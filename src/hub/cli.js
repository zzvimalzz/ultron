'use strict';
// What Ultron knows about each provider's CLI. It lives in the hub folder because the hub server
// runs outside the app bundle and can't require anything from src/main.
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLIS = {
  claude: {
    command: 'claude', homeEnv: 'CLAUDE_CONFIG_DIR', defaultHome: path.join(os.homedir(), '.claude'),
    transcripts: 'projects', instructions: 'CLAUDE.md', credentials: '.credentials.json', login: ['auth', 'login'],
  },
  chatgpt: {
    command: 'codex', homeEnv: 'CODEX_HOME', defaultHome: path.join(os.homedir(), '.codex'),
    transcripts: 'sessions', instructions: 'AGENTS.md', credentials: 'auth.json', login: ['login'],
  },
};

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

const homeOf = account => account.cliHome || CLIS[account.provider].defaultHome;

// ELECTRON_RUN_AS_NODE is dropped so a CLI started by the hub doesn't make the Electron projects it runs behave as Node.
function cliEnv(account, base = process.env) {
  const env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  if (account.cliHome) env[CLIS[account.provider].homeEnv] = account.cliHome;
  return env;
}

// Existence only: the credentials file holds tokens and is never read here.
const signedIn = account => exists(path.join(homeOf(account), CLIS[account.provider].credentials));

const SAFE_ARG = /^[\w@+=:,./\\-]+$/;

// cmd.exe strips one outer pair of quotes under /s. A literal % can't be escaped on a /c line,
// so callers pass free text through stdin instead of arguments.
function quoteArg(arg) {
  if (SAFE_ARG.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

// npm installs CLIs as .cmd shims, which Windows only runs through cmd.exe.
function spawnCli(file, args, options = {}) {
  if (/\.(cmd|bat)$/i.test(file)) {
    const line = `"${[file, ...args].map(quoteArg).join(' ')}"`;
    return childProcess.spawn('cmd.exe', ['/d', '/s', '/c', line], { ...options, windowsVerbatimArguments: true });
  }
  return childProcess.spawn(file, args, options);
}

module.exports = { CLIS, exists, which, homeOf, cliEnv, signedIn, spawnCli };
