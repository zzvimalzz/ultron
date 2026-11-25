import { $, esc, on } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import { brandSVG, colorHex, mascotSVG } from '../lib/mascots.js';
import { ICONS, button, flip, onSegment, openDrawer, options, phase, segmented, skeleton, tip, tipRows, toast } from '../lib/ui.js';
import { flowchart } from '../lib/flowchart.js';
import { describe } from '../lib/activity.js';
import { api, accountById, saveConfig, state, toastError } from '../lib/state.js';
import { openEditor } from './editor.js';
import * as memoryView from './memory.js';

const STATUS = { ready: 'Ready', working: 'Working', waiting: 'Waiting', done: 'Done', failed: 'Failed' };
const INELIGIBLE = { free: 'Free plan', unknown: 'Plan unknown', paid: 'Left out by you', team: 'Left out by you' };
const MEMORY_VERBS = { context: 'read the project context', recalled: 'recalled', saved: 'saved', updated: 'updated', archived: 'archived' };
const WINDOWS = { memory: 2400, report: 1800, blocked: 800, act: 2400 };
const MEMORY_READS = ['context', 'recalled'];
const RESULT_LINES = 12;
const TRAIL = 3;
const TIMELINE_KEY = 'ultron.timeline.collapsed';

let root;
let data = null;
let tasks = [];
let view = null;
let viewingId = null;
let tab = 'crew';
let menuOpen = false;
let undoAsk = false;
let draft = '';
let shellKey = '';
let primed = false;
let effectTimer = null;
let collapsed = false;
const expanded = new Set();
const shown = new Map();
const lastOf = list => list[list.length - 1];

try { collapsed = localStorage.getItem(TIMELINE_KEY) === '1'; } catch { /* storage unavailable */ }

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const box = (w, h) => `<rect class="box" width="${w}" height="${h}" rx="12"/>`;
const text = (x, y, value, cls) => `<text x="${x}" y="${y}" class="${cls}">${esc(value)}</text>`;
const dot = (x, y, status) => `<circle class="dot ${status}" cx="${x}" cy="${y}" r="3.5"/>`;
const eventKey = e => `${e.t}:${e.type}:${e.agent || ''}:${e.title || e.run || e.question || ''}`;
const running = () => ['running', 'waiting'].includes(view?.task.status);
const leader = () => data.agents.find(a => a.id === data.leader);
const folder = () => state.config.ultron?.lastFolder || '';
const accountFor = id => accountById(id) || { name: 'Account', color: 1, mascot: {}, provider: 'claude', roles: [] };

// Live mode: the sessions each account is running on its own, outside Ultron tasks. Sessions no account owns are left out.
const liveSessions = () => data.sessions.filter(s => !s.parent && accountById(s.agent)).sort((a, b) => b.working - a.working || b.lastActivity - a.lastActivity);
const subagentsOf = id => data.sessions.filter(s => s.parent === id && s.working);
const actsOf = s => [...s.acts].reverse().map(a => describe(a, data.memoryDir));
const folderName = cwd => (cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'Unknown folder';
const smallIcon = icon => icon.replace('<svg ', '<svg width="12" height="12" ');
const memoryLink = (node, writes) => (writes ? { from: node, to: 'memory', kind: 'memory' } : { from: 'memory', to: node, kind: 'memory' });
const drawerRows = rows => rows.map(([k, v]) => `<div class="drow"><span class="muted">${esc(k)}</span><span>${esc(v)}</span></div>`).join('');

function runBlocker() {
  if (!leader()?.eligible) return 'The leader needs a paid plan';
  return state.info.git ? '' : 'Install Git to enable undo';
}

const agentOf = id => view?.agents.find(a => a.id === id);
const nameOf = id => (id === 'user' ? 'You' : agentOf(id)?.title || 'Ultron');
const teamOf = id => view?.teams.find(t => t.id === id);

function statusOf(agent) {
  const last = view && lastOf(view.runs.filter(r => r.agent === agent.id));
  if (!last) return 'ready';
  if (last.status === 'running') return view.questions.some(q => q.from === agent.id && q.answer === undefined) ? 'waiting' : 'working';
  return last.status === 'done' ? 'done' : 'failed';
}

// Each live session's newest action, shaped like an event so its chip and glow play once.
const liveActEvents = () => data.sessions.filter(s => s.acts.length && accountById(s.agent)).map(s => {
  const [t, tool, detail] = lastOf(s.acts);
  return { t, type: 'act', session: s.id, title: `${s.id}:${tool}:${detail}` };
});

// Effects (pulses, chips, glows, flashes) play once per event: the first time the page sees it.
function activeEffects() {
  const now = Date.now();
  const active = [];
  for (const e of view ? view.events : [...data.events.filter(x => x.type === 'memory'), ...liveActEvents()]) {
    const kind = e.type === 'memory' ? 'memory' : e.type === 'act' ? 'act' : e.type === 'run.finished' && e.status === 'done' ? 'report' : e.type === 'guard.blocked' ? 'blocked' : null;
    if (!kind) continue;
    const key = eventKey(e);
    if (!shown.has(key)) shown.set(key, now);
    if (now - shown.get(key) < WINDOWS[kind]) active.push({ ...e, kind, age: now - shown.get(key) });
  }
  return active;
}

function agentNode(agent, parent, effects) {
  const account = accountFor(agent.account);
  const status = statusOf(agent);
  const model = account.model || 'Default';
  const mine = effects.filter(e => e.agent === agent.id);
  const cls = [status === 'working' ? 'working' : '', status === 'waiting' ? 'asking' : '', mine.some(e => e.kind === 'blocked') ? 'blocked' : '', mine.some(e => e.kind === 'memory') ? 'glow' : '']
    .filter(Boolean).join(' ');
  return {
    id: agent.id, parent, w: 200, h: 64, cls: `agent ${cls}`, live: status === 'working', edgeCls: status === 'waiting' ? 'ask' : status === 'done' ? 'done' : '',
    cluster: agent.team || undefined,
    attrs: `style="--account:${colorHex(account.color)}" data-node="agent" data-id="${agent.id}"`,
    body: box(200, 64) + `<g transform="translate(10 11)">${mascotSVG(account, 42)}</g>`
      + text(62, 26, clip(agent.title, 20), 'n-name') + dot(66, 42, status) + text(75, 46, `${clip(account.name, 11)} · ${clip(model, 12)}`, 'n-sub')
      + (agent.role === 'leader' ? '<g class="tag" transform="translate(138 -9)"><rect width="54" height="18" rx="9"/><text x="27" y="12.5">Leader</text></g>' : ''),
  };
}

function idleLeaderNode() {
  const account = accountFor(leader()?.id);
  return agentNode({ id: 'leader', title: 'Leader', account: account.id, role: 'leader' }, 'you', []);
}

function liveAccountNode(id, sessions) {
  const account = accountFor(id);
  const busy = sessions.filter(s => s.working).length;
  const status = busy ? 'working' : 'idle';
  const sub = (busy ? 'Working' : `Idle ${fmt.since(Math.max(...sessions.map(s => s.lastActivity)))}`) + (sessions.length > 1 ? ` · ${sessions.length} sessions` : '');
  return {
    id: `a:${id}`, parent: 'you', w: 184, h: 60, cls: `agent ${status}`, live: Boolean(busy),
    attrs: `style="--account:${colorHex(account.color)}" data-node="account" data-id="${esc(id)}"`,
    body: box(184, 60) + `<g transform="translate(10 10)">${mascotSVG(account, 40)}</g>` + text(60, 25, clip(account.name, 16), 'n-name') + dot(64, 40, status) + text(73, 44, sub, 'n-sub'),
  };
}

const actLine = a => (a.verb ? `${a.verb} ${a.target}` : `“${a.target}”`);

// A new tool call floats a chip, tinted by its kind, up off the node and makes the node glow.
function actChip(act, w) {
  const label = clip(actLine(act), 30);
  const width = Math.round(label.length * 6.2 + 34);
  return `<g class="actchip" style="--cx:${w / 2}px"><rect x="${-width / 2}" y="-11" width="${width}" height="22" rx="11"/>`
    + `<g transform="translate(${-width / 2 + 9} -6)">${smallIcon(act.icon)}</g><text x="${-width / 2 + 26}" y="4">${esc(label)}</text></g>`;
}

// The parts sessions and subagents share: kind tint, glow class, age of the effect and the chip.
function actState(s, effects, w) {
  const [now] = actsOf(s);
  const ping = now && effects.find(e => e.kind === 'act' && e.session === s.id);
  return {
    now,
    cls: `${now ? `k-${now.kind}` : ''} ${ping ? 'pinged' : ''}`,
    style: `--account:${colorHex(accountFor(s.agent).color)};--age:-${ping ? ping.age : 0}ms`,
    chip: ping ? actChip(now, w) : '',
  };
}

function sessionNode(s, effects) {
  const { now, cls, style, chip } = actState(s, effects, 200);
  return {
    id: `s:${s.id}`, parent: `a:${s.agent}`, w: 200, h: 54, cls: `session ${s.working ? 'working' : 'idle'} ${cls}`, live: s.working,
    attrs: `style="${style}" data-node="session" data-id="${esc(s.id)}" data-tip="${tip(s.cwd || 'Unknown folder')}"`,
    body: box(200, 54) + '<rect class="s-bar" x="0" y="12" width="3" height="30" rx="1.5"/>' + text(14, 23, clip(s.title || s.label, 27), 'n-name')
      + (now ? `<g class="s-icon" transform="translate(14 32)">${smallIcon(now.icon)}</g>` + text(31, 42, clip(actLine(now), 26), 'n-sub') : text(14, 42, folderName(s.cwd), 'n-sub'))
      + chip,
  };
}

function subagentNode(s, parent, effects) {
  const { now, cls, style, chip } = actState(s, effects, 168);
  return {
    id: `s:${s.id}`, parent: `s:${parent}`, w: 168, h: 32, cls: `subagent working ${cls}`, live: true,
    attrs: `style="${style}" data-node="session" data-id="${esc(s.id)}" data-tip="${tip(now ? actLine(now) : s.label)}"`,
    body: '<rect class="box" width="168" height="32" rx="16"/>' + dot(16, 16, 'working') + text(28, 20, clip(s.label, 16), 'n-sub')
      + (now ? `<g class="s-icon" transform="translate(144 10)">${smallIcon(now.icon)}</g>` : '') + chip,
  };
}

// Each account with sessions, its sessions under it, and their working subagents; memory use pulses to the session or account.
function liveNodes(nodes, links, effects) {
  const sessions = liveSessions();
  for (const id of new Set(sessions.map(s => s.agent))) {
    const mine = sessions.filter(s => s.agent === id);
    nodes.push(liveAccountNode(id, mine));
    for (const s of mine) {
      nodes.push(sessionNode(s, effects));
      for (const sub of subagentsOf(s.id)) nodes.push(subagentNode(sub, s.id, effects));
      const [now] = actsOf(s);
      if (s.working && now?.kind === 'memory') links.push(memoryLink(`s:${s.id}`, now.writes));
    }
  }
  for (const e of effects.filter(x => x.kind === 'memory')) {
    links.push(memoryLink(`a:${e.from}`, !MEMORY_READS.includes(e.action)));
  }
}

function memoryNode(effects) {
  const last = data.events.filter(e => e.type === 'memory').pop();
  const chips = effects.filter(e => e.kind === 'memory');
  const chip = lastOf(chips);
  const label = chip ? (chip.title && chip.action !== 'context' ? `${chip.action} · ${clip(chip.title, 24)}` : chip.action) : '';
  return {
    id: 'memory', parent: null, beside: 'you', w: 176, h: 54, cls: `memory ${data.connected ? '' : 'off'} ${chips.length ? 'glow' : ''}`,
    attrs: 'data-node="memory"',
    body: `${box(176, 54)}<path class="mem-icon" d="M14 16h9a4 4 0 0 1 4 4v18a3 3 0 0 0-3-3h-10z M40 16h-9a4 4 0 0 0-4 4v18a3 3 0 0 1 3-3h10z"/>`
      + text(52, 25, 'Memory', 'n-name') + text(52, 41, last ? `${MEMORY_READS.includes(last.action) ? 'Recall' : 'Used'} ${fmt.ago(last.t)}` : 'Empty', 'n-sub')
      + (chip ? `<g class="memchip" style="animation-delay:-${chip.age}ms" transform="translate(88 70)"><rect x="-${label.length * 3.3 + 10}" y="-10" width="${label.length * 6.6 + 20}" height="20" rx="10"/><text text-anchor="middle" y="4">${esc(label)}</text></g>` : ''),
  };
}

function youLine() {
  const busy = view ? 0 : new Set(liveSessions().filter(s => s.working).map(s => s.agent)).size;
  return busy ? `${busy} working` : fmt.count(state.config.accounts.length, 'account');
}

function chart() {
  const effects = activeEffects();
  const you = { id: 'you', parent: null, w: 156, h: 54, cls: 'you',
    body: `${box(156, 54)}<rect class="you-mark" x="11" y="11" width="32" height="32" rx="9"/><g transform="translate(15 18)">${brandSVG(24)}</g>`
      + text(54, 25, clip(state.config.userName || 'You', 13), 'n-name') + text(54, 41, youLine(), 'n-sub') };
  const nodes = [you, memoryNode(effects)];
  const links = [];
  if (view) {
    for (const a of view.agents) nodes.push(agentNode(a, a.parent || 'you', effects));
    for (const e of effects) {
      const agent = e.agent && agentOf(e.agent) ? e.agent : 'you';
      if (e.kind === 'memory') links.push(memoryLink(agent, !MEMORY_READS.includes(e.action)));
      if (e.kind === 'report') links.push({ from: e.agent, to: agentOf(e.agent)?.parent || 'you', kind: 'report', once: true });
    }
    for (const q of view.questions.filter(x => x.answer === undefined)) links.push({ from: q.from, to: q.to === 'user' ? 'you' : q.to, kind: 'ask' });
  } else if (liveSessions().length) {
    liveNodes(nodes, links, effects);
  } else {
    nodes.push(idleLeaderNode());
  }
  const clusters = view ? view.teams.map((t, index) => ({ id: t.id, name: t.name, index, attrs: `data-node="team" data-id="${t.id}"` })) : [];
  if (effects.length && !effectTimer) effectTimer = setTimeout(() => { effectTimer = null; drawMap(); }, 2500);
  return { nodes, links, clusters };
}

// FLIP in the SVG: nodes that moved glide from their old place.
function drawMap() {
  const el = $('#flow', root);
  if (!el || !el.clientWidth) return;
  const before = new Map([...el.querySelectorAll('[data-fid]')].map(g => [g.dataset.fid, [Number(g.dataset.x), Number(g.dataset.y)]]));
  el.innerHTML = flowchart({ ...chart(), minWidth: el.clientWidth, minHeight: el.clientHeight, style: phase() });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const g of el.querySelectorAll('[data-fid]')) {
    const old = before.get(g.dataset.fid);
    const now = [Number(g.dataset.x), Number(g.dataset.y)];
    if (old && (old[0] !== now[0] || old[1] !== now[1])) {
      g.firstElementChild.animate([{ transform: `translate(${old[0] - now[0]}px, ${old[1] - now[1]}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
}

function benchHtml() {
  const runs = data.runs || {};
  const items = data.agents.map(a => {
    const account = accountFor(a.id);
    const mini = `<span class="mini" style="--account:${colorHex(account.color)}">${mascotSVG(account, 20)}</span>`;
    if (!a.eligible) {
      const why = a.launchOnly ? ['Crew', 'Launch only'] : ['Not in crew', INELIGIBLE[a.tier] || INELIGIBLE.unknown];
      return `<span class="bnode lock" data-bench="${a.id}" data-tip="${tipRows(a.name, [why])}">${mini}${esc(a.name)}<i class="lock-icon">${ICONS.lock}</i></span>`;
    }
    const used = Math.min(runs[a.id] || 0, a.maxRuns || 1);
    const dots = Array.from({ length: a.maxRuns || 1 }, (_, i) => `<i class="${i < used ? 'f' : ''}"></i>`).join('');
    return `<span class="bnode" data-bench="${a.id}" data-tip="${tipRows(a.name, [['Runs', `${used} of ${a.maxRuns || 1}`]])}">${mini}${esc(a.name)}<span class="capd">${dots}</span></span>`;
  });
  return `<span class="cap">Bench</span>${items.join('')}`;
}

function sentence(e) {
  const who = `<b>${esc(nameOf(e.agent))}</b>`;
  switch (e.type) {
    case 'task.started': return `${who} started the task`;
    case 'team.created': return `${who} created the <b>${esc(teamOf(e.team)?.name || 'new')}</b> team`;
    case 'run.started': return e.by ? `<b>${esc(nameOf(e.by))}</b> delegated to <b>${esc(nameOf(e.agent))}</b>` : `${who} started working`;
    case 'run.finished': return `${who} ${e.status === 'done' ? 'finished' : 'failed'}`;
    case 'question.asked': return `${who} asked <b>${esc(nameOf(e.to))}</b>`;
    case 'question.passed': return `${who} passed a question up to <b>${esc(nameOf(e.to))}</b>`;
    case 'question.answered': return `${who} answered`;
    case 'guard.blocked': return `${who} was blocked: ${esc(e.reason)}`;
    case 'memory': return `${who} ${MEMORY_VERBS[e.action] || e.action}${e.action === 'context' ? '' : ` “${esc(clip(e.title || '', 40))}”`}`;
    case 'task.finished': return `Task ${esc(e.status)}`;
    case 'undo': return 'Folder restored';
    default: return esc(e.type);
  }
}

function eventRow(e) {
  const agent = agentOf(e.agent);
  const icon = e.type === 'memory' ? `<span class="memico">${ICONS.book}</span>`
    : agent ? `<span class="mini" style="--account:${colorHex(accountFor(agent.account).color)}">${mascotSVG(accountFor(agent.account), 18)}</span>` : '<span class="mini"></span>';
  const key = eventKey(e);
  const result = e.type === 'run.finished' ? view.runs.find(r => r.id === e.run)?.result : '';
  const open = expanded.has(key);
  const body = result ? `<div class="res ${open ? 'open' : ''}" style="--lines:${RESULT_LINES}">${esc(result)}</div>${result.split('\n').length > RESULT_LINES || result.length > 700 ? `<button class="link-btn" data-expand="${esc(key)}">${open ? 'Show less' : 'Show all'}</button>` : ''}` : '';
  return `<div class="ev ${e.type === 'guard.blocked' ? 'blocked' : ''} ${e.type === 'memory' ? 'mem' : ''}" data-flip="${esc(key)}">${icon}<div class="x">${sentence(e)}${body}</div><span class="when">${fmt.ago(e.t)}</span></div>`;
}

function chainOf(question) {
  const ids = [question.from];
  for (let q = question; q.passes;) {
    q = view.questions.find(x => x.id === q.passes);
    if (!q) break;
    ids.push(q.from);
  }
  return ids.reverse();
}

function approvalCard(question) {
  const agent = agentOf(question.from);
  const account = accountFor(agent?.account);
  const chain = chainOf(question);
  const via = chain.slice(1).map(nameOf);
  const from = chain.length > 1 ? `from ${nameOf(chain[0])}${via.length ? ` via ${via.join(', ')}` : ''}` : '';
  const choices = (question.choices || []).map((c, i) => {
    const handoff = question.handoffPrompt && /chatgpt/i.test(c);
    return button(handoff ? 'Open ChatGPT' : c, { kind: `sm ${i === 0 ? 'primary' : ''}`, attrs: `data-answer="${esc(c)}" data-qid="${question.id}"` });
  }).join('');
  return `<div class="approval" data-flip="approval"><div class="who"><span class="mini" style="--account:${colorHex(account.color)}">${mascotSVG(account, 18)}</span>${esc(nameOf(question.from))} asks</div>`
    + `${from ? `<div class="chain">${esc(from)}</div>` : ''}<div class="q">${esc(question.text)}</div><div class="acts">${choices}</div>`
    + `<div class="reply"><input class="input" id="replyText" placeholder="Reply" aria-label="Reply"><button class="btn sm" data-reply data-qid="${question.id}">Send</button></div></div>`;
}

function finishedCard() {
  const { task, changed } = view;
  const files = changed || [];
  const colors = { M: 'var(--s3)', A: 'var(--accent)', D: 'var(--danger)' };
  const confirm = undoAsk
    ? `<div class="undo-ask"><b>Restore folder?</b>${button('Yes', { kind: 'sm danger', attrs: 'data-undo-yes' })}${button('Cancel', { kind: 'sm', attrs: 'data-undo-no' })}</div>`
    : `<div class="acts">${button('Continue in terminal', { kind: 'sm', attrs: 'data-terminal' })}${files.length ? button('Undo all', { kind: 'sm danger', attrs: 'data-undo' }) : ''}</div>`;
  const title = task.status === 'done' ? `Done in ${fmt.duration(task.finished - task.created).text}` : task.status === 'stopped' ? 'Stopped' : 'Failed';
  const undone = view.events.some(e => e.type === 'undo') && !files.length;
  return `<div class="finished ${task.status}" data-flip="finished"><div class="done-title">${undone ? 'Restored' : title}</div>`
    + `<div class="summary ${expanded.has('summary') ? 'open' : ''}">${esc(task.summary || '')}</div>`
    + `${(task.summary || '').length > 260 ? `<button class="link-btn" data-expand="summary">${expanded.has('summary') ? 'Show less' : 'Show all'}</button>` : ''}`
    + `<button class="link-btn files-toggle" data-expand="files">${esc(fmt.count(files.length, 'changed file'))} ${expanded.has('files') ? '▴' : '▾'}</button>`
    + `${expanded.has('files') ? `<div class="files">${files.map(f => `<button class="file-row" data-file="${esc(f.file)}"><span style="color:${colors[f.status] || 'var(--text-2)'}">${esc(f.status)}</span>${esc(f.file)}</button>`).join('')}</div>` : ''}${confirm}</div>`;
}

function actRow(a, sessionId) {
  const words = a.verb ? `<span class="act-verb">${esc(a.verb)}</span><span class="act-target">${esc(a.target)}</span>` : `<span class="act-target">“${esc(a.target)}”</span>`;
  return `<div class="act ${a.kind}" data-flip="${esc(`act:${sessionId}:${a.t}:${a.verb}:${a.target}`)}" data-tip="${tip(a.target || a.verb)}"><span class="act-ico">${a.icon}</span>${words}<span class="when">${fmt.since(a.t)}</span></div>`;
}

function liveCard(s) {
  const account = accountFor(s.agent);
  const [now, ...trail] = actsOf(s);
  const subagents = subagentsOf(s.id);
  return `<div class="live-card ${s.working ? 'working' : ''}" style="--account:${colorHex(account.color)}" data-session="${esc(s.id)}" data-flip="live-${esc(s.id)}">`
    + `<div class="lc-head"><span class="mini">${mascotSVG(account, 22)}</span><div class="lc-who"><b>${esc(account.name)}</b><span>${esc(s.title || s.label)}</span></div>`
    + `<span class="lc-state">${s.working ? '<i></i>Working' : esc(`Idle ${fmt.since(s.lastActivity)}`)}</span></div>`
    + `<div class="lc-meta"><button class="lc-chip" data-open-folder="${esc(s.cwd || '')}" data-tip="${tip(s.cwd || 'Unknown folder')}">${ICONS.folder}<span>${esc(folderName(s.cwd))}</span></button>`
    + `${s.model ? `<span class="lc-chip">${ICONS.model}<span>${esc(s.model)}</span></span>` : ''}</div>`
    + `${now ? `<div class="lc-now">${actRow(now, s.id)}</div>` : ''}`
    + `${trail.length ? `<div class="lc-trail">${trail.slice(0, TRAIL).map(a => actRow(a, s.id)).join('')}</div>` : ''}`
    + `${subagents.length ? `<div class="lc-subs">${subagents.map(x => `<span class="lc-sub"><i></i>${esc(x.label)}</span>`).join('')}</div>` : ''}</div>`;
}

function timelineHtml() {
  const chevron = `<button class="icon-btn tl-toggle" data-collapse aria-label="${collapsed ? 'Show timeline' : 'Hide timeline'}">${collapsed ? ICONS.chevronLeft : ICONS.chevronRight}</button>`;
  if (collapsed) return chevron;
  if (!view) {
    const sessions = liveSessions();
    const busy = sessions.filter(s => s.working).length;
    const rows = tasks.map(t => `<button class="ev recent" data-task="${t.id}" data-flip="task-${t.id}"><span class="dot ${t.status}"></span><div class="x"><b>${esc(t.title)}</b></div><span class="when">${fmt.ago(t.created)}</span></button>`).join('');
    return `<div class="th"><span class="t">Live</span>${busy ? `<span class="live-count"><i></i>${busy} working</span>` : ''}${chevron}</div>`
      + `<div class="tb">${sessions.map(liveCard).join('') || '<div class="feed-empty muted">Nobody is working right now</div>'}`
      + `${rows ? `<div class="tb-cap cap">Recent tasks</div>${rows}` : ''}</div>`;
  }
  const { task } = view;
  const pending = view.questions.filter(q => q.to === 'user' && q.answer === undefined);
  const finished = ['done', 'failed', 'stopped'].includes(task.status);
  const events = [...view.events].reverse().map(eventRow).join('');
  return `<div class="th"><span class="t">${esc(task.title)}</span><span class="dot ${task.status}"></span>${finished ? `<button class="icon-btn" data-close-task aria-label="Close task">${ICONS.close}</button>` : ''}${chevron}</div>`
    + `${pending[0] ? approvalCard(pending[0]) : ''}${finished ? finishedCard() : ''}<div class="tb">${events}</div>`;
}

function head() {
  const lead = leader();
  const account = accountFor(lead?.id);
  const menu = menuOpen ? `<div class="menu" role="menu">${data.agents.map(a => `<button role="menuitem" data-set-leader="${a.id}" ${a.eligible ? '' : `disabled data-tip="${tip(a.launchOnly ? 'Launch only' : INELIGIBLE[a.tier] || INELIGIBLE.unknown)}"`}>`
    + `<span class="mini" style="--account:${colorHex(accountFor(a.id).color)}">${mascotSVG(accountFor(a.id), 18)}</span>${esc(a.name)}<span class="hint">${a.id === data.leader ? ICONS.check : a.eligible ? '' : ICONS.lock}</span></button>`).join('')}</div>` : '';
  const chip = lead ? `<span class="plan-wrap"><button class="btn leader-chip" data-leader-menu><span class="mini" style="--account:${colorHex(account.color)}">${mascotSVG(account, 18)}</span>${esc(account.name)}${ICONS.chevron}</button>${menu}</span>` : '';
  const connect = data.connected ? button('Disconnect', { attrs: 'data-connect="off"' })
    : `<span class="connect-row">${button('Connect agents', { kind: 'primary', attrs: 'data-connect="on"' })}<span class="info-tip" data-tip="${tip('Gives Claude and Codex shared memory, messages, and the KISS and repo-structure skills.')}" aria-label="What connecting does">${ICONS.info}</span></span>`;
  return `<div class="page-head"><h1>Ultron</h1>${segmented('tab', options([['crew', 'Crew'], ['memory', 'Memory']]), tab)}<div class="head-actions">${connect}${chip}</div></div>`;
}

function composer() {
  if (!data.agents.some(a => a.eligible)) {
    return `<div class="card empty-card">Ultron needs a paid account to lead${button('Go to accounts', { attrs: 'data-goto-accounts' })}</div>`;
  }
  const blocker = runBlocker();
  const live = running();
  const action = live ? button('Stop', { attrs: 'data-stop' })
    : `<span ${blocker ? `data-tip="${tip(blocker)}"` : ''}>${button('Run', { kind: 'primary', attrs: `data-run ${blocker ? 'disabled' : ''}` })}</span>`;
  const locked = Boolean(view);
  return `<div class="card composer"><textarea id="prompt" rows="1" placeholder="Give Ultron a task" aria-label="Task" ${locked ? 'readonly' : ''}>${esc(locked ? view.task.prompt : draft)}</textarea>`
    + `<button class="folder-chip" data-folder ${live ? 'disabled' : ''} data-tip="${tip(folder() || 'Choose a folder')}">${ICONS.folder}<span>${esc(folder() ? folder().split(/[\\/]/).pop() : 'Choose folder')}</span></button>${action}</div>`;
}

const keyOf = () => [tab, viewingId, running(), data.leader, Boolean(leader()?.eligible), data.agents.some(a => a.eligible), data.connected, folder(), menuOpen, Boolean(view)].join('|');

function drawParts() {
  drawMap();
  $('#bench', root).innerHTML = benchHtml();
  const tl = $('#timeline', root);
  flip(tl, () => { tl.innerHTML = timelineHtml(); });
  $('#grid', root).classList.toggle('collapsed', collapsed);
}

export function render() {
  if (!data) {
    root.innerHTML = `<div class="page-head"><h1>Ultron</h1></div><div class="card flow-card">${skeleton('100%', '540px')}</div>`;
    return;
  }
  if (tab === 'memory') {
    root.innerHTML = `${head()}<div id="mem"></div>`;
    memoryView.load($('#mem', root), data.memoryDir);
    return;
  }
  root.innerHTML = `${head()}${composer()}<div class="ugrid ${collapsed ? 'collapsed' : ''}" id="grid"><div class="card canvas"><div class="flow" id="flow"></div><div class="bench" id="bench"></div></div><div class="card tl" id="timeline"></div></div>`;
  shellKey = keyOf();
  drawParts();
}

export async function load() {
  [data, tasks] = await Promise.all([api.crewMap(), api.tasks.list()]);
  if (!viewingId) viewingId = tasks.find(t => ['running', 'waiting'].includes(t.status))?.id || null;
  if (!primed) [...data.events, ...liveActEvents()].forEach(e => shown.set(eventKey(e), -Infinity));
  primed = true;
  const first = view?.task.id !== viewingId;
  view = viewingId ? await api.tasks.get(viewingId) : null;
  if (first && view) view.events.forEach(e => shown.set(eventKey(e), -Infinity));
  if (tab === 'crew' && $('#prompt', root) && keyOf() === shellKey) drawParts();
  else render();
}

async function guarded(action) {
  try {
    await action();
  } catch (err) {
    toastError(err, data.leader);
  }
  await load();
}

function agentDrawer(id) {
  const agent = agentOf(id);
  const account = accountFor(agent.account);
  const runs = view.runs.filter(r => r.agent === id);
  const last = lastOf(runs);
  const team = teamOf(agent.team);
  const rows = [['Kind', state.info.roles.find(r => r.id === agent.kind)?.label || agent.kind], ['Team', team?.name || 'None'], ['Account', `${account.name}${state.overview[account.id]?.plan ? ` · ${state.overview[account.id].plan}` : ''}`],
    ['Model', account.model || 'Default'], ['Status', STATUS[statusOf(agent)]]];
  openDrawer(`<div class="dsec">${drawerRows(rows)}</div>`
    + `${last?.result ? `<div class="dsec"><span class="cap">Last report</span><div class="res open">${esc(last.result)}</div></div>` : ''}`
    + `<div class="dsec acts">${last ? button('Open log', { kind: 'sm', attrs: `data-open-log="${last.id}"` }) : ''}${button('Account settings', { kind: 'sm', attrs: `data-account="${account.id}"` })}</div>`,
  { title: agent.title, lead: `<span class="mini" style="--account:${colorHex(account.color)}">${mascotSVG(account, 24)}</span>` });
}

function teamDrawer(id) {
  const team = teamOf(id);
  const line = a => `<div class="drow"><span>${esc(a.title)}</span><span class="muted">${esc(accountFor(a.account).name)} · ${STATUS[statusOf(a)]}</span></div>`;
  openDrawer(`<div class="dsec"><span class="cap">Purpose</span><div>${esc(team.purpose)}</div></div><div class="dsec"><span class="cap">Lead</span>${line(agentOf(team.lead))}</div>`
    + `<div class="dsec"><span class="cap">Members</span>${team.members.map(m => line(agentOf(m))).join('') || '<div class="muted">None</div>'}</div>`, { title: team.name });
}

function sessionDrawer(id) {
  const s = data.sessions.find(x => x.id === id);
  if (!s) return;
  const account = accountFor(s.agent);
  const rows = [['Account', account.name], ['Model', s.model || 'Unknown'], ['Status', s.working ? 'Working' : 'Idle'], ['Last active', fmt.ago(s.lastActivity)]];
  const subagents = data.sessions.filter(x => x.parent === id);
  openDrawer(`<div class="dsec">${drawerRows(rows)}</div>`
    + `<div class="dsec"><span class="cap">Folder</span><div class="mono">${esc(s.cwd || 'Unknown')}</div></div>`
    + `<div class="dsec"><span class="cap">Recent activity</span>${actsOf(s).map(a => actRow(a, s.id)).join('') || '<div class="muted">Nothing yet</div>'}</div>`
    + `${subagents.length ? `<div class="dsec"><span class="cap">Subagents</span>${subagents.map(x => `<div class="drow"><span>${esc(x.label)}</span><span class="muted">${x.working ? 'Working' : fmt.ago(x.lastActivity)}</span></div>`).join('')}</div>` : ''}`
    + `<div class="dsec acts">${s.cwd ? button('Open folder', { kind: 'sm', attrs: `data-open-folder="${esc(s.cwd)}"` }) : ''}${button('Account settings', { kind: 'sm', attrs: `data-account="${account.id}"` })}</div>`,
  { title: s.title || s.label, lead: `<span class="mini" style="--account:${colorHex(account.color)}">${mascotSVG(account, 24)}</span>` });
}

function memoryDrawer() {
  const events = data.events.filter(e => e.type === 'memory').slice(-8).reverse();
  const who = id => accountById(id)?.name || 'Ultron';
  openDrawer(`<div class="dsec"><span class="cap">Vault</span><div class="mono">${esc(data.memoryDir)}</div></div><div class="dsec"><span class="cap">Recent use</span>`
    + `${events.map(e => `<div class="drow"><span>${esc(who(e.from))} ${esc(MEMORY_VERBS[e.action] || e.action)} ${e.action === 'context' ? '' : `“${esc(clip(e.title || '', 30))}”`}</span><span class="muted">${fmt.ago(e.t)}</span></div>`).join('') || '<div class="muted">Nothing yet</div>'}</div>`
    + `<div class="dsec">${button('Review', { kind: 'sm', attrs: 'data-review' })}</div>`, { title: 'Memory', lead: `<span class="memico lg">${ICONS.book}</span>` });
}

function benchDrawer(id) {
  const agent = data.agents.find(a => a.id === id);
  const account = accountFor(id);
  const model = [agent.model || 'Default', agent.effort].filter(Boolean).join(' · ');
  const details = agent.launchOnly ? '<div class="dsec"><div class="drow"><span class="muted">Crew</span><span>Launch only</span></div></div>'
    : `<div class="dsec"><div class="drow"><span class="muted">Plan</span><span>${esc(state.overview[id]?.plan || agent.tier || 'Unknown')}</span></div>`
    + `<div class="drow"><span class="muted">Model</span><span>${esc(model)}</span></div><div class="drow"><span class="muted">Runs</span><span>${data.runs?.[id] || 0} of ${agent.maxRuns || 1}</span></div>`
    + `<div class="drow"><span class="muted">Roles</span><span>${esc(agent.roles.map(r => state.info.roles.find(x => x.id === r)?.label || r).join(', '))}</span></div></div>`;
  openDrawer(`${details}<div class="dsec acts">${agent.eligible && id !== data.leader ? button('Make leader', { kind: 'sm primary', attrs: `data-make-leader="${id}"` }) : ''}${button('Account settings', { kind: 'sm', attrs: `data-account="${id}"` })}</div>`,
  { title: account.name, lead: `<span class="mini" style="--account:${colorHex(account.color)}">${mascotSVG(account, 24)}</span>` });
}

const setLeader = id => guarded(async () => {
  await saveConfig({ crew: { ...state.config.crew, leader: id } });
  menuOpen = false;
});

export function mount(el) {
  root = el;
  const drawer = $('#drawer');
  memoryView.mount(root);
  onSegment(root, 'tab', value => { tab = value; menuOpen = false; render(); });
  on(root, 'input', '#prompt', input => {
    draft = input.value;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 6 * 20 + 12)}px`;
  });
  root.addEventListener('keydown', e => {
    if (e.target.id === 'prompt' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('[data-run]', root)?.click();
    }
    if (e.target.id === 'replyText' && e.key === 'Enter') $('[data-reply]', root).click();
  });
  on(root, 'click', '[data-goto-accounts]', () => $('.nav-item[data-page="accounts"]').click());
  on(root, 'click', '[data-run]', () => {
    if (!draft.trim()) return;
    guarded(async () => {
      viewingId = await api.tasks.start({ prompt: draft.trim(), folder: folder() });
      view = null;
      draft = '';
    });
  });
  on(root, 'click', '[data-stop]', () => guarded(() => api.tasks.stop(viewingId)));
  on(root, 'click', '[data-folder]', async () => {
    const dir = await api.pickFolder();
    if (dir) guarded(() => saveConfig({ ultron: { ...state.config.ultron, lastFolder: dir } }));
  });
  on(root, 'click', '[data-connect]', btn => guarded(async () => {
    const connect = btn.dataset.connect === 'on';
    state.config = await api.connectAgents(connect);
    toast(connect ? 'Agents connected' : 'Agents disconnected');
  }));
  on(root, 'click', '[data-leader-menu]', () => { menuOpen = !menuOpen; render(); });
  on(root, 'click', '[data-set-leader]', btn => setLeader(btn.dataset.setLeader));
  on(root, 'click', '[data-task]', btn => { viewingId = btn.dataset.task; undoAsk = false; load(); });
  on(root, 'click', '[data-close-task]', () => { viewingId = null; undoAsk = false; view = null; load(); });
  on(root, 'click', '[data-collapse]', () => {
    collapsed = !collapsed;
    try { localStorage.setItem(TIMELINE_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
    drawParts();
  });
  on(root, 'click', '[data-expand]', btn => {
    if (expanded.has(btn.dataset.expand)) expanded.delete(btn.dataset.expand); else expanded.add(btn.dataset.expand);
    drawParts();
  });
  on(root, 'click', '[data-answer]', btn => guarded(() => api.tasks.answer(viewingId, btn.dataset.qid, btn.dataset.answer)));
  on(root, 'click', '[data-reply]', btn => {
    const reply = $('#replyText', root).value.trim();
    if (reply) guarded(() => api.tasks.answer(viewingId, btn.dataset.qid, reply));
  });
  on(root, 'click', '[data-undo]', () => { undoAsk = true; drawParts(); });
  on(root, 'click', '[data-undo-no]', () => { undoAsk = false; drawParts(); });
  on(root, 'click', '[data-undo-yes]', () => guarded(async () => {
    undoAsk = false;
    await api.tasks.undo(viewingId);
    toast('Folder restored');
  }));
  on(root, 'click', '[data-terminal]', () => guarded(() => api.tasks.terminal(viewingId)));
  on(root, 'click', '[data-file]', btn => api.openPath(`${view.task.folder}\\${btn.dataset.file.replaceAll('/', '\\')}`));
  on(root, 'click', '[data-node="agent"]', g => { if (view && agentOf(g.dataset.id)) agentDrawer(g.dataset.id); });
  on(root, 'click', '[data-node="team"]', g => teamDrawer(g.dataset.id));
  on(root, 'click', '[data-node="memory"]', memoryDrawer);
  on(root, 'click', '[data-node="session"]', g => sessionDrawer(g.dataset.id));
  on(root, 'click', '[data-node="account"]', g => benchDrawer(g.dataset.id));
  on(root, 'click', '[data-session]', (card, e) => { if (!e.target.closest('[data-open-folder]')) sessionDrawer(card.dataset.session); });
  on(root, 'click', '[data-open-folder]', btn => { if (btn.dataset.openFolder) api.openPath(btn.dataset.openFolder); });
  on(root, 'click', '[data-bench]', btn => benchDrawer(btn.dataset.bench));
  root.addEventListener('contextmenu', e => {
    const node = e.target.closest('[data-bench]');
    const agent = node && data.agents.find(a => a.id === node.dataset.bench);
    if (agent?.eligible) { e.preventDefault(); setLeader(agent.id); }
  });
  on(drawer, 'click', '[data-open-log]', btn => api.openPath(`${view.dir}\\runs\\${btn.dataset.openLog}.log`));
  on(drawer, 'click', '[data-account]', btn => openEditor(btn.dataset.account));
  on(drawer, 'click', '[data-open-folder]', btn => api.openPath(btn.dataset.openFolder));
  on(drawer, 'click', '[data-make-leader]', btn => setLeader(btn.dataset.makeLeader));
  on(drawer, 'click', '[data-review]', () => { tab = 'memory'; $('#drawer [data-drawer-close]').click(); render(); });
  new ResizeObserver(() => requestAnimationFrame(drawMap)).observe(root);
}
