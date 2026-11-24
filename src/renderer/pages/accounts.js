import { $, esc, on } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import { colorHex, mascotSVG } from '../lib/mascots.js';
import { ICONS, phase, toast } from '../lib/ui.js';
import { api, state, accountById } from '../lib/state.js';
import { openEditor } from './editor.js';

let root;
let menuFor = null;

function openWithMenu(account) {
  const targets = state.targets[account.provider] || [];
  return `<div class="menu" role="menu">${targets.map(t => `<button role="menuitemradio" aria-checked="${t.id === account.openWith}" data-open-with="${t.id}">`
    + `<span class="menu-check">${t.id === account.openWith ? ICONS.check : ''}</span>${esc(t.label)}</button>`).join('')}</div>`;
}

function card(account, index) {
  const live = state.overview[account.id] || {};
  const hex = colorHex(account.color);
  const target = (state.targets[account.provider] || []).find(t => t.id === account.openWith);
  const meta = (label, value) => `<div><div class="k">${label}</div><div class="v">${value}</div></div>`;
  const counted = live.tokens !== undefined;
  const status = live.working ? ['busy', 'Working'] : live.running ? ['on', 'Running'] : ['', 'Not running'];
  return `
    <div class="acct ${live.working ? 'working' : ''}" role="button" tabindex="0" data-account="${account.id}" aria-label="Open ${esc(account.name)}" style="${phase(index)}">
      <div class="acct-hero" style="--account:${hex}">
        <span class="status ${status[0]}"><i></i>${status[1]}</span>
        <button class="icon-btn acct-edit" data-edit="${account.id}" aria-label="Customize ${esc(account.name)}">${ICONS.edit}</button>
        <span class="floor"></span>
        <span class="mascot-wrap">${mascotSVG(account, 128)}</span>
        ${live.working ? '<span class="think"><i></i><i></i><i></i></span>' : ''}
        ${index < 9 ? `<span class="acct-key">${index + 1}</span>` : ''}
      </div>
      <div class="acct-body">
        <div class="acct-title">
          <div class="acct-names">
            <div class="acct-name">${esc(account.name)}</div>
            ${account.subtitle ? `<div class="acct-sub">${esc(account.subtitle)}</div>` : ''}
          </div>
          <div class="split" title="${target ? `Open with ${esc(target.label)}` : ''}">
            <span class="split-main">Open ${ICONS.arrow}</span>
            <button class="split-more" data-menu="${account.id}" aria-label="Choose how to open ${esc(account.name)}" aria-expanded="${menuFor === account.id}">${ICONS.chevron}</button>
            ${menuFor === account.id ? openWithMenu(account) : ''}
          </div>
        </div>
        <div class="acct-meta">
          ${meta('Last opened', live.lastOpened === undefined ? '—' : live.running ? 'Now' : fmt.ago(live.lastOpened))}
          ${meta('Tokens · 24h', counted ? fmt.tokens(live.tokens) : '—')}
          ${meta('Active · 24h', counted ? fmt.duration(live.activeMs).text : '—')}
        </div>
      </div>
    </div>`;
}

export function render() {
  const { config } = state;
  root.innerHTML = `
    <div class="page-head">
      <h1>${fmt.greeting()}${config.userName ? `, ${esc(config.userName)}` : ''}</h1>
      <button class="btn" data-add>${ICONS.plus}Add account</button>
    </div>
    <div class="accounts-grid">${config.accounts.length ? config.accounts.map(card).join('')
      : `<button class="acct-empty" data-add>${mascotSVG({ color: 2, mascot: { eyes: 'happy' } }, 72)}<span>Add your first account</span></button>`}</div>`;
  const menu = $('.menu', root);
  if (menu && menu.getBoundingClientRect().bottom > root.closest('.scroller').getBoundingClientRect().bottom) menu.classList.add('up');
}

export async function launch(id, targetId) {
  const account = accountById(id);
  const cardEl = $(`[data-account="${id}"]`, root);
  if (cardEl) { cardEl.classList.remove('launching'); void cardEl.offsetWidth; cardEl.classList.add('launching'); }
  try {
    const used = await api.open(id, targetId);
    state.config = await api.getConfig();
    const label = (state.targets[account.provider] || []).find(t => t.id === used)?.label || '';
    toast(`Opening ${account.name}${label ? ` in ${label}` : ''}…`, { icon: mascotSVG(account, 22) });
  } catch (err) {
    toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { kind: 'error' });
  }
  render();
}

async function toggleMenu(id) {
  const account = accountById(id);
  if (menuFor !== id) state.targets[account.provider] = await api.targets(account.provider);
  menuFor = menuFor === id ? null : id;
  render();
}

export function mount(el) {
  root = el;
  on(root, 'click', '[data-add]', () => openEditor(null));
  on(root, 'click', '[data-edit]', btn => openEditor(btn.dataset.edit));
  on(root, 'click', '[data-menu]', btn => toggleMenu(btn.dataset.menu));
  on(root, 'click', '[data-open-with]', btn => {
    menuFor = null;
    launch(btn.closest('[data-account]').dataset.account, btn.dataset.openWith);
  });
  on(root, 'click', '[data-account]', (el, e) => {
    if (!e.target.closest('.menu, [data-menu], [data-edit]')) launch(el.dataset.account);
  });
  on(root, 'keydown', '[data-account]', (el, e) => {
    if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    launch(el.dataset.account);
  });
  document.addEventListener('click', e => {
    if (menuFor && !e.target.closest('.split')) { menuFor = null; render(); }
  });
}

export async function loadTargets() {
  const providers = [...new Set(state.config.accounts.map(a => a.provider))];
  await Promise.all(providers.map(async p => { state.targets[p] = await api.targets(p); }));
}

