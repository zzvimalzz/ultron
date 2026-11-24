import { $, esc, cssVar } from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import { heatGrid, stackedBars } from '../lib/charts.js';
import { ICONS, onPage, onSegment, options, pager, paginate, segmented, tipRows, toast } from '../lib/ui.js';
import { api, state } from '../lib/state.js';

const RANGES = options([['24h', '24H'], ['7d', '7D'], ['30d', '30D'], ['90d', '90D'], ['all', 'All']]);
const RHYTHMS = options([['week', 'Week'], ['month', 'Month'], ['year', 'Year']]);
const METRICS = options([['total', 'Total'], ['output', 'Output']]);
const PROJECT_ROWS = 6;
const DAY = 86400000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OTHER = { id: 'other', name: 'VS Code & CLI' };

let root;
let loading = false;

// Account tabs come from config and all-time data, so they never change with the range.
function accountOptions() {
  const has = state.usageData ? state.usageData.lastActivity : {};
  const list = state.config.accounts.map(a => ({ id: a.id, name: a.name, color: cssVar(`--s${a.color}`) }));
  if (has.other) list.push({ ...OTHER, color: cssVar('--text-3') });
  return list;
}

const BUCKET_LABELS = {
  hour: t => [fmt.time(t, { hour: '2-digit', minute: '2-digit' }), fmt.date(t, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + fmt.time(t, { hour: '2-digit', minute: '2-digit' })],
  day: t => [fmt.date(t, { day: 'numeric', month: 'short' }), fmt.date(t, { weekday: 'short', day: 'numeric', month: 'short' })],
  week: t => [fmt.date(t, { day: 'numeric', month: 'short' }), `Week of ${fmt.date(t, { day: 'numeric', month: 'short', year: 'numeric' })}`],
  month: t => [fmt.date(t, { month: 'short', year: '2-digit' }), fmt.date(t, { month: 'long', year: 'numeric' })],
};

const chartSeries = () => accountOptions()
  .filter(s => (state.usage.account === 'all' ? state.usageData.lastActivity[s.id] : s.id === state.usage.account));

function timeline(width) {
  const { timeline: tl } = state.usageData;
  const { metric } = state.usage;
  const series = chartSeries();
  const buckets = tl.buckets.map(b => {
    const [label, tipTitle] = BUCKET_LABELS[tl.unit](b.t);
    return { label, tipTitle, values: series.map(s => (b.byAccount[s.id] || {})[metric] || 0) };
  });
  return stackedBars({ width, buckets, series, format: fmt.tokens });
}

function rhythmGrid(width) {
  const { week, weekStart, days, daysStart } = state.usageData.rhythm;
  const levels = [0, 1, 2, 3, 4, 5].map(i => cssVar(`--seq-${i}`));
  const cell = (value, title, text) => ({ value, text, tip: tipRows(title, [['Responses', value.toLocaleString()]]) });
  const dayCell = i => {
    if (i < 0 || i >= days.length) return null;
    const t = daysStart + i * DAY;
    return cell(days[i], fmt.date(t, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), String(new Date(t).getDate()));
  };
  let cells, rowLabels, colLabels;
  if (state.usage.rhythm === 'week') {
    cells = week.map((hours, r) => hours.map((v, h) =>
      cell(v, `${fmt.date(weekStart + r * DAY, { weekday: 'short', day: 'numeric', month: 'short' })} · ${String(h).padStart(2, '0')}:00`)));
    rowLabels = week.map((_, r) => fmt.date(weekStart + r * DAY, { weekday: 'short', day: 'numeric' }));
    colLabels = Array.from({ length: 24 }, (_, h) => (h % 3 ? '' : String(h).padStart(2, '0')));
  } else if (state.usage.rhythm === 'month') {
    const weeks = 5;
    const first = Math.floor((days.length - 1) / 7) * 7 - (weeks - 1) * 7;
    cells = Array.from({ length: weeks }, (_, w) => WEEKDAYS.map((_, d) => dayCell(first + w * 7 + d)));
    rowLabels = cells.map((_, w) => fmt.date(daysStart + (first + w * 7) * DAY, { day: 'numeric', month: 'short' }));
    colLabels = WEEKDAYS;
  } else {
    const weeks = Math.ceil(days.length / 7);
    cells = WEEKDAYS.map((_, d) => Array.from({ length: weeks }, (_, w) => dayCell(w * 7 + d)));
    rowLabels = WEEKDAYS.map((d, i) => (i % 2 ? '' : d));
    colLabels = Array.from({ length: weeks }, (_, w) => {
      const t = daysStart + w * 7 * DAY;
      const prev = daysStart + (w - 1) * 7 * DAY;
      return w > 0 && new Date(t).getMonth() !== new Date(prev).getMonth() ? fmt.date(t, { month: 'short' }) : '';
    });
  }
  return heatGrid({ width, height: 210, cells, rowLabels, colLabels, levels });
}

function barList(items, valueText, colorFor) {
  if (!items.length) return '<div class="empty">Nothing in this range</div>';
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div class="bars">${items.map(i => `<div class="bar-row"><div class="top"><span class="n">${esc(i.name)}</span><span class="v">${valueText(i)}</span></div>`
    + `<div class="bar-track"><div class="bar-fill" style="width:${(i.value / max) * 100}%${colorFor ? `;background:${colorFor(i)}` : ''}"></div></div></div>`).join('')}</div>`;
}

function breakdown() {
  const data = state.usageData;
  if (state.usage.account === 'all') {
    const rows = accountOptions().map(a => {
      const used = data.perAccount[a.id] || {};
      return { ...a, value: used.total || 0, activeMs: used.activeMs || 0 };
    });
    return barList(rows, r => `${fmt.tokens(r.value)} · ${fmt.duration(r.activeMs).text}`, r => r.color);
  }
  const total = data.sources.reduce((a, s) => a + s.total, 0) || 1;
  return barList(data.sources.map(s => ({ name: s.name, value: s.total })), s => `${fmt.tokens(s.value)} · ${fmt.percent(s.value / total)}`);
}

function kpi(icon, label, value, foot) {
  return `<div class="card kpi"><div class="label">${icon}${label}</div><div class="value">${value}</div><div class="foot">${foot}</div></div>`;
}

function body() {
  const data = state.usageData;
  const u = state.usage;
  const t = data.totals;
  const d = fmt.duration(t.activeMs);
  const mix = [['Input', t.input, '--s1'], ['Cache write', t.cacheWrite, '--s3'], ['Cache read', t.cacheRead, '--s7'], ['Output', t.output, '--s2']];
  const mixTotal = t.total || 1;
  const share = v => { const p = (v / mixTotal) * 100; return p >= 10 ? `${p.toFixed(0)}%` : p >= 0.1 ? `${p.toFixed(1)}%` : p > 0 ? '<0.1%' : '0%'; };
  const projects = paginate(data.projects, u.projectPage, PROJECT_ROWS);
  const series = u.account === 'all' ? chartSeries() : [];

  return `
    <div class="kpis">
      ${kpi(ICONS.token, 'Tokens', fmt.tokens(t.total), `${fmt.tokens(t.output)} output`)}
      ${kpi(ICONS.model, 'Top model', data.topModel ? esc(data.topModel.model) : '—', data.topModel ? `${fmt.percent(data.topModel.share)} of responses` : '&nbsp;')}
      ${kpi(ICONS.clock, 'Active time', d.h ? `${d.h}<small>h</small> ${d.m}<small>m</small>` : `${d.m}<small>m</small>`, '&nbsp;')}
      ${kpi(ICONS.chat, 'Sessions', t.sessions.toLocaleString(), fmt.count(t.messages, 'response'))}
    </div>

    <div class="card">
      <div class="card-head"><h2>Token mix</h2></div>
      <div class="comp-bar">${mix.map(([k, v, c]) => `<span style="flex:${Math.max(v, mixTotal * 0.004)};background:var(${c})" data-tip="${tipRows(k, [['Tokens', fmt.tokens(v)], ['Share', share(v)]])}"></span>`).join('')}</div>
      <div class="comp-legend">${mix.map(([k, v, c]) => `<div class="item"><div class="k"><i style="background:var(${c})"></i>${k}</div><div class="v">${fmt.tokens(v)}<span>${share(v)}</span></div></div>`).join('')}</div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Tokens over time</h2>
        <div class="head-tools">
          <div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>
          ${segmented('metric', METRICS, u.metric)}
        </div>
      </div>
      <div class="chart" id="timeline"></div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>When you work</h2>
        <div class="head-tools">
          <div class="heat-scale">Less ${[0, 1, 2, 3, 4, 5].map(i => `<i style="background:var(--seq-${i})"></i>`).join('')} More</div>
          ${segmented('rhythm', RHYTHMS, u.rhythm)}
        </div>
      </div>
      <div class="chart" id="rhythm"></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Models</h2></div>
        <div class="scroll-area">${barList(data.models.map(m => ({ name: m.model, value: m[u.metric], messages: m.messages })), m => `${fmt.tokens(m.value)} · ${fmt.count(m.messages, 'response')}`)}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>${u.account === 'all' ? 'By account' : 'By source'}</h2></div>
        <div class="scroll-area">${breakdown()}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Projects</h2>${pager('projects', projects)}</div>
      <div class="table-area">
        ${projects.rows.length ? `<table class="list"><thead><tr><th>Project</th><th class="r">Sessions</th><th class="r">Tokens</th><th class="r">Last active</th></tr></thead><tbody>
          ${projects.rows.map(p => `<tr><td class="name" title="${esc(p.name)}">${esc(p.name)}</td><td class="r">${p.sessions}</td><td class="r">${fmt.tokens(p.total)}</td><td class="r muted">${fmt.ago(p.lastActive)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Nothing in this range</div>'}
      </div>
    </div>

    <p class="note">${ICONS.info}<span>Claude Code and Codex sessions on this PC. Chat conversations aren't stored locally. Updated ${fmt.time(data.generatedAt, { hour: 'numeric', minute: '2-digit' })}.</span></p>`;
}

function skeleton() {
  return `<div class="kpis">${'<div class="card kpi"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton" style="height:30px;width:70%;margin-top:14px"></div><div class="skeleton" style="height:12px;width:50%;margin-top:10px"></div></div>'.repeat(4)}</div>`
    + '<div class="card"><div class="skeleton" style="height:300px"></div></div>';
}

// Charts size to their container, so they wait until the page is visible.
function drawCharts() {
  const tl = $('#timeline', root);
  const rh = $('#rhythm', root);
  if (tl && tl.clientWidth) tl.innerHTML = timeline(tl.clientWidth);
  if (rh && rh.clientWidth) rh.innerHTML = rhythmGrid(rh.clientWidth);
}

export function render() {
  const u = state.usage;
  const accounts = [{ value: 'all', label: 'All' }, ...accountOptions().map(a => ({ value: a.id, label: a.name, dot: a.color }))];
  root.innerHTML = `
    <div class="page-head"><h1>Usage</h1></div>
    <div class="filters">
      ${segmented('account', accounts, u.account)}
      <span class="spacer"></span>
      ${segmented('range', RANGES, u.range)}
    </div>
    <div class="usage-body stack ${loading ? 'is-loading' : ''}">${state.usageData ? body() : skeleton()}</div>`;
  drawCharts();
}

export async function load() {
  loading = true;
  if (!state.usageData) render();
  try {
    state.usageData = await api.usage({ account: state.usage.account, range: state.usage.range });
  } catch {
    toast('Could not read usage data', { kind: 'error' });
  }
  loading = false;
  render();
}

export function mount(el) {
  root = el;
  onSegment(root, 'account', v => { state.usage.account = v; state.usage.projectPage = 0; load(); });
  onSegment(root, 'range', v => { state.usage.range = v; state.usage.projectPage = 0; load(); });
  onSegment(root, 'metric', v => { state.usage.metric = v; render(); });
  onSegment(root, 'rhythm', v => { state.usage.rhythm = v; render(); });
  onPage(root, (_name, step) => { state.usage.projectPage += step; render(); });
  new ResizeObserver(() => { if (state.usageData) drawCharts(); }).observe(root);
}
