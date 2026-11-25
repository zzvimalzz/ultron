import { $, $$, esc, on } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import { colorHex, mascotSVG } from '../lib/mascots.js';
import { ICONS, badge, button, flip, phase, tip, toast } from '../lib/ui.js';
import { api, state, accountById, loadTargets, toastError } from '../lib/state.js';
import { planBadge, planChoices } from '../lib/plan.js';
import { openEditor } from './editor.js';

let root;
let menuFor = null;
let askFor = null;
let dragId = null;

const targetsOf = account => state.targets[account.id] || [];

function openWithMenu(account) {
  return `<div class="menu" role="menu">${targetsOf(account).map(t => `<button role="menuitemradio" aria-checked="${t.id === account.openWith}" data-open-with="${t.id}"`
    + `${t.locked ? ` disabled data-tip="${tip(t.locked)}"` : ''}>`
    + `<span class="menu-check">${t.id === account.openWith ? ICONS.check : ''}</span>${esc(t.label)}</button>`).join('')}</div>`;
}

function planAsk(account, live) {
  const badge = planBadge(live);
  if (!badge) return '';
  const menu = askFor === account.id ? `<div class="menu" role="menu">${planChoices(account.provider).map(([plan, label]) => `<button role="menuitem" data-plan-pick="${plan}">${label}</button>`).join('')}</div>` : '';
  return `<span class="plan-wrap">${badge}${menu}</span>`;
}

// Opus · high; nothing for the CLI default.
function modelChip(account) {
  if (!account.model) return '';
  const label = state.models[account.id]?.find(m => m.id === account.model)?.label || account.model;
  return `<div class="acct-chip">${badge(account.effort ? `${label} · ${account.effort}` : label, { tone: 'muted' })}</div>`;
}

function card(account, index) {
  const live = state.overview[account.id] || {};
  const hex = colorHex(account.color);
  const target = targetsOf(account).find(t => t.id === account.openWith);
  const needsSignIn = target?.cli && live.signedIn === false;
  const meta = (label, value) => `<div><div class="k">${label}</div><div class="v">${value}</div></div>`;
  const counted = live.tokens !== undefined;
  const status = live.working ? ['busy', 'Working'] : live.running ? ['on', 'Running'] : ['', 'Not running'];
  return `
    <div class="acct ${live.working ? 'working' : ''}" role="button" tabindex="0" draggable="true" data-flip="${account.id}" data-account="${account.id}" aria-label="Open ${esc(account.name)}" style="${phase(index)}">
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
            <div class="acct-line"><div class="acct-name">${esc(account.name)}</div>${planAsk(account, live)}</div>
            ${account.subtitle ? `<div class="acct-sub">${esc(account.subtitle)}</div>` : ''}${modelChip(account)}
          </div>
          ${needsSignIn ? `<span class="acct-action">${button('Sign in', { kind: 'primary sm', attrs: 'data-sign-in' })}</span>` : `<div class="split">
            <span class="split-main"${target ? ` data-tip="${tip(`Open with ${target.label}`)}"` : ''}>Open ${ICONS.arrow}</span>
            <button class="split-more" data-menu="${account.id}" aria-label="Choose how to open ${esc(account.name)}" aria-expanded="${menuFor === account.id}">${ICONS.chevron}</button>
            ${menuFor === account.id ? openWithMenu(account) : ''}
          </div>`}
        </div>
        <div class="acct-meta">
          ${meta('Last opened', live.lastOpened === undefined ? '—' : live.running ? 'Now' : fmt.ago(live.lastOpened))}
          ${meta('Tokens · 24h', counted ? fmt.tokens(live.tokens) : '—')}
          ${meta('Active · 24h', counted ? fmt.duration(live.activeMs).text : '—')}
        </div>
      </div>
    </div>`;
}

function draw() {
  const { config } = state;
  root.innerHTML = `
    <div class="page-head">
      <h1>${fmt.greeting()}${config.userName ? `, ${esc(config.userName)}` : ''}</h1>
      ${button('Add account', { icon: ICONS.plus, attrs: 'data-add' })}
    </div>
    <div class="accounts-grid">${config.accounts.length ? config.accounts.map(card).join('')
      : `<button class="acct-empty" data-add>${mascotSVG({ color: 2, mascot: { eyes: 'happy' } }, 72)}<span>Add your first account</span></button>`}</div>`;
  const menu = $('.menu', root);
  if (menu && menu.getBoundingClientRect().bottom > root.closest('.scroller').getBoundingClientRect().bottom) menu.classList.add('up');
}

// A redraw mid-drag would replace the card being dragged.
export const render = () => { if (!dragId) flip(root, draw); };

const clearDrop = () => $$('.drop-before, .drop-after', root).forEach(el => el.classList.remove('drop-before', 'drop-after'));
const dropSide = (card, e) => { const box = card.getBoundingClientRect(); return e.clientX < box.left + box.width / 2 ? 'before' : 'after'; };

async function moveAccount(id, targetId, side) {
  const ids = state.config.accounts.map(a => a.id).filter(x => x !== id);
  ids.splice(ids.indexOf(targetId) + (side === 'after' ? 1 : 0), 0, id);
  state.config = await api.reorderAccounts(ids);
  document.dispatchEvent(new Event('accountsreordered'));
}

export async function launch(id, targetId) {
  const account = accountById(id);
  const cardEl = $(`[data-account="${id}"]`, root);
  if (cardEl) { cardEl.classList.remove('launching'); void cardEl.offsetWidth; cardEl.classList.add('launching'); }
  try {
    const used = await api.open(id, targetId);
    state.config = await api.getConfig();
    const label = targetsOf(account).find(t => t.id === used)?.label || '';
    toast(`Opening ${account.name}${label ? ` in ${label}` : ''}…`, { icon: mascotSVG(account, 22) });
  } catch (err) {
    toastError(err, id);
  }
  render();
}

async function toggleMenu(id) {
  const account = accountById(id);
  if (menuFor !== id) await loadTargets([account]);
  menuFor = menuFor === id ? null : id;
  render();
}

export function mount(el) {
  root = el;
  on(root, 'dragstart', '[data-account]', (card, e) => {
    dragId = card.dataset.account;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    card.classList.add('dragging');
  });
  on(root, 'dragover', '[data-account]', (card, e) => {
    if (!dragId || card.dataset.account === dragId) return;
    e.preventDefault();
    clearDrop();
    card.classList.add(`drop-${dropSide(card, e)}`);
  });
  on(root, 'drop', '[data-account]', async (card, e) => {
    if (!dragId) return;
    e.preventDefault();
    const id = dragId;
    const side = dropSide(card, e);
    dragId = null;
    if (card.dataset.account !== id) await moveAccount(id, card.dataset.account, side);
    flip(root, draw);
  });
  on(root, 'dragend', '[data-account]', () => { dragId = null; clearDrop(); flip(root, draw); });
  on(root, 'click', '[data-add]', () => openEditor(null));
  on(root, 'click', '[data-edit]', btn => openEditor(btn.dataset.edit));
  on(root, 'click', '[data-menu]', btn => toggleMenu(btn.dataset.menu));
  on(root, 'click', '[data-open-with]', btn => {
    menuFor = null;
    launch(btn.closest('[data-account]').dataset.account, btn.dataset.openWith);
  });
  on(root, 'click', '[data-sign-in]', async btn => {
    try { await api.signIn(btn.closest('[data-account]').dataset.account, 'cli'); } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-plan-ask]', btn => {
    const id = btn.closest('[data-account]').dataset.account;
    askFor = askFor === id ? null : id;
    render();
  });
  on(root, 'click', '[data-plan-pick]', async btn => {
    const id = btn.closest('[data-account]').dataset.account;
    askFor = null;
    state.config = await api.updateAccount(id, { planAnswer: btn.dataset.planPick });
    state.overview = await api.overview();
    render();
  });
  on(root, 'click', '[data-account]', (el, e) => {
    if (!e.target.closest('.menu, [data-menu], [data-edit], [data-sign-in], [data-plan-ask]')) launch(el.dataset.account);
  });
  on(root, 'keydown', '[data-account]', (el, e) => {
    if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    launch(el.dataset.account);
  });
  document.addEventListener('click', e => {
    if ((menuFor && !e.target.closest('.split')) || (askFor && !e.target.closest('.plan-wrap'))) { menuFor = null; askFor = null; render(); }
  });
}
