'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-tasks-'));
process.env.USERPROFILE = home;
process.env.HOME = home;
const tasks = require('../src/hub/tasks');
const { pickAccount } = require('../src/hub/team-tools');

const newTask = () => tasks.createTask({ title: 'Make a page', prompt: 'Make a page', folder: path.join(home, 'work') });

test('task, agent, team and event records', () => {
  const task = newTask();
  assert.match(task.id, /^t-[a-z0-9]+-[a-z0-9]{4}$/);
  assert.strictEqual(tasks.readTask(task.id).status, 'running');

  const leader = tasks.addAgent(task.id, { title: 'Leader', kind: 'code', role: 'leader', account: 'c1' });
  const lead = tasks.addAgent(task.id, { title: 'QA lead', kind: 'qa', role: 'lead', account: 'c2', parent: leader.id });
  assert.deepStrictEqual([leader.id, lead.id, lead.parent, lead.sessionId], ['agent-1', 'agent-2', 'agent-1', null]);
  tasks.updateAgent(task.id, lead.id, { sessionId: 's-1' });
  assert.strictEqual(tasks.agentsOf(task.id)[1].sessionId, 's-1');

  const team = tasks.addTeam(task.id, { name: 'QA', purpose: 'Check it', lead: lead.id });
  tasks.updateTeam(task.id, team.id, { members: ['agent-3'] });
  assert.deepStrictEqual(tasks.teamsOf(task.id)[0].members, ['agent-3']);

  tasks.updateTask(task.id, { leader: leader.id });
  tasks.logEvent(task.id, { type: 'team.created', agent: leader.id });
  tasks.logEvent(task.id, { type: 'task.started' });
  assert.deepStrictEqual(tasks.eventsOf(task.id).map(e => e.type), ['team.created', 'task.started']);
  assert.strictEqual(tasks.eventsOf(task.id, 1)[0].type, 'task.started');
  assert.ok(tasks.listTasks().some(t => t.id === task.id));
});

test('concurrent agent writes do not lose records', async () => {
  const task = newTask();
  const script = `const t = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'hub', 'tasks'))}); for (let i = 0; i < 10; i++) t.addAgent(${JSON.stringify(task.id)}, { title: 'a', role: 'member', account: 'c1' });`;
  const results = await Promise.all([1, 2, 3].map(() => new Promise(resolve => {
    require('child_process').execFile(process.execPath, ['-e', script], { env: process.env }, err => resolve(err));
  })));
  assert.deepStrictEqual(results, [null, null, null]);
  assert.deepStrictEqual(new Set(tasks.agentsOf(task.id).map(a => a.id)).size, 30);
});

test('questions climb the hierarchy and answers flow back down', () => {
  const task = newTask();
  const memberQuestion = tasks.ask(task.id, { from: 'agent-3', to: 'agent-2', text: 'Delete the old build?', choices: ['Yes', 'No'] });
  assert.deepStrictEqual(tasks.pendingFor(task.id, 'agent-2').map(q => q.id), [memberQuestion.id]);
  assert.deepStrictEqual(tasks.pendingFor(task.id, 'agent-1'), []);

  const leadQuestion = tasks.ask(task.id, { from: 'agent-2', to: 'agent-1', text: 'The member asks to delete the build', passes: memberQuestion.id });
  const leaderQuestion = tasks.ask(task.id, { from: 'agent-1', to: 'user', text: 'Delete the old build?', passes: leadQuestion.id });
  assert.strictEqual(tasks.readTask(task.id).status, 'waiting');
  assert.deepStrictEqual(tasks.pendingFor(task.id, 'user').map(q => q.id), [leaderQuestion.id]);

  tasks.answer(task.id, leaderQuestion.id, 'No', 'user');
  assert.strictEqual(tasks.readTask(task.id).status, 'running');
  for (const q of [memberQuestion, leadQuestion, leaderQuestion]) assert.strictEqual(tasks.readQuestion(task.id, q.id).answer, 'No');
  assert.strictEqual(tasks.readQuestion(task.id, memberQuestion.id).answeredBy, 'user');
  assert.deepStrictEqual(tasks.pendingFor(task.id, 'agent-2'), []);
  assert.deepStrictEqual(tasks.eventsOf(task.id).map(e => e.type), [
    'question.asked', 'question.passed', 'question.passed', 'question.answered', 'question.answered', 'question.answered',
  ]);
});

test('pickAccount respects eligibility, roles, capacity and preference', () => {
  const account = (id, extra) => ({ id, name: id.toUpperCase(), eligible: true, roles: ['code', 'qa'], maxRuns: 2, tokens24h: 0, ...extra });
  const accounts = [account('a'), account('b'), account('c', { eligible: false }), account('d', { roles: ['images'] })];
  assert.strictEqual(pickAccount(accounts, 'images', undefined, {}).id, 'd');
  assert.strictEqual(pickAccount(accounts, 'ui', undefined, {}), null);
  assert.notStrictEqual(pickAccount(accounts, 'code', undefined, {})?.id, 'c');
  assert.strictEqual(pickAccount(accounts, 'code', 'b', {}).id, 'b');
  assert.strictEqual(pickAccount(accounts, 'code', 'B', {}).id, 'b');
  assert.strictEqual(pickAccount(accounts, 'code', 'c', {}).id, 'a', 'an ineligible preference falls back to the best fit');
  assert.strictEqual(pickAccount(accounts, 'code', 'b', { b: 2 }).id, 'a', 'a full preference falls back');
  assert.strictEqual(pickAccount(accounts, 'code', undefined, { a: 1 }).id, 'b', 'most spare capacity wins');
  assert.strictEqual(pickAccount(accounts, 'code', undefined, {}, { a: 1 }).id, 'b', 'then fewest agents in the task');
  assert.strictEqual(pickAccount([account('a', { tokens24h: 90 }), account('b', { tokens24h: 10 })], 'code', undefined, {}).id, 'b', 'then least used');
  assert.strictEqual(pickAccount(accounts, 'code', undefined, { a: 2, b: 2 }), null);
});

test('runningRunsByAccount ignores dead processes', () => {
  const task = newTask();
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  const live = tasks.startRunRecord(task.id, { agent: 'agent-1', account: 'acct-live', prompt: 'x' });
  tasks.updateRun(task.id, live.id, { pid: process.pid });
  const gone = tasks.startRunRecord(task.id, { agent: 'agent-2', account: 'acct-dead', prompt: 'x' });
  tasks.updateRun(task.id, gone.id, { pid: dead });
  const finished = tasks.startRunRecord(task.id, { agent: 'agent-3', account: 'acct-live', prompt: 'x' });
  tasks.updateRun(task.id, finished.id, { pid: process.pid });
  tasks.finishRunRecord(task.id, finished.id, { status: 'done', result: 'ok', files: [], exitCode: 0 });

  assert.deepStrictEqual(tasks.runningRunsByAccount(), { 'acct-live': 1 });
  tasks.reapDeadRuns();
  assert.strictEqual(tasks.readRun(task.id, gone.id).status, 'failed');
  assert.strictEqual(tasks.readRun(task.id, live.id).status, 'running');
});
