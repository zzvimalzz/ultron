import { $, esc, on } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import { brandSVG, colorHex, mascotSVG } from '../lib/mascots.js';
import { ICONS, button, errorText, onSegment, options, phase, segmented, skeleton, tip, tipRows, toast } from '../lib/ui.js';
import { flowchart } from '../lib/flowchart.js';
import { api, state, saveConfig } from '../lib/state.js';
import { launch } from './accounts.js';

const LINK_MS = 10 * 60 * 1000;
const STATUS = { working: 'Working', open: 'Open', idle: 'Idle' };
const LEGEND = [['dot working', 'Working'], ['dot open', 'Open'], ['dot idle', 'Idle'], ['line message', 'Message'], ['line memory', 'Memory']];
const INELIGIBLE = { free: 'Free plan', unknown: 'Plan unknown', paid: 'Left out by you', team: 'Left out by you' };
const OTHER = { id: 'other', name: 'VS Code & CLI', provider: 'claude', color: 7, mascot: {}, roles: [] };

let root;
let data = null;
let seen = null;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const box = (w, h) => `<rect class="box" width="${w}" height="${h}" rx="12"/>`;
const text = (x, y, value, cls) => `<text x="${x}" y="${y}" class="${cls}">${esc(value)}</text>`;
const dot = (x, y, status) => `<circle class="dot ${status}" cx="${x}" cy="${y}" r="3.5"/>`;

function crewAgents() {
  const others = data.sessions.filter(s => s.agent === 'other');
  return others.length ? [...data.agents, { ...OTHER, status: others.some(s => s.working) ? 'working' : 'idle' }] : data.agents;
}

const roleLabels = a => a.roles.map(id => state.info.roles.find(r => r.id === id)?.label || id);

function agentNode(a, parent) {
  const leader = a.id === data.leader;
  const roles = roleLabels(a);
  const body = box(200, 70)
    + `<g transform="translate(12 18)">${mascotSVG(a, 42)}</g>`
    + text(66, 26, clip(a.name, 16), 'n-name') + dot(70, 41, a.status) + text(79, 45, STATUS[a.status], 'n-sub')
    + (roles.length ? text(66, 60, clip(roles.join(' · '), 24), 'n-sub') : '')
    + (leader ? '<g class="tag" transform="translate(138 -9)"><rect width="54" height="18" rx="9"/><text x="27" y="12.5">Leader</text></g>' : '');
  const clickable = a.id !== OTHER.id;
  const idle = a.eligible === false;
  return {
    id: a.id, parent, w: 200, h: 70, cls: `agent ${a.status}${idle ? ' ineligible' : ''}`, live: a.status === 'working',
    attrs: `style="--account:${colorHex(a.color)}" ${clickable ? `data-node="agent" data-id="${a.id}"` : ''}`
      + ` data-tip="${tipRows(a.name, [['Status', STATUS[a.status]], ...(idle ? [['Not in crew', INELIGIBLE[a.tier] || INELIGIBLE.unknown]] : []), ...(a.model ? [['Model', a.effort ? `${a.model} · ${a.effort}` : a.model]] : []), ...(roles.length ? [['Roles', roles.join(', ')]] : []), ...(clickable ? [['Click', 'Open']] : [])])}"`,
    body,
  };
}

function sessionNode(s, parent) {
  const status = s.working ? 'working' : 'idle';
  return {
    id: `s:${s.id}`, parent, w: 156, h: 46, cls: `${s.parent ? 'sub' : 'session'} ${status}`, live: s.working,
    attrs: `data-tip="${tipRows(s.label, [['Kind', s.parent ? 'Subagent' : 'Session'], ['Folder', s.cwd || '—'], ['Last activity', fmt.ago(s.lastActivity)]])}"`,
    body: box(156, 46) + dot(16, 23, status) + text(28, 20, clip(s.label, 17), 'n-name sm')
      + text(28, 36, s.working ? 'Working' : `Idle · ${fmt.ago(s.lastActivity)}`, 'n-sub'),
  };
}

function buildNodes() {
  const agents = crewAgents();
  const you = state.config.userName || 'You';
  const nodes = [
    { id: 'you', parent: null, w: 156, h: 54, cls: 'you',
      body: `${box(156, 54)}<rect class="you-mark" x="11" y="11" width="32" height="32" rx="9"/><g transform="translate(15 18)">${brandSVG(24)}</g>`
        + text(54, 25, clip(you, 13), 'n-name') + text(54, 41, fmt.count(agents.length, 'agent'), 'n-sub') },
  ];
  const leader = agents.find(a => a.id === data.leader);
  if (leader) nodes.push(agentNode(leader, 'you'));
  const lastNote = data.events.filter(e => e.type === 'memory').pop();
  nodes.push({ id: 'memory', parent: 'you', w: 176, h: 54, cls: `memory ${data.connected ? '' : 'off'}`,
    attrs: `data-node="memory" data-tip="${tipRows('Shared memory', [['Folder', data.memoryDir], ['Click', 'Open folder']])}"`,
    body: `${box(176, 54)}<path class="mem-icon" d="M14 16h9a4 4 0 0 1 4 4v18a3 3 0 0 0-3-3h-10z M40 16h-9a4 4 0 0 0-4 4v18a3 3 0 0 1 3-3h10z"/>`
      + text(52, 25, 'Shared memory', 'n-name') + text(52, 41, !data.connected ? 'Not connected' : lastNote ? `Used ${fmt.ago(lastNote.t)}` : 'Empty', 'n-sub') });
  for (const a of agents.filter(x => x !== leader)) nodes.push(agentNode(a, leader ? leader.id : 'you'));
  const ids = new Set(data.sessions.map(s => s.id));
  const sorted = [...data.sessions].sort((a, b) => Boolean(a.parent) - Boolean(b.parent) || b.lastActivity - a.lastActivity);
  for (const s of sorted) nodes.push(sessionNode(s, s.parent && ids.has(s.parent) ? `s:${s.parent}` : s.agent));
  if (seen) nodes.forEach(n => { if (!seen.has(n.id)) n.cls += ' enter'; });
  seen = new Set(nodes.map(n => n.id));
  return nodes;
}

function buildLinks() {
  const since = Date.now() - LINK_MS;
  const ids = crewAgents().map(a => a.id);
  const links = new Map();
  for (const e of data.events.filter(x => x.t >= since)) {
    const targets = e.type === 'memory' ? ['memory'] : e.to === 'all' ? ids.filter(id => id !== e.from) : [e.to];
    for (const to of targets) links.set(`${e.from}>${to}`, { from: e.from, to, kind: e.type });
  }
  return [...links.values()];
}

function drawMap() {
  const el = $('#flow', root);
  if (!el || !el.clientWidth) return;
  el.innerHTML = flowchart({ nodes: buildNodes(), links: buildLinks(), minWidth: el.clientWidth, minHeight: el.clientHeight, style: phase() });
}

function feed() {
  const byId = new Map(crewAgents().map(a => [a.id, a]));
  const rows = [...data.events].reverse().map(e => {
    const from = byId.get(e.from) || OTHER;
    const head = e.type === 'message'
      ? `<b>${esc(from.name)}</b> → <b>${esc(e.to === 'all' ? 'Everyone' : byId.get(e.to)?.name || 'Unknown')}</b>`
      : `<b>${esc(from.name)}</b> ${e.action === 'saved' ? 'saved a note' : 'searched memory'}`;
    return `<div class="feed-row"><span class="mini" style="--account:${colorHex(from.color)}">${mascotSVG(from, 18)}</span>`
      + `<div class="feed-main"><div class="feed-head">${head}<span class="muted">${fmt.ago(e.t)}</span></div>`
      + `<div class="feed-text">${esc(clip((e.type === 'message' ? e.text : e.title) || '', 280))}</div></div></div>`;
  });
  return rows.join('') || '<div class="feed-empty muted">No messages yet</div>';
}

export function render() {
  if (!data) {
    root.innerHTML = `<div class="page-head"><h1>Crew</h1></div><div class="card flow-card">${skeleton('100%', '540px')}</div>`;
    return;
  }
  const leaders = options(state.config.accounts.map(a => [a.id, a.name]));
  root.innerHTML = `
    <div class="page-head">
      <h1>Crew</h1>
      <div class="head-actions">
        ${leaders.length > 1 ? `<span class="muted">Leader</span>${segmented('leader', leaders, data.leader)}` : ''}
        ${data.connected ? button('Disconnect', { attrs: 'data-connect="off"' }) : `<div class="connect-row">${button('Connect agents', { kind: 'primary', attrs: 'data-connect="on"' })}`
          + `<span class="info-tip" data-tip="${tip('Gives Claude and Codex shared memory, messages, and the KISS and repo-structure skills.')}" aria-label="What connecting does">${ICONS.info}</span></div>`}
      </div>
    </div>
    <div class="stack">
      <div class="card flow-card">
        <div class="flow" id="flow"></div>
        <div class="legend flow-legend">
          ${LEGEND.map(([cls, label]) => `<span data-tip="${tip(label)}" aria-label="${label}"><i class="${cls}"></i></span>`).join('')}
        </div>
      </div>
      <div class="card"><h2 class="card-title">Activity</h2><div class="scroll-area feed">${feed()}</div></div>
    </div>`;
  drawMap();
}

export async function load() {
  data = await api.crewMap();
  render();
}

export function mount(el) {
  root = el;
  on(root, 'click', '[data-connect]', async btn => {
    const connect = btn.dataset.connect === 'on';
    try {
      state.config = await api.connectAgents(connect);
      toast(connect ? 'Agents connected' : 'Agents disconnected');
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
    load();
  });
  onSegment(root, 'leader', async id => { await saveConfig({ crew: { ...state.config.crew, leader: id } }); load(); });
  on(root, 'click', '[data-node="agent"]', g => launch(g.dataset.id));
  on(root, 'click', '[data-node="memory"]', async () => {
    if (await api.openPath(data.memoryDir)) toast('No notes yet');
  });
  new ResizeObserver(() => requestAnimationFrame(drawMap)).observe(root);
}
