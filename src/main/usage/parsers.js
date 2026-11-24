'use strict';

const IDLE_GAP_MS = 5 * 60 * 1000;

function emptyRecord() {
  return { sessionId: null, cwd: null, entrypoint: null, msgs: [], blocks: [], model: null, totals: null };
}

// Activity blocks: consecutive timestamps closer than IDLE_GAP_MS count as active time.
function addActivity(rec, t) {
  const last = rec.blocks[rec.blocks.length - 1];
  if (!last || t - (last[0] + last[1]) > IDLE_GAP_MS) rec.blocks.push([t, 0]);
  else if (t > last[0] + last[1]) last[1] = t - last[0];
}

function parseJson(line) {
  if (line.charCodeAt(0) !== 123) return null;
  try { return JSON.parse(line); } catch { return null; }
}

// Claude Code: one line per event; streamed assistant content repeats the same message id and usage.
// Only assistant lines carry usage, and their timestamps alone are enough for active time, so other
// (often huge) lines are skipped without parsing.
function readClaudeLine(rec, line) {
  if (!line.includes('"type":"assistant"')) return;
  const d = parseJson(line);
  if (!d || d.type !== 'assistant') return;
  rec.sessionId ||= d.sessionId || null;
  rec.cwd ||= d.cwd || null;
  rec.entrypoint ||= d.entrypoint || null;
  const t = Date.parse(d.timestamp);
  if (Number.isNaN(t)) return;
  addActivity(rec, t);
  const m = d.message;
  if (!m || !m.usage || !m.model || m.model === '<synthetic>') return;
  const u = m.usage;
  rec.msgs.push([t, m.model, u.input_tokens || 0, u.cache_creation_input_tokens || 0,
    u.cache_read_input_tokens || 0, u.output_tokens || 0, m.id || d.requestId || d.uuid]);
}

// Codex rollouts report cumulative totals; per-response usage is the delta between token_count events.
// Every line starts with {"timestamp":"<ISO>", so activity is read without parsing the payload.
const CODEX_PREFIX = '{"timestamp":"';
const CODEX_PARSED = /"type":"(session_meta|turn_context)"|"type":"token_count"/;

function readCodexLine(rec, line) {
  if (!line.startsWith(CODEX_PREFIX)) return;
  const t = Date.parse(line.slice(CODEX_PREFIX.length, CODEX_PREFIX.length + 24));
  const head = line.slice(0, 200);
  if (!Number.isNaN(t) && /"type":"(response_item|event_msg)"/.test(head)) addActivity(rec, t);
  if (!CODEX_PARSED.test(head)) return;
  const d = parseJson(line);
  if (!d) return;
  const p = d.payload || {};
  if (d.type === 'session_meta') {
    rec.sessionId ||= p.id || null;
    rec.cwd ||= p.cwd || null;
    rec.entrypoint ||= p.originator || 'codex';
  } else if (d.type === 'turn_context') {
    rec.model = p.model || rec.model;
    rec.cwd ||= p.cwd || null;
  }
  if (Number.isNaN(t) || d.type !== 'event_msg' || p.type !== 'token_count' || !p.info || !p.info.total_token_usage) return;
  const cur = p.info.total_token_usage;
  const prev = rec.totals || { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0 };
  const delta = k => Math.max(0, (cur[k] || 0) - (prev[k] || 0));
  const cached = delta('cached_input_tokens');
  const output = delta('output_tokens');
  const input = Math.max(0, delta('input_tokens') - cached);
  const cacheWrite = delta('cache_write_input_tokens');
  rec.totals = cur;
  if (input + cached + output + cacheWrite === 0) return;
  rec.msgs.push([t, rec.model || 'codex', input, cacheWrite, cached, output, `${rec.sessionId}:${d.ordinal ?? t}`]);
}

const FORMATS = { claude: readClaudeLine, chatgpt: readCodexLine };

function readLines(rec, provider, text) {
  const read = FORMATS[provider];
  for (const line of text.split('\n')) read(rec, line);
  return rec;
}

module.exports = { emptyRecord, readLines };
