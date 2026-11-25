'use strict';
// Shares this device's usage totals with the user's own sync server and merges what the other devices shared.
// The server is any HTTPS service with PUT/DELETE /v1/devices/<id> that answers { devices: [...] }; it holds nothing but these snapshots.
const crypto = require('crypto');
const fs = require('fs');
const { fromRows, isRow } = require('./usage/buckets');

const SYNC_MS = 10 * 60 * 1000;
const FIRST_SYNC_MS = 20 * 1000;
const TIMEOUT_MS = 20 * 1000;
const OTHER_NAME = 'VS Code & CLI';

// Accounts are matched across devices by a keyed hash of the email the account's CLI reports, so the server never sees an address.
const hmac = (token, text) => crypto.createHmac('sha256', token).update(text).digest('hex').slice(0, 32);

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

function validUrl(text) {
  const url = new URL(text);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('The server URL must start with https://');
  return url.origin + url.pathname.replace(/\/+$/, '');
}

function createSync({ store, usage, accounts, tokenFile, cacheFile, secrets, onChange }) {
  let others = readJson(cacheFile, []).filter(d => d && Array.isArray(d.rows));
  let status = { lastSyncAt: 0, error: '' };
  let running = null;

  const settings = () => store.get().sync;
  const hasToken = () => fs.existsSync(tokenFile);
  const token = () => { try { return secrets.decrypt(fs.readFileSync(tokenFile)); } catch { return ''; } };
  const ready = () => settings().enabled && Boolean(settings().url) && hasToken();

  function keyOf(secret) {
    const byId = new Map(accounts().map(a => [a.id, a]));
    return id => {
      const a = byId.get(id);
      if (!a) return hmac(secret, 'other');
      return hmac(secret, a.emailHash ? `${a.provider}:${a.emailHash}` : `${store.get().deviceId}:${a.id}`);
    };
  }

  async function snapshot(secret) {
    const list = accounts();
    const key = keyOf(secret);
    const rows = await usage.rows(list, key);
    const used = new Set(rows.map(r => r[1]));
    const names = Object.fromEntries(list.filter(a => used.has(key(a.id))).map(a => [key(a.id), { name: a.name, provider: a.provider, color: a.color }]));
    if (used.has(key('other'))) names[key('other')] = { name: OTHER_NAME, provider: 'claude', color: 0 };
    return { v: 1, deviceId: store.get().deviceId, name: settings().deviceName || 'This PC', updatedAt: Date.now(), accounts: names, rows };
  }

  async function send(method, id, body) {
    let res;
    try {
      res = await fetch(`${settings().url}/v1/devices/${id}`, {
        method, headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
        body: body && JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error("Couldn't reach the server");
    }
    if (res.status === 401 || res.status === 403) throw new Error('The server rejected the token');
    if (!res.ok) throw new Error(`The server answered ${res.status}`);
    const reply = await res.json().catch(() => null);
    if (!reply || !Array.isArray(reply.devices)) throw new Error("The server's answer wasn't understood");
    return reply.devices.filter(d => d && typeof d.deviceId === 'string' && Array.isArray(d.rows) && d.rows.every(isRow));
  }

  function remember(devices) {
    others = devices.filter(d => d.deviceId !== store.get().deviceId);
    try { fs.writeFileSync(cacheFile, JSON.stringify(others)); } catch { /* the cache only speeds up the next start */ }
  }

  function syncNow() {
    running ||= (async () => {
      if (!ready()) {
        status = { ...status, error: settings().enabled ? 'Add the server URL and token' : '' };
        return;
      }
      try {
        const snap = await snapshot(token());
        remember(await send('PUT', snap.deviceId, snap));
        status = { lastSyncAt: Date.now(), error: '' };
      } catch (err) {
        status = { ...status, error: err.message };
      }
    })().finally(() => { running = null; onChange(); });
    return running;
  }

  async function remove(id) {
    if (!ready()) throw new Error('Sync is not set up');
    remember(await send('DELETE', id));
    return view();
  }

  async function merged(options) {
    const self = await snapshot(token());
    return fromRows([self, ...others], options);
  }

  function save({ token: plain, ...patch }) {
    const next = { ...settings(), ...patch };
    if (patch.url) next.url = validUrl(patch.url);
    if (plain !== undefined) {
      if (plain.trim()) fs.writeFileSync(tokenFile, secrets.encrypt(plain.trim()));
      else fs.rmSync(tokenFile, { force: true });
    }
    store.update({ sync: next });
    syncNow();
    return view();
  }

  function view() {
    const { enabled, url, deviceName } = settings();
    return {
      enabled, url, deviceName, deviceId: store.get().deviceId, hasToken: hasToken(), ...status,
      devices: others.map(d => ({ id: d.deviceId, name: d.name, updatedAt: d.updatedAt })),
    };
  }

  function start() {
    setTimeout(syncNow, FIRST_SYNC_MS);
    setInterval(syncNow, SYNC_MS);
  }

  return { start, syncNow, merged, save, remove, view };
}

module.exports = { createSync };
