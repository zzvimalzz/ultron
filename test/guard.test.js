'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { classify } = require('../src/hub/guard');

const folder = path.join(os.tmpdir(), 'ultron-guard-folder');
const elsewhere = path.join(os.tmpdir(), 'ultron-guard-elsewhere');
const ignored = new Set([path.join(folder, 'dist')]);
const options = { isIgnored: p => ignored.has(p) };

const shell = command => ['Bash', { command }];
const ps = command => ['PowerShell', { command }];

const ALLOWED = [
  ['Read', { file_path: path.join(elsewhere, 'a.txt') }],
  ['Grep', { pattern: 'x' }],
  ['WebFetch', { url: 'https://example.com' }],
  ['mcp__ultron-hub__recall', { query: 'x' }],
  ['Write', { file_path: path.join(folder, 'hello.html') }],
  ['Edit', { file_path: 'src/app.js' }],
  ['NotebookEdit', { notebook_path: path.join(folder, 'n.ipynb') }],
  shell('ls -la'),
  shell('cat README.md | grep -n title'),
  shell('git status && git diff'),
  shell('git add -A && git commit -m "add page; tidy"'),
  shell('git -C . log --oneline'),
  shell('git switch -c feature'),
  shell('git stash'),
  shell('git branch feature-x'),
  shell('npm test'),
  shell('npm run build && node dist/index.js'),
  shell('npm install left-pad'),
  shell('npx prettier --write .'),
  shell('node scripts/build.js > build.log 2>&1'),
  shell('python -m pytest -q'),
  shell('.venv/Scripts/pip install requests'),
  shell('pip install --user requests'),
  shell('pip list'),
  shell('./node_modules/.bin/tsc --noEmit'),
  shell('mkdir -p src/lib && cp a.txt src/lib/a.txt'),
  shell('mv old.txt new.txt'),
  shell('rm build.log'),
  shell('rm -rf out'),
  shell('cd src && ls'),
  shell(`echo hi > ${path.join(folder, 'out.txt')}`),
  shell('echo done > /dev/null'),
  shell('cargo test'),
  shell('go build ./...'),
  shell('curl -s https://example.com/data.json'),
  ps('Get-ChildItem -Recurse | Select-String "TODO"'),
  ps('Set-Content -Path notes.md -Value "hello"'),
  ps('New-Item -ItemType Directory -Path assets'),
  ps('Remove-Item -Recurse -Force .\\out'),
  ps('Copy-Item a.txt b.txt'),
  ps('Write-Output "done"'),
];

const BLOCKED = [
  [['Write', { file_path: path.join(elsewhere, 'x.txt') }], /outside the task folder/],
  [['Edit', { file_path: '../x.txt' }], /outside the task folder/],
  [['mcp__github__create_issue', {}], /external tool/],
  [['SomethingNew', {}], /unknown tool/],
  [shell('git push'), /git push/],
  [shell('git push origin main --delete'), /git push/],
  [shell('git -C . push'), /git push/],
  [shell('npm test && git push origin main'), /git push/],
  [shell('git status; git push'), /git push/],
  [shell('ls | git push'), /git push/],
  [shell('git reset --hard HEAD~1'), /git reset --hard/],
  [shell('git clean -fd'), /git clean/],
  [shell('git rebase main'), /git rebase/],
  [shell('git commit --amend -m x'), /--amend/],
  [shell('git filter-branch --all'), /history rewrite/],
  [shell('git branch -D old'), /deleting a branch/],
  [shell('git tag -d v1'), /deleting a tag/],
  [shell('git checkout -- .'), /discarding/],
  [shell('git checkout .'), /discarding/],
  [shell('rm -rf /'), /outside the task folder/],
  [shell(`rm ${path.join(elsewhere, 'a.txt')}`), /outside the task folder/],
  [shell('rm ../other/a.txt'), /outside the task folder/],
  [shell('rm -rf node_modules'), /undo does not cover/],
  [shell('rm -rf .git'), /undo does not cover/],
  [shell('rm -rf dist'), /undo does not cover/],
  [ps('Remove-Item -Recurse -Force C:\\Windows\\Temp\\x'), /outside the task folder/],
  [ps('Remove-Item ~\\notes.txt'), /outside the task folder/],
  [shell('cp a.txt ../b.txt'), /outside the task folder/],
  [shell('echo x > ../leak.txt'), /outside the task folder/],
  [shell('cd .. && ls'), /outside the task folder/],
  [shell('cd src && rm ../../x'), /outside the task folder/],
  [shell('npm publish'), /npm publish/],
  [shell('npm i -g typescript'), /global package install/],
  [shell('npm install --global typescript'), /global package install/],
  [shell('yarn global add x'), /global package install/],
  [shell('winget install Git.Git'), /installing software/],
  [shell('choco install nodejs'), /installing software/],
  [shell('pip install requests'), /virtual environment/],
  [shell('python -m pip install requests'), /virtual environment/],
  [shell('reg add HKCU\\Software\\X'), /registry/],
  [shell('setx PATH x'), /registry or environment/],
  [ps('Set-ItemProperty HKLM:\\Software\\X -Name a -Value 1'), /registry/],
  [shell('shutdown /s'), /shutting down/],
  [shell('curl -X POST https://example.com -d a=1'), /sending data/],
  [shell('curl --data a=1 https://example.com'), /sending data/],
  [ps('Invoke-WebRequest https://example.com -Method POST -Body x'), /sending data/],
  [shell('gh pr create --fill'), /GitHub/],
  [shell('gh release create v1'), /GitHub/],
  [shell('ssh host ls'), /remote access/],
  [shell('scp a.txt host:'), /remote access/],
  [shell('docker push img'), /docker push/],
  [shell('vercel --prod'), /deploying/],
  [shell('wrangler deploy'), /deploying/],
  [ps('Send-MailMessage -To a@b.c'), /email/],
  [shell('format c:'), /disk/],
  [shell('somebinary --flag'), /unrecognised command/],
  [shell('sh -c "ls"'), /unrecognised command/],
  [shell('./script.sh'), /unrecognised command/],
  [shell(`${path.join(elsewhere, 'tool.exe')} run`), /unrecognised command/],
  [shell('git remote add x y'), /unrecognised command/],
  [shell('echo $(whoami)'), /unrecognised command/],
];

test('the guard lets reversible actions through', () => {
  for (const [tool, input] of ALLOWED) {
    const verdict = classify(tool, input, folder, { ...options, cwd: folder });
    assert.ok(verdict.allow, `${tool} ${JSON.stringify(input)} was blocked: ${verdict.reason}`);
  }
});

test('the guard blocks what cannot be undone, with the reason', () => {
  for (const [[tool, input], reason] of BLOCKED) {
    const verdict = classify(tool, input, folder, { ...options, cwd: folder });
    assert.strictEqual(verdict.allow, false, `${tool} ${JSON.stringify(input)} was allowed`);
    assert.match(verdict.reason, reason, `${tool} ${JSON.stringify(input)}`);
  }
});

test('relative paths resolve against the hook cwd', () => {
  const sub = path.join(folder, 'sub');
  assert.ok(classify('Write', { file_path: 'a.txt' }, folder, { cwd: sub }).allow);
  assert.strictEqual(classify('Write', { file_path: '../../a.txt' }, folder, { cwd: sub }).allow, false);
});

test('the hook prints a deny decision and logs the block', () => {
  const fs = require('fs');
  const { spawnSync } = require('child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-guard-'));
  fs.mkdirSync(path.join(home, '.ultron', 'tasks', 't-1'), { recursive: true });
  const env = { ...process.env, USERPROFILE: home, HOME: home, ULTRON_TASK: 't-1', ULTRON_AGENT: 'agent-2', ULTRON_FOLDER: folder };
  const run = input => spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'hub', 'guard.js')], { input: JSON.stringify(input), env, encoding: 'utf8' });

  assert.strictEqual(run({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: folder }).stdout, '');
  const out = JSON.parse(run({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: folder }).stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Not reversible: git push\. Use the ultron-hub ask_up tool/);
  const event = JSON.parse(fs.readFileSync(path.join(home, '.ultron', 'tasks', 't-1', 'events.jsonl'), 'utf8').trim());
  assert.deepStrictEqual([event.type, event.agent, event.tool, event.reason], ['guard.blocked', 'agent-2', 'Bash', 'git push']);
  assert.match(JSON.parse(run('not json').stdout).hookSpecificOutput.permissionDecisionReason, /guard failed/);
});
