'use strict';
// Task records under ~/.ultron/tasks/<taskId>. Ultron, the hub servers and the run processes all
// write here, so every read-modify-write of a shared list takes a lock.
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { HUB_DIR, CREW_FILE, readJson, writeJson, unpacked } = require('./files');

const TASKS_DIR = path.join(HUB_DIR, 'tasks');
const RUN_SCRIPT = unpacked(path.join(__dirname, 'run.js'));
const LOCK_TRIES = 200;

const dirOf = taskId => path.join(TASKS_DIR, taskId);
const fileOf = (taskId, ...parts) => path.join(dirOf(taskId), ...parts);
const newId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function locked(taskId, fn) {
  const lock = fileOf(taskId, '.lock');
  for (let tries = 0; ; tries++) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx'));
      break;
    } catch (err) {
      // Windows reports EPERM while another process's delete of the lock file is still pending
      if (!['EEXIST', 'EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      if (tries >= LOCK_TRIES) fs.rmSync(lock, { force: true });
      else sleep(10);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

function mutate(taskId, name, fn) {
  return locked(taskId, () => {
    const list = readJson(fileOf(taskId, name), []);
    const result = fn(list);
    writeJson(fileOf(taskId, name), list);
    return result;
  });
}

function createTask({ title, prompt, folder }) {
  const task = { id: newId('t'), title, prompt, folder, leader: null, status: 'running', created: Date.now(), finished: null, checkpoint: null, summary: '' };
  fs.mkdirSync(dirOf(task.id), { recursive: true });
  writeJson(fileOf(task.id, 'task.json'), task);
  writeJson(fileOf(task.id, 'agents.json'), []);
  writeJson(fileOf(task.id, 'teams.json'), []);
  return task;
}

const readTask = taskId => readJson(fileOf(taskId, 'task.json'), null);

function updateTask(taskId, patch) {
  return locked(taskId, () => {
    const task = { ...readTask(taskId), ...patch };
    writeJson(fileOf(taskId, 'task.json'), task);
    return task;
  });
}

const agentsOf = taskId => readJson(fileOf(taskId, 'agents.json'), []);
const teamsOf = taskId => readJson(fileOf(taskId, 'teams.json'), []);

function addAgent(taskId, agent) {
  return mutate(taskId, 'agents.json', list => {
    const added = { team: null, parent: null, sessionId: null, ...agent, id: `agent-${list.length + 1}` };
    list.push(added);
    return added;
  });
}

function updateAgent(taskId, agentId, patch) {
  return mutate(taskId, 'agents.json', list => Object.assign(list.find(a => a.id === agentId), patch));
}

function addTeam(taskId, team) {
  return mutate(taskId, 'teams.json', list => {
    const added = { members: [], ...team, id: `team-${list.length + 1}` };
    list.push(added);
    return added;
  });
}

function updateTeam(taskId, teamId, patch) {
  return mutate(taskId, 'teams.json', list => Object.assign(list.find(t => t.id === teamId), patch));
}

function logEvent(taskId, event) {
  fs.appendFileSync(fileOf(taskId, 'events.jsonl'), `${JSON.stringify({ t: Date.now(), ...event })}\n`);
}

function eventsOf(taskId, limit = 200) {
  try {
    return fs.readFileSync(fileOf(taskId, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-limit).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

const runFile = (taskId, runId) => fileOf(taskId, 'runs', `${runId}.json`);

function startRunRecord(taskId, { agent, account, prompt }) {
  const run = { id: newId('r'), agent, account, status: 'running', pid: null, started: Date.now(), finished: null, prompt, result: '', files: [], exitCode: null };
  writeJson(runFile(taskId, run.id), run);
  return run;
}

const readRun = (taskId, runId) => readJson(runFile(taskId, runId), null);

function updateRun(taskId, runId, patch) {
  const run = { ...readRun(taskId, runId), ...patch };
  writeJson(runFile(taskId, runId), run);
  return run;
}

const finishRunRecord = (taskId, runId, { status, result, files, exitCode }) => updateRun(taskId, runId, { status, result, files, exitCode, finished: Date.now() });

function runsOf(taskId) {
  try {
    return fs.readdirSync(fileOf(taskId, 'runs')).filter(f => f.endsWith('.json')).map(f => readJson(fileOf(taskId, 'runs', f), null)).filter(Boolean)
      .sort((a, b) => a.started - b.started);
  } catch {
    return [];
  }
}

const isAlive = pid => {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
};

// A run that has no pid yet was just created and is being started.
const isLive = run => run.status === 'running' && (run.pid === null || isAlive(run.pid));

function listTasks() {
  try {
    return fs.readdirSync(TASKS_DIR).map(readTask).filter(Boolean).sort((a, b) => b.created - a.created);
  } catch {
    return [];
  }
}

function runningRunsByAccount() {
  const counts = {};
  for (const task of listTasks().filter(t => ['running', 'waiting'].includes(t.status) || t.finished > Date.now() - 3600 * 1000)) {
    for (const run of runsOf(task.id).filter(isLive)) counts[run.account] = (counts[run.account] || 0) + 1;
  }
  return counts;
}

// Runs whose process vanished without finishing (crash, killed with the PC) are closed as failed.
function reapDeadRuns() {
  for (const task of listTasks().filter(t => ['running', 'waiting'].includes(t.status))) {
    for (const run of runsOf(task.id).filter(r => r.status === 'running' && r.pid !== null && !isAlive(r.pid))) {
      finishRunRecord(task.id, run.id, { status: 'failed', result: 'The process ended without a report.', files: run.files, exitCode: null });
      logEvent(task.id, { type: 'run.finished', agent: run.agent, run: run.id, status: 'failed' });
      closeIfLeader(task.id, run.agent, 'failed', 'The leader process ended without a report.');
    }
  }
}

function closeIfLeader(taskId, agentId, status, summary) {
  const task = readTask(taskId);
  if (task.leader !== agentId) return;
  updateTask(taskId, { status: status === 'done' ? 'done' : 'failed', summary, finished: Date.now() });
  logEvent(taskId, { type: 'task.finished', agent: agentId, status });
}

const questionFile = (taskId, qid) => fileOf(taskId, 'questions', `${qid}.json`);
const readQuestion = (taskId, qid) => readJson(questionFile(taskId, qid), null);

function questionsOf(taskId) {
  try {
    return fs.readdirSync(fileOf(taskId, 'questions')).map(f => readJson(fileOf(taskId, 'questions', f), null)).filter(Boolean).sort((a, b) => a.created - b.created);
  } catch {
    return [];
  }
}

// `passes` links a question to the one a lead received, so answering it answers both.
function ask(taskId, { from, to, text, choices, handoffPrompt, passes }) {
  const question = { id: newId('q'), from, to, text, choices, handoffPrompt, passes, created: Date.now() };
  writeJson(questionFile(taskId, question.id), question);
  logEvent(taskId, { type: passes ? 'question.passed' : 'question.asked', agent: from, question: question.id, to });
  if (to === 'user') updateTask(taskId, { status: 'waiting' });
  return question;
}

function answer(taskId, qid, text, by) {
  const question = readQuestion(taskId, qid);
  if (question.answer !== undefined) return question;
  const answered = { ...question, answer: text, answeredBy: by, answered: Date.now() };
  writeJson(questionFile(taskId, qid), answered);
  logEvent(taskId, { type: 'question.answered', agent: by, question: qid });
  if (question.passes) answer(taskId, question.passes, text, by);
  if (question.to === 'user' && readTask(taskId).status === 'waiting' && !pendingFor(taskId, 'user').length) updateTask(taskId, { status: 'running' });
  return answered;
}

const markNotified = (taskId, qid) => writeJson(questionFile(taskId, qid), { ...readQuestion(taskId, qid), notified: true });

const pendingFor = (taskId, agentId) => questionsOf(taskId).filter(q => q.to === agentId && q.answer === undefined);

const capacityOf = (account, counts = runningRunsByAccount()) => (account.maxRuns || 1) - (counts[account.id] || 0);

// Starts one headless run as a detached process, so it outlives whoever asked for it.
function startRun(taskId, agentId, prompt) {
  const agent = agentsOf(taskId).find(a => a.id === agentId);
  const account = readJson(CREW_FILE, { agents: [] }).agents.find(a => a.id === agent.account);
  if (!account || !account.eligible) throw new Error(`${agent.title} has no eligible account.`);
  if (capacityOf(account) <= 0) throw new Error(`${account.name} is at capacity (${account.maxRuns || 1} runs). Wait for a run to finish, or use another account.`);
  const run = startRunRecord(taskId, { agent: agentId, account: account.id, prompt });
  logEvent(taskId, { type: 'run.started', agent: agentId, run: run.id, by: agent.parent });
  const child = childProcess.spawn(process.execPath, [RUN_SCRIPT, taskId, run.id], {
    detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.unref();
  return updateRun(taskId, run.id, { pid: child.pid });
}

module.exports = {
  dirOf, createTask, readTask, updateTask, agentsOf, teamsOf, addAgent, updateAgent, addTeam, updateTeam,
  logEvent, eventsOf, startRunRecord, readRun, updateRun, finishRunRecord, runsOf, isLive, listTasks,
  runningRunsByAccount, reapDeadRuns, closeIfLeader, questionsOf, readQuestion, markNotified, ask, answer, pendingFor, startRun,
};
