'use strict';
const path = require('path');
const { CLIS } = require('../../hub/cli');
const { createScanner } = require('./scan');
const { buildContext, attribute } = require('./attribution');
const { aggregate } = require('./aggregate');

const WORKING_MS = 60 * 1000;
// A turn that hasn't ended is still working through long tool calls, unless it went quiet this long.
const MID_TURN_MS = 5 * 60 * 1000;
const ACTIVE_MS = 15 * 60 * 1000;

// Shared homes hold every account's sessions; an account with its own CLI home owns everything in it.
function transcriptSources(accounts) {
  const shared = Object.entries(CLIS).map(([provider, cli]) => ({ provider, root: path.join(cli.defaultHome, cli.transcripts), account: null }));
  const own = accounts.filter(a => a.cliHome)
    .map(a => ({ provider: a.provider, root: path.join(a.cliHome, CLIS[a.provider].transcripts), account: a.id }));
  return [...own, ...shared.filter(s => !own.some(o => path.resolve(o.root) === path.resolve(s.root)))];
}

function createUsage(cacheFile) {
  const scanner = createScanner(cacheFile);
  let ctx = null;
  let busy = null;

  async function refresh(accounts) {
    if (busy) return busy;
    busy = (async () => {
      const changed = await scanner.refresh(transcriptSources(accounts));
      if (changed || !ctx) ctx = await buildContext(accounts);
      return changed;
    })();
    try { return await busy; } finally { busy = null; }
  }

  async function query(accounts, options) {
    if (!ctx) await refresh(accounts);
    return aggregate(scanner.records(), ctx, accounts, options);
  }

  // Sessions (and Claude subagents) active within `within` ms, each with its owning account.
  function sessions(accounts, within = ACTIVE_MS) {
    if (!ctx) return [];
    const now = Date.now();
    return Object.entries(scanner.records()).flatMap(([file, rec]) => {
      const last = rec.blocks[rec.blocks.length - 1];
      const lastActivity = last ? last[0] + last[1] : 0;
      if (now - lastActivity > within) return [];
      const parts = file.split(path.sep);
      const sub = parts.lastIndexOf('subagents');
      return [{
        id: path.basename(file).replace(/\.jsonl(\.zst)?$/, ''), parent: sub > 0 ? parts[sub - 1] : null, file,
        provider: rec.provider, account: attribute(file, rec, ctx, accounts), cwd: rec.cwd, lastActivity,
        working: now - lastActivity < (rec.ended ? WORKING_MS : MID_TURN_MS),
        title: rec.title, model: rec.msgs.length ? rec.msgs[rec.msgs.length - 1][1] : rec.model, acts: rec.acts,
      }];
    });
  }

  return { refresh, query, sessions, ready: () => Boolean(ctx) };
}

module.exports = { createUsage };
