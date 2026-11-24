'use strict';
const { which } = require('../hub/cli');
const { PROVIDERS, isInstalled, inTerminal } = require('./targets');

// `command` is what the Run button types into a terminal. It only appears when its first word is on PATH,
// and nothing runs until the user clicks.
const APPS = [
  { id: 'claude-desktop', label: 'Claude Desktop', provider: 'claude', found: () => isInstalled('claude'), download: PROVIDERS.claude.download },
  { id: 'claude-cli', label: 'Claude Code CLI', provider: 'claude', found: () => which('claude'), download: 'https://code.claude.com/docs/en/setup', command: ['winget', 'install', 'Anthropic.ClaudeCode'] },
  { id: 'chatgpt-desktop', label: 'ChatGPT Desktop', provider: 'chatgpt', found: () => isInstalled('chatgpt'), download: PROVIDERS.chatgpt.download },
  { id: 'codex-cli', label: 'Codex CLI', provider: 'chatgpt', found: () => which('codex'), download: 'https://github.com/openai/codex', command: ['npm', 'i', '-g', '@openai/codex'] },
  { id: 'git', label: 'Git', found: () => which('git'), download: 'https://git-scm.com/download/win', command: ['winget', 'install', '--id', 'Git.Git', '-e'] },
];

const runnable = app => app.command && which(app.command[0]) ? app.command : null;

function appRows() {
  return APPS.map(app => ({
    id: app.id, label: app.label, provider: app.provider, color: PROVIDERS[app.provider]?.color || 2, installed: Boolean(app.found()), download: app.download, command: runnable(app)?.join(' ') || null,
  }));
}

// `cmd /k` keeps the window open so the user can read the result.
function runInstall(id) {
  const command = runnable(APPS.find(a => a.id === id) || {});
  if (!command) return Promise.reject(new Error('That install can\'t be run from here'));
  return inTerminal(`Install ${id}`, 'cmd.exe', ['/k', ...command], process.env);
}

module.exports = { appRows, runInstall };
