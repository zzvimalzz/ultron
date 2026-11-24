'use strict';
const fs = require('fs');
const zlib = require('zlib');

const CAP = 24000;

const textOf = content => (typeof content === 'string' ? content
  : (content || []).filter(block => block.type === 'text' || block.type === 'input_text' || block.type === 'output_text').map(block => block.text).join('\n'));

// Each reader returns { role, text } for a line worth keeping: what was said, never tool calls or their output.
const READERS = {
  claude: d => {
    if ((d.type !== 'user' && d.type !== 'assistant') || d.isMeta) return null;
    const text = textOf(d.message?.content).trim();
    return text && !text.startsWith('<') ? { role: d.type, text } : null;
  },
  chatgpt: d => {
    const p = d.payload || {};
    if (d.type !== 'response_item' || p.type !== 'message' || (p.role !== 'user' && p.role !== 'assistant')) return null;
    const text = textOf(p.content).trim();
    return text && !text.startsWith('<') ? { role: p.role, text } : null;
  },
};

async function readAll(file) {
  const raw = await fs.promises.readFile(file);
  return (file.endsWith('.zst') ? zlib.zstdDecompressSync(raw) : raw).toString('utf8');
}

// The conversation as plain text, capped for a model prompt, with how many turns the user took.
async function condense(file, provider) {
  const read = READERS[provider];
  const parts = [];
  let turns = 0;
  for (const line of (await readAll(file)).split('\n')) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const kept = read(d);
    if (!kept) continue;
    if (kept.role === 'user') turns++;
    parts.push(`${kept.role === 'user' ? 'User' : 'Assistant'}: ${kept.text}`);
  }
  const text = parts.join('\n\n');
  return { turns, text: text.length > CAP ? `${text.slice(0, CAP / 4)}\n\n[…]\n\n${text.slice(-CAP * 3 / 4)}` : text };
}

module.exports = { condense };
