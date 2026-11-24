'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HUB_DIR, writeJson } = require('../hub/files');
const { CLIS } = require('../hub/cli');
const { resolveDataDir } = require('./profiles');

const NAME = 'ultron-hub';
// The server runs outside Electron (Node mode), which can't read inside app.asar.
const unpacked = file => file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const SERVER = unpacked(path.join(__dirname, '..', 'hub', 'server.js'));
const CONTEXT_HOOK = unpacked(path.join(__dirname, '..', 'hub', 'context-hook.js'));
const SKILLS = path.join(__dirname, '..', 'hub', 'skills');
const MARKER = '<!-- Installed by Ultron -->';
const NODE_LAUNCHER = path.join(HUB_DIR, 'bin', 'ultron-node.cmd');
const BLOCK = /\n?<!-- Ultron memory -->[\s\S]*?<!-- \/Ultron memory -->\r?\n?/;

const serverEntry = provider => ({ command: process.execPath, args: [SERVER], env: { ELECTRON_RUN_AS_NODE: '1', ULTRON_PROVIDER: provider } });

function agentHomes(accounts) {
  const key = home => path.resolve(home).toLowerCase();
  const homes = new Map(Object.entries(CLIS).map(([provider, cli]) => [key(cli.defaultHome), { provider, home: cli.defaultHome }]));
  for (const a of accounts.filter(x => x.cliHome && !homes.has(key(x.cliHome)))) homes.set(key(a.cliHome), { provider: a.provider, home: a.cliHome });
  return [...homes.values()].filter(h => fs.existsSync(h.home));
}

const readJsonFile = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});

// Claude Code keeps user-level MCP servers in ~/.claude.json, or inside CLAUDE_CONFIG_DIR when set.
function setClaudeServer(home, entry) {
  const file = home === CLIS.claude.defaultHome ? path.join(os.homedir(), '.claude.json') : path.join(home, '.claude.json');
  const cfg = readJsonFile(file);
  const servers = { ...cfg.mcpServers };
  if (entry) servers[NAME] = { type: 'stdio', ...entry };
  else delete servers[NAME];
  if (JSON.stringify(servers) === JSON.stringify(cfg.mcpServers || {})) return;
  writeJson(file, { ...cfg, mcpServers: servers });
}

// Drops the hub's tables by header, so it still works after Codex reformats the file.
function withoutHubTables(toml) {
  let skipping = false;
  return toml.split(/\r?\n/).filter(line => {
    if (/^\s*\[/.test(line)) skipping = /^\s*\[mcp_servers\.ultron-hub[.\]]/.test(line);
    return !skipping;
  }).join('\n');
}

// TOML literal strings ('...') take Windows paths without escaping.
function hubTables(entry) {
  return [`[mcp_servers.${NAME}]`, `command = '${entry.command}'`, `args = ['${entry.args[0]}']`, '',
    `[mcp_servers.${NAME}.env]`, ...Object.entries(entry.env).map(([k, v]) => `${k} = '${v}'`)].join('\n');
}

function setCodexServer(home, entry) {
  const file = path.join(home, 'config.toml');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const rest = withoutHubTables(before);
  if (!entry && rest === before) return;
  const trimmed = rest.trimEnd();
  const next = entry ? `${trimmed}${trimmed ? '\n\n' : ''}${hubTables(entry)}\n` : `${trimmed}\n`;
  if (next !== before) fs.writeFileSync(file, next);
}

const SET_SERVER = { claude: setClaudeServer, chatgpt: setCodexServer };

// Skills of the same name that the user wrote (no marker) are left alone.
function syncSkills(home, install) {
  for (const name of fs.readdirSync(SKILLS)) {
    const target = path.join(home, 'skills', name, 'SKILL.md');
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current !== null && !current.includes(MARKER)) continue;
    if (install) {
      const skill = fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
      if (skill === current) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, skill);
    } else if (current !== null) {
      fs.rmSync(target);
      try { fs.rmdirSync(path.dirname(target)); } catch { /* the user added files */ }
    }
  }
}

// Hooks and runs start Ultron's own executable in Node mode, so Node isn't needed on the machine. The path changes with updates.
function writeNodeLauncher() {
  fs.mkdirSync(path.dirname(NODE_LAUNCHER), { recursive: true });
  fs.writeFileSync(NODE_LAUNCHER, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" %*\r\n`);
}

const memoryBlock = vault => `<!-- Ultron memory -->\n## Memory\nThis device's memory vault is \`${vault}\`. At the start of every task read \`MEMORY.md\`, \`INDEX.md\` and only the relevant linked files (or call the ultron-hub \`context\` tool). Before finishing substantive work, follow \`PROTOCOL.md\`: record outcomes, decisions and open loops.\n<!-- /Ultron memory -->\n`;

// The block is replaced between its markers. A file the user wrote that already names the vault is left alone.
function setMemoryBlock(home, provider, vault) {
  const file = path.join(home, CLIS[provider].instructions);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const outside = before.replace(BLOCK, '');
  if (vault && outside.toLowerCase().includes(vault.toLowerCase())) return;
  if (!vault) {
    if (outside === before) return;
    if (outside.trim()) fs.writeFileSync(file, outside); else fs.rmSync(file);
    return;
  }
  const block = memoryBlock(vault);
  const gap = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const next = BLOCK.test(before) ? before.replace(BLOCK, found => `${found.startsWith('\n') ? '\n' : ''}${block}`) : `${before}${gap}${block}`;
  if (next !== before) fs.writeFileSync(file, next);
}

const isOurHook = group => (group.hooks || []).some(h => (h.command || '').includes('context-hook.js'));

// Claude Code runs this at every session start and adds its output as context. Other hooks stay as they are.
function setContextHook(home, install) {
  const file = path.join(home, 'settings.json');
  const settings = readJsonFile(file);
  const others = (settings.hooks?.SessionStart || []).filter(group => !isOurHook(group));
  const groups = install ? [...others, { hooks: [{ type: 'command', command: `"${NODE_LAUNCHER}" "${CONTEXT_HOOK}"` }] }] : others;
  if (JSON.stringify(groups) === JSON.stringify(settings.hooks?.SessionStart || [])) return;
  const hooks = { ...settings.hooks, SessionStart: groups };
  if (!groups.length) delete hooks.SessionStart;
  const next = { ...settings, hooks };
  if (!Object.keys(hooks).length) delete next.hooks;
  if (Object.keys(next).length) writeJson(file, next); else fs.rmSync(file);
}

// Claude Desktop's chat loads local MCP servers from claude_desktop_config.json in its profile folder, once the app has created it.
function setDesktopServer(account, entry) {
  if (account.provider !== 'claude' || !account.dataDir) return;
  const file = path.join(resolveDataDir(account.dataDir), 'claude_desktop_config.json');
  if (!fs.existsSync(file)) return;
  const cfg = readJsonFile(file);
  const servers = { ...cfg.mcpServers };
  if (entry) servers[NAME] = entry; else delete servers[NAME];
  if (JSON.stringify(servers) === JSON.stringify(cfg.mcpServers || {})) return;
  writeJson(file, { ...cfg, mcpServers: servers });
}

function connectAgents(accounts, connected, vault) {
  if (connected) writeNodeLauncher(); else fs.rmSync(NODE_LAUNCHER, { force: true });
  for (const account of accounts) setDesktopServer(account, connected ? serverEntry('claude') : null);
  return agentHomes(accounts).map(({ provider, home }) => {
    SET_SERVER[provider](home, connected ? serverEntry(provider) : null);
    setMemoryBlock(home, provider, connected ? vault : null);
    if (provider === 'claude') setContextHook(home, connected);
    syncSkills(home, connected);
    return home;
  });
}

module.exports = { connectAgents, withoutHubTables, setMemoryBlock, setContextHook };
