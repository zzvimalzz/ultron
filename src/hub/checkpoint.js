'use strict';
// Undo for a task: a shadow git repository per task, so the user's own repository and refs are never
// touched and folders that aren't repositories work too. Files the folder's .gitignore ignores aren't covered.
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { HUB_DIR } = require('./files');

const CHECKPOINTS_DIR = path.join(HUB_DIR, 'checkpoints');
// No line-ending or path rewriting, so a restore is byte for byte.
const SETTINGS = ['-c', 'core.autocrlf=false', '-c', 'core.quotepath=false', '-c', 'core.longpaths=true', '-c', 'user.name=Ultron', '-c', 'user.email=ultron@localhost'];

const gitDirOf = taskId => path.join(CHECKPOINTS_DIR, `${taskId}.git`);

function git(taskId, folder, args) {
  return childProcess.execFileSync('git', [...SETTINGS, ...args], {
    cwd: folder, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_DIR: gitDirOf(taskId), GIT_WORK_TREE: folder },
  });
}

function available() {
  try {
    childProcess.execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function create(taskId, folder) {
  fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
  git(taskId, folder, ['init', '-q']);
  git(taskId, folder, ['add', '-A']);
  git(taskId, folder, ['commit', '-q', '--allow-empty', '-m', 'checkpoint']);
  return git(taskId, folder, ['rev-parse', 'HEAD']).trim();
}

function changed(taskId, folder, sha) {
  git(taskId, folder, ['add', '-A']);
  return git(taskId, folder, ['diff', '--cached', '--name-status', '--no-renames', sha]).split('\n').filter(Boolean).map(line => {
    const [status, ...file] = line.split('\t');
    return { status, file: file.join('\t') };
  });
}

function restore(taskId, folder, sha) {
  const added = changed(taskId, folder, sha).filter(c => c.status === 'A');
  git(taskId, folder, ['checkout', sha, '--', '.']);
  for (const { file } of added) {
    const target = path.join(folder, file);
    fs.rmSync(target, { force: true });
    for (let dir = path.dirname(target); dir !== folder && fs.existsSync(dir) && !fs.readdirSync(dir).length; dir = path.dirname(dir)) fs.rmdirSync(dir);
  }
}

const remove = taskId => fs.rmSync(gitDirOf(taskId), { recursive: true, force: true });

module.exports = { available, create, changed, restore, remove };
