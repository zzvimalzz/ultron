'use strict';
const fsp = require('fs').promises;
const path = require('path');

async function walkFiles(dir, test, out = []) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkFiles(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}

module.exports = { walkFiles };
