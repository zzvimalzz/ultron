'use strict';
// The memory vault: plain Markdown files in fixed places. Every function takes the vault folder first.
// The hub server, the session hook and Ultron's curator all go through here, so what may be written where is enforced in one place.
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const SKELETON = path.join(__dirname, 'vault');
const CONTEXT_CAP = 12000;
const PROFILE_TOPICS = ['identity', 'preferences', 'working-style', 'goals'];
const MEMORY_SECTIONS = ['About me', 'Communication preferences', 'Current priorities', 'Boundaries'];
const NEEDS_TITLE = ['area', 'decision', 'session'];
const PROTECTED = ['MEMORY.md', 'INDEX.md', 'PROTOCOL.md', 'START_HERE.md'];

const SECRET_PATTERNS = [
  ['API key', /sk-[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /ghp_|gho_|github_pat_/],
  ['Slack token', /xox[abprs]-/],
  ['AWS key', /AKIA[0-9A-Z]{16}/],
  ['JWT', /eyJ[\w-]+\.[\w-]+\.[\w-]+/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['card number', /\b\d{13,19}\b/],
  ['password', /password\s*[:=]\s*\S+/i],
];

const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clock = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';
const rel = file => file.split(path.sep).join('/');
const norm = p => path.resolve(p).toLowerCase();

const read = (vault, file) => { try { return fs.readFileSync(path.join(vault, file), 'utf8'); } catch { return null; } };

function write(vault, file, text) {
  const target = path.join(vault, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}

const append = (vault, file, text, header) => write(vault, file, (read(vault, file) ?? header) + text);

function scanSecrets(text) {
  return SECRET_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function refuseSecrets(...texts) {
  const found = scanSecrets(texts.filter(Boolean).join('\n'));
  if (found) throw new Error(`Refused: looks like a secret (${found})`);
}

// A path that stays inside the vault, relative with forward slashes.
function inside(vault, file) {
  const full = path.resolve(vault, file);
  if (!full.toLowerCase().startsWith(`${norm(vault)}${path.sep}`)) throw new Error('Refused: outside the vault');
  return rel(path.relative(vault, full));
}

function mdFiles(vault, dir = '') {
  let entries;
  try { entries = fs.readdirSync(path.join(vault, dir), { withFileTypes: true }); } catch { return []; }
  return entries.flatMap(e => {
    const file = dir ? `${dir}/${e.name}` : e.name;
    if (e.name.startsWith('.') || e.name === '_template' || e.name === 'node_modules') return [];
    return e.isDirectory() ? mdFiles(vault, file) : e.name.endsWith('.md') ? [file] : [];
  });
}

const titleOf = (text, file) => /^#\s+(.+)$/m.exec(text)?.[1] || path.basename(file, '.md');

// Never overwrites: a second copy on the same day gets a counter.
function archivePath(vault, file) {
  const { dir, name, ext } = path.parse(file);
  const base = `archive/${new Date().getFullYear()}/${dir ? `${dir}/` : ''}${name}`;
  for (let n = 1; ; n++) {
    const candidate = `${base}-${today()}${n > 1 ? `-${n}` : ''}${ext}`;
    if (!fs.existsSync(path.join(vault, candidate))) return candidate;
  }
}

const isVault = dir => fs.existsSync(path.join(dir, 'MEMORY.md'));

function copySkeleton(from, to, vault) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copySkeleton(source, target, vault);
    else fs.writeFileSync(target, fs.readFileSync(source, 'utf8').replaceAll('{{VAULT}}', vault).replaceAll('{{DATE}}', today()));
  }
}

// An existing vault is adopted untouched. Notes the v1.3 hub left in the folder go to the inbox.
function ensureVault(dir) {
  if (isVault(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  const legacy = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name);
  for (const name of legacy) {
    fs.mkdirSync(path.join(dir, 'inbox', 'v1.3-notes'), { recursive: true });
    fs.renameSync(path.join(dir, name), path.join(dir, 'inbox', 'v1.3-notes', name));
  }
  copySkeleton(SKELETON, dir, dir);
  return true;
}

function rowsOf(text) {
  return (text || '').split(/\r?\n/).filter(l => /^\|/.test(l) && !/^\|\s*(Project|-)/.test(l)).map(l => l.split('|').slice(1, -1).map(c => c.trim()));
}

const projectDir = (vault, name) => path.join(vault, 'projects', name);
const hasProject = (vault, name) => name && name !== '_template' && fs.existsSync(path.join(projectDir(vault, name), 'overview.md'));

function gitRemote(cwd) {
  try {
    return childProcess.execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).toString().trim();
  } catch {
    return '';
  }
}

// The project whose recorded location is `cwd` or holds it, else the one with the same git remote, else the one named like the folder.
function projectFor(vault, cwd) {
  if (!cwd) return null;
  const here = norm(cwd);
  for (const [name, , location] of rowsOf(read(vault, 'projects/_index.md'))) {
    const where = /`([^`]+)`/.exec(location || '')?.[1];
    const dir = slug(name.replace(/\]\(.*$/, '').replace(/^\[/, ''));
    if (where && hasProject(vault, dir) && (here === norm(where) || here.startsWith(`${norm(where)}${path.sep}`))) return { slug: dir, dir: projectDir(vault, dir) };
  }
  const remote = gitRemote(cwd);
  if (remote) {
    const hit = fs.readdirSync(path.join(vault, 'projects'), { withFileTypes: true }).find(e => e.isDirectory() && hasProject(vault, e.name)
      && read(vault, `projects/${e.name}/overview.md`).includes(remote));
    if (hit) return { slug: hit.name, dir: projectDir(vault, hit.name) };
  }
  const byName = path.basename(cwd).toLowerCase();
  return hasProject(vault, byName) ? { slug: byName, dir: projectDir(vault, byName) } : null;
}

// Durable memory in full, then as much of the current project as fits.
function context(vault, cwd) {
  const memory = `# Memory\n\n${read(vault, 'MEMORY.md') || ''}`;
  const project = projectFor(vault, cwd);
  if (!project) return memory;
  const files = ['overview.md', 'state.md'].map(f => read(vault, `projects/${project.slug}/${f}`)).filter(Boolean).join('\n\n');
  const room = CONTEXT_CAP - memory.length;
  return room > 0 ? `${memory}\n\n# Project: ${project.slug}\n\n${files}`.slice(0, CONTEXT_CAP) : memory;
}

function recall(vault, query, cwd) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const files = mdFiles(vault).map(file => ({ file, text: read(vault, file) || '' }));
  if (!words.length) {
    return files.map(f => ({ ...f, mtime: fs.statSync(path.join(vault, f.file)).mtimeMs })).sort((a, b) => b.mtime - a.mtime).slice(0, 20)
      .map(f => ({ file: f.file, title: titleOf(f.text, f.file), text: '' }));
  }
  const current = projectFor(vault, cwd);
  return files.map(f => {
    const haystack = `${f.file}\n${f.text}`.toLowerCase();
    const hits = words.every(w => haystack.includes(w)) ? words.reduce((sum, w) => sum + haystack.split(w).length - 1, 0) : 0;
    const weight = f.file.startsWith('archive/') ? 0.3 : current && f.file.startsWith(`projects/${current.slug}/`) ? 2 : 1;
    return { file: f.file, title: titleOf(f.text, f.file), text: f.text.slice(0, 2500), score: hits * weight };
  }).filter(f => f.score).sort((a, b) => b.score - a.score).slice(0, 6);
}

const touch = text => text.replace(/^Updated:.*$/m, `Updated: ${today()}`);

// Appends a line to the end of a `## heading` section, creating the section when it is missing.
function addToSection(text, heading, line) {
  const lines = text.replace(/\s+$/, '').split(/\r?\n/);
  const start = lines.findIndex(l => l.trim() === `## ${heading}`);
  if (start < 0) return `${lines.join('\n')}\n\n## ${heading}\n\n${line}\n`;
  let at = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (at < 0) at = lines.length;
  while (at > start + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, ...(at === start + 1 ? ['', line] : [line]));
  return `${lines.join('\n')}\n`;
}

function createProject(vault, name, cwd, source) {
  const dir = slug(name);
  const fill = text => text.replace(/YYYY-MM-DD/g, today()).replace(/^Source:.*$/m, `Source: ${source}`);
  const template = f => fill(fs.readFileSync(path.join(SKELETON, 'projects', '_template', f), 'utf8'));
  write(vault, `projects/${dir}/overview.md`, template('overview.md').replace('- Working directory:', `- Working directory: \`${cwd || ''}\``));
  write(vault, `projects/${dir}/state.md`, template('state.md'));
  write(vault, `projects/${dir}/decisions.md`, '# Decision Log\n');
  append(vault, 'projects/_index.md', `| ${name} | active | \`${cwd || ''}\` | ${today()} |\n`, '# Project Index\n\n| Project | Status | Location | Last updated |\n| --- | --- | --- | --- |\n');
  write(vault, 'INDEX.md', addToSection(read(vault, 'INDEX.md') || '', 'Work', `- [Project: ${name}](projects/${dir}/overview.md)`));
  return dir;
}

function projectOf(vault, { project, cwd }, source) {
  const found = project ? slug(project) : projectFor(vault, cwd)?.slug;
  if (found) return hasProject(vault, found) ? found : createProject(vault, project || found, cwd, source);
  return createProject(vault, path.basename(cwd || 'project'), cwd, source);
}

function touchIndexRow(vault, dir) {
  const text = read(vault, 'projects/_index.md');
  if (!text) return;
  write(vault, 'projects/_index.md', text.split(/\r?\n/).map(l => (slug((l.split('|')[1] || '').trim()) === dir ? l.replace(/\d{4}-\d{2}-\d{2}(\s*\|\s*)$/, `${today()}$1`) : l)).join('\n'));
}

const bullet = (text, source, unconfirmed) => `- ${text.trim()} (${unconfirmed ? 'unconfirmed; ' : ''}Source: ${source}; Recorded: ${today()})`;

const WRITERS = {
  fact: (vault, o, source) => {
    const file = `inbox/${today()}.md`;
    append(vault, file, `${bullet(o.text, source, true)}\n`, `# Inbox ${today()}\n\n`);
    return file;
  },
  profile: (vault, o, source) => {
    if (!PROFILE_TOPICS.includes(o.topic)) throw new Error(`topic must be one of: ${PROFILE_TOPICS.join(', ')}`);
    const file = `profile/${o.topic}.md`;
    write(vault, file, addToSection(read(vault, file) || `# ${o.topic}\n`, 'To confirm', bullet(o.text, source, true)));
    return file;
  },
  area: (vault, o, source) => {
    const file = `areas/${slug(o.title)}.md`;
    const existing = read(vault, file);
    if (existing === null) {
      write(vault, file, `# ${o.title}\n\nRecorded: ${today()}\nUpdated: ${today()}\nSource: ${source}\n\n${o.text.trim()}\n`);
      append(vault, 'areas/_index.md', `- [${o.title}](${slug(o.title)}.md)\n`, '# Life-Area Index\n\n');
      write(vault, 'INDEX.md', addToSection(read(vault, 'INDEX.md') || '', 'Work', `- [Area: ${o.title}](${file})`));
    } else {
      write(vault, file, `${touch(existing).trimEnd()}\n\n${o.text.trim()}\n`);
    }
    return file;
  },
  'project-state': (vault, o, source) => {
    const dir = projectOf(vault, o, source);
    const file = `projects/${dir}/state.md`;
    const old = read(vault, file);
    if (old) write(vault, archivePath(vault, file), old);
    write(vault, file, `# Project State\n\nUpdated: ${today()}\n\n${o.text.trim()}\n`);
    touchIndexRow(vault, dir);
    return file;
  },
  decision: (vault, o, source) => {
    const dir = projectOf(vault, o, source);
    const file = `projects/${dir}/decisions.md`;
    append(vault, file, `\n## ${today()} — ${o.title}\n\n${o.text.trim()}\n\n- Source: ${source}\n`, '# Decision Log\n');
    touchIndexRow(vault, dir);
    return file;
  },
  session: (vault, o) => {
    const file = `sessions/${today()}.md`;
    append(vault, file, `\n## ${clock()} — ${o.title}\n\n${o.text.trim()}\n`, `# ${today()}\n`);
    return file;
  },
  inbox: (vault, o, source) => {
    const file = `inbox/${today()}.md`;
    append(vault, file, `- ${o.text.trim()} (Source: ${source})\n`, `# Inbox ${today()}\n\n`);
    return file;
  },
};

// `kind` decides the file and the format, so agents never pick paths. Returns the file written.
function remember(vault, options, source) {
  const writer = WRITERS[options.kind];
  if (!writer) throw new Error(`kind must be one of: ${Object.keys(WRITERS).join(', ')}`);
  if (!options.text) throw new Error('text is required');
  if (NEEDS_TITLE.includes(options.kind) && !options.title) throw new Error('title is required');
  refuseSecrets(options.title, options.text);
  return writer(vault, options, source);
}

// The old version is archived first, so nothing is ever lost.
function update(vault, file, text, source) {
  const name = inside(vault, file);
  if (name.startsWith('archive/')) throw new Error('Refused: archived notes are read-only');
  const old = read(vault, name);
  if (old === null) throw new Error(`No such file: ${name}`);
  refuseSecrets(text);
  write(vault, archivePath(vault, name), old);
  write(vault, name, /^Updated:/m.test(text) ? touch(text) : text);
  return name;
}

function forget(vault, file) {
  const name = inside(vault, file);
  if (name.startsWith('archive/') || PROTECTED.includes(name)) throw new Error(`Refused: ${name} can't be archived`);
  const old = read(vault, name);
  if (old === null) throw new Error(`No such file: ${name}`);
  const target = archivePath(vault, name);
  write(vault, target, old);
  fs.rmSync(path.join(vault, name));
  return target;
}

const bulletsOf = (lines, from = 0, to = lines.length) =>
  lines.map((line, index) => ({ line: index, text: line.slice(2), bullet: line.startsWith('- ') })).filter(b => b.bullet && b.line >= from && b.line < to).map(({ line, text }) => ({ line, text }));

function pending(vault) {
  const toConfirm = [];
  for (const file of mdFiles(vault, 'profile')) {
    const lines = (read(vault, file) || '').split(/\r?\n/);
    const start = lines.findIndex(l => l.trim() === '## To confirm');
    if (start < 0) continue;
    const next = lines.findIndex((l, i) => i > start && /^## /.test(l));
    toConfirm.push(...bulletsOf(lines, start + 1, next < 0 ? lines.length : next).map(b => ({ file, ...b })));
  }
  const inbox = mdFiles(vault, 'inbox').filter(f => !f.endsWith('README.md') && !f.startsWith('inbox/v1.3-notes/'))
    .flatMap(file => bulletsOf((read(vault, file) || '').split(/\r?\n/)).map(b => ({ file, ...b })));
  return { toConfirm, inbox };
}

// Takes the bullet out of its file; the text is matched, so a line number that has shifted still finds it.
function takeBullet(vault, item) {
  const name = inside(vault, item.file);
  const lines = (read(vault, name) || '').split(/\r?\n/);
  const at = lines.findIndex(l => l === `- ${item.text}`);
  if (at < 0) throw new Error('That item has changed; refresh and try again');
  lines.splice(at, 1);
  write(vault, name, lines.join('\n'));
  return name;
}

const confirmed = text => text.replace(/\(unconfirmed; (.*)\)$/, `($1; Confirmed: ${today()})`);

const archiveLine = (vault, file, line) => append(vault, `archive/${new Date().getFullYear()}/${file}`, `${line}\n`, `# ${path.basename(file, '.md')}\n\n`);

function confirm(vault, item) {
  const name = takeBullet(vault, item);
  write(vault, name, addToSection(read(vault, name), 'Confirmed', `- ${confirmed(item.text)}`));
}

function reject(vault, item) {
  const name = takeBullet(vault, item);
  archiveLine(vault, 'rejected.md', `- ${item.text} (rejected ${today()}; from ${name})`);
}

function keep(vault, item, section) {
  if (!MEMORY_SECTIONS.includes(section)) throw new Error(`section must be one of: ${MEMORY_SECTIONS.join(', ')}`);
  takeBullet(vault, item);
  write(vault, 'MEMORY.md', addToSection(read(vault, 'MEMORY.md'), section, `- ${confirmed(item.text)}`));
}

function drop(vault, item) {
  const name = takeBullet(vault, item);
  archiveLine(vault, 'inbox.md', `- ${item.text} (dropped ${today()}; from ${name})`);
}

// The date in MEMORY.md's "Last reviewed" line.
const lastReviewed = vault => /^Last reviewed: (S+)/m.exec(read(vault, 'MEMORY.md') || '')?.[1] || '';

module.exports = {
  MEMORY_SECTIONS, lastReviewed, isVault, ensureVault, projectFor, context, recall, remember, update, forget, pending, confirm, reject, keep, drop, scanSecrets, mdFiles, titleOf,
};
