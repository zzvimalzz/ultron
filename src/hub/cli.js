'use strict';
// What Ultron knows about each provider's CLI. It lives in the hub folder because the hub server
// runs outside the app bundle and can't require anything from src/main.
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FILE_TOOLS } = require('./guard');

const CLIS = {
  claude: {
    command: 'claude', homeEnv: 'CLAUDE_CONFIG_DIR', defaultHome: path.join(os.homedir(), '.claude'),
    transcripts: 'projects', instructions: 'CLAUDE.md', credentials: '.credentials.json', login: ['auth', 'login'],
    modelArgs: model => ['--model', model], effortArgs: effort => ['--effort', effort],
  },
  chatgpt: {
    command: 'codex', homeEnv: 'CODEX_HOME', defaultHome: path.join(os.homedir(), '.codex'),
    transcripts: 'sessions', instructions: 'AGENTS.md', credentials: 'auth.json', login: ['login'],
    modelArgs: model => ['-m', model], effortArgs: effort => ['-c', `model_reasoning_effort=${effort}`],
  },
};

// App execution aliases (WindowsApps\*.exe) can't be stat'ed, only lstat'ed.
function exists(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

function which(cmd) {
  const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT').toLowerCase().split(';');
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const hit = exts.map(ext => path.join(dir, cmd + ext)).find(exists);
    if (hit) return hit;
  }
  return null;
}

const homeOf = account => account.cliHome || CLIS[account.provider].defaultHome;

// ELECTRON_RUN_AS_NODE is dropped so a CLI started by the hub doesn't make the Electron projects it runs behave as Node.
function cliEnv(account, base = process.env) {
  const env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  if (account.cliHome) env[CLIS[account.provider].homeEnv] = account.cliHome;
  return env;
}

// Existence only: the credentials file holds tokens and is never read here.
const signedIn = account => Boolean(CLIS[account.provider]) && exists(path.join(homeOf(account), CLIS[account.provider].credentials));

// The chosen model and effort as CLI arguments, for the terminal and for headless runs.
function modelArgs(account) {
  const cli = CLIS[account.provider];
  return [...(account.model ? cli.modelArgs(account.model) : []), ...(account.effort ? cli.effortArgs(account.effort) : [])];
}

const SAFE_ARG = /^[\w@+=:,./\\-]+$/;

// cmd.exe strips one outer pair of quotes under /s. A literal % can't be escaped on a /c line,
// so callers pass free text through stdin instead of arguments.
function quoteArg(arg) {
  if (SAFE_ARG.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

// npm installs CLIs as .cmd shims, which Windows only runs through cmd.exe.
function spawnCli(file, args, options = {}) {
  if (/\.(cmd|bat)$/i.test(file)) {
    const line = `"${[file, ...args].map(quoteArg).join(' ')}"`;
    return childProcess.spawn('cmd.exe', ['/d', '/s', '/c', line], { ...options, windowsVerbatimArguments: true });
  }
  return childProcess.spawn(file, args, options);
}

const SERVER_NAME = 'ultron-hub';
const tomlValue = JSON.stringify;

// A run's hub server: Claude reads it from an --mcp-config file; Codex has no such flag, so every
// key goes through -c and the run works whether or not the user connected the agents.
const HEADLESS = {
  claude: (account, { sessionId, resume, mcpFile, settingsFile, systemFile }) => [
    '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions',
    ...modelArgs(account), resume ? '--resume' : '--session-id', sessionId,
    '--mcp-config', mcpFile, '--settings', settingsFile, '--append-system-prompt-file', systemFile,
  ],
  chatgpt: (account, { sessionId, resume, server }) => [
    'exec', ...(resume ? ['resume', sessionId] : []), '--json', ...modelArgs(account),
    '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"', '--skip-git-repo-check',
    '-c', `mcp_servers.${SERVER_NAME}.command=${tomlValue(server.command)}`, '-c', `mcp_servers.${SERVER_NAME}.args=${tomlValue(server.args)}`,
    ...Object.entries(server.env).flatMap(([key, value]) => ['-c', `mcp_servers.${SERVER_NAME}.env.${key}=${tomlValue(value)}`]), '-',
  ],
};

const headlessArgs = (account, options) => HEADLESS[account.provider](account, options);

const claudeLine = message => {
  if (message.type === 'system' && message.subtype === 'init') return [{ sessionId: message.session_id }];
  if (message.type === 'assistant') {
    return (message.message?.content || []).filter(b => b.type === 'tool_use' && FILE_TOOLS.includes(b.name))
      .map(b => ({ file: b.input.file_path || b.input.notebook_path })).filter(f => f.file);
  }
  if (message.type !== 'result') return [];
  return message.is_error || message.subtype !== 'success' ? [{ error: message.result || message.subtype }] : [{ result: message.result }];
};

const codexLine = message => {
  const item = message.item || {};
  if (message.type === 'thread.started') return [{ sessionId: message.thread_id }];
  if (message.type === 'item.completed' && item.type === 'agent_message') return [{ result: item.text }];
  if (message.type === 'item.completed' && item.type === 'file_change') return (item.changes || []).map(c => ({ file: c.path }));
  if (message.type === 'turn.failed') return [{ error: message.error?.message || 'The turn failed' }];
  return message.type === 'error' ? [{ error: message.message }] : [];
};

const STREAMS = { claude: claudeLine, chatgpt: codexLine };

// One stdout line from a headless run becomes zero or more of { sessionId }, { file }, { result }, { error }.
function parseStream(provider, line) {
  let message;
  try { message = JSON.parse(line); } catch { return []; }
  return STREAMS[provider](message);
}

const DETECT_TIMEOUT_MS = 25000;

// First hit wins; anything unmatched is 'unknown'.
const TIERS = {
  claude: [[/free/i, 'free'], [/team|enterprise/i, 'team'], [/pro|max/i, 'paid']],
  chatgpt: [[/^free$/i, 'free'], [/team|business|enterprise|edu/i, 'team'], [/plus|pro|go/i, 'paid']],
};

const tierOf = (provider, plan) => (plan && TIERS[provider].find(([pattern]) => pattern.test(plan))?.[1]) || 'unknown';

const killTree = pid => childProcess.execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});

// Starts the CLI, feeds it JSON lines and resolves with the first value `onMessage` returns.
// No model call is made, so this costs nothing; the process tree is killed once the answer is in.
function converse(account, args, { start, onMessage }) {
  return new Promise((resolve, reject) => {
    const exe = which(CLIS[account.provider].command);
    if (!exe) return reject(Object.assign(new Error('CLI not installed'), { state: 'cli-missing' }));
    const child = spawnCli(exe, args, { env: cliEnv(account), cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let buffer = '';
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (child.pid) killTree(child.pid);
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Timed out')), DETECT_TIMEOUT_MS);
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.once('error', finish);
    child.once('exit', () => finish(new Error('CLI exited')));
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const out = onMessage(message, send);
        if (out !== undefined) return finish(null, out);
      }
    });
    start(send);
  });
}

// Every model list starts with a Default entry (id ''), so the account's chosen model always has an entry to read efforts from.
const withDefault = (models, standard) => [{ id: '', label: 'Default', description: standard?.description || '', efforts: standard?.efforts || [] }, ...models];

// `message` is the control_response line, or its inner response.
function parseClaudeInit(message) {
  const body = message.response?.response || message.response || message;
  const plan = body.account?.subscriptionType || null;
  const listed = (body.models || []).map(m => ({
    id: m.value, label: m.displayName, description: m.description || '', efforts: m.supportsEffort === false ? [] : m.supportedEffortLevels || [],
  }));
  const models = withDefault(listed.filter(m => m.id !== 'default'), listed.find(m => m.id === 'default'));
  return { plan, tier: tierOf('claude', plan), models, limits: null };
}

// `replies` holds the JSON-RPC results: modelPages (one per model/list page), account and rateLimits.
function parseCodexReplies({ modelPages = [], account, rateLimits }) {
  const plan = account?.account?.planType || null;
  const shown = modelPages.flatMap(page => page.data || []).filter(m => !m.hidden);
  const listed = shown.map(m => ({
    id: m.model || m.id, label: m.displayName, description: m.description || '', efforts: (m.supportedReasoningEfforts || []).map(e => e.reasoningEffort),
  }));
  const models = withDefault(listed, listed[Math.max(0, shown.findIndex(m => m.isDefault))]);
  const primary = rateLimits?.rateLimits?.primary;
  return { plan, tier: tierOf('chatgpt', plan), models, limits: primary ? { usedPercent: primary.usedPercent, resetsAt: primary.resetsAt } : null };
}

async function detectClaude(account) {
  const reply = await converse(account, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], {
    start: send => send({ type: 'control_request', request_id: '1', request: { subtype: 'initialize' } }),
    onMessage: message => (message.type === 'control_response' ? message : undefined),
  });
  return parseClaudeInit(reply);
}

async function detectCodex(account, { version = '0' } = {}) {
  const replies = { modelPages: [] };
  const request = (send, id, method, params) => send({ id, method, ...(params ? { params } : {}) });
  let modelsDone = false;
  await converse(account, ['app-server'], {
    start: send => request(send, 1, 'initialize', { clientInfo: { name: 'ultron', version } }),
    onMessage: (message, send) => {
      if (message.id === 1) {
        send({ method: 'initialized' });
        request(send, 2, 'model/list', {});
        request(send, 3, 'account/read', {});
        request(send, 4, 'account/rateLimits/read');
      } else if (message.id === 2) {
        replies.modelPages.push(message.result || {});
        if (message.result?.nextCursor) request(send, 2, 'model/list', { cursor: message.result.nextCursor });
        else modelsDone = true;
      } else if (message.id === 3) {
        replies.account = message.result;
      } else if (message.id === 4) {
        replies.rateLimits = message.result;
      }
      return modelsDone && 'account' in replies && 'rateLimits' in replies ? replies : undefined;
    },
  });
  return parseCodexReplies(replies);
}

const DETECTORS = { claude: detectClaude, chatgpt: detectCodex };

// Offline fallback for a missing or unresponsive CLI: the plan field and nothing else from the credentials file.
const OFFLINE_PLANS = {
  claude: credentials => credentials.claudeAiOauth?.subscriptionType,
  chatgpt: credentials => JSON.parse(Buffer.from(credentials.tokens.id_token.split('.')[1], 'base64url').toString())['https://api.openai.com/auth']?.chatgpt_plan_type,
};

function offlinePlan(account) {
  try {
    const file = path.join(homeOf(account), CLIS[account.provider].credentials);
    return OFFLINE_PLANS[account.provider](JSON.parse(fs.readFileSync(file, 'utf8'))) || null;
  } catch {
    return null;
  }
}

async function detect(account, options) {
  const base = { plan: null, tier: 'unknown', models: [], limits: null };
  if (!signedIn(account)) return { ...base, state: 'signed-out', checkedAt: Date.now() };
  try {
    return { ...base, ...(await DETECTORS[account.provider](account, options)), state: 'ok', checkedAt: Date.now() };
  } catch (err) {
    const plan = offlinePlan(account);
    return { ...base, plan, tier: tierOf(account.provider, plan), state: err.state || 'error', checkedAt: Date.now() };
  }
}

module.exports = { CLIS, exists, which, homeOf, cliEnv, signedIn, spawnCli, killTree, modelArgs, headlessArgs, parseStream, tierOf, parseClaudeInit, parseCodexReplies, detect };
