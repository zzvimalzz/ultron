'use strict';
// Fails when tracked text files contain personal or machine-specific details.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const TEXT = /\.(js|json|md|html|css|py|txt|yml|yaml|ps1|gitignore)$/i;

function gitUserName() {
  try { return execSync('git config user.name', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = [os.userInfo().username, gitUserName()].filter(n => n && n.length > 2);

const RULES = [
  ['user folder path', /[A-Z]:[\\/]+Users[\\/]+(?![<%$])[\w.-]+/i],
  ['email address', /[\w.+-]+@(?!example\.)[\w-]+\.[a-z]{2,}/i],
  ['MSIX package hash', /_[a-hj-km-np-tv-z0-9]{13}\b/],
  ['UUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['account id', /\b(user|acct|org)-[A-Za-z0-9]{12,}\b/],
  ...names.map(n => ['name or username', new RegExp(`\\b${escape(n)}\\b`, 'i')]),
];

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (TEXT.test(e.name)) yield p;
  }
}

const findings = [];
for (const file of files(ROOT)) {
  if (path.basename(file) === 'package-lock.json') continue;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const [label, re] of RULES) {
      if (re.test(line)) findings.push(`${path.relative(ROOT, file)}:${i + 1} ${label}`);
    }
  });
}

if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log('No personal details found.');
