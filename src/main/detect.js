'use strict';
const crypto = require('crypto');
const { detect, signedIn } = require('../hub/cli');

const REFRESH_MS = 6 * 3600 * 1000;
const STARTUP_DELAY_MS = 5000;

// A saved model or effort the account's CLI no longer offers goes back to the CLI default.
function healAccount(account, models) {
  if (!models.length) return null;
  const known = models.some(m => m.id === account.model);
  const model = known ? account.model : '';
  const efforts = models.find(m => m.id === model).efforts;
  const effort = efforts.includes(account.effort) ? account.effort : '';
  return model === account.model && effort === account.effort ? null : { model, effort, modelReset: !known };
}

// Plans and model lists come from each account's own CLI. Results live in memory; the config keeps only the
// last plan label and tier so badges show at once on the next start.
function createDetection({ store, version, onChange, onReset }) {
  const results = new Map();
  const inflight = new Map();
  let started = false;
  let chain = Promise.resolve();

  function persist(account, found) {
    const healed = healAccount(account, found.models);
    if (healed) {
      const { modelReset, ...patch } = healed;
      store.updateAccount(account.id, patch);
      if (modelReset) onReset(account);
    }
    if (found.email) store.updateAccount(account.id, { emailHash: crypto.createHash('sha256').update(found.email.trim().toLowerCase()).digest('hex') });
    if (found.tier !== 'unknown') store.updateAccount(account.id, { plan: { label: found.plan, tier: found.tier, checkedAt: found.checkedAt } });
  }

  // One account at a time, so detections never overlap and never start in the live tick.
  function refreshOne(id) {
    if (inflight.has(id)) return inflight.get(id);
    const job = chain.then(async () => {
      const account = store.get().accounts.find(a => a.id === id);
      if (!account) return null;
      const found = await detect(account, { version });
      results.set(id, found);
      persist(account, found);
      return found;
    }).finally(() => { inflight.delete(id); onChange(); });
    inflight.set(id, job);
    chain = job.catch(() => {});
    onChange();
    return job;
  }

  const stale = id => !results.has(id) || Date.now() - results.get(id).checkedAt > REFRESH_MS;

  const refresh = () => Promise.all(store.get().accounts.filter(a => signedIn(a) && stale(a.id)).map(a => refreshOne(a.id)));

  // Runs on every tick, so a login that has just finished (or a new account) is picked up within seconds.
  function watchSignIn(accounts) {
    for (const account of accounts) {
      if (!signedIn(account)) results.delete(account.id);
      else if (started && !results.has(account.id)) refreshOne(account.id);
    }
  }

  function start() {
    setTimeout(() => { started = true; refresh(); }, STARTUP_DELAY_MS);
    setInterval(refresh, REFRESH_MS);
  }

  const tierOf = account => {
    const found = results.get(account.id);
    return found && found.tier !== 'unknown' ? found.tier : account.plan?.tier || 'unknown';
  };

  return {
    start, refreshOne, watchSignIn, tierOf,
    planOf: account => results.get(account.id)?.plan || account.plan?.label || null,
    checkedAt: account => results.get(account.id)?.checkedAt || account.plan?.checkedAt || 0,
    detecting: id => inflight.has(id),
    stateOf: id => results.get(id)?.state || '',
    models: async id => {
      const found = results.get(id) || await refreshOne(id);
      return { models: found?.models || [], checkedAt: found?.checkedAt || 0 };
    },
  };
}

module.exports = { createDetection, healAccount };
