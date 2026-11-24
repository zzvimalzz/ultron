import { $, $$, esc, on } from './dom.js';

const DUR = { 1: 120, 2: 200, 3: 320 };
const ACTION_TOAST_MS = 6000;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ms = step => (reducedMotion() ? 1 : DUR[step]);

// `action` is one button, { label, run }, for the fix a plain-words error points at.
export function toast(text, { kind, icon = '', ms: shown = 2600, action } = {}) {
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' error' : ''}`;
  el.innerHTML = `${icon ? `<span class="toast-icon">${icon}</span>` : ''}<span>${esc(text)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  $('#toasts').appendChild(el);
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), ms(2)); };
  if (action) el.querySelector('.toast-action').onclick = () => { dismiss(); action.run(); };
  setTimeout(dismiss, action ? ACTION_TOAST_MS : shown);
}

export const options = pairs => pairs.map(([value, label]) => ({ value, label }));

// Components return markup. `attrs` is raw HTML, so callers escape any values they put in it.
export const button = (label, { kind = '', icon = '', attrs = '' } = {}) =>
  `<button class="btn ${kind}" ${attrs}>${icon}${esc(label)}</button>`;

export const badge = (text, { tone = '', attrs = '' } = {}) => `<span class="badge ${tone}" ${attrs}>${esc(text)}</span>`;

export const chip = (label, { on: active = false, attrs = '' } = {}) =>
  `<button class="chip ${active ? 'on' : ''}" aria-pressed="${active}" ${attrs}>${esc(label)}</button>`;

// `locked` is the reason a switch can't be changed; it shows as a tooltip over the dimmed switch.
export const toggle = (name, active, label, locked = '') =>
  `<span${locked ? ` data-tip="${tip(locked)}"` : ''}><button class="switch ${active ? 'on' : ''}" data-toggle="${name}" role="switch" aria-checked="${!!active}" aria-label="${esc(label)}"${locked ? ' disabled' : ''}></button></span>`;

export const onToggle = (root, name, handler) => on(root, 'click', `[data-toggle="${name}"]`, btn => handler(btn.getAttribute('aria-checked') !== 'true'));

export const skeleton = (width, height) => `<span class="skeleton" style="width:${width};height:${height}"></span>`;

export function segmented(name, items, current) {
  return `<div class="seg" data-seg="${name}"><span class="thumb"></span>${items.map(o => `<button class="${String(o.value) === String(current) ? 'on' : ''}" data-value="${esc(o.value)}">`
    + `${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ''}${esc(o.label)}</button>`).join('')}</div>`;
}

export function onSegment(root, name, handler) {
  on(root, 'click', `[data-seg="${name}"] button`, btn => handler(btn.dataset.value));
}

// The thumb slides from where the same control last sat, so it still glides after a page re-render.
const thumbX = new Map();
export function placeThumbs(root = document) {
  for (const seg of $$('.seg', root)) {
    const thumb = $('.thumb', seg);
    const active = $('button.on', seg);
    if (!thumb || !active || !active.offsetWidth) continue;
    const name = seg.dataset.seg;
    const x = active.offsetLeft;
    const from = thumbX.get(name);
    thumb.style.width = `${active.offsetWidth}px`;
    thumbX.set(name, x);
    if (from !== undefined && from !== x && !reducedMotion()) {
      thumb.style.transform = `translateX(${from}px)`;
      void thumb.offsetWidth;
      thumb.classList.add('ready');
    } else {
      requestAnimationFrame(() => thumb.classList.add('ready'));
    }
    thumb.style.transform = `translateX(${x}px)`;
  }
}

// A custom list in place of a native <select>. The menu is built on open, so nothing re-renders.
export function select(name, items, value) {
  const current = items.find(o => String(o.value) === String(value));
  return `<div class="select" data-select="${name}" data-items="${esc(JSON.stringify(items))}" data-value="${esc(value ?? '')}">`
    + `<button class="select-btn" aria-haspopup="listbox" aria-expanded="false"><span class="label">${esc(current ? current.label : '')}</span>${ICONS.chevron}</button></div>`;
}

export const onSelect = (root, name, handler) => root.addEventListener('select', e => {
  if (e.detail.name === name) handler(e.detail.value);
});

function closeSelects(except) {
  for (const el of $$('.select')) {
    if (el === except) continue;
    $('.menu', el)?.remove();
    $('.select-btn', el).setAttribute('aria-expanded', 'false');
  }
}

function toggleSelect(el) {
  const open = $('.menu', el);
  closeSelects(open ? null : el);
  if (open) { open.remove(); $('.select-btn', el).setAttribute('aria-expanded', 'false'); return; }
  const items = JSON.parse(el.dataset.items);
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'listbox');
  menu.innerHTML = items.map(o => `<button role="option" data-value="${esc(o.value)}" aria-selected="${String(o.value) === el.dataset.value}"${o.disabled ? ` disabled data-tip="${tip(o.disabled)}"` : ''}>`
    + `<span class="menu-check">${String(o.value) === el.dataset.value ? ICONS.check : ''}</span>${esc(o.label)}${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ''}</button>`).join('');
  el.appendChild(menu);
  $('.select-btn', el).setAttribute('aria-expanded', 'true');
}

function pickSelect(btn) {
  const el = btn.closest('.select');
  const items = JSON.parse(el.dataset.items);
  el.dataset.value = btn.dataset.value;
  $('.label', el).textContent = items.find(o => String(o.value) === btn.dataset.value)?.label || '';
  closeSelects();
  el.dispatchEvent(new CustomEvent('select', { bubbles: true, detail: { name: el.dataset.select, value: btn.dataset.value } }));
}

export function paginate(items, page, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { rows: items.slice(current * size, current * size + size), page: current, pages, total: items.length, size };
}

export function pager(name, { page, pages, total, size }) {
  if (pages <= 1) return '<div class="pager"></div>';
  const from = page * size + 1;
  const to = Math.min(total, from + size - 1);
  return `<div class="pager"><span>${from}–${to} of ${total}</span>`
    + `<button class="icon-btn" data-page-of="${name}" data-step="-1" ${page === 0 ? 'disabled' : ''} aria-label="Previous page"><svg viewBox="0 0 16 16"><path d="M10 4L6 8l4 4"/></svg></button>`
    + `<button class="icon-btn" data-page-of="${name}" data-step="1" ${page >= pages - 1 ? 'disabled' : ''} aria-label="Next page"><svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4"/></svg></button></div>`;
}

export function onPage(root, handler) {
  on(root, 'click', '[data-page-of]', btn => handler(btn.dataset.pageOf, Number(btn.dataset.step)));
}

// FLIP: elements marked data-flip="<key>" glide from their old position after `render` rebuilds the markup.
export function flip(container, render) {
  const visible = Boolean(container.offsetParent);
  const before = new Map(visible ? $$('[data-flip]', container).map(el => [el.dataset.flip, el.getBoundingClientRect()]) : []);
  render();
  if (!visible || reducedMotion()) return;
  for (const el of $$('[data-flip]', container)) {
    const old = before.get(el.dataset.flip);
    const now = el.getBoundingClientRect();
    if (!old) {
      if (before.size) el.animate([{ opacity: 0, transform: 'scale(.94) translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: DUR[3], easing: 'cubic-bezier(.34,1.3,.64,1)' });
    } else if (old.left !== now.left || old.top !== now.top) {
      el.animate([{ transform: `translate(${old.left - now.left}px, ${old.top - now.top}px)` }, { transform: 'none' }], { duration: DUR[3], easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
}

// Any element with data-tip="<html>" shows a tooltip on hover.
function installTooltips() {
  const tip = $('#tooltip');
  document.addEventListener('mousemove', e => {
    const host = e.target.closest('[data-tip]');
    if (!host) { tip.classList.remove('show'); return; }
    tip.innerHTML = host.dataset.tip;
    tip.classList.add('show');
    const r = tip.getBoundingClientRect();
    const left = e.clientX + 14 + r.width > innerWidth - 8 ? e.clientX - r.width - 14 : e.clientX + 14;
    const top = e.clientY - r.height - 10 < 8 ? e.clientY + 16 : e.clientY - r.height - 10;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
  document.addEventListener('mouseleave', () => tip.classList.remove('show'));
}

export const tipRows = (title, rows) => esc(`<div class="t">${esc(title)}</div>${rows.map(([label, value, color]) =>
  `<div class="r"><span>${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}`);

// Plain text for a data-tip attribute.
export const tip = text => esc(esc(text));

export function openModal(html) {
  const modal = $('#modal');
  clearTimeout(modal.settle);
  modal.classList.remove('closing', 'settled');
  modal.innerHTML = html;
  modal.hidden = false;
  modal.settle = setTimeout(() => modal.classList.add('settled'), DUR[3]);
  const close = () => {
    modal.classList.add('closing');
    setTimeout(() => { if (modal.classList.contains('closing')) { modal.hidden = true; modal.innerHTML = ''; modal.classList.remove('closing'); } }, ms(2));
  };
  modal.onclick = e => { if (e.target === modal || e.target.closest('[data-close]')) close(); };
  return close;
}

export const modalOpen = () => !$('#modal').hidden && !$('#modal').classList.contains('closing');

let drawerClose = null;
let drawerOnClose = null;

const drawerHead = (title, lead) => `${lead || ''}<span class="t">${esc(title)}</span><button class="icon-btn" data-drawer-close aria-label="Close">${ICONS.close}</button>`;

// A right sheet with a title and a scrollable body; `lead` is optional markup before the title.
export function openDrawer(html, { title = '', lead = '', onClose } = {}) {
  const root = $('#drawer');
  drawerOnClose?.();
  drawerOnClose = onClose || null;
  root.hidden = false;
  root.classList.remove('open');
  root.innerHTML = `<div class="drawer-scrim" data-drawer-close></div>`
    + `<aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="drawer-head">${drawerHead(title, lead)}</div><div class="drawer-body">${html}</div></aside>`;
  requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.add('open'); placeThumbs(root); }));
  drawerClose = () => {
    if (!root.classList.contains('open')) return;
    root.classList.remove('open');
    const done = () => { if (!root.classList.contains('open')) { root.hidden = true; root.innerHTML = ''; } };
    $('.drawer', root).addEventListener('transitionend', done, { once: true });
    setTimeout(done, ms(3) + 60);
    drawerClose = null;
    drawerOnClose?.();
    drawerOnClose = null;
  };
  return drawerClose;
}

// Redraws the open drawer in place, keeping its scroll position.
export function updateDrawer(html, { title, lead } = {}) {
  const body = $('#drawer .drawer-body');
  if (!body) return;
  const top = body.scrollTop;
  body.innerHTML = html;
  body.scrollTop = top;
  if (title !== undefined) $('#drawer .drawer-head').innerHTML = drawerHead(title, lead);
  placeThumbs($('#drawer'));
}

export const drawerOpen = () => !$('#drawer').hidden && $('#drawer').classList.contains('open');
export const closeDrawer = () => drawerClose?.();

export const errorText = err => err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// Re-rendered markup restarts CSS animations; a delay tied to the clock keeps each loop continuous.
export const phase = (offset = 0) => `--phase:-${Math.round(performance.now() + offset * 700)}ms`;

export function installUi() {
  installTooltips();
  const drawer = $('#drawer');
  on(drawer, 'click', '[data-drawer-close]', () => closeDrawer());
  on(document, 'click', '.select-btn', btn => toggleSelect(btn.closest('.select')));
  on(document, 'click', '.select .menu button', pickSelect);
  document.addEventListener('click', e => { if (!e.target.closest('.select')) closeSelects(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('.select .menu')) closeSelects();
    else if (drawerOpen() && !modalOpen()) closeDrawer();
  });
  // Controls rendered after boot get their thumb as soon as they reach the page.
  new MutationObserver(records => {
    for (const r of records) for (const node of r.addedNodes) if (node.nodeType === 1 && (node.matches('.seg') || node.querySelector('.seg'))) { placeThumbs(node.parentElement); return; }
  }).observe(document.body, { childList: true, subtree: true });
}

export const ICONS = {
  arrow: '<svg viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  chevron: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>',
  check: '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  edit: '<svg viewBox="0 0 16 16"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>',
  plus: '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>',
  token: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M5.5 8h5M8 5.5v5"/></svg>',
  model: '<svg viewBox="0 0 16 16"><path d="M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9z"/><path d="M8 8l5.4-3.1M8 8v6.2M8 8L2.6 4.9"/></svg>',
  clock: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/></svg>',
  chat: '<svg viewBox="0 0 16 16"><path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7l-3 2.5v-2.5h0a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
  info: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6M8 5.2v.1"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  desktop: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="8" rx="1.5"/><path d="M6 14h4M8 11v3"/></svg>',
  book: '<svg viewBox="0 0 16 16"><path d="M2 3h4a2 2 0 0 1 2 2v8a1.5 1.5 0 0 0-1.5-1.5H2zM14 3h-4a2 2 0 0 0-2 2v8a1.5 1.5 0 0 1 1.5-1.5H14z"/></svg>',
  lock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  chevronLeft: '<svg viewBox="0 0 16 16"><path d="M10 4L6 8l4 4"/></svg>',
  chevronRight: '<svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4"/></svg>',
  terminal: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 7l2 1.5L5 10M8.5 10h2.5"/></svg>',
};
