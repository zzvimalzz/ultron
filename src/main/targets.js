'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');
const { LOCAL, findPackage } = require('./profiles');
const { CLIS, exists, which, cliEnv, modelArgs } = require('../hub/cli');
const { HUB_DIR } = require('../hub/files');

// multiDesktop: Claude runs one window per --user-data-dir; ChatGPT is a single-instance MSIX.
// A provider with no CLIS row is launch-only: it opens in the browser with no CLI home or plan badge (see .doc/notes/gemini.md and grok.md).
const PROVIDERS = {
  claude: { label: 'Claude', web: 'https://claude.ai', download: 'https://claude.ai/download', defaultTarget: 'claude-desktop', cliTarget: 'claude-cli', multiDesktop: true },
  chatgpt: { label: 'ChatGPT', web: 'https://chatgpt.com', download: 'https://chatgpt.com/download', defaultTarget: 'chatgpt-desktop', cliTarget: 'codex-cli', multiDesktop: false, color: 3 },
  gemini: { label: 'Gemini', web: 'https://gemini.google.com', defaultTarget: 'web', multiDesktop: true, color: 7 },
  grok: { label: 'Grok', web: 'https://grok.com', defaultTarget: 'web', multiDesktop: true, color: 8 },
};
const isLaunchOnly = provider => !CLIS[provider];

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
    open: (exe, a, ctx) => inTerminal('Claude Code', exe, [...modelArgs(a), ...(ctx.resume ? ['--resume', ctx.resume] : [])], cliEnv(a), ctx.cwd) },
  { id: 'chatgpt-desktop', label: 'ChatGPT Desktop', provider: 'chatgpt',
    locate: chatgptAppId,
    open: appId => detached('explorer.exe', [`shell:AppsFolder\\${appId}`]) },
  { id: 'codex-cli', label: 'Codex CLI', provider: 'chatgpt', cli: true,
    locate: () => which('codex'),
    open: (exe, a, ctx) => inTerminal('Codex', exe, [...modelArgs(a), ...(ctx.resume ? ['resume', ctx.resume] : [])], cliEnv(a), ctx.cwd) },
  // VS Code is single-instance, so an account with its own CLI home gets its own user-data folder and window.
  { id: 'vscode', label: 'VS Code', cli: true,
    locate: vscodeExe,
    open: (exe, a, ctx) => detached(exe, [...(a.cliHome ? ['--user-data-dir', path.join(HUB_DIR, 'vscode', a.id)] : []), ...(ctx.cwd ? [ctx.cwd] : [])], { env: cliEnv(a) }) },
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
    .filter(t => !(t.cli && isLaunchOnly(account.provider)))
    .filter(t => t.locate())
    .map(t => ({ id: t.id, label: t.label, cli: Boolean(t.cli), locked: lockedReason(account, accounts, t) }));
}

// `ctx` is { cwd, resume } for a session: the folder to start in and the session to continue.
async function openAccount(account, targetId, accounts, ctx = {}) {
  const target = targetById(targetId) || targetById(PROVIDERS[account.provider].defaultTarget);
  const located = target.locate();
  if (!located) throw new Error(`${target.label} isn't installed`);
  const locked = lockedReason(account, accounts, target);
  if (locked) throw new Error(locked);
  await target.open(located, account, ctx);
  return target.id;
}

// Where a session runs, from the entrypoint its transcript records: the desktop app, VS Code, or else a terminal.
function sessionTarget(session, provider) {
  const { defaultTarget, cliTarget } = PROVIDERS[provider];
  if (/desktop/i.test(session.entrypoint || '')) return defaultTarget;
  return /vscode/i.test(session.entrypoint || '') ? 'vscode' : cliTarget;
}

// Opens a session where it runs: the desktop app, VS Code in its folder, or a terminal resuming it. A terminal session
// that is still working already has its own window, and resuming it would fork the chat, so it is left alone (null).
async function openSession(session, account, accounts) {
  const targetId = sessionTarget(session, account.provider);
  if (targetId === PROVIDERS[account.provider].cliTarget && session.working) return null;
  const cwd = session.cwd && fs.existsSync(session.cwd) ? session.cwd : undefined;
  return targetById(await openAccount(account, targetId, accounts, { cwd, resume: session.sessionId })).label;
}

// part: 'cli' opens the official login in a terminal with the account's own home; 'desktop' opens the app, which shows its own sign-in.
async function signIn(account, part, accounts) {
  if (part === 'desktop') return openAccount(account, PROVIDERS[account.provider].defaultTarget, accounts);
  const cli = CLIS[account.provider];
  const exe = which(cli.command);
  if (!exe) throw new Error(`${PROVIDERS[account.provider].label} CLI isn't installed`);
  await inTerminal(`Sign in: ${account.name}`, exe, cli.login, cliEnv(account));
  return null;
}

function installs() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([provider, p]) => [provider, isLaunchOnly(provider)
    ? { label: p.label, color: p.color, launchOnly: true }
    : { label: p.label, color: p.color, desktop: isInstalled(provider), cli: Boolean(which(CLIS[provider].command)), download: p.download, multiDesktop: p.multiDesktop }]));
}

module.exports = { PROVIDERS, isLaunchOnly, inTerminal, isInstalled, installs, availableTargets, openAccount, openSession, sessionTarget, signIn };
