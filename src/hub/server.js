'use strict';
// Ultron Hub: a stdio MCP server that Claude Code and Codex start (through Ultron's executable in
// Node mode) to share memory and messages. Ultron keeps crew.json and sessions.json current.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const memory = require('./memory');
const { HUB_DIR, MEMORY_DIR, CREW_FILE, SESSIONS_FILE, readJson, writeJson, appendEvent, recentEvents } = require('./files');

const PROVIDER = process.env.ULTRON_PROVIDER || 'claude';
const PROVIDER_NAMES = { claude: 'Claude', chatgpt: 'ChatGPT' };
const WEEK_MS = 7 * 24 * 3600 * 1000;
const INBOX_DIR = path.join(HUB_DIR, 'inbox');
const norm = p => path.resolve(p).toLowerCase();
const memoryDir = () => readJson(CREW_FILE, {}).memoryDir || MEMORY_DIR;

// The server can't see which account started it, so Ultron publishes active sessions by folder.
function whoAmI() {
  const crew = readJson(CREW_FILE, { agents: [] });
  const cwd = norm(process.cwd());
  const session = readJson(SESSIONS_FILE, [])
    .filter(s => s.provider === PROVIDER && s.cwd && norm(s.cwd) === cwd)
    .sort((a, b) => b.last - a.last)[0];
  const mine = crew.agents.filter(a => a.provider === PROVIDER);
  const id = session ? session.agent : mine.length === 1 ? mine[0].id : null;
  return { crew, me: crew.agents.find(a => a.id === id) || null, mine };
}

const nameOf = (crew, from) => crew.agents.find(a => a.id === from.agent)?.name || PROVIDER_NAMES[from.provider] || 'An agent';

function sender() {
  const { me } = whoAmI();
  return { agent: me ? me.id : null, provider: PROVIDER, cwd: process.cwd() };
}

const notInCrew = agent => ({ free: 'free plan', unknown: 'plan unknown' })[agent.tier] || 'left out by the user';

function crewTool() {
  const { crew, me } = whoAmI();
  const lines = crew.agents.map(a => {
    const flags = `${a.id === crew.leader ? ' (leader)' : ''}${me && a.id === me.id ? ' (you)' : ''}${a.eligible ? '' : ` (not in crew: ${notInCrew(a)})`}`;
    return `- ${a.name}${flags}: ${a.tier} · ${a.model || 'default'}${a.effort ? `/${a.effort}` : ''} · roles: ${a.roles.join(', ')} · ${a.status}`;
  });
  return lines.join('\n') || 'No agents yet. Open Ultron to set up the crew.';
}

// Every memory tool leaves one event with a title only, never note text, so Ultron can show what the crew is doing.
const memoryEvent = (action, title) => appendEvent({ type: 'memory', action, title, from: sender() });

const source = () => {
  const { me } = whoAmI();
  return `${me ? me.name : PROVIDER_NAMES[PROVIDER]} (${PROVIDER})`;
};

const noteTitle = (vault, file) => memory.titleOf(fs.readFileSync(path.join(vault, file), 'utf8'), file);

function contextTool() {
  const vault = memoryDir();
  const project = memory.projectFor(vault, process.cwd());
  memoryEvent('context', project ? project.slug : 'memory');
  return memory.context(vault, process.cwd());
}

function recallTool({ query = '' }) {
  memoryEvent('recalled', query || 'recent notes');
  const hits = memory.recall(memoryDir(), query, process.cwd());
  if (!hits.length) return query ? `No notes match "${query}".` : 'The vault is empty.';
  return hits.map(h => (h.text ? `## ${h.title} (${h.file})\n${h.text}` : `- ${h.title} (${h.file})`)).join(query ? '\n\n' : '\n');
}

function rememberTool(args) {
  const file = memory.remember(memoryDir(), { ...args, cwd: process.cwd() }, source());
  memoryEvent('saved', `${args.kind}: ${args.title || args.topic || path.basename(file, '.md')}`);
  return `Saved to ${file}.`;
}

function updateTool({ file, text }) {
  const vault = memoryDir();
  const title = noteTitle(vault, file);
  const name = memory.update(vault, file, text, source());
  memoryEvent('updated', title);
  return `Updated ${name}; the old version is in the archive.`;
}

function forgetTool({ file }) {
  const vault = memoryDir();
  const title = noteTitle(vault, file);
  const archived = memory.forget(vault, file);
  memoryEvent('archived', title);
  return `Archived as ${archived}.`;
}

function sendMessage({ to, text }) {
  const { crew } = whoAmI();
  const key = to.trim().toLowerCase();
  const target = ['everyone', 'all'].includes(key) ? 'all'
    : key === 'leader' ? crew.leader
      : crew.agents.find(a => a.name.toLowerCase() === key || a.id === to)?.id;
  if (!target) throw new Error(`No agent called "${to}". Agents: ${crew.agents.map(a => a.name).join(', ')}, or "leader" / "everyone".`);
  appendEvent({ type: 'message', from: sender(), to: target, text });
  return `Sent to ${target === 'all' ? 'everyone' : crew.agents.find(a => a.id === target).name}.`;
}

function checkInbox() {
  const { crew, me, mine } = whoAmI();
  const ids = me ? [me.id] : mine.map(a => a.id);
  const inbox = path.join(INBOX_DIR, `${me ? me.id : PROVIDER}.json`);
  const { lastRead = 0 } = readJson(inbox, {});
  const messages = recentEvents(Math.max(lastRead + 1, Date.now() - WEEK_MS))
    .filter(e => e.type === 'message' && (e.to === 'all' || ids.includes(e.to)) && !(me && e.from.agent === me.id));
  writeJson(inbox, { lastRead: Date.now() });
  return messages.length
    ? messages.map(e => `From ${nameOf(crew, e.from)} at ${new Date(e.t).toLocaleString()}:\n${e.text}`).join('\n\n')
    : 'No new messages.';
}

const object = (properties = {}, required = []) => ({ type: 'object', properties, required });
const text = description => ({ type: 'string', description });

const TOOLS = [
  { name: 'crew', run: crewTool, inputSchema: object(),
    description: 'List the AI agents on this PC: the leader, what each one does, and who is working right now.' },
  { name: 'context', run: contextTool, inputSchema: object(),
    description: "What you should know right now: durable memory and the current project's overview and state. Call at the start of substantive work." },
  { name: 'recall', run: recallTool, inputSchema: object({ query: text('Words to search for; leave empty to list recent notes') }),
    description: 'Search the memory vault; the current project ranks first.' },
  { name: 'remember', run: rememberTool, inputSchema: object({
    kind: { type: 'string', enum: ['fact', 'profile', 'area', 'project-state', 'decision', 'session', 'inbox'], description: 'What is being saved; it decides where' },
    title: text('Short title (needed for area, decision and session)'), text: text('The note, in Markdown'),
    project: text('Project name, if not the current folder'), topic: text('For profile: identity, preferences, working-style or goals'),
  }, ['kind', 'text']),
    description: 'Save to memory. kind: fact, profile (needs topic), area, project-state, decision, session, inbox. Facts about the user are saved as unconfirmed until the user confirms them.' },
  { name: 'update', run: updateTool, inputSchema: object({ file: text('Path inside the vault'), text: text('The full new content') }, ['file', 'text']),
    description: 'Replace a stale note; the old version is archived.' },
  { name: 'forget', run: forgetTool, inputSchema: object({ file: text('Path inside the vault') }, ['file']),
    description: 'Archive a note that is no longer true. Nothing is deleted.' },
  { name: 'send_message', run: sendMessage, inputSchema: object({ to: text('Agent name, "leader" or "everyone"'), text: text('The message') }, ['to', 'text']),
    description: 'Send a message to another agent. Use crew to see who does which kind of work.' },
  { name: 'check_inbox', run: checkInbox, inputSchema: object(),
    description: 'Read the messages other agents sent you since you last checked.' },
];

function instructions() {
  const { crew } = whoAmI();
  const leader = crew.agents.find(a => a.id === crew.leader);
  return [
    `Ultron Hub connects you to the other AI agents on this PC (${crew.agents.map(a => a.name).join(', ') || 'none yet'}).${leader ? ` The leader is ${leader.name}.` : ''}`,
    `This device's memory vault is ${memoryDir()}. Call context at the start, recall before work that may have history, and remember outcomes (kind: session) and decisions before you finish. Follow PROTOCOL.md in the vault.`,
    'Use the crew tool to see which agent does which kind of work. Use send_message to hand work over, and check_inbox when other agents are mentioned.',
  ].join('\n');
}

memory.ensureVault(memoryDir());

function handle(msg) {
  const { method, params = {} } = msg;
  if (method === 'initialize') {
    return { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ultron-hub', version: '1.0.0' }, instructions: instructions() };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params.name);
    if (!tool) throw Object.assign(new Error(`Unknown tool ${params.name}`), { code: -32602 });
    try {
      return { content: [{ type: 'text', text: tool.run(params.arguments || {}) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
  }
  throw Object.assign(new Error(`Unknown method ${method}`), { code: -32601 });
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  let reply;
  try {
    reply = { jsonrpc: '2.0', id: msg.id, result: handle(msg) };
  } catch (err) {
    reply = { jsonrpc: '2.0', id: msg.id, error: { code: err.code || -32603, message: err.message } };
  }
  process.stdout.write(`${JSON.stringify(reply)}\n`);
});
