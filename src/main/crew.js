'use strict';
const fs = require('fs');
const path = require('path');
const { projectName, prettyModel } = require('./usage/aggregate');
const { homeOf } = require('../hub/cli');
const { isLaunchOnly } = require('./targets');
const { MEMORY_DIR, CREW_FILE, SESSIONS_FILE, EVENTS_FILE, readJson, writeJson, recentEvents } = require('../hub/files');

const FEED_MS = 24 * 3600 * 1000;

// A detected plan wins; the user's answer only fills in while detection can't tell.
const effectiveTier = (account, detected = 'unknown') => (detected !== 'unknown' ? detected : account.planAnswer || 'unknown');
// Only paid and team plans can run a model for the memory curator.
const eligible = (account, detected) => ['paid', 'team'].includes(effectiveTier(account, detected));

const statusOf = live => (live?.working ? 'working' : live?.running ? 'open' : 'idle');

// crew.json and sessions.json let the hub server list the agents, route messages and tell
// which account started it.
let published = '';
function publish(config, overview, sessions) {
  const crew = {
    memoryDir: config.memory.dir || MEMORY_DIR,
    agents: config.accounts.filter(a => !isLaunchOnly(a.provider)).map(a => ({
      id: a.id, name: a.name, provider: a.provider, tier: overview[a.id]?.tier, model: a.model, effort: a.effort, status: statusOf(overview[a.id]), home: homeOf(a),
    })),
  };
  const active = sessions.filter(s => !s.parent).map(s => ({ agent: s.account, provider: s.provider, cwd: s.cwd, last: s.lastActivity }));
  const text = JSON.stringify([crew, active]);
  if (text === published) return;
  published = text;
  writeJson(CREW_FILE, crew);
  writeJson(SESSIONS_FILE, active);
}

const eventsSize = () => { try { return fs.statSync(EVENTS_FILE).size; } catch { return 0; } };

const subagentType = file => readJson(file.replace(/\.jsonl$/, '.meta.json'), {}).agentType || 'Subagent';

// What the live map draws: every recent session with its last actions, and the latest memory use.
function liveMap(config, sessions) {
  const norm = p => (p ? path.resolve(p).toLowerCase() : '');
  const sessionAgent = (provider, cwd) => sessions.find(s => s.provider === provider && norm(s.cwd) === norm(cwd))?.account;
  const fallback = provider => config.accounts.find(a => a.provider === provider)?.id || 'other';
  return {
    connected: config.crew.connected,
    memoryDir: config.memory.dir || MEMORY_DIR,
    sessions: sessions.map(s => ({
      id: s.id, agent: s.account, parent: s.parent, working: s.working, lastActivity: s.lastActivity, cwd: s.cwd,
      label: s.parent ? subagentType(s.file) : projectName(s.cwd), title: s.title, model: s.model ? prettyModel(s.model) : '', acts: s.acts,
    })),
    memoryEvents: recentEvents(Date.now() - FEED_MS).filter(e => e.type === 'memory').slice(-20).map(e => ({
      t: e.t, action: e.action, title: e.title, from: e.from.agent || sessionAgent(e.from.provider, e.from.cwd) || fallback(e.from.provider),
    })),
  };
}

module.exports = { publish, eventsSize, liveMap, effectiveTier, eligible };
