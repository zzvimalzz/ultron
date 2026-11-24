'use strict';
const fs = require('fs');
const path = require('path');
const { LOCAL, ROAMING, findShortcuts, resolveDataDir } = require('./profiles');
const { PROVIDERS, isInstalled } = require('./targets');
const { HUB_DIR } = require('../hub/files');
const { DEFAULT_ROLES } = require('../hub/roles');

const VERSION = 7;
const HOMES_DIR = path.join(HUB_DIR, 'homes');

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
    planAnswer: null,
    model: '',
    effort: '',
    roles: [...DEFAULT_ROLES[provider]],
    inCrew: true,
    maxRuns: 2,
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

// A new account gets its own CLI home. A new Claude account also gets its own desktop profile (and so its own
// sign-in) once the default one is taken; a second ChatGPT account has no desktop app of its own and opens in the CLI.
function blankAccount(provider, accounts, ownProfile) {
  const index = accounts.filter(a => a.provider === provider).length;
  const fields = { mascot: { accessory: 'none', eyes: 'happy' } };
  let created;
  if (provider === 'chatgpt') {
    created = account(provider, index, { ...fields, dataDir: index ? '' : chatgptDataDir(), ...(index ? { openWith: PROVIDERS.chatgpt.cliTarget } : {}) });
  } else {
    ownProfile ??= accounts.some(a => a.provider === 'claude' && !usesOwnProfile(a));
    const dataDir = ownProfile ? freeClaudeProfile(accounts) : defaultClaudeDataDir();
    created = account(provider, index, { ...fields, dataDir, args: ownProfile ? `--user-data-dir="${dataDir}"` : '' });
  }
  return { ...created, cliHome: path.join(HOMES_DIR, created.id) };
}

// Homes Ultron created are made when the account is saved, so the login has somewhere to write.
function ensureHomes(accounts) {
  for (const a of accounts) {
    if (a.cliHome && path.dirname(path.resolve(a.cliHome)).toLowerCase() === HOMES_DIR.toLowerCase()) fs.mkdirSync(a.cliHome, { recursive: true });
  }
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
    a.planAnswer ??= null;
    a.model ??= '';
    a.effort ??= '';
    a.roles ??= [...DEFAULT_ROLES[a.provider]];
    a.inCrew ??= true;
    a.maxRuns ??= 2;
    delete a.launches;
    delete a.target;
    delete a.pathHints;
  }
  config.crew ||= { connected: false, leader: null };
  config.memory ||= { dir: config.crew.memoryDir || '', tidy: false, curator: { account: '', model: '' } };
  delete config.crew.memoryDir;
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
    update(patch) {
      config = { ...config, ...patch };
      if (patch.accounts) ensureHomes(config.accounts);
      save();
      return config;
    },
    updateAccount(id, patch) {
      config.accounts = config.accounts.map(a => (a.id === id ? { ...a, ...patch } : a));
      save();
      return config;
    },
  };
}

module.exports = { createStore, blankAccount, migrate };
