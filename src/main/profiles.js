'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const PACKAGES = path.join(LOCAL, 'Packages');

function findPackage(prefix) {
  try {
    const name = fs.readdirSync(PACKAGES).find(n => n.toLowerCase().startsWith(prefix.toLowerCase() + '_'));
    return name ? path.join(PACKAGES, name) : null;
  } catch {
    return null;
  }
}

// MSIX apps write new AppData folders into %LOCALAPPDATA%\Packages\<pkg>\LocalCache,
// which other processes can't see at the original path.
let cacheRoots = null;
function packageCacheRoots() {
  if (!cacheRoots) {
    try {
      cacheRoots = fs.readdirSync(PACKAGES).map(n => path.join(PACKAGES, n, 'LocalCache')).filter(p => fs.existsSync(p));
    } catch {
      cacheRoots = [];
    }
  }
  return cacheRoots;
}

const isProfile = dir => ['lockfile', 'Local State'].some(f => fs.existsSync(path.join(dir, f)));
const resolved = new Map();

function resolveDataDir(dir) {
  if (!dir) return dir;
  const hit = resolved.get(dir);
  if (hit && fs.existsSync(hit)) return hit;
  const candidates = [dir];
  for (const [base, sub] of [[LOCAL, 'Local'], [ROAMING, 'Roaming']]) {
    const rel = path.relative(base, dir);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      for (const root of packageCacheRoots()) candidates.push(path.join(root, sub, rel));
    }
  }
  const real = candidates.find(isProfile) || dir;
  resolved.set(dir, real);
  return real;
}

// Chromium keeps `lockfile` open exclusively while the profile is in use.
function isRunning(dir) {
  if (!dir) return false;
  try {
    fs.closeSync(fs.openSync(path.join(resolveDataDir(dir), 'lockfile'), 'r+'));
    return false;
  } catch (err) {
    return err.code === 'EBUSY' || err.code === 'EPERM';
  }
}

// `lockfile` is rewritten at launch and Preferences on every settings flush while the app is open.
const ACTIVITY_FILES = ['lockfile', 'Preferences', path.join('Default', 'Preferences'), 'Local State'];
function lastActivityAt(dir) {
  if (!dir) return 0;
  const real = resolveDataDir(dir);
  let latest = 0;
  for (const f of ACTIVITY_FILES) {
    try { latest = Math.max(latest, fs.statSync(path.join(real, f)).mtimeMs); } catch { /* absent */ }
  }
  return latest;
}

function powershell(script) {
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 },
      (err, stdout) => resolve(err ? '' : stdout));
  });
}

// Reads Desktop and Start Menu shortcuts that launch an app, so first-run accounts mirror the user's own shortcuts.
async function findShortcuts(exeName) {
  const script = `
    $sh = New-Object -ComObject WScript.Shell
    @(Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter *.lnk -ErrorAction SilentlyContinue) +
      @(Get-ChildItem ([Environment]::GetFolderPath('Programs')) -Filter *.lnk -Recurse -ErrorAction SilentlyContinue) | ForEach-Object {
      $l = $sh.CreateShortcut($_.FullName)
      if ($l.TargetPath -like '*\\${exeName}') { [pscustomobject]@{ name = $_.BaseName; target = $l.TargetPath; args = $l.Arguments } }
    } | ConvertTo-Json -Compress`;
  try {
    const out = JSON.parse(await powershell(script) || '[]');
    return Array.isArray(out) ? out : [out];
  } catch {
    return [];
  }
}

module.exports = { LOCAL, ROAMING, findPackage, resolveDataDir, isRunning, lastActivityAt, findShortcuts };
