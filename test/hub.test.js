'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'src', 'hub', 'server.js');

function startHub(home, provider, cwd, extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], { cwd, env: { ...process.env, USERPROFILE: home, HOME: home, ULTRON_PROVIDER: provider, ...extraEnv } });
  const pending = new Map();
  let buffer = '';
  let nextId = 1;
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      pending.get(msg.id)(msg);
    }
  });
  child.on('exit', code => pending.forEach(resolve => resolve({ error: { message: `hub exited with ${code}` } })));
  const call = (method, params) => new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const tool = async (name, args = {}) => (await call('tools/call', { name, arguments: args })).result;
  return { call, tool, stop: () => child.kill() };
}

test('hub shares memory and routes messages between agents', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-hub-'));
  const project = path.join(home, 'project');
  fs.mkdirSync(path.join(home, '.ultron'), { recursive: true });
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(home, '.ultron', 'crew.json'), JSON.stringify({
    leader: 'c1',
    agents: [
      { id: 'c1', name: 'Claude 1', provider: 'claude', model: '', effort: '', roles: ['code', 'svg'], tier: 'paid', eligible: true, status: 'working' },
      { id: 'c2', name: 'Claude 2', provider: 'claude', model: '', effort: '', roles: ['code', 'svg'], tier: 'paid', eligible: true, status: 'idle' },
      { id: 'g1', name: 'ChatGPT', provider: 'chatgpt', model: 'gpt-x', effort: 'high', roles: ['code', 'images'], tier: 'free', eligible: false, status: 'idle' },
    ],
  }));
  fs.writeFileSync(path.join(home, '.ultron', 'sessions.json'), JSON.stringify([{ agent: 'c2', provider: 'claude', cwd: project, last: Date.now() }]));

  const claude = startHub(home, 'claude', project);
  const chatgpt = startHub(home, 'chatgpt', home);
  try {
    const init = await claude.call('initialize', { protocolVersion: '2025-06-18' });
    assert.match(init.result.instructions, /The leader is Claude 1/);
    const { tools } = (await claude.call('tools/list')).result;
    assert.deepStrictEqual(tools.map(t => t.name), ['crew', 'context', 'recall', 'remember', 'update', 'forget', 'send_message', 'check_inbox']);

    const crewText = (await claude.tool('crew')).content[0].text;
    assert.match(crewText, /Claude 2 \(you\): paid · default · roles: code, svg · idle/);
    assert.match(crewText, /ChatGPT \(not in crew: free plan\): free · gpt-x\/high · roles: code, images/);
    assert.doesNotMatch(init.result.instructions, /Image and GIF/);
    assert.match(init.result.instructions, /Use the crew tool/);
    assert.ok(init.result.instructions.includes(path.join(home, '.ultron', 'memory')));
    const noteText = 'Tag v* to publish the installer.';
    assert.match((await claude.tool('remember', { kind: 'session', title: 'Release process', text: noteText })).content[0].text, /Saved to sessions\//);
    assert.match((await chatgpt.tool('recall', { query: 'installer tag' })).content[0].text, /Release process/);
    assert.match((await claude.tool('context')).content[0].text, /# Memory/);
    assert.ok((await claude.tool('remember', { kind: 'fact', text: 'password: hunter2' })).isError);
    await claude.tool('remember', { kind: 'area', title: 'Garden', text: 'Water the beds.' });
    await claude.tool('update', { file: 'areas/garden.md', text: '# Garden\n\nWater daily.\n' });
    await claude.tool('forget', { file: 'areas/garden.md' });

    assert.ok((await claude.tool('send_message', { to: 'nobody', text: 'hi' })).isError);
    await claude.tool('send_message', { to: 'ChatGPT', text: 'Please draw a GIF of the mascot.' });
    assert.match((await chatgpt.tool('check_inbox')).content[0].text, /From Claude 2 .*\n.*GIF of the mascot/);
    assert.match((await chatgpt.tool('check_inbox')).content[0].text, /No new messages/);

    const events = fs.readFileSync(path.join(home, '.ultron', 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepStrictEqual(events.map(e => `${e.type}:${e.action || ''}`), [
      'memory:saved', 'memory:recalled', 'memory:context', 'memory:saved', 'memory:updated', 'memory:archived', 'message:',
    ]);
    assert.deepStrictEqual(events.filter(e => e.type === 'memory').map(e => e.title), ['session: Release process', 'installer tag', 'memory', 'area: Garden', 'Garden', 'Garden']);
    assert.ok(!JSON.stringify(events).includes(noteText));
    assert.strictEqual(events[6].from.agent, 'c2');
  } finally {
    claude.stop();
    chatgpt.stop();
  }
});

test('Codex config keeps other tables when the hub entry is removed', () => {
  const { withoutHubTables } = require('../src/main/agents');
  const toml = [
    'model = "x"', '', '[mcp_servers.other]', "command = 'a'", '',
    '[mcp_servers.ultron-hub]', "command = 'b'", '', '[mcp_servers.ultron-hub.env]', "K = '1'", '',
    '[profiles.p]', 'k = 1',
  ].join('\n');
  const out = withoutHubTables(toml);
  assert.doesNotMatch(out, /ultron-hub|command = 'b'|K = '1'/);
  assert.match(out, /\[mcp_servers\.other\]\ncommand = 'a'/);
  assert.match(out, /\[profiles\.p\]\nk = 1/);
});

const STUB = `
const fs = require('fs');
const path = require('path');
let prompt = '';
process.stdin.on('data', d => { prompt += d; }).on('end', () => {
  const m = /write (\\S+)/.exec(prompt);
  if (m) fs.writeFileSync(m[1], '<p>hi</p>');
  const lines = [
    { type: 'system', subtype: 'init', session_id: 'stub-session' },
    m && { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(process.cwd(), m[1]) } }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Done: ' + (m ? m[1] : 'nothing') },
  ].filter(Boolean);
  for (const line of lines) console.log(JSON.stringify(line));
});
`;

test('task tools: visibility by role, delegation through runs, and early wait on a question', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-team-'));
  const folder = path.join(home, 'work');
  const taskDir = path.join(home, '.ultron', 'tasks', 't-test');
  fs.mkdirSync(folder);
  fs.mkdirSync(taskDir, { recursive: true });
  const stub = path.join(home, 'stub-cli.js');
  fs.writeFileSync(stub, STUB);
  const account = (id, extra) => ({ id, name: `Claude ${id}`, provider: 'claude', model: '', effort: '', roles: ['code', 'ui', 'qa'], tier: 'paid', eligible: true, maxRuns: 2, status: 'idle', home: path.join(home, id), ...extra });
  fs.writeFileSync(path.join(home, '.ultron', 'crew.json'), JSON.stringify({ leader: 'c1', memoryDir: path.join(home, 'vault'), agents: [account('c1'), account('c2'), account('c3', { eligible: false, tier: 'free' })] }));
  fs.writeFileSync(path.join(taskDir, 'task.json'), JSON.stringify({ id: 't-test', title: 'Test', prompt: 'x', folder, leader: 'agent-1', status: 'running', created: Date.now() }));
  fs.writeFileSync(path.join(taskDir, 'agents.json'), JSON.stringify([{ id: 'agent-1', title: 'Leader', kind: 'code', role: 'leader', team: null, parent: null, account: 'c1', sessionId: null }]));
  fs.writeFileSync(path.join(taskDir, 'teams.json'), '[]');

  const as = (role, agent) => ({ ULTRON_TASK: 't-test', ULTRON_RUN: 'r-0', ULTRON_AGENT: agent, ULTRON_ROLE: role, ULTRON_STUB_CLI: stub });
  const names = async hub => (await hub.call('tools/list')).result.tools.map(t => t.name);
  const outside = startHub(home, 'claude', folder);
  const leader = startHub(home, 'claude', folder, as('leader', 'agent-1'));
  const lead = startHub(home, 'claude', folder, as('lead', 'agent-2'));
  const member = startHub(home, 'claude', folder, as('member', 'agent-3'));
  const base = ['crew', 'context', 'recall', 'remember', 'update', 'forget', 'send_message', 'check_inbox'];
  try {
    assert.deepStrictEqual(await names(outside), base);
    assert.deepStrictEqual(await names(leader), [...base, 'create_team', 'delegate', 'wait', 'answer', 'ask_up', 'runs']);
    assert.deepStrictEqual(await names(lead), [...base, 'delegate', 'wait', 'answer', 'ask_up', 'runs']);
    assert.deepStrictEqual(await names(member), [...base, 'ask_up']);
    assert.match((await outside.call('tools/call', { name: 'delegate', arguments: {} })).error.message, /Unknown tool delegate/);

    const team = (await leader.tool('create_team', {
      name: 'UI team', purpose: 'Build the page', lead: { title: 'UI/UX lead', kind: 'ui' }, members: [{ title: 'Designer', kind: 'ui' }],
    })).content[0].text;
    assert.match(team, /Lead: agent-2: UI\/UX lead \(Claude c[12]\)/);
    assert.match(team, /agent-3: Designer/);
    assert.ok((await leader.tool('create_team', { name: 'x', purpose: 'y', lead: { title: 'Artist', kind: 'images' } })).isError, 'no account has the images kind');
    assert.ok((await leader.tool('delegate', { to: 'agent-3', task: 'x' })).isError, 'a member is not a direct report of the leader');

    const started = JSON.parse((await leader.tool('delegate', { to: 'agent-2', task: 'please write hello.html', files: ['hello.html'] })).content[0].text);
    const report = JSON.parse((await leader.tool('wait', { runIds: [started.runId] })).content[0].text);
    assert.deepStrictEqual(report.finished.map(r => [r.runId, r.status, r.result, r.files]), [[started.runId, 'done', 'Done: hello.html', ['hello.html']]]);
    assert.strictEqual(fs.readFileSync(path.join(folder, 'hello.html'), 'utf8'), '<p>hi</p>');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(taskDir, 'agents.json'), 'utf8'))[1].sessionId, 'stub-session');
    assert.match(fs.readFileSync(path.join(taskDir, 'runs', `${started.runId}.log`), 'utf8'), /stub-session/);
    const guardSettings = JSON.parse(fs.readFileSync(path.join(taskDir, 'runs', started.runId, 'settings.json'), 'utf8'));
    assert.match(guardSettings.hooks.PreToolUse[0].hooks[0].command, /guard\.js/);
    assert.match(fs.readFileSync(path.join(taskDir, 'runs', started.runId, 'system.md'), 'utf8'), /You lead the UI team team for: Build the page\./);

    const events = fs.readFileSync(path.join(taskDir, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepStrictEqual(events.map(e => e.type), ['team.created', 'run.started', 'run.finished']);
    assert.strictEqual(events[1].by, 'agent-1');

    const idle = JSON.parse((await leader.tool('wait', { seconds: 5 })).content[0].text);
    assert.deepStrictEqual([idle.finished, idle.questions, idle.running], [[], [], []], 'nothing running returns at once');

    const asked = { id: 'q-1', from: 'agent-2', to: 'agent-1', text: 'Which palette?', choices: ['Light', 'Dark'], created: Date.now() };
    fs.mkdirSync(path.join(taskDir, 'questions'));
    fs.writeFileSync(path.join(taskDir, 'questions', 'q-1.json'), JSON.stringify(asked));
    const second = JSON.parse((await leader.tool('delegate', { to: 'agent-2', task: 'carry on' })).content[0].text);
    const early = JSON.parse((await leader.tool('wait', {})).content[0].text);
    assert.deepStrictEqual(early.questions.map(q => [q.id, q.text, q.choices]), [['q-1', 'Which palette?', ['Light', 'Dark']]]);
    assert.ok(early.running.length + early.finished.length >= 1);
    assert.match((await leader.tool('answer', { questionId: 'q-1', text: 'Dark' })).content[0].text, /Answered/);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(taskDir, 'questions', 'q-1.json'), 'utf8')).answer, 'Dark');
    const rest = JSON.parse((await leader.tool('wait', { runIds: [second.runId] })).content[0].text);
    assert.strictEqual(rest.finished[0].status, 'done');
    assert.ok((await lead.tool('answer', { questionId: 'q-1', text: 'x' })).isError, 'the question was not asked to the lead');
    assert.match((await leader.tool('runs')).content[0].text, /"title": "UI\/UX lead"/);
  } finally {
    [outside, leader, lead, member].forEach(hub => hub.stop());
  }
});
