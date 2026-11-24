import { $, $$, esc } from './lib/dom.js';
import { brandSVG, colorHex, mascotSVG } from './lib/mascots.js';
import { installTooltips, modalOpen } from './lib/ui.js';
import { api, state } from './lib/state.js';
import * as accounts from './pages/accounts.js';
import * as usage from './pages/usage.js';
import * as settings from './pages/settings.js';
import { setEditorListener } from './pages/editor.js';

const PAGES = { accounts, usage, settings };
const SHORTCUTS = { 1: 'accounts', 2: 'usage', ',': 'settings' };
let current = 'accounts';

function applyTheme() {
  const theme = state.config.theme || 'system';
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function show(page) {
  current = page;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  $('#scroller').scrollTop = 0;
  if (page === 'usage' && !state.usageData) usage.load();
  else if (page === 'settings') settings.load();
  else PAGES[page].render();
}

function renderSidebar() {
  $('#sidebarFoot').innerHTML = state.config.accounts.map(a => `
    <div class="foot-row" title="${esc(a.name)}">
      <span class="mini" style="--account:${colorHex(a.color)}">${mascotSVG(a, 18)}</span>
      <span class="name">${esc(a.name)}</span>
      <span class="dot ${state.overview[a.id]?.running ? 'on' : ''}"></span>
    </div>`).join('');
}

async function refreshLive() {
  state.overview = await api.overview();
  renderSidebar();
  if (current === 'accounts' && !modalOpen()) accounts.render();
  if (state.usageData) await usage.load();
}

function onKey(e) {
  if (modalOpen()) {
    if (e.key === 'Escape') $('#modal [data-close]')?.click();
    return;
  }
  if (e.ctrlKey && SHORTCUTS[e.key]) { e.preventDefault(); show(SHORTCUTS[e.key]); return; }
  if (e.ctrlKey || e.altKey || /input|textarea/i.test(document.activeElement?.tagName)) return;
  if (current === 'accounts' && /^[1-9]$/.test(e.key)) {
    const account = state.config.accounts[Number(e.key) - 1];
    if (account) accounts.launch(account.id);
  }
}

async function boot() {
  state.config = await api.getConfig();
  applyTheme();
  $('#brandMark').innerHTML = brandSVG(26);
  for (const [name, page] of Object.entries(PAGES)) page.mount($(`#page-${name}`));
  $$('.nav-item').forEach(b => b.addEventListener('click', () => show(b.dataset.page)));
  document.addEventListener('keydown', onKey);
  document.addEventListener('themechange', () => { applyTheme(); if (state.usageData) usage.render(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (current === 'usage') usage.render(); });
  setEditorListener(() => { renderSidebar(); PAGES[current].render(); });
  installTooltips();
  accounts.render();
  await accounts.loadTargets();
  await refreshLive();
  api.onLive(refreshLive);
  // Relative times ("5m ago") drift between live events, so the cards re-render each minute.
  setInterval(() => { if (current === 'accounts' && !modalOpen()) accounts.render(); }, 60000);
}

boot();
