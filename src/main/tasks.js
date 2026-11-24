'use strict';
// Starts, stops and reads Ultron tasks. The work itself happens in detached run processes (hub/run.js).
const fs = require('fs');
const { clipboard } = require('electron');
const checkpoint = require('../hub/checkpoint');
const { CLIS, cliEnv, killTree, signedIn, which } = require('../hub/cli');
const hub = require('../hub/tasks');
const crew = require('./crew');
const { PROVIDERS, inTerminal, openAccount } = require('./targets');

const TITLE_CHARS = 60;
const KEEP_DAYS = 14;
const DAY_MS = 24 * 3600 * 1000;
const FINISHED = ['done', 'failed', 'stopped'];

// `isEligible(account)` and `publishCrew()` come from the app, which knows plans and live status.
function createTasks({ store, isEligible, publishCrew, onQuestion }) {
  const announced = new Set();
  const changedCache = new Map();
  const accountOf = id => store.get().accounts.find(a => a.id === id);

  async function start({ prompt, folder }) {
    const config = store.get();
    const leader = accountOf(crew.leaderId(config));
    if (!leader || !isEligible(leader)) throw new Error('The leader needs a paid plan. Choose another leader.');
    if (!checkpoint.available()) throw new Error('Install Git to enable undo');
    if (!which(CLIS[leader.provider].command)) throw new Error(`${PROVIDERS[leader.provider].label} CLI isn't installed`);
    if (!signedIn(leader)) throw new Error('Not signed in');
    if (!folder || !fs.existsSync(folder)) throw new Error('Choose an existing folder');
    await publishCrew();

    const task = hub.createTask({ title: prompt.trim().slice(0, TITLE_CHARS), prompt, folder });
    const agent = hub.addAgent(task.id, { title: 'Leader', kind: leader.roles[0] || 'code', role: 'leader', account: leader.id });
    hub.updateTask(task.id, { leader: agent.id, checkpoint: checkpoint.create(task.id, folder) });
    hub.logEvent(task.id, { type: 'task.started', agent: agent.id });
    try {
      hub.startRun(task.id, agent.id, prompt);
    } catch (err) {
      hub.updateTask(task.id, { status: 'failed', summary: err.message, finished: Date.now() });
      throw err;
    }
    return task.id;
  }

  function stop(taskId) {
    for (const run of hub.runsOf(taskId).filter(hub.isLive)) {
      if (run.pid) killTree(run.pid);
      hub.updateRun(taskId, run.id, { status: 'stopped', finished: Date.now() });
    }
    if (!FINISHED.includes(hub.readTask(taskId).status)) {
      hub.updateTask(taskId, { status: 'stopped', finished: Date.now() });
      hub.logEvent(taskId, { type: 'task.finished', status: 'stopped' });
    }
  }

  async function answerUser(taskId, questionId, answer) {
    const question = hub.readQuestion(taskId, questionId);
    hub.answer(taskId, questionId, answer, 'user');
    if (!question.handoffPrompt || !/chatgpt/i.test(answer)) return;
    clipboard.writeText(question.handoffPrompt);
    const chatgpt = store.get().accounts.find(a => a.provider === 'chatgpt');
    if (chatgpt) await openAccount(chatgpt, chatgpt.openWith, store.get().accounts);
  }

  function undo(taskId) {
    stop(taskId);
    const task = hub.readTask(taskId);
    checkpoint.restore(taskId, task.folder, task.checkpoint);
    hub.logEvent(taskId, { type: 'undo' });
  }

  // The leader's session reopened in a terminal, with the task's variables so the hub tools stay available.
  function terminal(taskId) {
    const task = hub.readTask(taskId);
    const agent = hub.agentsOf(taskId).find(a => a.id === task.leader);
    const account = accountOf(agent.account);
    const cli = CLIS[account.provider];
    const run = hub.runsOf(taskId).filter(r => r.agent === agent.id).pop();
    const env = cliEnv(account, { ...process.env, ULTRON_TASK: taskId, ULTRON_RUN: run?.id || '', ULTRON_AGENT: agent.id, ULTRON_ROLE: 'leader', ULTRON_FOLDER: task.folder });
    const args = account.provider === 'claude' ? ['--resume', agent.sessionId] : ['resume', agent.sessionId];
    return inTerminal('Ultron task', which(cli.command), args, env, task.folder);
  }

  const list = () => hub.listTasks().map(({ id, title, status, created, finished }) => ({ id, title, status, created, finished }));

  function get(taskId) {
    const task = hub.readTask(taskId);
    if (!task) return null;
    const events = hub.eventsOf(taskId);
    const key = `${task.status}|${task.finished}|${events.length}`;
    if (FINISHED.includes(task.status) && changedCache.get(taskId)?.key !== key) {
      changedCache.set(taskId, { key, files: checkpoint.changed(taskId, task.folder, task.checkpoint) });
    }
    return {
      dir: hub.dirOf(taskId), task, agents: hub.agentsOf(taskId), teams: hub.teamsOf(taskId), runs: hub.runsOf(taskId),
      questions: hub.questionsOf(taskId), events, changed: FINISHED.includes(task.status) ? changedCache.get(taskId).files : null,
    };
  }

  const active = () => hub.listTasks().some(t => ['running', 'waiting'].includes(t.status));

  // Called from the live tick: closes dead runs, announces new questions, and returns a signature that changes with any task activity.
  function poll() {
    hub.reapDeadRuns();
    let signature = '';
    for (const task of hub.listTasks().slice(0, 20)) {
      signature += `${task.id}${task.status}${hub.eventsOf(task.id, 1)[0]?.t || ''};`;
      for (const question of hub.pendingFor(task.id, 'user').filter(q => !announced.has(q.id))) {
        announced.add(question.id);
        onQuestion(question, task);
      }
    }
    return signature;
  }

  // A checkpoint is only useful for a while; after KEEP_DAYS the task and its shadow repository go.
  function sweep() {
    for (const task of hub.listTasks().filter(t => (t.finished || t.created) < Date.now() - KEEP_DAYS * DAY_MS && !['running', 'waiting'].includes(t.status))) {
      checkpoint.remove(task.id);
      fs.rmSync(hub.dirOf(task.id), { recursive: true, force: true });
    }
  }

  return { start, stop, answerUser, undo, terminal, list, get, active, poll, sweep };
}

module.exports = { createTasks };
