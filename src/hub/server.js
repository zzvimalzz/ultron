'use strict';
// Ultron Hub: a stdio MCP server that Claude Code and Codex start (through Ultron's executable in
// Node mode) to share memory and messages. Ultron keeps crew.json and sessions.json current.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { HUB_DIR, CREW_FILE, SESSIONS_FILE, EVENTS_FILE, readJson, writeJson, recentEvents } = require('./files');

const PROVIDER = process.env.ULTRON_PROVIDER || 'claude';
const PROVIDER_NAMES = { claude: 'Claude', chatgpt: 'ChatGPT' };
const WEEK_MS = 7 * 24 * 3600 * 1000;
const INBOX_DIR = path.join(HUB_DIR, 'inbox');
const norm = p => path.resolve(p).toLowerCase();
const memoryDir = () => readJson(CREW_FILE, {}).memoryDir || path.join(HUB_DIR, 'memory');

function appendEvent(event) {
  fs.mkdirSync(HUB_DIR, { recursive: true });
  fs.appendFileSync(EVENTS_FILE, `${JSON.stringify({ t: Date.now(), ...event })}\n`);
}

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

function notes() {
  const dir = memoryDir();
  let files = [];
  try { files = fs.readdirSync(dir, { recursive: true }); } catch { return []; }
  return files.filter(f => f.endsWith('.md') && !/(^|[\\/])(\.|node_modules)/.test(f)).map(f => {
    const file = path.join(dir, f);
    const text = fs.readFileSync(file, 'utf8');
    return { file: f, title: (/^#\s+(.+)$/m.exec(text) || [, path.basename(f, '.md')])[1], text, mtime: fs.statSync(file).mtimeMs };
  });
}

function crewTool() {
  const { crew, me } = whoAmI();
  const lines = crew.agents.map(a => `- ${a.name}${a.id === crew.leader ? ' (leader)' : ''}${me && a.id === me.id ? ' (you)' : ''}: ${a.status}. Good at: ${a.strengths.join(', ')}.`);
  return `${lines.join('\n') || 'No agents yet. Open Ultron to set up the crew.'}\n\nRoute image and GIF work to ChatGPT and SVG work to Claude.`;
}

function recall({ query = '' }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = notes();
  appendEvent({ type: 'memory', action: 'recalled', title: query || 'recent notes', from: sender() });
  if (!words.length) {
    const recent = all.sort((a, b) => b.mtime - a.mtime).slice(0, 30);
    return recent.length ? recent.map(n => `- ${n.title} (${n.file})`).join('\n') : 'Shared memory is empty.';
  }
  const hits = all.map(n => {
    const text = `${n.title}\n${n.text}`.toLowerCase();
    return { ...n, score: words.every(w => text.includes(w)) ? words.reduce((s, w) => s + text.split(w).length - 1, 0) : 0 };
  }).filter(n => n.score).sort((a, b) => b.score - a.score).slice(0, 5);
  return hits.length ? hits.map(n => `## ${n.title} (${n.file})\n${n.text.slice(0, 3000)}`).join('\n\n') : `No notes match "${query}".`;
}

function remember({ title, text }) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';
  const dir = memoryDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.md`), `# ${title}\n\n${text.trim()}\n`);
  appendEvent({ type: 'memory', action: 'saved', title, from: sender() });
  return `Saved "${title}" to shared memory.`;
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
    description: 'List the AI agents on this PC: the leader, what each one is good at, and who is working right now.' },
  { name: 'recall', run: recall, inputSchema: object({ query: text('Words to search for; leave empty to list recent notes') }),
    description: 'Search the memory shared by every agent. Use it before work that may have history.' },
  { name: 'remember', run: remember, inputSchema: object({ title: text('Short note title'), text: text('The note, in Markdown') }, ['title', 'text']),
    description: 'Save a durable note (decision, convention, finding) to shared memory for the other agents. The same title replaces the note.' },
  { name: 'send_message', run: sendMessage, inputSchema: object({ to: text('Agent name, "leader" or "everyone"'), text: text('The message') }, ['to', 'text']),
    description: 'Send a message to another agent. Ask ChatGPT for images and GIFs, and Claude for SVG.' },
  { name: 'check_inbox', run: checkInbox, inputSchema: object(),
    description: 'Read the messages other agents sent you since you last checked.' },
];

function instructions() {
  const { crew } = whoAmI();
  const leader = crew.agents.find(a => a.id === crew.leader);
  return [
    `Ultron Hub connects you to the other AI agents on this PC (${crew.agents.map(a => a.name).join(', ') || 'none yet'}).${leader ? ` The leader is ${leader.name}.` : ''}`,
    'Call recall before work that may have history, and remember durable decisions and findings.',
    'Image and GIF work belongs to ChatGPT; SVG work belongs to Claude. Use send_message to hand work over, and check_inbox when other agents are mentioned.',
  ].join('\n');
}

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
