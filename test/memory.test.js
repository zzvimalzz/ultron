'use strict';
const test = require('node:test');
const assert = require('node:assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-memory-'));
Object.assign(process.env, { HOME: TEMP, USERPROFILE: TEMP, LOCALAPPDATA: path.join(TEMP, 'Local'), APPDATA: path.join(TEMP, 'Roaming') });

const memory = require('../src/hub/memory');
const { parseOperations } = require('../src/main/curator');
const { condense } = require('../src/main/usage/transcript');
const { setContextHook, setMemoryBlock } = require('../src/main/agents');

const dir = name => fs.mkdtempSync(path.join(TEMP, `${name}-`));
const newVault = () => { const vault = dir('vault'); memory.ensureVault(vault); return vault; };
const read = (vault, file) => fs.readFileSync(path.join(vault, file), 'utf8');
const exists = (vault, file) => fs.existsSync(path.join(vault, file));
const today = new Date().toLocaleDateString('sv-SE');
const SKELETON_FILES = ['START_HERE.md', 'MEMORY.md', 'INDEX.md', 'PROTOCOL.md', 'AGENTS.md', 'CLAUDE.md', 'profile/identity.md', 'profile/goals.md', 'areas/_index.md',
  'projects/_index.md', 'projects/_template/state.md', 'sessions/README.md', 'inbox/README.md', 'archive/README.md'];

test('ensureVault fills an empty folder with the skeleton and its own path', () => {
  const vault = dir('empty');
  assert.strictEqual(memory.ensureVault(vault), true);
  for (const file of SKELETON_FILES) assert.ok(exists(vault, file), file);
  assert.match(read(vault, 'AGENTS.md'), new RegExp(vault.replace(/\\/g, '\\\\').replace(/[.*+?^${}()|[\]]/g, '\\$&')));
  assert.match(read(vault, 'MEMORY.md'), new RegExp(`Last reviewed: ${today}`));
  assert.ok(!read(vault, 'AGENTS.md').includes('{{'));
});

test('ensureVault leaves an existing vault untouched and moves v1.3 notes into the inbox', () => {
  const existing = dir('existing');
  fs.writeFileSync(path.join(existing, 'MEMORY.md'), '# Mine\n');
  fs.writeFileSync(path.join(existing, 'note.md'), 'keep me');
  assert.strictEqual(memory.ensureVault(existing), false);
  assert.deepStrictEqual(fs.readdirSync(existing).sort(), ['MEMORY.md', 'note.md']);
  assert.strictEqual(read(existing, 'MEMORY.md'), '# Mine\n');

  const legacy = dir('legacy');
  fs.writeFileSync(path.join(legacy, 'release-process.md'), '# Release process\n');
  memory.ensureVault(legacy);
  assert.ok(exists(legacy, 'inbox/v1.3-notes/release-process.md'));
  assert.ok(!exists(legacy, 'release-process.md'));
});

test('remember writes each kind to its own place and keeps the indexes current', () => {
  const vault = newVault();
  const cwd = path.join(TEMP, 'work', 'demo');
  const who = 'Claude 1 (claude)';

  assert.strictEqual(memory.remember(vault, { kind: 'fact', text: 'Likes tea' }, who), `inbox/${today}.md`);
  assert.match(read(vault, `inbox/${today}.md`), /- Likes tea \(unconfirmed; Source: Claude 1 \(claude\); Recorded: \d{4}-\d{2}-\d{2}\)/);

  memory.remember(vault, { kind: 'profile', topic: 'preferences', text: 'Short answers' }, who);
  assert.match(read(vault, 'profile/preferences.md'), /## To confirm\n\n- Short answers \(unconfirmed;/);
  assert.throws(() => memory.remember(vault, { kind: 'profile', topic: 'secrets', text: 'x' }, who), /topic must be one of/);

  memory.remember(vault, { kind: 'area', title: 'Home network', text: 'Router is upstairs.' }, who);
  memory.remember(vault, { kind: 'area', title: 'Home network', text: 'Switch is in the hall.' }, who);
  assert.match(read(vault, 'areas/home-network.md'), /Router is upstairs\.\n\nSwitch is in the hall\./);
  assert.match(read(vault, 'areas/_index.md'), /\[Home network\]\(home-network\.md\)/);
  assert.match(read(vault, 'INDEX.md'), /areas\/home-network\.md/);

  memory.remember(vault, { kind: 'project-state', text: 'First state', cwd }, who);
  memory.remember(vault, { kind: 'project-state', text: 'Second state', cwd }, who);
  assert.match(read(vault, 'projects/demo/state.md'), /Second state/);
  assert.ok(fs.readdirSync(path.join(vault, 'archive', String(new Date().getFullYear()), 'projects', 'demo')).some(f => /^state-/.test(f)));
  assert.match(read(vault, 'projects/_index.md'), /\| demo \| active \| `.*demo` \|/);
  assert.ok(exists(vault, 'projects/demo/overview.md'));

  memory.remember(vault, { kind: 'decision', title: 'Use plain files', text: 'Simple to review.', cwd }, who);
  assert.match(read(vault, 'projects/demo/decisions.md'), new RegExp(`## ${today} — Use plain files\\n\\nSimple to review\\.\\n\\n- Source: Claude 1 \\(claude\\)`));

  memory.remember(vault, { kind: 'session', title: 'Wrote tests', text: '- App: Claude Code\n- Outcome: done' }, who);
  assert.match(read(vault, `sessions/${today}.md`), /## \d{2}:\d{2} — Wrote tests\n\n- App: Claude Code/);

  memory.remember(vault, { kind: 'inbox', text: 'Check the router firmware' }, who);
  assert.match(read(vault, `inbox/${today}.md`), /- Check the router firmware \(Source: Claude 1 \(claude\)\)/);

  assert.throws(() => memory.remember(vault, { kind: 'nonsense', text: 'x' }, who), /kind must be one of/);
});

test('remember refuses text that looks like a secret', () => {
  assert.strictEqual(memory.scanSecrets('An ordinary sentence.'), null);
  const vault = newVault();
  const secrets = ['sk-abcdefghijklmnopqrstuvwxyz', 'token ghp_123456', 'AKIAABCDEFGHIJKLMNOP', 'password: hunter2', 'card 4111111111111111',
    '-----BEGIN RSA PRIVATE KEY-----', 'eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl'];
  for (const text of secrets) assert.throws(() => memory.remember(vault, { kind: 'fact', text }, 'x'), /Refused: looks like a secret/, text);
  assert.ok(!exists(vault, `inbox/${today}.md`));
  assert.throws(() => memory.remember(vault, { kind: 'area', title: 'password=abc', text: 'x' }, 'x'), /Refused/);
});

test('projectFor finds a project by its indexed folder, its git remote or its folder name', () => {
  const vault = newVault();
  const place = dir('place');
  const named = path.join(place, 'billing');
  const remoteRepo = path.join(place, 'unrelated-name');
  fs.mkdirSync(path.join(named, 'src'), { recursive: true });
  fs.mkdirSync(remoteRepo);

  memory.remember(vault, { kind: 'project-state', text: 'x', project: 'Indexed', cwd: named }, 'x');
  assert.strictEqual(memory.projectFor(vault, path.join(named, 'src')).slug, 'indexed');
  assert.strictEqual(memory.projectFor(vault, named.toUpperCase()).slug, 'indexed');

  childProcess.execFileSync('git', ['init', '-q'], { cwd: remoteRepo });
  childProcess.execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/team/shop.git'], { cwd: remoteRepo });
  fs.mkdirSync(path.join(vault, 'projects', 'shop'));
  fs.writeFileSync(path.join(vault, 'projects', 'shop', 'overview.md'), '# Shop\n\n- Remote: https://example.com/team/shop.git\n');
  assert.strictEqual(memory.projectFor(vault, remoteRepo).slug, 'shop');

  fs.mkdirSync(path.join(vault, 'projects', 'lonely'));
  fs.writeFileSync(path.join(vault, 'projects', 'lonely', 'overview.md'), '# Lonely\n');
  const byName = path.join(place, 'Lonely');
  fs.mkdirSync(byName);
  assert.strictEqual(memory.projectFor(vault, byName).slug, 'lonely');
  assert.strictEqual(memory.projectFor(vault, path.join(place, 'nothing-here')), null);
});

test('update and forget archive the old version and refuse paths outside the vault', () => {
  const vault = newVault();
  memory.remember(vault, { kind: 'area', title: 'Garden', text: 'Old text.' }, 'x');
  memory.update(vault, 'areas/garden.md', '# Garden\n\nNew text.\n', 'x');
  assert.match(read(vault, 'areas/garden.md'), /New text/);
  const year = String(new Date().getFullYear());
  const archived = fs.readdirSync(path.join(vault, 'archive', year, 'areas'));
  assert.ok(archived.some(f => /^garden-\d{4}-\d{2}-\d{2}\.md$/.test(f)));
  assert.match(fs.readFileSync(path.join(vault, 'archive', year, 'areas', archived[0]), 'utf8'), /Old text/);

  memory.forget(vault, 'areas/garden.md');
  assert.ok(!exists(vault, 'areas/garden.md'));
  assert.strictEqual(fs.readdirSync(path.join(vault, 'archive', year, 'areas')).length, 2);

  assert.throws(() => memory.update(vault, '../outside.md', 'x', 'x'), /outside the vault/);
  assert.throws(() => memory.forget(vault, '..\\..\\outside.md'), /outside the vault/);
  assert.throws(() => memory.update(vault, `archive/${year}/areas/${archived[0]}`, 'x', 'x'), /read-only/);
  assert.throws(() => memory.forget(vault, 'MEMORY.md'), /can't be archived/);
  assert.throws(() => memory.update(vault, 'areas/missing.md', 'x', 'x'), /No such file/);
});

test('pending lists what waits for the user, and confirm, reject, keep and drop move it', () => {
  const vault = newVault();
  memory.remember(vault, { kind: 'profile', topic: 'goals', text: 'Ship the app' }, 'A');
  memory.remember(vault, { kind: 'profile', topic: 'goals', text: 'Learn piano' }, 'A');
  memory.remember(vault, { kind: 'fact', text: 'Prefers tabs' }, 'B');
  memory.remember(vault, { kind: 'fact', text: 'Uses a laptop' }, 'B');

  let { toConfirm, inbox } = memory.pending(vault);
  assert.strictEqual(toConfirm.length, 2);
  assert.strictEqual(inbox.length, 2);

  memory.confirm(vault, toConfirm[0]);
  assert.match(read(vault, 'profile/goals.md'), /## Confirmed\n\n- Ship the app \(Source: A; Recorded: [\d-]+; Confirmed: [\d-]+\)/);
  memory.reject(vault, toConfirm[1]);
  assert.match(read(vault, `archive/${new Date().getFullYear()}/rejected.md`), /Learn piano/);
  assert.strictEqual(memory.pending(vault).toConfirm.length, 0);

  memory.keep(vault, inbox[0], 'Communication preferences');
  assert.match(read(vault, 'MEMORY.md'), /## Communication preferences\n\n- Prefers tabs/);
  memory.drop(vault, inbox[1]);
  assert.match(read(vault, `archive/${new Date().getFullYear()}/inbox.md`), /Uses a laptop/);
  assert.deepStrictEqual(memory.pending(vault), { toConfirm: [], inbox: [] });
  assert.throws(() => memory.keep(vault, inbox[0], 'Anywhere'), /section must be one of/);
});

test('context keeps MEMORY.md whole and cuts the project files to fit', () => {
  const vault = newVault();
  const cwd = path.join(TEMP, 'big-project');
  fs.writeFileSync(path.join(vault, 'MEMORY.md'), `# Durable Memory\n\n## About me\n\n${'a'.repeat(3000)}\n`);
  memory.remember(vault, { kind: 'project-state', text: 'S'.repeat(30000), cwd }, 'x');
  const text = memory.context(vault, cwd);
  assert.ok(text.length <= 12000);
  assert.ok(text.includes('a'.repeat(3000)));
  assert.match(text, /# Project: big-project/);
  assert.ok(!memory.context(vault, path.join(TEMP, 'elsewhere')).includes('# Project:'));
});

test('recall ranks the current project first and the archive last', () => {
  const vault = newVault();
  const cwd = path.join(TEMP, 'ranked');
  memory.remember(vault, { kind: 'project-state', text: 'wiring notes', cwd }, 'x');
  memory.remember(vault, { kind: 'area', title: 'Plumbing', text: 'wiring notes' }, 'x');
  const files = memory.recall(vault, 'wiring', cwd).map(h => h.file);
  assert.strictEqual(files[0], 'projects/ranked/state.md');
  assert.ok(files.includes('areas/plumbing.md'));
  assert.strictEqual(memory.recall(vault, '', cwd).length > 0, true);
});

test('condense keeps what was said in a Claude or Codex transcript and drops tool output', async () => {
  const claude = path.join(dir('t'), 'a.jsonl');
  fs.writeFileSync(claude, [
    { type: 'user', message: { role: 'user', content: 'Please add a button' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Adding it now' }, { type: 'tool_use', name: 'Edit', input: { secret: 'tool-input' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'tool-output' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
    { type: 'user', message: { role: 'user', content: 'Thanks' } },
  ].map(l => JSON.stringify(l)).join('\n'));
  const fromClaude = await condense(claude, 'claude');
  assert.strictEqual(fromClaude.turns, 2);
  assert.strictEqual(fromClaude.text, 'User: Please add a button\n\nAssistant: Adding it now\n\nAssistant: Done\n\nUser: Thanks');

  const codex = path.join(dir('t'), 'r.jsonl');
  fs.writeFileSync(codex, [
    { type: 'session_meta', payload: { id: 's1' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the bug' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed' }] } },
  ].map(l => JSON.stringify(l)).join('\n'));
  const fromCodex = await condense(codex, 'chatgpt');
  assert.strictEqual(fromCodex.turns, 1);
  assert.strictEqual(fromCodex.text, 'User: Fix the bug\n\nAssistant: Fixed');
});

test('the curator reads a fenced JSON block and ignores anything malformed', () => {
  const good = [{ op: 'remember', kind: 'session', title: 'T', text: 'x' }, { op: 'update', file: 'MEMORY.md', text: 'y' }, { op: 'forget', file: 'areas/a.md' }];
  assert.deepStrictEqual(parseOperations(`Here you go:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\`\nDone.`), good);
  assert.deepStrictEqual(parseOperations(JSON.stringify(good)), good);
  assert.deepStrictEqual(parseOperations('not json at all'), []);
  assert.deepStrictEqual(parseOperations('```json\n{"op":"forget"}\n```'), []);
  assert.deepStrictEqual(parseOperations(JSON.stringify([{ op: 'delete', file: 'x' }, { op: 'update', file: 'x' }, null, good[2]])), [good[2]]);
});

test('the memory block is inserted, replaced and removed without touching the user\'s text', () => {
  const home = dir('claude-home');
  const vault = path.join(TEMP, 'vault-one');
  const file = path.join(home, 'CLAUDE.md');
  fs.writeFileSync(file, '# My rules\n\nBe brief.\n');

  setMemoryBlock(home, 'claude', vault);
  const inserted = fs.readFileSync(file, 'utf8');
  assert.match(inserted, /^# My rules\n\nBe brief\.\n\n<!-- Ultron memory -->\n## Memory\n/);
  assert.ok(inserted.includes(`\`${vault}\``));

  setMemoryBlock(home, 'claude', path.join(TEMP, 'vault-two'));
  const replaced = fs.readFileSync(file, 'utf8');
  assert.strictEqual(replaced.match(/<!-- Ultron memory -->/g).length, 1);
  assert.ok(replaced.includes('vault-two') && !replaced.includes('vault-one'));
  assert.ok(replaced.startsWith('# My rules\n\nBe brief.\n'));

  setMemoryBlock(home, 'claude', null);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '# My rules\n\nBe brief.\n');

  const created = dir('codex-home');
  setMemoryBlock(created, 'chatgpt', vault);
  assert.ok(fs.existsSync(path.join(created, 'AGENTS.md')));
  setMemoryBlock(created, 'chatgpt', null);
  assert.ok(!fs.existsSync(path.join(created, 'AGENTS.md')));

  const own = dir('own-home');
  fs.writeFileSync(path.join(own, 'CLAUDE.md'), `Vault lives at ${vault}\n`);
  setMemoryBlock(own, 'claude', vault);
  assert.strictEqual(fs.readFileSync(path.join(own, 'CLAUDE.md'), 'utf8'), `Vault lives at ${vault}\n`);
});

test('the SessionStart hook is merged beside other hooks and removed alone', () => {
  const home = dir('hook-home');
  const file = path.join(home, 'settings.json');
  const mine = { hooks: [{ type: 'command', command: 'echo mine' }] };
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark', hooks: { SessionStart: [mine], Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] } }));

  setContextHook(home, true);
  setContextHook(home, true);
  let settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(settings.theme, 'dark');
  assert.strictEqual(settings.hooks.SessionStart.length, 2);
  assert.deepStrictEqual(settings.hooks.SessionStart[0], mine);
  assert.match(settings.hooks.SessionStart[1].hooks[0].command, /ultron-node\.cmd" ".*context-hook\.js"$/);
  assert.strictEqual(settings.hooks.Stop.length, 1);

  setContextHook(home, false);
  settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(settings.hooks.SessionStart, [mine]);

  const fresh = dir('fresh-home');
  setContextHook(fresh, true);
  setContextHook(fresh, false);
  assert.ok(!fs.existsSync(path.join(fresh, 'settings.json')));
});
