'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-5', 'claude-opus-5',
  'claude-fable-5-2', 'claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'];

function seeded(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const iso = t => new Date(t).toISOString();
const jsonl = lines => lines.map(l => JSON.stringify(l)).join('\n') + '\n';

function claudeTurn({ sessionId, cwd, t, model, id, input = 10, cacheWrite = 100, cacheRead = 1000, output = 50, entrypoint = 'cli' }) {
  const usage = { input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: output };
  return [
    { type: 'user', sessionId, cwd, entrypoint, timestamp: iso(t - 2000) },
    { type: 'assistant', sessionId, cwd, entrypoint, timestamp: iso(t), message: { id, model, usage } },
  ];
}

function codexRollout({ sessionId, cwd, start, turns, model = 'gpt-6-luna', originator = 'codex_cli_rs' }) {
  const lines = [
    { timestamp: iso(start), type: 'session_meta', payload: { id: sessionId, cwd, originator } },
    { timestamp: iso(start), type: 'turn_context', payload: { model, cwd } },
  ];
  const total = { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0 };
  turns.forEach((turn, i) => {
    total.input_tokens += turn.input;
    total.cached_input_tokens += turn.cached;
    total.output_tokens += turn.output;
    const t = start + (i + 1) * 60000;
    lines.push({ timestamp: iso(t), ordinal: lines.length, type: 'response_item', payload: { type: 'message' } });
    lines.push({ timestamp: iso(t), ordinal: lines.length, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { ...total } } } });
  });
  return lines;
}

// A synthetic home with `days` of Claude and Codex activity ending at `now`.
function writeFixtureHome(home, { days = 30, now = Date.now(), seed = 7, projects = 24 } = {}) {
  const rand = seeded(seed);
  for (let d = 0; d < days; d++) {
    if (rand() < 0.25) continue;
    const dayStart = now - (d + 1) * DAY;
    const project = `project-${String(Math.floor(rand() * projects)).padStart(2, '0')}`;
    const cwd = path.join(home, 'work', project);
    const sessionId = `claude-${d}`;
    const lines = [];
    const turns = 3 + Math.floor(rand() * 20);
    for (let i = 0; i < turns; i++) {
      const t = dayStart + 9 * HOUR + Math.floor(rand() * 12 * HOUR);
      lines.push(...claudeTurn({ sessionId, cwd, t, model: CLAUDE_MODELS[(d + i) % CLAUDE_MODELS.length], id: `msg-${d}-${i}`, output: 20 + Math.floor(rand() * 400) }));
    }
    lines.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const dir = path.join(home, '.claude', 'projects', project.replace(/[^a-z0-9]/gi, '-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), jsonl(lines));

    if (d % 3 === 0) {
      const day = new Date(dayStart);
      const dir2 = path.join(home, '.codex', 'sessions', String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
      fs.mkdirSync(dir2, { recursive: true });
      const rollout = codexRollout({
        sessionId: `codex-${d}`, cwd, start: dayStart + 14 * HOUR,
        turns: Array.from({ length: 4 }, () => ({ input: 5000, cached: 4000, output: 300 })),
      });
      fs.writeFileSync(path.join(dir2, `rollout-codex-${d}.jsonl.zst`), zlib.zstdCompressSync(Buffer.from(jsonl(rollout))));
    }
  }
  return home;
}

module.exports = { claudeTurn, codexRollout, jsonl, writeFixtureHome, HOUR, DAY };
