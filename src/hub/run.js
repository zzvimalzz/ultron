'use strict';
// Owns one headless run: node run.js <taskId> <runId>. It is detached from whoever started it, so a run
// survives the app closing, and it records everything the CLI does in the task folder.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { CLIS, cliEnv, headlessArgs, parseStream, spawnCli, which } = require('./cli');
const { CREW_FILE, readJson, unpacked, writeJson } = require('./files');
const { crewLine, rolePrompt } = require('./prompts');
const tasks = require('./tasks');

const SERVER = unpacked(path.join(__dirname, 'server.js'));
const GUARD = unpacked(path.join(__dirname, 'guard.js'));
const STDERR_TAIL = 2000;

function contextOf(taskId, agent, crew) {
  const agents = tasks.agentsOf(taskId);
  const team = tasks.teamsOf(taskId).find(t => t.id === agent.team);
  const describe = a => a && { id: a.id, title: a.title, account: crew.agents.find(x => x.id === a.account)?.name || a.account };
  return {
    role: agent.role, title: agent.title, folder: tasks.readTask(taskId).folder, vault: crew.memoryDir, parent: describe(agents.find(a => a.id === agent.parent)),
    team: team?.name, purpose: team?.purpose, members: (team?.members || []).map(id => describe(agents.find(a => a.id === id))),
    crewLines: crew.agents.filter(a => a.eligible).map(a => crewLine(a)).join('\n'),
  };
}

// Hooks run outside Ultron's process, so the guard gets its own launcher in the run folder.
function writeRunFiles(dir, provider, context, env) {
  const server = { command: process.execPath, args: [SERVER], env: { ELECTRON_RUN_AS_NODE: '1', ULTRON_PROVIDER: provider, ...env } };
  const launcher = path.join(dir, 'node.cmd');
  fs.writeFileSync(launcher, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" %*\r\n`);
  const files = { mcpFile: path.join(dir, 'mcp.json'), settingsFile: path.join(dir, 'settings.json'), systemFile: path.join(dir, 'system.md'), server };
  writeJson(files.mcpFile, { mcpServers: { 'ultron-hub': { type: 'stdio', ...server } } });
  writeJson(files.settingsFile, { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `"${launcher}" "${GUARD}"` }] }] } });
  fs.writeFileSync(files.systemFile, rolePrompt(context));
  return files;
}

const relativeTo = (folder, file) => (path.isAbsolute(file) && !path.relative(folder, file).startsWith('..') ? path.relative(folder, file) : file);

function main([taskId, runId]) {
  const run = tasks.readRun(taskId, runId);
  const agent = tasks.agentsOf(taskId).find(a => a.id === run.agent);
  const crew = readJson(CREW_FILE, { agents: [] });
  const crewAgent = crew.agents.find(a => a.id === run.account);
  const account = { ...crewAgent, cliHome: crewAgent.home };
  const folder = tasks.readTask(taskId).folder;
  const dir = path.join(tasks.dirOf(taskId), 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });

  const env = { ULTRON_TASK: taskId, ULTRON_RUN: runId, ULTRON_AGENT: agent.id, ULTRON_ROLE: agent.role, ULTRON_FOLDER: folder };
  const context = contextOf(taskId, agent, crew);
  const files = writeRunFiles(dir, account.provider, context, env);
  const resume = Boolean(agent.sessionId);
  let sessionId = agent.sessionId || (account.provider === 'claude' ? crypto.randomUUID() : null);
  if (sessionId !== agent.sessionId) tasks.updateAgent(taskId, agent.id, { sessionId });

  const outcome = { result: '', error: '', files: new Set() };
  const finish = (exitCode, fallback) => {
    const status = exitCode === 0 && !outcome.error ? 'done' : 'failed';
    const result = status === 'done' ? outcome.result : outcome.error || fallback || `The CLI exited with code ${exitCode}.`;
    tasks.finishRunRecord(taskId, runId, { status, result, files: [...outcome.files], exitCode });
    tasks.logEvent(taskId, { type: 'run.finished', agent: agent.id, run: runId, status });
    tasks.closeIfLeader(taskId, agent.id, status, result);
    process.exit(0);
  };

  // Tests start a stub that prints recorded stream lines instead of a real CLI.
  const stub = process.env.ULTRON_STUB_CLI;
  const exe = stub ? process.execPath : which(CLIS[account.provider].command);
  if (!exe) return finish(null, `${CLIS[account.provider].command} is not installed.`);
  const args = stub ? [stub] : headlessArgs(account, { sessionId, resume, ...files });
  const prompt = account.provider === 'chatgpt' ? `${fs.readFileSync(files.systemFile, 'utf8')}\n\n---\n\n${run.prompt}` : run.prompt;
  const child = spawnCli(exe, args, { cwd: folder, env: cliEnv(account, { ...process.env, ...env }), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-STDERR_TAIL); });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  const log = path.join(tasks.dirOf(taskId), 'runs', `${runId}.log`);
  readline.createInterface({ input: child.stdout }).on('line', line => {
    fs.appendFileSync(log, `${line}\n`);
    for (const item of parseStream(account.provider, line)) {
      if (item.sessionId && item.sessionId !== sessionId) {
        sessionId = item.sessionId;
        tasks.updateAgent(taskId, agent.id, { sessionId });
      }
      if (item.file) outcome.files.add(relativeTo(folder, item.file));
      if (item.result !== undefined) outcome.result = item.result;
      if (item.error) outcome.error = item.error;
    }
  });
  child.once('error', err => finish(null, err.message));
  child.once('close', code => finish(code, stderr.trim()));
}

main(process.argv.slice(2));
