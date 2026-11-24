'use strict';
const fs = require('fs');
const fsp = fs.promises;
const zlib = require('zlib');
const { emptyRecord, readLines } = require('./parsers');
const { walkFiles } = require('./walk');

const CACHE_VERSION = 4;

// Splits on the newline byte so multi-byte characters never straddle a chunk boundary. Chunks of a
// long line are collected and joined once, not re-copied on every chunk.
async function consume(stream, rec, provider, final) {
  let pending = [];
  let consumed = 0;
  for await (const chunk of stream) {
    const nl = chunk.lastIndexOf(10);
    if (nl < 0) { pending.push(chunk); continue; }
    const complete = Buffer.concat([...pending, chunk.subarray(0, nl)]);
    readLines(rec, provider, complete.toString('utf8'));
    consumed += complete.length + 1;
    pending = [chunk.subarray(nl + 1)];
  }
  if (final) readLines(rec, provider, Buffer.concat(pending).toString('utf8'));
  return consumed;
}

function createScanner(cacheFile) {
  let cache = { version: CACHE_VERSION, files: {} };
  let savedAt = 0;
  try {
    const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (saved.version === CACHE_VERSION) cache = saved;
  } catch { /* first run */ }

  async function update(file, source, st) {
    const prev = cache.files[file];
    const compressed = file.endsWith('.zst');
    // Plain transcripts are append-only, so only the new bytes are read. A shrunk file is re-read.
    const resume = prev && !compressed && prev.provider === source.provider && st.size >= prev.offset;
    const rec = resume ? prev : { ...emptyRecord(), provider: source.provider, offset: 0 };
    rec.account = source.account || null;
    if (compressed) {
      await consume(fs.createReadStream(file).pipe(zlib.createZstdDecompress()), rec, source.provider, true);
      rec.offset = st.size;
    } else if (st.size > rec.offset) {
      rec.offset += await consume(fs.createReadStream(file, { start: rec.offset }), rec, source.provider, false);
    }
    rec.mtime = st.mtimeMs;
    rec.size = st.size;
    cache.files[file] = rec;
  }

  async function refresh(sources) {
    let changed = false;
    const seen = new Set();
    for (const source of sources) {
      for (const file of await walkFiles(source.root, name => /\.jsonl(\.zst)?$/.test(name))) {
        seen.add(file);
        let st;
        try { st = await fsp.stat(file); } catch { continue; }
        const prev = cache.files[file];
        if (prev && prev.mtime === st.mtimeMs && prev.size === st.size && prev.account === (source.account || null)) continue;
        try {
          await update(file, source, st);
          changed = true;
        } catch { /* unreadable or mid-write; retried next tick */ }
      }
    }
    for (const file of Object.keys(cache.files)) {
      if (!seen.has(file)) { delete cache.files[file]; changed = true; }
    }
    if (changed && Date.now() - savedAt > 30000) {
      savedAt = Date.now();
      try { fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch { /* cache is an optimisation */ }
    }
    return changed;
  }

  return { refresh, records: () => cache.files };
}

module.exports = { createScanner };
