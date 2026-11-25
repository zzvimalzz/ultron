'use strict';

const IDLE_GAP_MS = 5 * 60 * 1000;
const ACTS_KEPT = 6;
const DETAIL_CHARS = 140;
// The input field that best says what a tool call is about, in order of preference.
const DETAIL_KEYS = ['file_path', 'notebook_path', 'description', 'pattern', 'path', 'command', 'cmd', 'url', 'query', 'title', 'prompt', 'skill'];
const ENDS = ['end_turn', 'stop_sequence', 'refusal'];

function emptyRecord() {
  return { sessionId: null, cwd: null, entrypoint: null, msgs: [], blocks: [], model: null, totals: null, title: null, acts: [], ended: false };
}

// Activity blocks: consecutive timestamps closer than IDLE_GAP_MS count as active time.
function addActivity(rec, t) {
  const last = rec.blocks[rec.blocks.length - 1];
  if (!last || t - (last[0] + last[1]) > IDLE_GAP_MS) rec.blocks.push([t, 0]);
  else if (t > last[0] + last[1]) last[1] = t - last[0];
}

const firstLine = text => String(text).trim().split('\n')[0].slice(0, DETAIL_CHARS);

function detailOf(input) {
  if (!input || typeof input !== 'object') return '';
  for (const key of DETAIL_KEYS) {
    const value = Array.isArray(input[key]) ? input[key].join(' ') : input[key];
    if (typeof value === 'string' && value.trim()) return firstLine(value);
  }
  return '';
}

// The last few things a session did, as [t, tool, detail]; an empty tool is something the agent said.
function addAct(rec, t, tool, detail) {
  const last = rec.acts[rec.acts.length - 1];
  if (last && last[0] === t && last[1] === tool && last[2] === detail) return;
  rec.acts.push([t, tool, detail]);
  if (rec.acts.length > ACTS_KEPT) rec.acts.shift();
}

function parseJson(line) {
  if (line.charCodeAt(0) !== 123) return null;
  try { return JSON.parse(line); } catch { return null; }
}

// Claude Code: one line per event; streamed assistant content repeats the same message id and usage.
// Only assistant lines carry usage and actions, and their timestamps alone are enough for active
// time, so other (often huge) lines are skipped without parsing.
const CLAUDE_TITLE = /^\{"type":"(custom-title|ai-title)"/;

function readClaudeLine(rec, line) {
  if (CLAUDE_TITLE.test(line)) {
    const d = parseJson(line);
    rec.title = d?.customTitle || d?.aiTitle || rec.title;
    return;
  }
  if (!line.includes('"type":"assistant"')) {
    if (line.includes('[Request interrupted by user')) rec.ended = true;
    return;
  }
  const d = parseJson(line);
  if (!d || d.type !== 'assistant') return;
  rec.sessionId ||= d.sessionId || null;
  rec.cwd ||= d.cwd || null;
  rec.entrypoint ||= d.entrypoint || null;
  const t = Date.parse(d.timestamp);
  if (Number.isNaN(t)) return;
  addActivity(rec, t);
  const m = d.message;
  if (!m) return;
  for (const block of Array.isArray(m.content) ? m.content : []) {
    if (block.type === 'tool_use') addAct(rec, t, block.name, detailOf(block.input));
    else if (block.type === 'text' && block.text?.trim()) addAct(rec, t, '', firstLine(block.text));
  }
  if (m.stop_reason) rec.ended = ENDS.includes(m.stop_reason);
  if (!m.usage || !m.model || m.model === '<synthetic>') return;
  const u = m.usage;
  rec.msgs.push([t, m.model, u.input_tokens || 0, u.cache_creation_input_tokens || 0,
    u.cache_read_input_tokens || 0, u.output_tokens || 0, m.id || d.requestId || d.uuid]);
}

// Codex runs most tools through one `exec` tool whose input is JavaScript calling tools.<name>({...}).
const CODEX_INNER = /tools\.(\w+)\(/;
const CODEX_FILE = /\*\*\* (?:Update|Add|Delete) File: ([^\n"\\]+)/;
const CODEX_ARG = /\b(?:cmd|path|query|url|q|ref_id)\s*:\s*"((?:[^"\\]|\\.)*)"/;

function unquote(text) {
  try { return JSON.parse(`"${text}"`); } catch { return text; }
}

function codexCall(p) {
  if (p.type === 'function_call') return [p.name, detailOf(parseJson(String(p.arguments || '')))];
  if (p.type === 'local_shell_call') return ['shell', detailOf(p.action)];
  if (p.type === 'web_search_call') return ['web_search', detailOf(p.action)];
  const input = String(p.input || '');
  const inner = input.match(CODEX_INNER);
  const file = input.match(CODEX_FILE);
  const arg = input.match(CODEX_ARG);
  const detail = file ? file[1].trim() : arg ? firstLine(unquote(arg[1])) : inner ? '' : firstLine(input);
  return [inner ? inner[1] : p.name, detail];
}

// Codex rollouts report cumulative totals; per-response usage is the delta between token_count events.
// Every line starts with {"timestamp":"<ISO>", so activity is read without parsing the payload.
const CODEX_PREFIX = '{"timestamp":"';
const CODEX_PARSED = /"type":"(session_meta|turn_context|token_count|task_started|task_complete|custom_tool_call|function_call|local_shell_call|web_search_call)"|"role":"assistant"/;

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
  if (Number.isNaN(t)) return;
  if (d.type === 'event_msg' && (p.type === 'task_started' || p.type === 'task_complete')) rec.ended = p.type === 'task_complete';
  if (d.type === 'response_item' && /call$/.test(p.type || '')) addAct(rec, t, ...codexCall(p));
  if (d.type === 'response_item' && p.type === 'message' && p.role === 'assistant') {
    const text = (Array.isArray(p.content) ? p.content : []).map(c => c.text || '').join(' ');
    if (text.trim()) addAct(rec, t, '', firstLine(text));
  }
  if (d.type !== 'event_msg' || p.type !== 'token_count' || !p.info || !p.info.total_token_usage) return;
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
