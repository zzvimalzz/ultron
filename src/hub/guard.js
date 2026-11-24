'use strict';
// PreToolUse hook for task runs: only reversible actions pass. Anything it can't recognise is blocked,
// and the agent is told to ask up the hierarchy instead.
const childProcess = require('child_process');
const path = require('path');

const FILE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const SHELL_TOOLS = ['Bash', 'PowerShell'];
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task', 'Agent', 'Skill', 'ToolSearch',
  'BashOutput', 'KillShell', 'TaskOutput', 'TaskStop', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'ExitPlanMode', 'EnterPlanMode'];

// First match wins. Patterns run on one command with git's global options removed.
const BLOCK = [
  [/^git push\b/, 'git push'],
  [/^git reset .*--hard/, 'git reset --hard'],
  [/^git clean\b/, 'git clean'],
  [/^git rebase\b/, 'git rebase'],
  [/^git commit\b.*--amend/, 'git commit --amend'],
  [/^git filter-/, 'git history rewrite'],
  [/^git branch\b.*\s(-d|--delete)\b/, 'deleting a branch'],
  [/^git tag\b.*\s(-d|--delete)\b/, 'deleting a tag'],
  [/^git (checkout|restore)\s+(--\s+)?\.$/, 'discarding all changes'],
  [/^npm publish\b/, 'npm publish'],
  [/^(npm|pnpm)\b.*\s(-g|--global)\b/, 'global package install'],
  [/^yarn global\b/, 'global package install'],
  [/^(winget|choco|scoop)\b/, 'installing software'],
  [/^(reg|setx)\b/, 'changing the registry or environment'],
  [/^(set|new|remove)-itemproperty\b.*hk(lm|cu)/, 'changing the registry'],
  [/^(shutdown|restart-computer|stop-computer)\b/, 'shutting down'],
  [/^(format|diskpart)\b/, 'disk changes'],
  [/^(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b.*(\s-x\s*(post|put|delete|patch)\b|--request\s+(post|put|delete|patch)\b|--data|\s-d\s|\s-method\s+(post|put|delete|patch)\b|\s-body\b)/, 'sending data to a server'],
  [/^gh\s+(pr\s+(create|merge)|release|repo)\b/, 'GitHub changes'],
  [/^(ssh|scp)\b/, 'remote access'],
  [/^docker push\b/, 'docker push'],
  [/^(vercel|wrangler deploy)\b/, 'deploying'],
  [/^send-mailmessage\b/, 'sending email'],
];

// Command names that need no further checks.
const READ_ONLY = ['ls', 'dir', 'cat', 'type', 'head', 'tail', 'grep', 'rg', 'find', 'get-childitem', 'gci', 'get-content', 'gc', 'select-string', 'echo', 'pwd',
  'which', 'where', 'wc', 'sort', 'uniq', 'diff', 'tree', 'test-path', 'write-output', 'write-host', 'select-object', 'sort-object', 'measure-object',
  'get-location', 'get-item', 'resolve-path', 'true', 'false', 'sleep', 'start-sleep', 'curl', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod'];
const BUILD = ['node', 'npx', 'pnpm', 'yarn', 'python', 'python3', 'py', 'pytest', 'tsc', 'eslint', 'prettier', 'make'];
const WRITE = ['mkdir', 'md', 'cp', 'copy', 'mv', 'move', 'ren', 'rename', 'touch', 'new-item', 'ni', 'set-content', 'add-content', 'out-file', 'tee', 'copy-item', 'move-item'];
const DELETE = ['rm', 'del', 'erase', 'rmdir', 'rd', 'remove-item', 'ri'];
const CD = ['cd', 'chdir', 'set-location', 'sl'];
const SUBCOMMANDS = {
  git: ['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'blame', 'add', 'commit', 'stash', 'init'],
  npm: ['run', 'run-script', 'test', 't', 'ci', 'install', 'i', 'start', 'ls', 'list'],
  cargo: ['build', 'test', 'check', 'fmt', 'clippy', 'run'],
  go: ['build', 'test', 'vet', 'fmt', 'run'],
  dotnet: ['build', 'test'],
};
const GIT_GLOBAL_OPTIONS = /^git((?:\s+(?:-[cC]\s+\S+|--[\w-]+=\S+|--no-pager|--paginate|-p))*)/;

const inside = (folder, target) => {
  const relative = path.relative(folder, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

// Quote-aware, so `git commit -m "a; b"` stays one command.
function splitOutside(text, separators) {
  const parts = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else {
      const sep = separators.find(s => text.startsWith(s, i));
      if (sep) {
        parts.push(current);
        current = '';
        i += sep.length - 1;
        continue;
      }
    }
    current += ch;
  }
  return [...parts, current].map(p => p.trim()).filter(Boolean);
}

const tokensOf = command => (command.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(t => t.replace(/^(["'])(.*)\1$/, '$2'));
const isFlag = token => /^-/.test(token) || /^\/[a-z?]$/i.test(token);

// `cwd` changes with `cd`, so the folder check follows the commands in order.
function classifyPart(part, folder, state, isIgnored) {
  const redirects = [...part.matchAll(/(?:^|\s)\d?>>?\s*("[^"]+"|'[^']+'|[^\s&|]+)/g)].map(m => m[1].replace(/^["']|["']$/g, ''));
  for (const target of redirects) {
    if (/^(nul|\$null|\/dev\/null)$/i.test(target)) continue;
    if (!inside(folder, path.resolve(state.cwd, target))) return { allow: false, reason: 'writes outside the task folder' };
  }
  const withoutRedirects = part.replace(/(?:^|\s)\d?>>?\s*("[^"]+"|'[^']+'|[^\s&|]+)/g, ' ').trim();
  const command = withoutRedirects.replace(/^(\w+=\S*\s+)+/, '').replace(GIT_GLOBAL_OPTIONS, 'git').replace(/\s+/g, ' ');
  const lower = command.toLowerCase();
  const hit = BLOCK.find(([pattern]) => pattern.test(lower));
  if (hit) return { allow: false, reason: hit[1] };

  const [first, ...args] = tokensOf(command);
  if (!first) return { allow: true };
  const ownPath = /[\\/]/.test(first);
  if (ownPath && !inside(folder, path.resolve(state.cwd, first))) return { allow: false, reason: 'unrecognised command' };
  const name = path.basename(first).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
  const paths = args.filter(a => !isFlag(a));
  const outside = paths.find(p => /^[~$%]/.test(p) || !inside(folder, path.resolve(state.cwd, p)));

  if (CD.includes(name)) {
    if (paths[0] && outside === paths[0]) return { allow: false, reason: 'moving outside the task folder' };
    state.cwd = paths[0] ? path.resolve(state.cwd, paths[0]) : state.cwd;
    return { allow: true };
  }
  if (DELETE.includes(name)) {
    if (outside) return { allow: false, reason: 'deleting outside the task folder' };
    const protectedPath = paths.find(p => /(^|[\\/])(node_modules|\.git)$/i.test(p) || isIgnored(path.resolve(state.cwd, p)));
    return protectedPath ? { allow: false, reason: 'deleting node_modules, .git or ignored files, which undo does not cover' } : { allow: true };
  }
  if (WRITE.includes(name)) return outside ? { allow: false, reason: 'writes outside the task folder' } : { allow: true };
  if (['pip', 'pip3'].includes(name) || (name.startsWith('python') && args[0] === '-m' && args[1] === 'pip')) {
    const venv = /(^|[\\/])\.?venv[\\/]/i.test(first);
    return !/\binstall\b/.test(command) || venv || /\s--user\b/.test(command)
      ? { allow: true } : { allow: false, reason: 'pip install outside a virtual environment' };
  }
  if (SUBCOMMANDS[name]) {
    const sub = args.find(a => !isFlag(a));
    const switching = name === 'git' && (/^git (switch|checkout) (-c|--create|-b)\b/.test(lower));
    return SUBCOMMANDS[name].includes(sub) || switching ? { allow: true } : { allow: false, reason: 'unrecognised command' };
  }
  if (READ_ONLY.includes(name) || BUILD.includes(name)) return { allow: true };
  return { allow: false, reason: 'unrecognised command' };
}

function classifyShell(command, folder, cwd, isIgnored) {
  const state = { cwd };
  const inner = [...command.matchAll(/\$\(([^()]*)\)/g)].map(m => m[1]);
  const parts = [...splitOutside(command, ['&&', '||', ';', '|', '\n']), ...inner.flatMap(c => splitOutside(c, ['&&', '||', ';', '|', '\n']))];
  for (const part of parts) {
    const verdict = classifyPart(part, folder, state, isIgnored);
    if (!verdict.allow) return verdict;
  }
  return { allow: true };
}

// A file the folder's own repository ignores. Outside a repository nothing is ignored.
function gitIgnored(target) {
  const result = childProcess.spawnSync('git', ['check-ignore', '-q', '--', target], { cwd: path.dirname(target), windowsHide: true });
  return result.status === 0;
}

function classify(toolName, input, folder, { cwd = folder, isIgnored = () => false } = {}) {
  if (READ_TOOLS.includes(toolName) || toolName.startsWith('mcp__ultron-hub__')) return { allow: true };
  if (FILE_TOOLS.includes(toolName)) {
    const target = input.file_path || input.notebook_path || input.path;
    return !target || inside(folder, path.resolve(cwd, target)) ? { allow: true } : { allow: false, reason: 'writes outside the task folder' };
  }
  if (toolName.startsWith('mcp__')) return { allow: false, reason: 'external tool' };
  if (SHELL_TOOLS.includes(toolName)) return classifyShell(input.command || '', folder, cwd, isIgnored);
  return { allow: false, reason: 'unknown tool' };
}

function main() {
  const decide = verdict => {
    if (verdict.allow) return;
    const reason = `Not reversible: ${verdict.reason}. Use the ultron-hub ask_up tool to ask for approval.`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  };
  let raw = '';
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => {
    let verdict;
    let event = {};
    try {
      event = JSON.parse(raw);
      const folder = path.resolve(process.env.ULTRON_FOLDER || event.cwd);
      verdict = classify(event.tool_name, event.tool_input || {}, folder, { cwd: path.resolve(event.cwd || folder), isIgnored: gitIgnored });
    } catch (err) {
      verdict = { allow: false, reason: `the guard failed (${err.message})` };
    }
    decide(verdict);
    if (!verdict.allow && process.env.ULTRON_TASK) {
      require('./tasks').logEvent(process.env.ULTRON_TASK, { type: 'guard.blocked', agent: process.env.ULTRON_AGENT, tool: event.tool_name, reason: verdict.reason });
    }
  });
}

if (require.main === module) main();

module.exports = { classify, FILE_TOOLS };
