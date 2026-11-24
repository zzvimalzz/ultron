'use strict';
const fsp = require('fs').promises;
const path = require('path');
const { walkFiles } = require('./walk');

async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; }
}

// Claude Desktop records which CLI session ids each Code-tab session used, per profile.
async function buildContext(accounts) {
  const sessionOwner = new Map();
  const firstLaunch = {};
  for (const a of accounts.filter(x => x.provider === 'claude' && x.realDataDir)) {
    const cfg = await readJson(path.join(a.realDataDir, 'config.json'));
    if (cfg && cfg.first_launch_at) firstLaunch[a.id] = cfg.first_launch_at;
    for (const f of await walkFiles(path.join(a.realDataDir, 'claude-code-sessions'), name => /^local_.*\.json$/.test(name))) {
      const s = await readJson(f);
      if (!s) continue;
      for (const id of [s.cliSessionId, s.lastAssistantCliSessionId]) if (id) sessionOwner.set(id, a.id);
    }
  }
  return { sessionOwner, firstLaunch };
}

const norm = p => (p || '').toLowerCase().replace(/\//g, '\\');

function attribute(file, rec, ctx, accounts) {
  if (rec.account) return rec.account;
  const candidates = accounts.filter(a => a.provider === rec.provider);
  if (rec.provider !== 'claude') return candidates[0] ? candidates[0].id : 'other';

  // Subagent transcripts live in <project>/<parentSessionId>/subagents/.
  const parts = file.split(path.sep);
  const sub = parts.lastIndexOf('subagents');
  for (const id of [sub > 0 ? parts[sub - 1] : null, rec.sessionId, path.basename(file, '.jsonl')]) {
    if (id && ctx.sessionOwner.has(id)) return ctx.sessionOwner.get(id);
  }
  const cwd = norm(rec.cwd);
  const owner = cwd && candidates.find(a => [a.dataDir, a.realDataDir].some(d => d && cwd.startsWith(norm(d) + '\\')));
  if (owner) return owner.id;
  // Desktop sessions from before a second profile existed can only belong to the first one.
  if (rec.entrypoint === 'claude-desktop') {
    const t = rec.blocks.length ? rec.blocks[0][0] : 0;
    const live = candidates.filter(a => ctx.firstLaunch[a.id] && ctx.firstLaunch[a.id] <= t);
    if (live.length === 1) return live[0].id;
  }
  return 'other';
}

module.exports = { buildContext, attribute };
