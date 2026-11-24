'use strict';
const fs = require('fs');
const path = require('path');
const { projectName } = require('./usage/aggregate');
const { homeOf } = require('../hub/cli');
const { MEMORY_DIR, CREW_FILE, SESSIONS_FILE, EVENTS_FILE, readJson, writeJson, recentEvents } = require('../hub/files');

const FEED_MS = 24 * 3600 * 1000;
const norm = p => (p ? path.resolve(p).toLowerCase() : '');

function leaderId(config) {
  if (config.accounts.some(a => a.id === config.crew.leader)) return config.crew.leader;
  return (config.accounts.find(a => a.provider === 'claude') || config.accounts[0])?.id || null;
}

// A detected plan wins; the user's answer only fills in while detection can't tell.
const effectiveTier = (account, detected = 'unknown') => (detected !== 'unknown' ? detected : account.planAnswer || 'unknown');
const eligible = (account, detected) => account.inCrew !== false && ['paid', 'team'].includes(effectiveTier(account, detected));

const standing = live => ({ tier: live?.tier, eligible: Boolean(live?.eligible) });
const agentOf = (a, overview) => ({
  id: a.id, name: a.name, provider: a.provider, ...standing(overview[a.id]),
  model: a.model, effort: a.effort, roles: a.roles, maxRuns: a.maxRuns, tokens24h: overview[a.id]?.tokens || 0, status: statusOf(overview[a.id]),
});

const statusOf = live => (live?.working ? 'working' : live?.running ? 'open' : 'idle');

// crew.json and sessions.json let the hub server name the leader, route messages and tell
// which account started it.
let published = '';
function publish(config, overview, sessions) {
  const crew = {
    leader: leaderId(config),
    memoryDir: config.memory.dir || MEMORY_DIR,
    agents: config.accounts.map(a => ({ ...agentOf(a, overview), home: homeOf(a) })),
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

function crewMap(config, overview, sessions) {
  const sessionAgent = (provider, cwd) => sessions.find(s => s.provider === provider && norm(s.cwd) === norm(cwd))?.account;
  const fallback = provider => config.accounts.find(a => a.provider === provider)?.id || 'other';
  return {
    connected: config.crew.connected,
    memoryDir: config.memory.dir || MEMORY_DIR,
    leader: leaderId(config),
    agents: config.accounts.map(a => ({ ...agentOf(a, overview), color: a.color, mascot: a.mascot })),
    sessions: sessions.map(s => ({
      id: s.id, agent: s.account, parent: s.parent, working: s.working, lastActivity: s.lastActivity, cwd: s.cwd,
      label: s.parent ? subagentType(s.file) : projectName(s.cwd),
    })),
    events: recentEvents(Date.now() - FEED_MS).slice(-60).map(e => ({
      t: e.t, type: e.type, action: e.action, title: e.title, text: e.text, to: e.to,
      from: e.from.agent || sessionAgent(e.from.provider, e.from.cwd) || fallback(e.from.provider),
    })),
  };
}

module.exports = { publish, eventsSize, crewMap, leaderId, effectiveTier, eligible };
