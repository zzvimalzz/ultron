import { esc, on } from '../lib/dom.js';
import { colorHex, mascotSVG, brandSVG } from '../lib/mascots.js';
import { ICONS, onSegment, options, segmented } from '../lib/ui.js';
import { api, state, saveConfig } from '../lib/state.js';
import { openEditor } from './editor.js';

const THEMES = options([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]);

let root;
let info = { version: '', userData: '' };

const row = (title, control) => `<div class="set-row"><div class="t">${title}</div>${control}</div>`;

export function render() {
  const cfg = state.config;
  root.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="settings stack">
      <div class="card">
        ${row('Your name', `<input class="input" id="sName" style="width:220px" value="${esc(cfg.userName || '')}" placeholder="Name" maxlength="24">`)}
        ${row('Appearance', segmented('theme', THEMES, cfg.theme))}
        ${row('Minimize after opening an account', `<button class="switch ${cfg.closeOnLaunch ? 'on' : ''}" data-toggle-minimize role="switch" aria-checked="${!!cfg.closeOnLaunch}" aria-label="Minimize after opening an account"></button>`)}
      </div>
      <div class="card">
        <h2 class="card-title">Accounts</h2>
        ${cfg.accounts.map(a => row(`<span class="set-account"><span class="set-mascot" style="--account:${colorHex(a.color)}">${mascotSVG(a, 28)}</span>${esc(a.name)}</span>`,
          `<button class="btn" data-edit="${a.id}">${ICONS.edit}Edit</button>`)).join('')}
      </div>
      <div class="card">
        ${row('Shared memory folder', `<div class="input-row"><input class="input" id="sMemory" style="width:260px" readonly value="${esc(cfg.crew.memoryDir)}" placeholder="Default (.ultron\\memory)">`
          + `${cfg.crew.memoryDir ? '<button class="btn ghost" data-memory="reset">Reset</button>' : ''}<button class="btn" data-memory="pick">${ICONS.folder}Browse</button></div>`)}
        ${row('Ultron data', `<button class="btn" data-open-data>${ICONS.folder}Open folder</button>`)}
      </div>
      <div class="card about">
        <span class="brand-mark lg">${brandSVG(30)}</span>
        <span>Ultron ${esc(info.version)}</span>
      </div>
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
  on(root, 'click', '[data-toggle-minimize]', async () => { await saveConfig({ closeOnLaunch: !state.config.closeOnLaunch }); render(); });
  on(root, 'click', '[data-edit]', btn => openEditor(btn.dataset.edit));
  on(root, 'click', '[data-open-data]', () => api.openPath(info.userData));
  on(root, 'click', '[data-memory]', async btn => {
    const memoryDir = btn.dataset.memory === 'pick' ? await api.pickFolder() : '';
    if (memoryDir === null) return;
    await saveConfig({ crew: { ...state.config.crew, memoryDir } });
    render();
  });
}
