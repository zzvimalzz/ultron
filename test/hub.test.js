'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'src', 'hub', 'server.js');

function startHub(home, provider, cwd) {
  const child = spawn(process.execPath, [SERVER], { cwd, env: { ...process.env, USERPROFILE: home, HOME: home, ULTRON_PROVIDER: provider } });
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
    assert.deepStrictEqual(tools.map(t => t.name), ['crew', 'recall', 'remember', 'send_message', 'check_inbox']);

    const crewText = (await claude.tool('crew')).content[0].text;
    assert.match(crewText, /Claude 2 \(you\): paid · default · roles: code, svg · idle/);
    assert.match(crewText, /ChatGPT \(not in crew: free plan\): free · gpt-x\/high · roles: code, images/);
    assert.doesNotMatch(init.result.instructions, /Image and GIF/);
    assert.match(init.result.instructions, /Use the crew tool/);
    await claude.tool('remember', { title: 'Release process', text: 'Tag v* to publish the installer.' });
    assert.match((await chatgpt.tool('recall', { query: 'installer tag' })).content[0].text, /Release process/);

    assert.ok((await claude.tool('send_message', { to: 'nobody', text: 'hi' })).isError);
    await claude.tool('send_message', { to: 'ChatGPT', text: 'Please draw a GIF of the mascot.' });
    assert.match((await chatgpt.tool('check_inbox')).content[0].text, /From Claude 2 .*\n.*GIF of the mascot/);
    assert.match((await chatgpt.tool('check_inbox')).content[0].text, /No new messages/);

    const events = fs.readFileSync(path.join(home, '.ultron', 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepStrictEqual(events.map(e => e.type), ['memory', 'memory', 'message']);
    assert.strictEqual(events[2].from.agent, 'c2');
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
