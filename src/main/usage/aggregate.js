'use strict';
const path = require('path');
const { attribute } = require('./attribution');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const YEAR_WEEKS = 53;

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfBucket(t, unit) {
  const d = new Date(t);
  if (unit === 'hour') { d.setMinutes(0, 0, 0); return d.getTime(); }
  d.setHours(0, 0, 0, 0);
  if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (unit === 'month') d.setDate(1);
  return d.getTime();
}

function nextBucket(t, unit) {
  const d = new Date(t);
  if (unit === 'hour') d.setHours(d.getHours() + 1);
  else if (unit === 'day') d.setDate(d.getDate() + 1);
  else if (unit === 'week') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

function rangeStart(range, now) {
  if (range === '24h') return now - DAY;
  const days = parseInt(range, 10);
  return days ? startOfDay(now) - (days - 1) * DAY : 0;
}

// Keeps the daily chart readable: long ranges switch to weekly, then monthly bars.
function bucketUnit(range, since, now) {
  if (range === '24h') return 'hour';
  const days = (now - since) / DAY;
  return days <= 120 ? 'day' : days <= 3 * 366 ? 'week' : 'month';
}

const MODEL_FAMILIES = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/i;
const LEGACY_CLAUDE = /^claude-(\d+)(?:-(\d))?-(opus|sonnet|haiku)/i;
const capital = s => s[0].toUpperCase() + s.slice(1);

function prettyModel(model) {
  let r = MODEL_FAMILIES.exec(model);
  if (r) return `${capital(r[1])} ${r[2]}${r[3] ? '.' + r[3] : ''}`;
  r = LEGACY_CLAUDE.exec(model);
  if (r) return `${capital(r[3])} ${r[1]}${r[2] ? '.' + r[2] : ''}`;
  r = /^gpt-([\w.]+?)(?:-(\w+))?$/i.exec(model);
  if (r) return `GPT-${r[1]}${r[2] ? ' ' + capital(r[2]) : ''}`;
  return model;
}

const SCRATCH = /scratch-workspaces|[\\/]Codex[\\/]\d{4}-\d{2}-\d{2}[\\/]/i;
const projectName = cwd => (!cwd ? 'Unknown' : SCRATCH.test(cwd) ? 'Scratch sessions' : path.basename(cwd) || cwd);

const SOURCES = [
  [/desktop/i, 'Desktop app'],
  [/vscode/i, 'VS Code'],
  [/^cli$|codex_cli|exec/i, 'Terminal'],
];
const sourceName = entrypoint => (SOURCES.find(([re]) => re.test(entrypoint || '')) || [0, 'Other'])[1];

function overlap(start, dur, since, now) {
  return Math.max(0, Math.min(start + dur, now) - Math.max(start, since));
}

function emptyTotals() {
  return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, total: 0, messages: 0, sessions: 0, activeMs: 0 };
}

// Tokens per bucket, split by account. `first` is the earliest point, which starts the chart when the range is All.
function buildTimeline(points, range, since, first, now) {
  if (!since) since = Number.isFinite(first) ? startOfDay(first) : startOfDay(now);
  const unit = bucketUnit(range, since, now);
  const buckets = [];
  for (let t = startOfBucket(since, unit); t <= now; t = nextBucket(t, unit)) buckets.push({ t, total: 0, output: 0, byAccount: {} });
  const index = new Map(buckets.map((b, i) => [b.t, i]));
  for (const p of points) {
    const b = buckets[index.get(startOfBucket(p.t, unit))];
    if (!b) continue;
    b.total += p.tokens; b.output += p.output;
    const ba = (b.byAccount[p.acct] ||= { total: 0, output: 0 });
    ba.total += p.tokens; ba.output += p.output;
  }
  return { unit, buckets };
}

function aggregate(records, ctx, accounts, { account = 'all', range = '30d' } = {}, now = Date.now()) {
  const since = rangeStart(range, now);
  const totals = emptyTotals();
  const perAccount = {};
  const lastActivity = {};
  const models = new Map();
  const projects = new Map();
  const sources = new Map();
  const points = [];
  const weekStart = startOfDay(now) - 6 * DAY;
  const week = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const daysStart = startOfBucket(now, 'week') - (YEAR_WEEKS - 1) * 7 * DAY;
  const days = new Array(Math.round((startOfDay(now) - daysStart) / DAY) + 1).fill(0);
  const seen = new Set();
  const counted = new Set();
  let first = Infinity;

  for (const [file, rec] of Object.entries(records)) {
    const acct = attribute(file, rec, ctx, accounts);
    const mine = account === 'all' || account === acct;
    const isSubagent = file.includes(`${path.sep}subagents${path.sep}`);
    const pa = (perAccount[acct] ||= { total: 0, output: 0, messages: 0, activeMs: 0 });
    const lastBlock = rec.blocks[rec.blocks.length - 1];
    if (lastBlock) lastActivity[acct] = Math.max(lastActivity[acct] || 0, lastBlock[0] + lastBlock[1]);
    let fileTokens = 0;

    for (const [t, model, input, cacheWrite, cacheRead, output, id] of rec.msgs) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (mine) {
        if (t >= weekStart) week[Math.floor((startOfDay(t) - weekStart) / DAY)][new Date(t).getHours()]++;
        if (t >= daysStart) days[Math.round((startOfDay(t) - daysStart) / DAY)]++;
      }
      if (t < since) continue;
      const tokens = input + cacheWrite + cacheRead + output;
      pa.total += tokens; pa.output += output; pa.messages++;
      if (!mine) continue;
      first = Math.min(first, t);
      fileTokens += tokens;
      totals.input += input; totals.cacheWrite += cacheWrite; totals.cacheRead += cacheRead; totals.output += output;
      totals.total += tokens; totals.messages++;
      const name = prettyModel(model);
      const m = models.get(name) || { model: name, total: 0, output: 0, messages: 0 };
      m.total += tokens; m.output += output; m.messages++;
      models.set(name, m);
      points.push({ t, acct, tokens, output });
    }

    if (isSubagent) continue;
    const active = rec.blocks.reduce((sum, [s, d]) => sum + overlap(s, d, since, now), 0);
    pa.activeMs += active;
    if (!mine || (!fileTokens && !active)) continue;
    totals.activeMs += active;
    const sid = rec.sessionId || file;
    if (!counted.has(sid)) { counted.add(sid); totals.sessions++; }
    const pn = projectName(rec.cwd);
    const p = projects.get(pn) || { name: pn, total: 0, sessions: new Set(), lastActive: 0 };
    p.total += fileTokens;
    p.sessions.add(sid);
    if (lastBlock) p.lastActive = Math.max(p.lastActive, lastBlock[0] + lastBlock[1]);
    projects.set(pn, p);
    const src = sourceName(rec.entrypoint);
    sources.set(src, (sources.get(src) || 0) + fileTokens);
  }

  const modelList = [...models.values()].sort((a, b) => b.total - a.total);
  const top = [...models.values()].sort((a, b) => b.messages - a.messages)[0];
  return {
    generatedAt: now,
    range,
    totals,
    topModel: top ? { model: top.model, share: top.messages / totals.messages } : null,
    models: modelList,
    timeline: buildTimeline(points, range, since, first, now),
    rhythm: { weekStart, week, daysStart, days },
    projects: [...projects.values()]
      .map(p => ({ name: p.name, total: p.total, sessions: p.sessions.size, lastActive: p.lastActive }))
      .sort((a, b) => b.total - a.total),
    sources: [...sources.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
    perAccount,
    lastActivity,
  };
}

module.exports = { aggregate, buildTimeline, prettyModel, projectName, rangeStart, startOfBucket, startOfDay, HOUR, DAY };
