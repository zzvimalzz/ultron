'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeJson } = require('../hub/files');

const NAME = 'ultron-hub';
// The server runs outside Electron (Node mode), which can't read inside app.asar.
const SERVER = path.join(__dirname, '..', 'hub', 'server.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const SKILLS = path.join(__dirname, '..', 'hub', 'skills');
const MARKER = '<!-- Installed by Ultron -->';
const DEFAULT_HOMES = { claude: path.join(os.homedir(), '.claude'), chatgpt: path.join(os.homedir(), '.codex') };

const serverEntry = provider => ({ command: process.execPath, args: [SERVER], env: { ELECTRON_RUN_AS_NODE: '1', ULTRON_PROVIDER: provider } });

function agentHomes(accounts) {
  const key = home => path.resolve(home).toLowerCase();
  const homes = new Map(Object.entries(DEFAULT_HOMES).map(([provider, home]) => [key(home), { provider, home }]));
  for (const a of accounts.filter(x => x.cliHome && !homes.has(key(x.cliHome)))) homes.set(key(a.cliHome), { provider: a.provider, home: a.cliHome });
  return [...homes.values()].filter(h => fs.existsSync(h.home));
}

// Claude Code keeps user-level MCP servers in ~/.claude.json, or inside CLAUDE_CONFIG_DIR when set.
function setClaudeServer(home, entry) {
  const file = home === DEFAULT_HOMES.claude ? path.join(os.homedir(), '.claude.json') : path.join(home, '.claude.json');
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
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

function connectAgents(accounts, connected) {
  return agentHomes(accounts).map(({ provider, home }) => {
    SET_SERVER[provider](home, connected ? serverEntry(provider) : null);
    syncSkills(home, connected);
    return home;
  });
}

module.exports = { connectAgents, withoutHubTables };
