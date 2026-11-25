import { esc, on } from '../lib/dom.js';
import { ago } from '../lib/format.js';
import { brandSVG } from '../lib/mascots.js';
import { ICONS, button, errorText, onSegment, onSelect, onToggle, options, segmented, select, toast, toggle } from '../lib/ui.js';
import { api, state, loadModels, saveConfig } from '../lib/state.js';
import * as setup from './setup.js';

const THEMES = options([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]);

let root;
let info = { version: '', userData: '' };
let syncInfo = { enabled: false, devices: [] };

const UPDATE_TEXT = {
  dev: 'Updates only run in the installed app',
  ready: 'Update ready · Restart from the sidebar',
  available: 'Downloading the update…',
  current: "You're up to date",
  private: "Couldn't read the releases: the GitHub repository is private",
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

function syncStatus() {
  if (syncInfo.error) return syncInfo.error;
  return syncInfo.lastSyncAt ? `Synced ${ago(syncInfo.lastSyncAt)}` : 'Not synced yet';
}

function syncRows() {
  const rows = [row('Share usage between devices', toggle('sync', syncInfo.enabled, 'Share usage between devices'))];
  if (!syncInfo.enabled) return rows;
  const input = (id, attrs) => `<input class="input" id="${id}" style="width:260px" autocomplete="off" spellcheck="false" ${attrs}>`;
  return [...rows,
    row('This device', input('sSyncName', `value="${esc(syncInfo.deviceName || '')}" placeholder="Laptop" maxlength="24" aria-label="This device's name"`)),
    row('Server URL', input('sSyncUrl', `value="${esc(syncInfo.url || '')}" placeholder="https://" aria-label="Sync server URL"`)),
    row('Token', input('sSyncToken', `type="password" placeholder="${syncInfo.hasToken ? 'Saved' : 'Paste the token'}" aria-label="Sync server token"`)),
    row('Status', `<div class="input-row"><span class="muted">${esc(syncStatus())}</span>${button('Sync now', { attrs: 'data-sync-now' })}</div>`),
    ...syncInfo.devices.map(d => row(esc(d.name), `<div class="input-row"><span class="muted">Synced ${ago(d.updatedAt)}</span>${button('Remove', { kind: 'ghost', attrs: `data-sync-remove="${esc(d.id)}"` })}</div>`)),
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
      ${group('Devices', syncRows())}
      ${group('Data', [row('Ultron data', button('Open folder', { icon: ICONS.folder, attrs: 'data-open-data' }))])}
      ${group('About', [`<div class="about"><span class="brand-mark lg">${brandSVG(30)}</span><span>Ultron ${esc(info.version)}</span></div>`,
        row('Updates', button('Check for updates', { attrs: 'data-check-update' }))])}
    </div>`;
}

export async function load() {
  [info, syncInfo] = await Promise.all([api.info(), api.sync.status()]);
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
  const saveSync = async patch => {
    try { syncInfo = await api.sync.save(patch); } catch (err) { toast(errorText(err), { kind: 'error' }); }
    render();
  };
  onToggle(root, 'sync', enabled => saveSync({ enabled }));
  on(root, 'change', '#sSyncName', field => saveSync({ deviceName: field.value.trim() }));
  on(root, 'change', '#sSyncUrl', field => saveSync({ url: field.value.trim() }));
  on(root, 'change', '#sSyncToken', field => saveSync({ token: field.value }));
  on(root, 'click', '[data-sync-now]', async () => { syncInfo = await api.sync.now(); render(); });
  on(root, 'click', '[data-sync-remove]', async btn => {
    try { syncInfo = await api.sync.remove(btn.dataset.syncRemove); } catch (err) { toast(errorText(err), { kind: 'error' }); }
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
