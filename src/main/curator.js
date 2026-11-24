'use strict';
// Keeps the memory vault tidy: after a session ends it asks a chosen account's CLI to write the session up, and once a week it
// reviews the whole vault. The model only returns operations; memory.js applies them, so it never writes files itself.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CLIS, spawnCli, which, cliEnv, killTree } = require('../hub/cli');
const memory = require('../hub/memory');
const { HUB_DIR, appendEvent, readJson, writeJson } = require('../hub/files');
const { condense } = require('./usage/transcript');

const STATE_FILE = path.join(HUB_DIR, 'curator.json');
const TICK_MS = 60 * 1000;
const IDLE_MS = 15 * 60 * 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const RUN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RUNS_PER_DAY = 10;
const MIN_TURNS = 3;
const INBOX_LIMIT = 10;
const WEEKLY_CAP = 30000;

// One headless run per provider: no tools, no MCP servers, nothing saved to the CLI's own history.
const HEADLESS = {
  claude: model => ({
    args: ['-p', '--output-format', 'json', ...(model ? ['--model', model] : []), '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--permission-prompts', 'none'],
    answer: ({ stdout }) => JSON.parse(stdout).result,
  }),
  chatgpt: model => {
    const out = path.join(os.tmpdir(), `ultron-curator-${process.pid}-${Date.now()}.txt`);
    return {
      args: ['exec', ...(model ? ['-m', model] : []), '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '-o', out, '-'],
      answer: () => { try { return fs.readFileSync(out, 'utf8'); } finally { fs.rmSync(out, { force: true }); } },
    };
  },
};

const INSTRUCTION = 'Return only a JSON array of operations in a json code block: '
  + '{op:"remember", kind, title, text, project?, topic?}, {op:"update", file, text}, {op:"forget", file}. ';

const SESSION_TASK = `${INSTRUCTION}Record one session entry (kind "session") and the updated project state (kind "project-state"). `
  + 'Add facts about the user only as kind "fact" or "profile". Never include secrets.';

const WEEKLY_TASK = `${INSTRUCTION}Merge duplicates, replace stale facts with update, archive obsolete notes with forget, `
  + 'and turn contradictions into {op:"remember", kind:"inbox", text:"Question: …"}. Bump "Last reviewed" in MEMORY.md and INDEX.md through update. Never include secrets.';

const VALID = {
  remember: o => typeof o.kind === 'string' && typeof o.text === 'string',
  update: o => typeof o.file === 'string' && typeof o.text === 'string',
  forget: o => typeof o.file === 'string',
};

// Accepts a fenced json block or bare JSON; anything else gives no operations.
function parseOperations(reply) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply || '');
  let list;
  try { list = JSON.parse((fenced ? fenced[1] : reply).trim()); } catch { return []; }
  return Array.isArray(list) ? list.filter(o => o && VALID[o.op]?.(o)) : [];
}

function apply(vault, operations, source) {
  const applied = [];
  for (const o of operations) {
    try {
      if (o.op === 'remember') memory.remember(vault, o, source);
      else if (o.op === 'update') memory.update(vault, o.file, o.text, source);
      else memory.forget(vault, o.file);
      applied.push(o);
    } catch (err) {
      console.error(`Curator skipped ${o.op}: ${err.message}`);
    }
  }
  return applied;
}

function runModel(account, model, prompt) {
  return new Promise((resolve, reject) => {
    const exe = which(CLIS[account.provider].command);
    if (!exe) return reject(new Error('CLI not installed'));
    const { args, answer } = HEADLESS[account.provider](model);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-curator-'));
    const child = spawnCli(exe, args, { env: cliEnv(account), cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let stdout = '';
    const done = (err, value) => {
      clearTimeout(timer);
      if (child.pid) killTree(child.pid);
      fs.rmSync(cwd, { recursive: true, force: true });
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => done(new Error('Timed out')), RUN_TIMEOUT_MS);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('error', done);
    child.once('exit', () => { try { done(null, answer({ stdout })); } catch (err) { done(err); } });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

const read = (vault, file) => { try { return fs.readFileSync(path.join(vault, file), 'utf8'); } catch { return ''; } };

function sessionPrompt(vault, session, transcript) {
  const project = memory.projectFor(vault, session.cwd);
  return [read(vault, 'PROTOCOL.md'), read(vault, 'MEMORY.md'), project ? read(vault, `projects/${project.slug}/state.md`) : '',
    `Session folder: ${session.cwd || 'unknown'}\n\n${transcript}`, SESSION_TASK].join('\n\n---\n\n');
}

function weeklyPrompt(vault) {
  const projects = memory.mdFiles(vault, 'projects').filter(f => f.endsWith('/state.md')).map(f => `${f}\n${read(vault, f)}`);
  const parts = ['INDEX.md', 'MEMORY.md', ...memory.mdFiles(vault, 'profile'), ...memory.mdFiles(vault, 'inbox').filter(f => !f.endsWith('README.md'))].map(f => `# ${f}\n${read(vault, f)}`);
  return [[...parts, ...projects].join('\n\n---\n\n').slice(0, WEEKLY_CAP), WEEKLY_TASK].join('\n\n---\n\n');
}

const dayKey = () => new Date().toDateString();

// `eligible(id)` says whether an account may be used; `onChange` tells the UI that memory moved.
function createCurator({ store, usage, accounts, eligible, vault, onChange }) {
  let busy = false;

  const state = () => readJson(STATE_FILE, { done: {}, lastWeekly: 0, day: '', runs: 0 });

  async function run(account, model, prompt, title) {
    const operations = parseOperations(await runModel(account, model, prompt));
    const applied = apply(vault(), operations, `Ultron curator (${model || 'default model'})`);
    if (applied.length) appendEvent({ type: 'memory', action: 'curated', title, from: { agent: account.id, provider: account.provider } });
    onChange();
  }

  async function curateSession(account, model, session, saved) {
    const { text, turns } = await condense(session.file, session.provider);
    saved.done[session.id] = session.lastActivity;
    if (turns < MIN_TURNS) return;
    saved.runs++;
    await run(account, model, sessionPrompt(vault(), session, text), memory.projectFor(vault(), session.cwd)?.slug || path.basename(session.cwd || 'sessions'));
  }

  async function tick() {
    const { memory: settings } = store.get();
    const account = settings.tidy && store.get().accounts.find(a => a.id === settings.curator.account);
    if (busy || !account || !eligible(account.id) || !memory.isVault(vault())) return;
    const saved = state();
    if (saved.day !== dayKey()) Object.assign(saved, { day: dayKey(), runs: 0 });
    if (saved.runs >= MAX_RUNS_PER_DAY) return;
    const now = Date.now();
    const due = usage.sessions(accounts(), WEEK_MS).find(s => !s.parent && now - s.lastActivity > IDLE_MS && saved.done[s.id] !== s.lastActivity);
    const weekly = now - saved.lastWeekly > WEEK_MS || memory.pending(vault()).inbox.length >= INBOX_LIMIT;
    if (!due && !weekly) return;
    busy = true;
    try {
      if (due) {
        await curateSession(account, settings.curator.model, due, saved);
      } else {
        saved.runs++;
        saved.lastWeekly = now;
        await run(account, settings.curator.model, weeklyPrompt(vault()), 'vault');
      }
    } catch (err) {
      console.error('Curator failed:', err.message);
    } finally {
      busy = false;
      writeJson(STATE_FILE, saved);
    }
  }

  return { start: () => setInterval(tick, TICK_MS), tick };
}

module.exports = { createCurator, parseOperations };
