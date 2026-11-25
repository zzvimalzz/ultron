'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sessionTarget } = require('../src/main/targets');

test('a session opens where its transcript says it runs', () => {
  const route = (provider, entrypoint) => sessionTarget({ entrypoint }, provider);
  assert.strictEqual(route('claude', 'claude-desktop'), 'claude-desktop');
  assert.strictEqual(route('claude', 'claude-vscode'), 'vscode');
  assert.strictEqual(route('claude', 'cli'), 'claude-cli');
  assert.strictEqual(route('claude', undefined), 'claude-cli');
  assert.strictEqual(route('chatgpt', 'Codex Desktop'), 'chatgpt-desktop');
  assert.strictEqual(route('chatgpt', 'codex_vscode'), 'vscode');
  assert.strictEqual(route('chatgpt', 'codex_cli_rs'), 'codex-cli');
});
