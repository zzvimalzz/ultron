'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// The hub lives in the home folder, not AppData: MSIX apps (Claude, ChatGPT) launch the hub server
// inside their container, where AppData writes are redirected and invisible to Ultron.
const HUB_DIR = path.join(os.homedir(), '.ultron');
const CREW_FILE = path.join(HUB_DIR, 'crew.json');
const SESSIONS_FILE = path.join(HUB_DIR, 'sessions.json');
const EVENTS_FILE = path.join(HUB_DIR, 'events.jsonl');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Events are append-only; only the recent tail matters, so at most the last `bytes` are parsed.
function recentEvents(since, bytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(EVENTS_FILE, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8').split('\n').slice(start ? 1 : 0)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(e => e && e.t >= since);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { HUB_DIR, CREW_FILE, SESSIONS_FILE, EVENTS_FILE, readJson, writeJson, recentEvents };
