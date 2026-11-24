import { esc, on } from '../lib/dom.js';
import { brandSVG } from '../lib/mascots.js';
import { ICONS, button, onSegment, onToggle, options, segmented, toggle } from '../lib/ui.js';
import { api, state, saveConfig } from '../lib/state.js';

const THEMES = options([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]);

let root;
let info = { version: '', userData: '' };

const row = (title, control) => `<div class="set-row"><div class="t">${title}</div>${control}</div>`;

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
      ])}
      ${group('Memory', [
        row('Shared memory folder', `<div class="input-row"><input class="input" id="sMemory" style="width:260px" readonly value="${esc(cfg.crew.memoryDir)}" placeholder="Default (.ultron\\memory)" aria-label="Shared memory folder">`
          + `${cfg.crew.memoryDir ? button('Reset', { kind: 'ghost', attrs: 'data-memory="reset"' }) : ''}${button('Browse', { icon: ICONS.folder, attrs: 'data-memory="pick"' })}</div>`),
      ])}
      ${group('Data', [row('Ultron data', button('Open folder', { icon: ICONS.folder, attrs: 'data-open-data' }))])}
      ${group('About', [`<div class="about"><span class="brand-mark lg">${brandSVG(30)}</span><span>Ultron ${esc(info.version)}</span></div>`])}
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
  on(root, 'click', '[data-memory]', async btn => {
    const memoryDir = btn.dataset.memory === 'pick' ? await api.pickFolder() : '';
    if (memoryDir === null) return;
    await saveConfig({ crew: { ...state.config.crew, memoryDir } });
    render();
  });
}
