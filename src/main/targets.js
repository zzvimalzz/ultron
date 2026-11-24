'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');
const { LOCAL, findPackage } = require('./profiles');

const PROVIDERS = {
  claude: { web: 'https://claude.ai', download: 'https://claude.ai/download', homeEnv: 'CLAUDE_CONFIG_DIR', defaultTarget: 'claude-desktop' },
  chatgpt: { web: 'https://chatgpt.com', download: 'https://chatgpt.com/download', homeEnv: 'CODEX_HOME', defaultTarget: 'chatgpt-desktop' },
};

// Microsoft Store build first, then the standalone installer's location.
const CLAUDE_EXES = [
  path.join(LOCAL, 'Microsoft', 'WindowsApps', 'claude-desktop.exe'),
  path.join(LOCAL, 'AnthropicClaude', 'claude.exe'),
];

// App execution aliases (WindowsApps\*.exe) can't be stat'ed, only lstat'ed.
function exists(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

function which(cmd) {
  const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT').toLowerCase().split(';');
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const hit = exts.map(ext => path.join(dir, cmd + ext)).find(exists);
    if (hit) return hit;
  }
  return null;
}

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
function inTerminal(title, exe, env) {
  const line = `"start "${title}" /D "${os.homedir()}" "${exe}""`;
  return detached('cmd.exe', ['/d', '/s', '/c', line], { env, windowsHide: true, windowsVerbatimArguments: true });
}

function homeEnv(account) {
  const name = PROVIDERS[account.provider].homeEnv;
  return account.cliHome ? { ...process.env, [name]: account.cliHome } : process.env;
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
  { id: 'claude-cli', label: 'Claude Code CLI', provider: 'claude',
    locate: () => which('claude'),
    open: (exe, a) => inTerminal('Claude Code', exe, homeEnv(a)) },
  { id: 'chatgpt-desktop', label: 'ChatGPT Desktop', provider: 'chatgpt',
    locate: chatgptAppId,
    open: appId => detached('explorer.exe', [`shell:AppsFolder\\${appId}`]) },
  { id: 'codex-cli', label: 'Codex CLI', provider: 'chatgpt',
    locate: () => which('codex'),
    open: (exe, a) => inTerminal('Codex', exe, homeEnv(a)) },
  { id: 'vscode', label: 'VS Code',
    locate: vscodeExe,
    open: (exe, a) => detached(exe, [], { env: homeEnv(a) }) },
  { id: 'web', label: 'Web browser',
    locate: () => true,
    open: (_, a) => shell.openExternal(PROVIDERS[a.provider].web) },
];

const isInstalled = provider => Boolean(TARGETS.find(t => t.id === PROVIDERS[provider].defaultTarget).locate());

function availableTargets(provider) {
  return TARGETS.filter(t => !t.provider || t.provider === provider)
    .filter(t => t.locate())
    .map(({ id, label }) => ({ id, label }));
}

async function openAccount(account, targetId) {
  const target = TARGETS.find(t => t.id === targetId) || TARGETS.find(t => t.id === PROVIDERS[account.provider].defaultTarget);
  const located = target.locate();
  if (!located) throw new Error(`${target.label} is not installed`);
  await target.open(located, account);
  return target.id;
}

module.exports = { PROVIDERS, isInstalled, availableTargets, openAccount };
