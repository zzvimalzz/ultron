import { esc, on } from '../lib/dom.js';
import { mascotSVG } from '../lib/mascots.js';
import { planBadge } from '../lib/plan.js';
import { ICONS, button, onToggle, toggle } from '../lib/ui.js';
import { api, state, loadTargets, saveConfig, toastError } from '../lib/state.js';
import { openEditor } from './editor.js';

const STEPS = ['Apps', 'Accounts', 'Memory', 'Ready'];
const CONNECT_TIP = 'Gives Claude Code and Codex the Ultron Hub: shared memory and messages, plus the kiss and repo-structure skills. You can disconnect any time.';
const LAST = STEPS.length - 1;
const SETTLE_MS = 450;

let el;
let step = 0;
let apps = [];
let statuses = {};
let memoryChoice = 'new';
let memoryDir = '';
let connect = true;
let onDone = () => {};

export const isOpen = () => !el.hidden;
export const setSetupListener = fn => { onDone = fn; };

const iconOf = app => (app.provider ? mascotSVG({ provider: app.provider, color: app.color }, 26) : ICONS.terminal);
const logo = html => `<span class="logo">${html}</span>`;

function appRow(app) {
  const action = app.installed ? `<span class="check">${ICONS.check}</span>`
    : app.command ? `<code class="cmd">${esc(app.command)}</code>${button('Run', { kind: 'primary sm', attrs: `data-run-install="${app.id}"` })}`
      : `<a class="btn sm" href="${esc(app.download)}" target="_blank">Install</a>`;
  return `<div class="lrow">${logo(iconOf(app))}<span class="t">${esc(app.label)}</span>${action}</div>`;
}

function accountRow(account) {
  const live = state.overview[account.id] || {};
  const status = statuses[account.id] || {};
  const mini = logo(mascotSVG(account, 26));
  if (live.launchOnly) return `<div class="lrow">${mini}<span class="t">${esc(account.name)}</span><span class="muted">Opens in your browser</span></div>`;
  const signed = status.cli || status.desktop;
  const cell = signed ? planBadge(live) || `<span class="check">${ICONS.check}</span>` : button('Sign in', { kind: 'primary sm', attrs: `data-setup-sign-in="${esc(account.id)}"` });
  return `<div class="lrow">${mini}<span class="t">${esc(account.name)}</span>${cell}</div>`;
}

const radio = (choice, label, extra = '') => `<div class="lrow"><button class="radio" role="radio" aria-checked="${memoryChoice === choice}" data-memory-choice="${choice}"><i></i>${label}</button>${extra}</div>`;

function body() {
  if (step === 0) return `<div class="setup-list">${apps.map(appRow).join('')}</div>`;
  if (step === 1) {
    return `<div class="setup-list">${state.config.accounts.map(accountRow).join('') || '<div class="empty">No accounts yet</div>'}</div>`;
  }
  if (step === 2) {
    return radio('new', 'Create a new vault') + radio('folder', 'Use an existing folder', `<span class="spacer"></span>${memoryDir ? `<span class="muted dir">${esc(memoryDir)}</span>` : ''}${button('Browse', { icon: ICONS.folder, attrs: 'data-memory-pick' })}`)
      + `<div class="lrow"><span class="t">Connect agents</span><span class="info-tip" data-tip="${esc(CONNECT_TIP)}" aria-label="What connecting does">${ICONS.info}</span>${toggle('connect', connect, 'Connect agents')}</div>`;
  }
  return `<div class="setup-done">${mascotSVG({ provider: 'claude', color: 2, mascot: { eyes: 'happy', accessory: 'party' } }, 120)}<h3>You're set</h3></div>`;
}

function actions() {
  const back = step ? button('Back', { kind: 'ghost', attrs: 'data-setup-back' }) : '';
  const left = step === 0 ? button('Check again', { kind: 'ghost', attrs: 'data-setup-recheck' }) : '';
  if (step === LAST) return `${back}<span class="spacer"></span>${button('Open Ultron', { kind: 'primary', attrs: 'data-setup-finish' })}`;
  const add = step === 1 ? button('Add account', { icon: ICONS.plus, attrs: 'data-setup-add' }) : '';
  return `${back}${left}${add}<span class="spacer"></span>${button('Skip', { attrs: 'data-setup-next=skip' })}${button('Next', { kind: 'primary', attrs: 'data-setup-next=go' })}`;
}

function draw() {
  el.innerHTML = `<div class="modal setup" role="dialog" aria-modal="true" aria-label="Set up Ultron">`
    + `<div class="modal-head"><h2>${STEPS[step]}</h2><span class="steps">${STEPS.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</span>`
    + `<button class="icon-btn" data-setup-finish aria-label="Close">${ICONS.close}</button></div>`
    + `<div class="modal-body">${body()}</div><div class="modal-foot">${actions()}</div></div>`;
}

async function load() {
  if (step === 0) apps = await api.setupApps();
  if (step === 1) {
    await loadTargets();
    statuses = Object.fromEntries(await Promise.all(state.config.accounts.map(async a => [a.id, await api.accountStatus(a.id)])));
  }
  draw();
}

export async function open() {
  step = 0;
  memoryChoice = 'new';
  memoryDir = '';
  connect = true;
  el.classList.remove('settled');
  setTimeout(() => el.classList.add('settled'), SETTLE_MS);
  el.hidden = false;
  await load();
}

export const refresh = () => (isOpen() && step < 2 ? load() : null);

async function finish() {
  el.hidden = true;
  el.innerHTML = '';
  if (!state.config.setupDone) await saveConfig({ setupDone: true });
  onDone();
}

async function applyMemory() {
  if (memoryChoice === 'folder' && !memoryDir) throw new Error('Choose a folder first');
  await api.memory.setDir(memoryChoice === 'folder' ? memoryDir : '');
  if (connect) await api.connectAgents(true);
  state.config = await api.getConfig();
}

async function go(to) {
  step = to;
  await load();
}

export function mount(root) {
  el = root;
  on(el, 'click', '[data-run-install]', async btn => {
    try { await api.runSetup(btn.dataset.runInstall); } catch (err) { toastError(err); }
  });
  on(el, 'click', '[data-setup-recheck]', load);
  window.addEventListener('focus', () => { if (isOpen() && step === 0) load(); });
  on(el, 'click', '[data-setup-sign-in]', async btn => {
    const account = state.config.accounts.find(a => a.id === btn.dataset.setupSignIn);
    const cli = state.targets[account.id]?.find(t => t.id === account.openWith)?.cli;
    try { await api.signIn(account.id, cli ? 'cli' : 'desktop'); } catch (err) { toastError(err, account.id); }
  });
  on(el, 'click', '[data-setup-add]', () => openEditor());
  on(el, 'click', '[data-memory-choice]', btn => { memoryChoice = btn.dataset.memoryChoice; draw(); });
  on(el, 'click', '[data-memory-pick]', async () => {
    const dir = await api.pickFolder();
    if (dir) { memoryDir = dir; memoryChoice = 'folder'; draw(); }
  });
  onToggle(el, 'connect', value => { connect = value; draw(); });
  on(el, 'click', '[data-setup-back]', () => go(step - 1));
  on(el, 'click', '[data-setup-next]', async btn => {
    if (step === 2 && btn.dataset.setupNext === 'go') {
      try { await applyMemory(); } catch (err) { toastError(err); return; }
    }
    go(step + 1);
  });
  on(el, 'click', '[data-setup-finish]', finish);
}
