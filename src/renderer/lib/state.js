export const api = window.ultron;

export const state = {
  config: null,
  overview: {},
  targets: {},
  usageData: null,
  usage: { account: 'all', range: '30d', metric: 'total', rhythm: 'week', projectPage: 0 },
};

// Open-with targets depend on the account (a single-instance desktop app is locked for later accounts).
export async function loadTargets(accounts = state.config.accounts) {
  await Promise.all(accounts.map(async a => { state.targets[a.id] = await api.targets(a.id); }));
}

export const accountById = id => state.config.accounts.find(a => a.id === id);

export async function saveConfig(patch) {
  state.config = await api.updateConfig(patch);
  return state.config;
}
