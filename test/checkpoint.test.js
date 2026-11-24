'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-checkpoint-'));
process.env.USERPROFILE = home;
process.env.HOME = home;
const checkpoint = require('../src/hub/checkpoint');

function seed(folder) {
  fs.mkdirSync(path.join(folder, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'a.txt'), 'one\r\ntwo\r\n');
  fs.writeFileSync(path.join(folder, 'src', 'b.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(folder, 'src', 'deep', 'c.txt'), 'deep');
  fs.writeFileSync(path.join(folder, 'bin.dat'), Buffer.from([0, 1, 2, 255, 13, 10]));
}

function tree(folder) {
  const out = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) walk(full); else out[path.relative(folder, full)] = fs.readFileSync(full).toString('hex');
    }
  };
  walk(folder);
  return out;
}

function exercise(folder, taskId) {
  const before = tree(folder);
  const sha = checkpoint.create(taskId, folder);

  fs.writeFileSync(path.join(folder, 'a.txt'), 'changed');
  fs.rmSync(path.join(folder, 'src', 'b.js'));
  fs.mkdirSync(path.join(folder, 'new', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'new', 'nested', 'd.txt'), 'added');
  fs.writeFileSync(path.join(folder, 'e.txt'), 'added too');

  const changes = checkpoint.changed(taskId, folder, sha).map(c => `${c.status} ${c.file}`).sort();
  assert.deepStrictEqual(changes, ['A e.txt', 'A new/nested/d.txt', 'D src/b.js', 'M a.txt']);

  checkpoint.restore(taskId, folder, sha);
  assert.deepStrictEqual(tree(folder), before);
  assert.ok(!fs.existsSync(path.join(folder, 'new')));
  assert.deepStrictEqual(checkpoint.changed(taskId, folder, sha), []);
}

test('git is available for the checkpoint tests', () => {
  assert.ok(checkpoint.available());
});

test('restore gives back the exact tree in a folder that is not a repository', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-plain-'));
  seed(folder);
  exercise(folder, 't-plain');
  assert.ok(!fs.existsSync(path.join(folder, '.git')));
});

test('restore leaves the user\'s own repository and refs alone', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-repo-'));
  const git = (...args) => execFileSync('git', ['-C', folder, '-c', 'user.name=T', '-c', 'user.email=t@localhost', ...args], { encoding: 'utf8' });
  git('init', '-q');
  seed(folder);
  fs.writeFileSync(path.join(folder, '.gitignore'), 'ignored/\n');
  fs.mkdirSync(path.join(folder, 'ignored'));
  fs.writeFileSync(path.join(folder, 'ignored', 'keep.txt'), 'untouched');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  const head = git('rev-parse', 'HEAD');
  const status = git('status', '--porcelain');

  exercise(folder, 't-repo');
  assert.strictEqual(git('rev-parse', 'HEAD'), head);
  assert.strictEqual(git('status', '--porcelain'), status);
  assert.strictEqual(fs.readFileSync(path.join(folder, 'ignored', 'keep.txt'), 'utf8'), 'untouched');
});

test('remove deletes the shadow repository', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-remove-'));
  seed(folder);
  checkpoint.create('t-remove', folder);
  const repo = path.join(home, '.ultron', 'checkpoints', 't-remove.git');
  assert.ok(fs.existsSync(repo));
  checkpoint.remove('t-remove');
  assert.ok(!fs.existsSync(repo));
});
