'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-sync-'));
Object.assign(process.env, { HOME: TEMP, USERPROFILE: TEMP, LOCALAPPDATA: path.join(TEMP, 'Local'), APPDATA: path.join(TEMP, 'Roaming') });

const { emptyRecord, readLines } = require('../src/main/usage/parsers');
const { aggregate } = require('../src/main/usage/aggregate');
const { snapshotRows, fromRows } = require('../src/main/usage/buckets');
const { createSync } = require('../src/main/sync');
const { claudeTurn, jsonl, HOUR, DAY } = require('./fixtures');

const NOW = Date.now();
const noContext = { sessionOwner: new Map(), firstLaunch: {} };
const account = { id: 'claude-a', provider: 'claude', name: 'Claude Work', color: 2, emailHash: 'hash-of-an-email' };

// One session per turn, 1160 tokens each, at the given ages.
function recordsAt(ages, accountId = account.id) {
  return Object.fromEntries(ages.map((age, i) => {
    const turn = claudeTurn({ sessionId: `s${i}`, cwd: path.join(TEMP, 'secret-project'), t: NOW - age, model: 'claude-opus-5-5', id: `m${i}` });
    return [path.join(TEMP, `s${i}.jsonl`), { ...readLines(emptyRecord(), 'claude', jsonl(turn)), provider: 'claude', account: accountId }];
  }));
}

const ages = [3 * HOUR, 30 * HOUR, 5 * DAY, 40 * DAY];
const keyOf = id => `key-${id}`;
const rowsOf = (records, accounts = [account]) => snapshotRows(records, noContext, accounts, keyOf, NOW);
const device = (id, rows, extra = {}) => ({ deviceId: id, name: id, updatedAt: NOW, accounts: { [keyOf(account.id)]: { name: 'Claude Work', provider: 'claude', color: 2 } }, rows, ...extra });

test('merged totals match the local totals for every range', () => {
  const records = recordsAt(ages);
  const rows = rowsOf(records);
  for (const range of ['24h', '7d', '30d', '90d', 'all']) {
    const local = aggregate(records, noContext, [account], { range }, NOW);
    const merged = fromRows([device('a', rows)], { range }, NOW);
    for (const field of ['total', 'input', 'cacheWrite', 'cacheRead', 'output', 'messages', 'sessions']) {
      assert.strictEqual(merged.totals[field], local.totals[field], `${range} ${field}`);
    }
    assert.strictEqual(merged.timeline.unit, local.timeline.unit, range);
    assert.strictEqual(merged.timeline.buckets.reduce((s, b) => s + b.total, 0), local.timeline.buckets.reduce((s, b) => s + b.total, 0), range);
  }
});

test('a snapshot holds hourly rows for the last two days, daily rows before, and nothing identifying', () => {
  const rows = rowsOf(recordsAt(ages));
  const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  assert.ok(rows.some(r => r[0] % HOUR === 0 && NOW - r[0] < 3 * DAY && r[2] === 'Opus 5.5'));
  assert.ok(rows.filter(r => NOW - r[0] > 2 * DAY + HOUR).every(r => r[0] === dayStart(r[0])));
  assert.ok(!JSON.stringify(rows).includes('secret-project'));
});

test('devices add up, and an account with the same key on two devices is one account', () => {
  const laptop = device('laptop', rowsOf(recordsAt([HOUR, 2 * HOUR])));
  const desktop = device('desktop', rowsOf(recordsAt([3 * HOUR])), { name: 'Desktop' });
  const merged = fromRows([laptop, desktop], { range: '24h' }, NOW);
  assert.strictEqual(merged.totals.total, 3 * 1160);
  assert.strictEqual(merged.accounts.length, 1);
  assert.deepStrictEqual(merged.devices.map(d => [d.name, d.total]), [['laptop', 2 * 1160], ['Desktop', 1160]]);
  assert.strictEqual(fromRows([laptop, desktop], { range: '24h', account: 'nobody' }, NOW).totals.total, 0);
});

test('malformed rows from a server are ignored', () => {
  const good = rowsOf(recordsAt([HOUR]));
  const merged = fromRows([device('a', [...good, [1, 2, 3], ['x'], null])], { range: '24h' }, NOW);
  assert.strictEqual(merged.totals.total, 1160);
});

// A sync server in a few lines: it keeps each device's last snapshot and answers with all of them.
function fakeServer(token) {
  const saved = new Map();
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
      const id = req.url.split('/').pop();
      if (req.method === 'PUT') saved.set(id, JSON.parse(body));
      if (req.method === 'DELETE') saved.delete(id);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ devices: [...saved.values()] }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, saved, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

function newDevice(name, accounts, records) {
  const dir = fs.mkdtempSync(path.join(TEMP, 'device-'));
  const config = { deviceId: `${name}-0000-4000-8000-000000000000`, sync: { enabled: false, url: '', deviceName: '' } };
  const store = { get: () => config, update: patch => Object.assign(config, patch) };
  const usage = { rows: (list, key) => Promise.resolve(snapshotRows(records, noContext, list, key, NOW)) };
  const secrets = { encrypt: text => Buffer.from(`sealed:${text}`), decrypt: bytes => bytes.toString().replace('sealed:', '') };
  return { config, sync: createSync({ store, usage, accounts: () => accounts, tokenFile: path.join(dir, 'token.bin'), cacheFile: path.join(dir, 'devices.json'), secrets, onChange() {} }), dir };
}

test('two devices share totals through the server and match accounts by email without sending it', async () => {
  const { server, saved, requests, url } = await fakeServer('shared-token');
  try {
    const laptop = newDevice('laptop', [account], recordsAt([HOUR]));
    const desktop = newDevice('desktop', [{ ...account, id: 'claude-b', name: 'Claude' }], recordsAt([2 * HOUR, 3 * HOUR], 'claude-b'));
    for (const [d, name] of [[laptop, 'Laptop'], [desktop, 'Desktop']]) {
      d.sync.save({ enabled: true, url, deviceName: name, token: 'shared-token' });
      await d.sync.syncNow();
    }
    await laptop.sync.syncNow();

    const view = laptop.sync.view();
    assert.strictEqual(view.error, '');
    assert.deepStrictEqual(view.devices.map(d => d.name), ['Desktop']);
    const merged = await laptop.sync.merged({ range: '24h' });
    assert.strictEqual(merged.totals.total, 3 * 1160);
    assert.strictEqual(merged.accounts.length, 1, 'the same email on both devices is one account');
    assert.strictEqual(requests[0].auth, 'Bearer shared-token');
    assert.strictEqual(saved.size, 2);

    const sent = requests.map(r => r.body).join('');
    assert.ok(!sent.includes(account.emailHash) && !sent.includes('secret-project') && !sent.includes('shared-token'));
    assert.ok(fs.existsSync(path.join(laptop.dir, 'token.bin')), 'the token is kept in its own file, not in the config');
    assert.ok(!JSON.stringify(laptop.config).includes('shared-token'));

    await laptop.sync.remove(desktop.config.deviceId);
    assert.deepStrictEqual(laptop.sync.view().devices, []);
  } finally {
    server.close();
  }
});

test('a wrong token, an unreachable server and a plain-http URL are reported in plain words', async () => {
  const { server, url } = await fakeServer('right');
  try {
    const d = newDevice('laptop', [account], recordsAt([HOUR]));
    d.sync.save({ enabled: true, url, token: 'wrong' });
    await d.sync.syncNow();
    assert.strictEqual(d.sync.view().error, 'The server rejected the token');
    server.close();
    await d.sync.syncNow();
    assert.strictEqual(d.sync.view().error, "Couldn't reach the server");
    assert.throws(() => d.sync.save({ url: 'http://example.org' }), /https/);
  } finally {
    server.close();
  }
});
