'use strict';
const fs = require('fs');
const path = require('path');
const { LOCAL, ROAMING, findShortcuts, resolveDataDir } = require('./profiles');
const { PROVIDERS, isInstalled } = require('./targets');

const VERSION = 3;

function defaultClaudeDataDir() {
  const base = path.join(LOCAL, 'Claude-Data');
  try {
    const dir = fs.readdirSync(base).find(n => /^claude_/i.test(n));
    if (dir) return path.join(base, dir);
  } catch { /* not the MSIX build */ }
  return path.join(ROAMING, 'Claude');
}

function account(provider, index, fields) {
  return {
    id: `${provider}-${Date.now().toString(36)}-${index}`,
    provider,
    name: provider === 'chatgpt' ? 'ChatGPT' : `Claude ${index + 1}`,
    subtitle: '',
    color: provider === 'chatgpt' ? 3 : [2, 1, 7, 5, 4, 8][index % 6],
    mascot: { accessory: 'none', eyes: 'normal' },
    args: '',
    dataDir: '',
    cliHome: '',
    openWith: PROVIDERS[provider].defaultTarget,
    lastOpened: 0,
    ...fields,
  };
}

const chatgptDataDir = () => path.join(ROAMING, 'Codex', 'web', 'Codex');
const usesOwnProfile = a => /--user-data-dir=/.test(a.args || '');

function freeClaudeProfile(accounts) {
  const taken = new Set(accounts.map(a => (a.dataDir || '').toLowerCase()));
  for (let n = 2; ; n++) {
    const dir = path.join(LOCAL, 'Claude-Profiles', `Claude${n}`);
    if (!taken.has(dir.toLowerCase()) && !fs.existsSync(resolveDataDir(dir))) return dir;
  }
}

// A new Claude account gets its own profile folder (and so its own sign-in) once the default one is taken.
function blankAccount(provider, accounts, ownProfile) {
  const index = accounts.filter(a => a.provider === provider).length;
  const fields = { mascot: { accessory: 'none', eyes: 'happy' } };
  if (provider === 'chatgpt') return account(provider, index, { ...fields, dataDir: chatgptDataDir() });
  ownProfile ??= accounts.some(a => a.provider === 'claude' && !usesOwnProfile(a));
  const dataDir = ownProfile ? freeClaudeProfile(accounts) : defaultClaudeDataDir();
  return account(provider, index, { ...fields, dataDir, args: ownProfile ? `--user-data-dir="${dataDir}"` : '' });
}

async function discoverClaudeAccounts() {
  const shortcuts = (await findShortcuts('claude-desktop.exe')).sort((a, b) => a.name.localeCompare(b.name));
  if (!shortcuts.length) return isInstalled('claude') ? [account('claude', 0, { name: 'Claude', dataDir: defaultClaudeDataDir() })] : [];
  return shortcuts.map((s, i) => {
    const custom = /--user-data-dir=("?)([^"]+)\1/.exec(s.args || '');
    return account('claude', i, { name: s.name, args: s.args || '', dataDir: custom ? custom[2] : defaultClaudeDataDir() });
  });
}

function migrate(config) {
  for (const a of config.accounts) {
    a.provider ||= 'claude';
    a.openWith ||= PROVIDERS[a.provider].defaultTarget;
    a.cliHome ??= '';
    delete a.launches;
    delete a.target;
    delete a.pathHints;
  }
  config.crew ||= { connected: false, leader: null, memoryDir: '' };
  if (!config.accounts.some(a => a.provider === 'chatgpt') && isInstalled('chatgpt')) {
    config.accounts.push(account('chatgpt', 0, { dataDir: chatgptDataDir() }));
  }
  config.version = VERSION;
  return config;
}

function createStore(file) {
  let config;
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
  };
  return {
    async load() {
      try {
        config = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        config = { theme: 'system', closeOnLaunch: false, userName: '', accounts: await discoverClaudeAccounts() };
      }
      if (config.version !== VERSION) { migrate(config); save(); }
      return config;
    },
    get: () => config,
    update(patch) { config = { ...config, ...patch }; save(); return config; },
    updateAccount(id, patch) {
      config.accounts = config.accounts.map(a => (a.id === id ? { ...a, ...patch } : a));
      save();
      return config;
    },
  };
}

module.exports = { createStore, blankAccount };
