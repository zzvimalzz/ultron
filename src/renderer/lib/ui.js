import { $, esc, on } from './dom.js';

export function toast(text, { kind, icon = '', ms = 2600 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' error' : ''}`;
  el.innerHTML = `${icon ? `<span class="toast-icon">${icon}</span>` : ''}<span>${esc(text)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, ms);
}

export const options = pairs => pairs.map(([value, label]) => ({ value, label }));

export function segmented(name, options, current) {
  return `<div class="seg" data-seg="${name}">${options.map(o => `<button class="${String(o.value) === String(current) ? 'on' : ''}" data-value="${esc(o.value)}">`
    + `${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ''}${esc(o.label)}</button>`).join('')}</div>`;
}

export function onSegment(root, name, handler) {
  on(root, 'click', `[data-seg="${name}"] button`, btn => handler(btn.dataset.value));
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

// Any element with data-tip="<html>" shows a tooltip on hover.
export function installTooltips() {
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

export function openModal(html) {
  const modal = $('#modal');
  modal.innerHTML = html;
  modal.hidden = false;
  const close = () => { modal.hidden = true; modal.innerHTML = ''; };
  modal.onclick = e => { if (e.target === modal || e.target.closest('[data-close]')) close(); };
  return close;
}

export const modalOpen = () => !$('#modal').hidden;

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
};
