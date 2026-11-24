'use strict';
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');
const { LOCAL, findPackage } = require('./profiles');
const { CLIS, exists, which, cliEnv, modelArgs } = require('../hub/cli');
const { HUB_DIR } = require('../hub/files');

// multiDesktop: Claude runs one window per --user-data-dir; ChatGPT is a single-instance MSIX.
const PROVIDERS = {
  claude: { label: 'Claude', web: 'https://claude.ai', download: 'https://claude.ai/download', defaultTarget: 'claude-desktop', cliTarget: 'claude-cli', multiDesktop: true },
  chatgpt: { label: 'ChatGPT', web: 'https://chatgpt.com', download: 'https://chatgpt.com/download', defaultTarget: 'chatgpt-desktop', cliTarget: 'codex-cli', multiDesktop: false },
};

// Microsoft Store build first, then the standalone installer's location.
const CLAUDE_EXES = [
  path.join(LOCAL, 'Microsoft', 'WindowsApps', 'claude-desktop.exe'),
  path.join(LOCAL, 'AnthropicClaude', 'claude.exe'),
];

function splitArgs(s) {
  const out = [];
  let cur = '', quoted = false, started = false;
  for (const ch of s || '') {
    if (ch === '"') { quoted = !quoted; started = true; continue; }
    if (/\s/.test(ch) && !quoted) {
      if (started) out.push(cur);
      cur = ''; started = false;
      continue;
    }
    cur += ch; started = true;
  }
  if (started) out.push(cur);
  return out;
}

function detached(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...options });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

// `start` gives the CLI its own console window with real stdio; a detached spawn would hand it NUL handles.
function inTerminal(title, exe, args, env, cwd = os.homedir()) {
  const line = `"start "${title.replace(/"/g, '')}" /D "${cwd}" "${exe}"${args.map(a => ` ${a}`).join('')}"`;
  return detached('cmd.exe', ['/d', '/s', '/c', line], { env, windowsHide: true, windowsVerbatimArguments: true });
}

function chatgptAppId() {
  const pkg = findPackage('OpenAI.Codex');
  return pkg ? `${path.basename(pkg)}!App` : null;
}

function vscodeExe() {
  const cmd = which('code');
  if (!cmd) return null;
  const exe = path.resolve(path.dirname(cmd), '..', 'Code.exe');
  return exists(exe) ? exe : null;
}

const TARGETS = [
  { id: 'claude-desktop', label: 'Claude Desktop', provider: 'claude',
    locate: () => CLAUDE_EXES.find(exists) || null,
    open: (exe, a) => detached(exe, splitArgs(a.args)) },
  { id: 'claude-cli', label: 'Claude Code CLI', provider: 'claude', cli: true,
    locate: () => which('claude'),
    open: (exe, a) => inTerminal('Claude Code', exe, modelArgs(a), cliEnv(a)) },
  { id: 'chatgpt-desktop', label: 'ChatGPT Desktop', provider: 'chatgpt',
    locate: chatgptAppId,
    open: appId => detached('explorer.exe', [`shell:AppsFolder\\${appId}`]) },
  { id: 'codex-cli', label: 'Codex CLI', provider: 'chatgpt', cli: true,
    locate: () => which('codex'),
    open: (exe, a) => inTerminal('Codex', exe, modelArgs(a), cliEnv(a)) },
  // VS Code is single-instance, so an account with its own CLI home gets its own user-data folder and window.
  { id: 'vscode', label: 'VS Code', cli: true,
    locate: vscodeExe,
    open: (exe, a) => detached(exe, a.cliHome ? ['--user-data-dir', path.join(HUB_DIR, 'vscode', a.id)] : [], { env: cliEnv(a) }) },
  { id: 'web', label: 'Web browser',
    locate: () => true,
    open: (_, a) => shell.openExternal(PROVIDERS[a.provider].web) },
];

const targetById = id => TARGETS.find(t => t.id === id);
const isInstalled = provider => Boolean(targetById(PROVIDERS[provider].defaultTarget).locate());

// A single-instance desktop app holds one account: every later account of that provider has to use the CLI or web.
function lockedReason(account, accounts, target) {
  const { multiDesktop, defaultTarget } = PROVIDERS[account.provider];
  const first = accounts.find(a => a.provider === account.provider);
  return target.id === defaultTarget && !multiDesktop && first && first.id !== account.id ? `${target.label} holds one account` : null;
}

function availableTargets(account, accounts) {
  return TARGETS.filter(t => !t.provider || t.provider === account.provider)
    .filter(t => t.locate())
    .map(t => ({ id: t.id, label: t.label, cli: Boolean(t.cli), locked: lockedReason(account, accounts, t) }));
}

async function openAccount(account, targetId, accounts) {
  const target = targetById(targetId) || targetById(PROVIDERS[account.provider].defaultTarget);
  const located = target.locate();
  if (!located) throw new Error(`${target.label} is not installed`);
  const locked = lockedReason(account, accounts, target);
  if (locked) throw new Error(locked);
  await target.open(located, account);
  return target.id;
}

// part: 'cli' opens the official login in a terminal with the account's own home; 'desktop' opens the app, which shows its own sign-in.
async function signIn(account, part, accounts) {
  if (part === 'desktop') return openAccount(account, PROVIDERS[account.provider].defaultTarget, accounts);
  const cli = CLIS[account.provider];
  const exe = which(cli.command);
  if (!exe) throw new Error(`${PROVIDERS[account.provider].label} CLI is not installed`);
  await inTerminal(`Sign in: ${account.name}`, exe, cli.login, cliEnv(account));
  return null;
}

function installs() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([provider, p]) => [provider, {
    label: p.label, desktop: isInstalled(provider), cli: Boolean(which(CLIS[provider].command)), download: p.download, multiDesktop: p.multiDesktop,
  }]));
}

module.exports = { PROVIDERS, inTerminal, isInstalled, installs, availableTargets, openAccount, signIn };
