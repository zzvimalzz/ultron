import { errorText, toast } from './ui.js';

export const api = window.ultron;

export const state = {
  config: null,
  overview: {},
  targets: {},
  models: {},
  info: { sections: [] },
  usageData: null,
  sync: null,
  usage: { scope: 'device', account: 'all', range: '30d', metric: 'total', rhythm: 'week', projectPage: 0 },
};

// Open-with targets depend on the account (a single-instance desktop app is locked for later accounts).
export async function loadTargets(accounts = state.config.accounts) {
  await Promise.all(accounts.map(async a => { state.targets[a.id] = await api.targets(a.id); }));
}

// The live model list from an account's own CLI, with efforts. The Default entry has id ''.
export async function loadModels(id) {
  state.models[id] = (await api.models(id)).models;
}

export const accountById = id => state.config.accounts.find(a => a.id === id);

export async function saveConfig(patch) {
  state.config = await api.updateConfig(patch);
  return state.config;
}

// Plain words plus the one action that fixes it: a missing app opens setup, a signed-out account starts its sign-in.
export function toastError(err, accountId) {
  const text = errorText(err);
  const action = /isn't installed$/.test(text) ? { label: 'Install', run: () => document.dispatchEvent(new Event('opensetup')) }
    : text === 'Not signed in' && accountId ? { label: 'Sign in', run: () => api.signIn(accountId, 'cli').catch(toastError) } : null;
  toast(text, { kind: 'error', action });
}
