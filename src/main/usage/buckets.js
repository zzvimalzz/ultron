'use strict';
// What one device shares with the others: usage totals only, never transcripts, folders or titles.
const path = require('path');
const { attribute } = require('./attribution');
const { buildTimeline, prettyModel, rangeStart, startOfBucket, startOfDay, HOUR, DAY } = require('./aggregate');

const KEEP_DAYS = 400;
// Recent usage stays hourly so the 24H range works across devices; older usage is daily.
const HOURLY_MS = 48 * HOUR;

// Row: [bucketStart, accountKey, model, input, cacheWrite, cacheRead, output, responses, activeMs, sessions].
// Active time and sessions ride on the row with an empty model.
const ROW_LENGTH = 10;

function snapshotRows(records, ctx, accounts, keyOf, now = Date.now()) {
  const since = now - KEEP_DAYS * DAY;
  const rows = new Map();
  const seen = new Set();
  const counted = new Set();
  const rowFor = (t, key, model) => {
    const bucket = now - t < HOURLY_MS ? startOfBucket(t, 'hour') : startOfDay(t);
    const id = `${bucket}|${key}|${model}`;
    if (!rows.has(id)) rows.set(id, [bucket, key, model, 0, 0, 0, 0, 0, 0, 0]);
    return rows.get(id);
  };

  for (const [file, rec] of Object.entries(records)) {
    const key = keyOf(attribute(file, rec, ctx, accounts));
    for (const [t, model, input, cacheWrite, cacheRead, output, id] of rec.msgs) {
      if (t < since || seen.has(id)) continue;
      seen.add(id);
      const row = rowFor(t, key, prettyModel(model));
      row[3] += input; row[4] += cacheWrite; row[5] += cacheRead; row[6] += output; row[7]++;
    }
    if (file.includes(`${path.sep}subagents${path.sep}`)) continue;
    for (const [start, duration] of rec.blocks) if (start >= since) rowFor(start, key, '')[8] += duration;
    const sid = rec.sessionId || file;
    if (rec.blocks.length && rec.blocks[0][0] >= since && !counted.has(sid)) {
      counted.add(sid);
      rowFor(rec.blocks[0][0], key, '')[9]++;
    }
  }
  return [...rows.values()];
}

const isRow = row => Array.isArray(row) && row.length === ROW_LENGTH && row.every((v, i) => (i === 1 || i === 2 ? typeof v === 'string' : Number.isFinite(v)));

// `devices` are snapshots: { deviceId, name, updatedAt, accounts: { key: { name, provider, color } }, rows }.
// The result has the shape the Usage page reads, minus what only makes sense per device (heatmap, projects).
function fromRows(devices, { account = 'all', range = '30d' } = {}, now = Date.now()) {
  const since = rangeStart(range, now);
  const totals = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, total: 0, messages: 0, sessions: 0, activeMs: 0 };
  const perAccount = {};
  const lastActivity = {};
  const accounts = {};
  const models = new Map();
  const points = [];
  const perDevice = [];
  let first = Infinity;

  for (const device of devices) {
    const mine = { id: device.deviceId, name: device.name, updatedAt: device.updatedAt, total: 0, activeMs: 0 };
    for (const [key, info] of Object.entries(device.accounts || {})) accounts[key] ||= { id: key, ...info };
    for (const row of device.rows.filter(isRow)) {
      const [t, key, model, input, cacheWrite, cacheRead, output, messages, activeMs, sessions] = row;
      if (t + (now - t < HOURLY_MS ? HOUR : DAY) <= since) continue;
      const tokens = input + cacheWrite + cacheRead + output;
      const pa = (perAccount[key] ||= { total: 0, output: 0, messages: 0, activeMs: 0 });
      pa.total += tokens; pa.output += output; pa.messages += messages; pa.activeMs += activeMs;
      lastActivity[key] = Math.max(lastActivity[key] || 0, t);
      if (account !== 'all' && account !== key) continue;
      first = Math.min(first, t);
      totals.input += input; totals.cacheWrite += cacheWrite; totals.cacheRead += cacheRead; totals.output += output;
      totals.total += tokens; totals.messages += messages; totals.sessions += sessions; totals.activeMs += activeMs;
      mine.total += tokens; mine.activeMs += activeMs;
      if (model) {
        const m = models.get(model) || { model, total: 0, output: 0, messages: 0 };
        m.total += tokens; m.output += output; m.messages += messages;
        models.set(model, m);
      }
      if (tokens) points.push({ t, acct: key, tokens, output });
    }
    perDevice.push(mine);
  }

  const top = [...models.values()].sort((a, b) => b.messages - a.messages)[0];
  return {
    generatedAt: now,
    scope: 'all',
    range,
    totals,
    topModel: top ? { model: top.model, share: top.messages / totals.messages } : null,
    models: [...models.values()].sort((a, b) => b.total - a.total),
    timeline: buildTimeline(points, range, since, first, now),
    perAccount,
    lastActivity,
    accounts: Object.values(accounts),
    devices: perDevice.sort((a, b) => b.total - a.total),
  };
}

module.exports = { snapshotRows, fromRows, isRow };
