import { $, esc, on } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import { colorHex, mascotSVG } from '../lib/mascots.js';
import { ICONS, badge, button, errorText, flip, tip, toast } from '../lib/ui.js';
import { api, state } from '../lib/state.js';

const SEARCH_MS = 200;
const VERBS = {
  context: e => `read the context for ${e.title}`, recalled: e => `searched memory for “${e.title}”`, saved: e => `saved ${e.title}`,
  updated: e => `updated ${e.title}`, archived: e => `archived ${e.title}`, curated: e => `tidied ${e.title}`,
};

let root;
let vault = '';
let data = { toConfirm: [], inbox: [], reviewed: '' };
let recent = [];
let results = null;
let keepFor = null;
let searchTimer = null;

const itemKey = item => `${item.file}:${item.line}`;
const sourceOf = text => /Source: (.+?)(?:;|\)$)/.exec(text)?.[1] || '';
const bodyOf = text => text.replace(/\s*\((?:unconfirmed; )?Source:.*\)$/, '');

function row(list, item, actions) {
  return `<div class="mrow" data-flip="${esc(itemKey(item))}" data-list="${list}" data-key="${esc(itemKey(item))}">`
    + `<div class="x">${esc(bodyOf(item.text))}<div class="src">${esc([item.file, sourceOf(item.text)].filter(Boolean).join(' · '))}</div></div>${actions}</div>`;
}

const iconButton = (attrs, icon, label) => `<button class="icon-btn" ${attrs} aria-label="${label}" data-tip="${tip(label)}">${icon}</button>`;

function keepMenu(item) {
  return `<span class="plan-wrap">${button('Keep', { kind: 'sm', attrs: 'data-keep' })}${keepFor === itemKey(item)
    ? `<div class="menu" role="menu">${state.info.sections.map(s => `<button role="menuitem" data-section="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</span>`;
}

function left() {
  if (results) {
    return `<div class="card"><div class="mh"><span class="cap">Results</span>${badge(String(results.length))}</div>${results.map(r => `<div class="mrow"><div class="x"><b>${esc(r.title)}</b>`
      + `<div class="src">${esc(r.file)}${r.text ? ` · ${esc(r.text.replace(/^#.*\n+/, '').slice(0, 90))}` : ''}</div></div>${button('Open', { kind: 'ghost sm', attrs: `data-open="${esc(r.file)}"` })}</div>`).join('')
      || '<div class="mrow muted">No notes match</div>'}</div>`;
  }
  return `<div class="card"><div class="mh"><span class="cap">To confirm</span>${badge(String(data.toConfirm.length), { tone: data.toConfirm.length ? 'warn' : '' })}</div>`
    + `${data.toConfirm.map(i => row('toConfirm', i, iconButton('data-confirm', ICONS.check, 'Confirm') + iconButton('data-reject', ICONS.close, 'Reject'))).join('') || '<div class="mrow muted">All caught up</div>'}</div>`
    + `<div class="card"><div class="mh"><span class="cap">Inbox</span>${badge(String(data.inbox.length))}</div>`
    + `${data.inbox.map(i => row('inbox', i, keepMenu(i) + iconButton('data-drop', ICONS.close, 'Drop'))).join('') || '<div class="mrow muted">Nothing waiting</div>'}</div>`;
}

function changes() {
  const people = new Map(state.config.accounts.map(a => [a.id, a]));
  const rows = recent.map(e => {
    const who = people.get(e.from?.agent) || { name: 'Ultron', color: 7, mascot: {}, provider: e.from?.provider || 'claude' };
    return `<div class="feed-row"><span class="mini" style="--account:${colorHex(who.color)}">${mascotSVG(who, 18)}</span><div class="feed-main">`
      + `<div class="feed-head"><b>${esc(who.name)}</b> ${esc((VERBS[e.action] || (x => x.action))(e))}<span class="muted">${fmt.ago(e.t)}</span></div></div></div>`;
  });
  return rows.join('') || '<div class="feed-empty muted">Nothing saved yet</div>';
}

function draw() {
  $('#memLeft', root).innerHTML = left();
  $('#memRight', root).innerHTML = `<h2 class="card-title">Recent changes</h2><div class="scroll-area feed">${changes()}</div>`
    + `<div class="mfoot"><span class="muted">${esc(vault)}${data.reviewed ? ` · reviewed ${esc(data.reviewed)}` : ''}</span>${button('Open folder', { kind: 'sm', attrs: 'data-open-vault' })}</div>`;
}

export async function load(el, vaultDir) {
  vault = vaultDir;
  el.innerHTML = `<input class="input mem-search" id="memSearch" placeholder="Search memory" aria-label="Search memory">`
    + `<div class="mem-grid"><div class="stack" id="memLeft"></div><div class="card" id="memRight"></div></div>`;
  [data, recent] = await Promise.all([api.memory.pending(), api.memory.recent()]);
  results = null;
  draw();
}

async function act(el, call) {
  const list = el.closest('[data-list]');
  const item = data[list.dataset.list].find(i => itemKey(i) === list.dataset.key);
  try {
    await call(item);
    data = await api.memory.pending();
    keepFor = null;
    flip(root, draw);
  } catch (err) {
    toast(errorText(err), { kind: 'error' });
  }
}

export function mount(el) {
  root = el;
  on(root, 'input', '#memSearch', input => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      results = input.value.trim() ? await api.memory.search(input.value.trim()) : null;
      draw();
    }, SEARCH_MS);
  });
  on(root, 'click', '[data-confirm]', btn => act(btn, item => api.memory.confirm(item)));
  on(root, 'click', '[data-reject]', btn => act(btn, item => api.memory.reject(item)));
  on(root, 'click', '[data-drop]', btn => act(btn, item => api.memory.drop(item)));
  on(root, 'click', '[data-keep]', btn => {
    const key = btn.closest('[data-key]').dataset.key;
    keepFor = keepFor === key ? null : key;
    draw();
  });
  on(root, 'click', '[data-section]', btn => act(btn, item => api.memory.keep(item, btn.dataset.section)));
  on(root, 'click', '[data-open]', btn => api.openPath(`${vault}\\${btn.dataset.open.replaceAll('/', '\\')}`));
  on(root, 'click', '[data-open-vault]', () => api.openPath(vault));
}
