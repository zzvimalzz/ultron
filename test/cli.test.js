'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { headlessArgs, parseStream } = require('../src/hub/cli');

const server = { command: 'C:\\Apps\\Ultron\\Ultron.exe', args: ['C:\\Apps\\Ultron\\hub\\server.js'], env: { ELECTRON_RUN_AS_NODE: '1', ULTRON_TASK: 't-1', ULTRON_RUN: 'r-1' } };
const files = { sessionId: 'session-1', mcpFile: 'run\\mcp.json', settingsFile: 'run\\settings.json', systemFile: 'run\\system.md', server };

test('Claude headless arguments', () => {
  const args = headlessArgs({ provider: 'claude', model: 'haiku', effort: 'low' }, files);
  assert.deepStrictEqual(args, [
    '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions',
    '--model', 'haiku', '--effort', 'low', '--session-id', files.sessionId,
    '--mcp-config', 'run\\mcp.json', '--settings', 'run\\settings.json', '--append-system-prompt-file', 'run\\system.md',
  ]);
  const resumed = headlessArgs({ provider: 'claude', model: '', effort: '' }, { ...files, resume: true });
  assert.deepStrictEqual(resumed.slice(resumed.indexOf('--resume'), resumed.indexOf('--resume') + 2), ['--resume', files.sessionId]);
  assert.ok(!resumed.includes('--session-id') && !resumed.includes('--model'));
});

test('Codex headless arguments use the sandbox and define the hub through -c', () => {
  const args = headlessArgs({ provider: 'chatgpt', model: 'gpt-x', effort: 'low' }, { ...files, sessionId: null });
  assert.deepStrictEqual(args.slice(0, 5), ['exec', '--json', '-m', 'gpt-x', '-c']);
  assert.ok(args.includes('sandbox_mode="workspace-write"') && args.includes('approval_policy="never"'));
  assert.ok(args.includes('mcp_servers.ultron-hub.command="C:\\\\Apps\\\\Ultron\\\\Ultron.exe"'));
  assert.ok(args.includes('mcp_servers.ultron-hub.args=["C:\\\\Apps\\\\Ultron\\\\hub\\\\server.js"]'));
  assert.ok(args.includes('mcp_servers.ultron-hub.env.ULTRON_TASK="t-1"'));
  assert.strictEqual(args.at(-1), '-');
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));

  const resumed = headlessArgs({ provider: 'chatgpt', model: '', effort: '' }, { ...files, resume: true, sessionId: 'thread-1' });
  assert.deepStrictEqual(resumed.slice(0, 4), ['exec', 'resume', 'thread-1', '--json']);
});

const CLAUDE_STREAM = [
  { type: 'system', subtype: 'init', session_id: 'sess-1', tools: [] },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Writing the page.' }, { type: 'tool_use', name: 'Write', input: { file_path: 'C:\\work\\hello.html', content: 'x' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }, { type: 'tool_use', name: 'Edit', input: { file_path: 'notes.md' } }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'Created hello.html and edited notes.md.', session_id: 'sess-1' },
].map(m => JSON.stringify(m));

test('parseStream reads a recorded Claude stream', () => {
  assert.deepStrictEqual(CLAUDE_STREAM.flatMap(line => parseStream('claude', line)), [
    { sessionId: 'sess-1' }, { file: 'C:\\work\\hello.html' }, { file: 'notes.md' }, { result: 'Created hello.html and edited notes.md.' },
  ]);
  assert.deepStrictEqual(parseStream('claude', JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true })), [{ error: 'error_max_turns' }]);
  assert.deepStrictEqual(parseStream('claude', 'not json'), []);
});

const CODEX_STREAM = [
  { type: 'thread.started', thread_id: 'thread-1' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'i0', type: 'reasoning', text: 'thinking' } },
  { type: 'item.completed', item: { id: 'i1', type: 'file_change', status: 'completed', changes: [{ path: 'C:\\work\\checklist.md', kind: 'add' }] } },
  { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Wrote checklist.md.' } },
  { type: 'turn.completed', usage: {} },
].map(m => JSON.stringify(m));

test('parseStream reads a recorded Codex exec stream', () => {
  assert.deepStrictEqual(CODEX_STREAM.flatMap(line => parseStream('chatgpt', line)), [
    { sessionId: 'thread-1' }, { file: 'C:\\work\\checklist.md' }, { result: 'Wrote checklist.md.' },
  ]);
  assert.deepStrictEqual(parseStream('chatgpt', JSON.stringify({ type: 'turn.failed', error: { message: 'Quota reached' } })), [{ error: 'Quota reached' }]);
  assert.deepStrictEqual(parseStream('chatgpt', JSON.stringify({ type: 'error', message: 'Boom' })), [{ error: 'Boom' }]);
});
