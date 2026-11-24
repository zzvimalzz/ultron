import { esc, on } from '../lib/dom.js';
import { brandSVG } from '../lib/mascots.js';
import { ICONS, button, errorText, onSegment, onSelect, onToggle, options, segmented, select, toast, toggle } from '../lib/ui.js';
import { api, state, loadModels, saveConfig } from '../lib/state.js';
import * as setup from './setup.js';

const THEMES = options([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]);

let root;
let info = { version: '', userData: '' };

const UPDATE_TEXT = {
  dev: 'Updates only run in the installed app',
  ready: 'Update ready · Restart from the sidebar',
  available: 'Downloading the update…',
  current: "You're up to date",
  error: "Couldn't check for updates",
};

const row = (title, control) => `<div class="set-row"><div class="t">${title}</div>${control}</div>`;

// The curator needs an account that can run models, and that account's own model list.
function memoryRows(memory) {
  const eligible = state.config.accounts.filter(a => state.overview[a.id]?.eligible);
  const models = state.models[memory.curator.account] || [];
  return [
    row('Memory folder', `<div class="input-row"><input class="input" id="sMemory" style="width:260px" readonly value="${esc(memory.dir)}" placeholder="Default (.ultron\\memory)" aria-label="Memory folder">`
      + `${memory.dir ? button('Reset', { kind: 'ghost', attrs: 'data-memory="reset"' }) : ''}${button('Browse', { icon: ICONS.folder, attrs: 'data-memory="pick"' })}</div>`),
    row('Keep memory tidy', toggle('tidy', memory.tidy, 'Keep memory tidy')),
    ...(memory.tidy ? [
      row('Tidy with', select('curatorAccount', eligible.map(a => ({ value: a.id, label: a.name })), memory.curator.account)),
      row('Model', select('curatorModel', models.map(m => ({ value: m.id, label: m.label, hint: m.description })), memory.curator.model)),
    ] : []),
  ];
}

const saveMemory = patch => saveConfig({ memory: { ...state.config.memory, ...patch } });

export function render() {
  const cfg = state.config;
  const group = (title, rows) => `<div class="card"><div class="cap">${title}</div>${rows.join('')}</div>`;
  root.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="settings stack">
      ${group('General', [
        row('Your name', `<input class="input" id="sName" style="width:220px" value="${esc(cfg.userName || '')}" placeholder="Name" maxlength="24" aria-label="Your name">`),
        row('Appearance', segmented('theme', THEMES, cfg.theme)),
        row('Minimize after opening an account', toggle('minimize', cfg.closeOnLaunch, 'Minimize after opening an account')),
        row('Setup', button('Run setup again', { attrs: 'data-run-setup' })),
      ])}
      ${group('Memory', memoryRows(cfg.memory))}
      ${group('Data', [row('Ultron data', button('Open folder', { icon: ICONS.folder, attrs: 'data-open-data' }))])}
      ${group('About', [`<div class="about"><span class="brand-mark lg">${brandSVG(30)}</span><span>Ultron ${esc(info.version)}</span></div>`,
        row('Updates', button('Check for updates', { attrs: 'data-check-update' }))])}
    </div>`;
}

export async function load() {
  info = await api.info();
  render();
}

export function mount(el) {
  root = el;
  on(root, 'change', '#sName', input => saveConfig({ userName: input.value.trim() }));
  onSegment(root, 'theme', async v => { await saveConfig({ theme: v }); document.dispatchEvent(new Event('themechange')); render(); });
  onToggle(root, 'minimize', async value => { await saveConfig({ closeOnLaunch: value }); render(); });
  on(root, 'click', '[data-open-data]', () => api.openPath(info.userData));
  on(root, 'click', '[data-run-setup]', () => setup.open());
  on(root, 'click', '[data-check-update]', async () => toast(UPDATE_TEXT[await api.checkForUpdates()]));
  on(root, 'click', '[data-memory]', async btn => {
    const dir = btn.dataset.memory === 'pick' ? await api.pickFolder() : '';
    if (dir === null) return;
    try {
      const created = await api.memory.setDir(dir);
      state.config = await api.getConfig();
      toast(created ? 'Vault ready' : 'Using existing vault');
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
    render();
  });
  onToggle(root, 'tidy', async tidy => {
    const first = state.config.accounts.find(a => state.overview[a.id]?.eligible);
    const account = state.config.memory.curator.account || first?.id || '';
    if (account) await loadModels(account);
    await saveMemory({ tidy, curator: { ...state.config.memory.curator, account } });
    render();
  });
  onSelect(root, 'curatorAccount', async account => {
    await loadModels(account);
    await saveMemory({ curator: { account, model: '' } });
    render();
  });
  onSelect(root, 'curatorModel', async model => {
    await saveMemory({ curator: { ...state.config.memory.curator, model } });
  });
}
