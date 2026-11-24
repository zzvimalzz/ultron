'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-setup-'));
Object.assign(process.env, { HOME: TEMP, USERPROFILE: TEMP, LOCALAPPDATA: path.join(TEMP, 'Local'), APPDATA: path.join(TEMP, 'Roaming') });

const { appRows, runInstall } = require('../src/main/setup');
const { createStore, migrate } = require('../src/main/config');

function withPath(dirs, fn) {
  const saved = process.env.PATH;
  process.env.PATH = dirs.join(path.delimiter);
  try { return fn(); } finally { process.env.PATH = saved; }
}

const bin = (...names) => {
  const dir = fs.mkdtempSync(path.join(TEMP, 'bin-'));
  for (const name of names) fs.writeFileSync(path.join(dir, `${name}.cmd`), '@echo off\r\n');
  return dir;
};

test('an app that is missing shows its install command only when the installer is on PATH', () => {
  const none = withPath([bin()], appRows);
  const byId = rows => Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepStrictEqual([byId(none).git.installed, byId(none).git.command, byId(none)['codex-cli'].command, byId(none)['claude-desktop'].command], [false, null, null, null]);

  const tools = byId(withPath([bin('winget', 'npm')], appRows));
  assert.strictEqual(tools.git.command, 'winget install --id Git.Git -e');
  assert.strictEqual(tools['claude-cli'].command, 'winget install Anthropic.ClaudeCode');
  assert.strictEqual(tools['codex-cli'].command, 'npm i -g @openai/codex');
  assert.match(tools['chatgpt-desktop'].download, /^https:\/\//);
});

test('an app that is found shows as installed and nothing else', () => {
  const rows = withPath([bin('git', 'codex', 'claude', 'winget')], appRows);
  assert.deepStrictEqual(rows.filter(r => r.installed).map(r => r.id).sort(), ['claude-cli', 'codex-cli', 'git']);
});

test('runInstall only runs a known command whose installer is present', async () => {
  await assert.rejects(runInstall('claude-desktop'), /can't be run/);
  await assert.rejects(runInstall('nope'), /can't be run/);
  await assert.rejects(withPath([bin()], () => runInstall('git')), /can't be run/);
});

test('setup is skipped for configs that already have accounts and shown on a first run', async () => {
  assert.strictEqual(migrate({ accounts: [{ provider: 'claude' }] }).setupDone, true);
  assert.strictEqual(migrate({ accounts: [] }).setupDone, false);
  assert.strictEqual(migrate({ accounts: [{ provider: 'claude' }], setupDone: false }).setupDone, false);

  const file = path.join(TEMP, 'first-run.json');
  const store = createStore(file);
  const config = await store.load();
  assert.strictEqual(config.setupDone, false);
  store.update({ setupDone: true });
  assert.strictEqual(await createStore(file).load().then(c => c.setupDone), true);
});
