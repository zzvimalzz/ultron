import { $, esc, on } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import { colorHex, mascotSVG } from '../lib/mascots.js';
import { ICONS, button, flip, onSegment, options, segmented, skeleton, tip, toast } from '../lib/ui.js';
import { createGraph } from '../lib/graph.js';
import { describe } from '../lib/activity.js';
import { api, accountById, state, toastError } from '../lib/state.js';
import { launch } from './accounts.js';
import * as memoryView from './memory.js';

const ACT_TTL_MS = 120 * 1000;
const REFRESH_MS = 10 * 1000;
const PANEL_KEY = 'ultron.panel.open';
const TRAIL = 3;
const KINDS = [['edit', 'Edit'], ['run', 'Run'], ['read', 'Read'], ['search', 'Search'], ['web', 'Web'], ['mcp', 'MCP'], ['memory', 'Memory'], ['agent', 'Agent']];

let root;
let data = null;
let graph = null;
let shownTab = null;
let tab = 'map';
let zen = false;
let panelOpen = false;
let actions = new Map();

try { panelOpen = localStorage.getItem(PANEL_KEY) === '1'; } catch { /* storage unavailable */ }

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const accountFor = id => accountById(id) || { name: 'Account', color: 1, mascot: {}, provider: 'claude' };
const folderName = cwd => (cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'Unknown folder';
const folderKey = cwd => (cwd || '').toLowerCase().replaceAll('/', '\\').replace(/\\+$/, '');
const hostOf = text => { try { return new URL(text).hostname.replace(/^www\./, ''); } catch { return ''; } };
const actsOf = s => [...s.acts].reverse().map(a => describe(a, data.memoryDir));

// Sessions an account owns, with Claude subagents only while they work.
const visibleSessions = () => data.sessions.filter(s => accountById(s.agent) && (!s.parent || s.working));
const topSessions = () => visibleSessions().filter(s => !s.parent).sort((a, b) => b.working - a.working || b.lastActivity - a.lastActivity);

const label = (y, text, cls = '') => `<text class="glabel ${cls}" y="${y}">${esc(clip(text, 24))}</text>`;
const iconAt = (icon, size) => icon.replace('<svg ', `<svg class="gicon" x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}" `);
const disc = (r, icon, size) => `<circle class="gdisc" r="${r}"/>${iconAt(icon, size)}`;

function accountNode(account, mine) {
  const busy = mine.some(s => s.working);
  const status = busy ? 'Working' : state.overview[account.id]?.running ? 'Open' : 'Not running';
  return {
    id: `a:${account.id}`, r: 36, cls: `account ${busy ? 'working' : 'idle'}`, style: `--account:${colorHex(account.color)}`, tip: esc(`${account.name} · click to open`),
    body: `<circle class="gring" r="38"/><circle class="gdisc" r="34"/><g transform="translate(-22 -22)">${mascotSVG(account, 44)}</g>`
      + label(56, account.name, 'strong') + label(71, mine.length > 1 ? `${status} · ${mine.length} sessions` : status, 'sub'),
  };
}

function sessionNode(s, parent) {
  const sub = Boolean(s.parent);
  const r = sub ? 11 : 16;
  return {
    id: `s:${s.id}`, r, near: parent, pull: 0.6, cls: `session ${s.working ? 'working' : 'idle'} ${sub ? 'subagent' : ''}`,
    style: `--account:${colorHex(accountFor(s.agent).color)}`, tip: esc(sub ? s.label : `${s.title || s.label} · click to open where it runs`),
    body: disc(r, sub ? ICONS.branch : ICONS.chat, sub ? 11 : 15) + label(r + 14, sub ? s.label : s.title || s.label, 'sm'),
  };
}

function toolNode(s, act) {
  return {
    id: `t:${s.id}:${act.t}:${act.verb}:${act.target}`, r: 11, near: `s:${s.id}`, pull: 0.3, cls: `tool k-${act.kind}`,
    style: `--fade:${Math.max(0.6, 1 - (Date.now() - act.t) / ACT_TTL_MS).toFixed(2)}`, tip: esc(`${act.verb} ${act.target}`.trim()),
    body: disc(11, act.icon, 12) + label(24, act.target || act.verb, 'sm'),
  };
}

// The shared thing a tool call reaches: the memory vault, an MCP server, or a website. Calls to the same one meet at one node.
function hubFor(act) {
  if (act.kind === 'memory') return { id: 'memory', kind: 'memory' };
  if (act.server) return { id: `mcp:${act.server}`, name: act.server.replace(/[_-]+/g, ' '), kind: 'mcp', icon: ICONS.plug };
  if (act.kind !== 'web') return null;
  const host = hostOf(act.target);
  return { id: host ? `web:${host}` : 'web', name: host || 'Web', kind: 'web', icon: ICONS.globe };
}

function hubNode(hub, near) {
  return {
    id: hub.id, r: 20, near, pull: 0.5, cls: `hub k-${hub.kind}`, tip: esc(hub.name),
    body: disc(20, hub.icon, 18) + label(34, hub.name, 'sm'),
  };
}

function memoryNode(near) {
  const last = data.memoryEvents[data.memoryEvents.length - 1];
  return {
    id: 'memory', r: 24, near, pull: 0.5, cls: `hub k-memory ${data.connected ? '' : 'idle'}`, tip: esc('Memory · click to review'),
    body: disc(24, ICONS.book, 20) + label(40, 'Memory', 'strong') + label(54, last ? `Used ${fmt.ago(last.t)}` : 'Empty', 'sub'),
  };
}

function folderNode(cwd, ids, near) {
  const shared = ids.size > 1;
  return {
    id: `f:${folderKey(cwd)}`, r: 19, near, pull: 0.5, cls: `folder ${shared ? 'shared' : ''}`, tip: esc(`${cwd} · click to open`),
    body: disc(19, ICONS.folder, 17) + label(33, folderName(cwd), 'strong') + (shared ? label(47, `${ids.size} sessions`, 'sub') : ''),
  };
}

// Accounts own sessions; sessions work in a folder and call tools; tools reach shared MCP servers, websites and memory.
function buildGraph() {
  const nodes = [];
  const links = [];
  const folders = new Map();
  const hubs = new Map();
  const sessions = visibleSessions();
  actions = new Map();
  let memoryNear = null;

  for (const account of state.config.accounts.filter(a => !state.overview[a.id]?.launchOnly)) {
    nodes.push(accountNode(account, sessions.filter(s => s.agent === account.id && !s.parent)));
    actions.set(`a:${account.id}`, () => launch(account.id));
  }
  for (const s of sessions) {
    const parent = s.parent ? `s:${s.parent}` : `a:${s.agent}`;
    if (s.parent && !sessions.some(p => p.id === s.parent)) continue;
    const style = `--account:${colorHex(accountFor(s.agent).color)}`;
    nodes.push(sessionNode(s, parent));
    links.push({ a: parent, b: `s:${s.id}`, cls: `owner ${s.working ? 'live' : ''}`, style, len: s.parent ? 80 : 135 });
    actions.set(`s:${s.id}`, () => openSession(s.parent || s.id));
    if (!s.parent && s.cwd) {
      const key = folderKey(s.cwd);
      if (!folders.has(key)) folders.set(key, { cwd: s.cwd, ids: new Set(), near: `s:${s.id}` });
      folders.get(key).ids.add(s.id);
      links.push({ a: `s:${s.id}`, b: `f:${key}`, cls: 'folder-link', len: 140 });
    }
    for (const act of actsOf(s).filter(a => a.kind !== 'say' && Date.now() - a.t < ACT_TTL_MS)) {
      const tool = toolNode(s, act);
      nodes.push(tool);
      links.push({ a: `s:${s.id}`, b: tool.id, cls: `call k-${act.kind}`, len: 88 });
      const hub = hubFor(act);
      if (!hub) continue;
      if (hub.id === 'memory') memoryNear ||= tool.id;
      else if (!hubs.has(hub.id)) hubs.set(hub.id, { hub, near: tool.id });
      links.push({ a: tool.id, b: hub.id, cls: `use k-${hub.kind}`, len: 95 });
    }
  }
  for (const { cwd, ids, near } of folders.values()) {
    nodes.push(folderNode(cwd, ids, near));
    actions.set(`f:${folderKey(cwd)}`, () => api.openPath(cwd));
  }
  for (const { hub, near } of hubs.values()) nodes.push(hubNode(hub, near));
  if (data.connected || memoryNear) {
    nodes.push(memoryNode(memoryNear));
    actions.set('memory', () => { tab = 'memory'; render(); });
  }
  return { nodes, links };
}

async function openSession(id) {
  const s = data.sessions.find(x => x.id === id);
  try {
    const where = await api.openSession(id);
    toast(where ? `Opening ${s.title || s.label} in ${where}…` : 'Already running in its terminal window', { icon: mascotSVG(accountFor(s.agent), 22) });
  } catch (err) {
    toastError(err, s?.agent);
  }
}

function actRow(a, sessionId) {
  const words = a.verb ? `<span class="act-verb">${esc(a.verb)}</span><span class="act-target">${esc(a.target)}</span>` : `<span class="act-target">“${esc(a.target)}”</span>`;
  return `<div class="act ${a.kind}" data-flip="${esc(`act:${sessionId}:${a.t}:${a.verb}:${a.target}`)}" data-tip="${tip(a.target || a.verb)}"><span class="act-ico">${a.icon}</span>${words}<span class="when">${fmt.since(a.t)}</span></div>`;
}

function liveCard(s) {
  const account = accountFor(s.agent);
  const [now, ...trail] = actsOf(s);
  const subagents = data.sessions.filter(x => x.parent === s.id && x.working);
  return `<div class="live-card ${s.working ? 'working' : ''}" style="--account:${colorHex(account.color)}" data-session="${esc(s.id)}" data-flip="live-${esc(s.id)}">`
    + `<div class="lc-head"><span class="mini">${mascotSVG(account, 22)}</span><div class="lc-who"><b>${esc(account.name)}</b><span>${esc(s.title || s.label)}</span></div>`
    + `<span class="lc-state">${s.working ? '<i></i>Working' : esc(`Idle ${fmt.since(s.lastActivity)}`)}</span></div>`
    + `<div class="lc-meta"><button class="lc-chip" data-open-folder="${esc(s.cwd || '')}" data-tip="${tip(s.cwd || 'Unknown folder')}">${ICONS.folder}<span>${esc(folderName(s.cwd))}</span></button>`
    + `${s.model ? `<span class="lc-chip">${ICONS.model}<span>${esc(s.model)}</span></span>` : ''}</div>`
    + `${now ? `<div class="lc-now">${actRow(now, s.id)}</div>` : ''}`
    + `${trail.length ? `<div class="lc-trail">${trail.slice(0, TRAIL).map(a => actRow(a, s.id)).join('')}</div>` : ''}`
    + `${subagents.length ? `<div class="lc-subs">${subagents.map(x => `<span class="lc-sub"><i></i>${esc(x.label)}</span>`).join('')}</div>` : ''}</div>`;
}

const connectHtml = () => (data.connected ? button('Disconnect', { attrs: 'data-connect="off"' })
  : `<span class="connect-row">${button('Connect agents', { kind: 'primary', attrs: 'data-connect="on"' })}<span class="info-tip" data-tip="${tip('Gives Claude and Codex shared memory, messages, and the KISS and repo-structure skills.')}" aria-label="What connecting does">${ICONS.info}</span></span>`);

const iconButton = (attrs, icon, text) => `<button class="icon-btn" ${attrs} aria-label="${text}" data-tip="${tip(text)}">${icon}</button>`;

function head() {
  const tools = tab === 'map' ? `${iconButton('data-panel', ICONS.list, 'Live sessions')}${iconButton('data-zen', zen ? ICONS.compress : ICONS.expand, 'Full screen')}` : '';
  return `<div class="uhead"><h1>Ultron</h1>${segmented('tab', options([['map', 'Map'], ['memory', 'Memory']]), tab)}<span class="live-count" id="ucount" hidden></span>`
    + `<div class="head-actions"><span id="uconnect">${connectHtml()}</span>${tools}</div></div>`;
}

const legend = () => `<div class="ulegend">${KINDS.map(([kind, name]) => `<span class="k-${kind}"><i></i>${name}</span>`).join('')}</div>`;

function shell() {
  graph?.destroy();
  graph = null;
  shownTab = tab;
  if (tab === 'memory') {
    root.innerHTML = `<div class="umem">${head()}<div id="mem"></div></div>`;
    memoryView.load($('#mem', root), data.memoryDir);
    return;
  }
  root.innerHTML = `<div class="umap ${panelOpen ? '' : 'nopanel'}" id="umap"><div class="ugraph" id="ugraph"></div>${head()}${legend()}`
    + '<div class="uempty" id="uempty" hidden>Nobody is working right now. Start a Claude Code or Codex session and it appears here.</div>'
    + `<aside class="upanel"><div class="upanel-head"><span class="t">Live</span>${iconButton('data-panel', ICONS.chevronRight, 'Hide panel')}</div><div class="upanel-body" id="ubody"></div></aside></div>`;
  graph = createGraph($('#ugraph', root), id => actions.get(id)?.());
}

function refresh() {
  $('#uconnect', root).innerHTML = connectHtml();
  if (tab === 'memory') return;
  const sessions = topSessions();
  const busy = visibleSessions().filter(s => s.working && !s.parent).length;
  const count = $('#ucount', root);
  count.hidden = !busy;
  count.innerHTML = `<i></i>${busy} working`;
  $('#uempty', root).hidden = sessions.length > 0;
  graph.update(buildGraph());
  flip($('#ubody', root), () => { $('#ubody', root).innerHTML = sessions.map(liveCard).join('') || '<div class="feed-empty muted">No recent sessions</div>'; });
}

export function render() {
  if (!data) {
    root.innerHTML = `<div class="umem">${skeleton('100%', '540px')}</div>`;
  } else if (shownTab !== tab) {
    shell();
    if (tab === 'map') refresh();
  } else {
    refresh();
  }
}

export async function load() {
  data = await api.liveMap();
  if (tab === 'memory' && shownTab === tab) memoryView.load($('#mem', root), data.memoryDir);
  render();
}

function setZen(on) {
  zen = on;
  $('.app').classList.toggle('zen', on);
  api.setFullscreen(on);
  const button = $('[data-zen]', root);
  if (button) button.innerHTML = on ? ICONS.compress : ICONS.expand;
}

export const leave = () => { if (zen) setZen(false); };

export function mount(el) {
  root = el;
  memoryView.mount(root);
  onSegment(root, 'tab', value => { tab = value; render(); });
  on(root, 'click', '[data-connect]', async btn => {
    const connect = btn.dataset.connect === 'on';
    try {
      state.config = await api.connectAgents(connect);
      toast(connect ? 'Agents connected' : 'Agents disconnected');
    } catch (err) {
      toastError(err);
    }
    await load();
  });
  on(root, 'click', '[data-zen]', () => setZen(!zen));
  on(root, 'click', '[data-panel]', () => {
    panelOpen = !panelOpen;
    $('#umap', root).classList.toggle('nopanel', !panelOpen);
    try { localStorage.setItem(PANEL_KEY, panelOpen ? '1' : '0'); } catch { /* storage unavailable */ }
  });
  on(root, 'click', '[data-session]', (card, e) => { if (!e.target.closest('[data-open-folder]')) openSession(card.dataset.session); });
  on(root, 'click', '[data-open-folder]', btn => { if (btn.dataset.openFolder) api.openPath(btn.dataset.openFolder); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && zen) setZen(false); });
  // Tool calls age out of the map and "5m" labels drift between live events.
  setInterval(() => { if (data && root.classList.contains('active') && tab === 'map') render(); }, REFRESH_MS);
}
