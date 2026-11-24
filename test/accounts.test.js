'use strict';
const test = require('node:test');
const assert = require('node:assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Every path the modules resolve at load time points at a temp folder, never the real user data.
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-accounts-'));
Object.assign(process.env, { HOME: TEMP, USERPROFILE: TEMP, LOCALAPPDATA: path.join(TEMP, 'Local'), APPDATA: path.join(TEMP, 'Roaming') });

const { CLIS, cliEnv, modelArgs, signedIn, spawnCli } = require('../src/hub/cli');
const { blankAccount, createStore, migrate } = require('../src/main/config');
const { availableTargets, openAccount } = require('../src/main/targets');

const acct = (provider, cliHome = '') => ({ id: `${provider}-1`, provider, cliHome });

test('cliEnv sets the home variable only for an account with its own home', () => {
  const base = { PATH: 'x', ELECTRON_RUN_AS_NODE: '1' };
  assert.deepStrictEqual(cliEnv(acct('claude'), base), { PATH: 'x' });
  assert.deepStrictEqual(cliEnv(acct('claude', 'C:\\homes\\one'), base), { PATH: 'x', CLAUDE_CONFIG_DIR: 'C:\\homes\\one' });
  assert.strictEqual(cliEnv(acct('chatgpt', 'C:\\homes\\two'), base).CODEX_HOME, 'C:\\homes\\two');
  assert.strictEqual(base.ELECTRON_RUN_AS_NODE, '1');
});

test('signedIn only checks that the credentials file exists', () => {
  const home = fs.mkdtempSync(path.join(TEMP, 'home-'));
  assert.strictEqual(signedIn(acct('claude', home)), false);
  fs.writeFileSync(path.join(home, CLIS.claude.credentials), '');
  assert.strictEqual(signedIn(acct('claude', home)), true);
  assert.strictEqual(signedIn(acct('chatgpt', home)), false);
});

test('a new account gets its own CLI home under the hub folder, created when the account is saved', async () => {
  const fresh = blankAccount('chatgpt', []);
  assert.strictEqual(fresh.cliHome, path.join(TEMP, '.ultron', 'homes', fresh.id));
  assert.strictEqual(fs.existsSync(fresh.cliHome), false);
  const store = createStore(path.join(TEMP, 'config.json'));
  await store.load();
  store.update({ accounts: [fresh] });
  assert.strictEqual(fs.existsSync(fresh.cliHome), true);
});

test('a second ChatGPT account opens in the CLI because the desktop app holds one account', async () => {
  const first = blankAccount('chatgpt', []);
  const second = blankAccount('chatgpt', [first]);
  assert.strictEqual(first.openWith, 'chatgpt-desktop');
  assert.strictEqual(second.openWith, 'codex-cli');
  const lockOf = (account, id) => availableTargets(account, [first, second]).find(t => t.id === id)?.locked ?? null;
  assert.ok([null, 'ChatGPT Desktop holds one account'].includes(lockOf(second, 'chatgpt-desktop')));
  assert.strictEqual(lockOf(first, 'chatgpt-desktop'), null);
  await assert.rejects(openAccount(second, 'chatgpt-desktop', [first, second]), /isn't installed|holds one account/);
});

test('spawnCli runs npm shims through cmd.exe and everything else directly', () => {
  const calls = [];
  const real = childProcess.spawn;
  childProcess.spawn = (...args) => { calls.push(args); return {}; };
  try {
    spawnCli('C:\\bin\\codex.cmd', ['exec', 'a b'], { cwd: 'x' });
    spawnCli('C:\\bin\\claude.exe', ['-p'], { cwd: 'y' });
  } finally {
    childProcess.spawn = real;
  }
  assert.strictEqual(calls[0][0], 'cmd.exe');
  assert.deepStrictEqual(calls[0][1], ['/d', '/s', '/c', '"C:\\bin\\codex.cmd exec "a b""']);
  assert.strictEqual(calls[0][2].windowsVerbatimArguments, true);
  assert.strictEqual(calls[0][2].cwd, 'x');
  assert.deepStrictEqual(calls[1], ['C:\\bin\\claude.exe', ['-p'], { cwd: 'y' }]);
});

test('modelArgs builds the arguments for each CLI from the chosen model and effort', () => {
  const both = { model: 'sonnet', effort: 'low' };
  assert.deepStrictEqual(modelArgs({ provider: 'claude', ...both }), ['--model', 'sonnet', '--effort', 'low']);
  assert.deepStrictEqual(modelArgs({ provider: 'claude', model: '', effort: 'low' }), ['--effort', 'low']);
  assert.deepStrictEqual(modelArgs({ provider: 'chatgpt', ...both }), ['-m', 'sonnet', '-c', 'model_reasoning_effort=low']);
  assert.deepStrictEqual(modelArgs({ provider: 'chatgpt', model: 'm', effort: '' }), ['-m', 'm']);
  assert.deepStrictEqual(modelArgs({ provider: 'chatgpt', model: '', effort: '' }), []);
});

test('migrate adds the model, roles and crew fields and keeps values already set', () => {
  const config = migrate({ accounts: [{ provider: 'claude', model: 'opus', roles: ['qa'] }, { provider: 'chatgpt' }] });
  const [claude, chatgpt] = config.accounts;
  assert.deepStrictEqual([claude.model, claude.effort, claude.roles, claude.inCrew, claude.maxRuns], ['opus', '', ['qa'], true, 2]);
  assert.deepStrictEqual(chatgpt.roles, ['code', 'images', 'research', 'review']);
});

test('Gemini and Grok are launch-only: web target only, no CLI home, never in the crew', () => {
  const { installs, isLaunchOnly } = require('../src/main/targets');
  const { publish, crewMap, leaderId } = require('../src/main/crew');
  const gemini = blankAccount('gemini', []);
  const grok = blankAccount('grok', [gemini]);
  const claude = { ...blankAccount('claude', []), id: 'claude-1' };
  assert.deepStrictEqual([isLaunchOnly('gemini'), isLaunchOnly('grok'), isLaunchOnly('claude')], [true, true, false]);
  assert.deepStrictEqual([gemini.name, grok.name, gemini.openWith, gemini.cliHome, gemini.inCrew, gemini.roles], ['Gemini 1', 'Grok 1', 'web', '', false, []]);
  assert.deepStrictEqual(availableTargets(gemini, [gemini, grok]).map(t => t.id), ['web']);
  assert.strictEqual(signedIn(gemini), false);
  assert.deepStrictEqual(installs().gemini, { label: 'Gemini', color: 7, launchOnly: true });

  const config = { accounts: [gemini, grok, claude], crew: { leader: gemini.id }, memory: { dir: TEMP }, connected: false };
  assert.strictEqual(leaderId({ ...config, crew: { leader: null } }), 'claude-1');
  publish(config, {}, []);
  const published = JSON.parse(fs.readFileSync(path.join(TEMP, '.ultron', 'crew.json'), 'utf8'));
  assert.deepStrictEqual(published.agents.map(a => a.id), ['claude-1']);
  assert.deepStrictEqual(crewMap(config, {}, []).agents.map(a => [a.id, a.launchOnly, a.eligible]), [[gemini.id, true, false], [grok.id, true, false], ['claude-1', false, false]]);
});

test('migrate gives a launch-only account no roles and keeps it out of the crew', () => {
  const [gemini] = migrate({ accounts: [{ provider: 'gemini' }] }).accounts;
  assert.deepStrictEqual([gemini.roles, gemini.openWith], [[], 'web']);
});
