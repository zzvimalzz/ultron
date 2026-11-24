export const api = window.ultron;

export const state = {
  config: null,
  overview: {},
  targets: {},
  usageData: null,
  usage: { account: 'all', range: '30d', metric: 'total', rhythm: 'week', projectPage: 0 },
};

export const accountById = id => state.config.accounts.find(a => a.id === id);

export async function saveConfig(patch) {
  state.config = await api.updateConfig(patch);
  return state.config;
}
