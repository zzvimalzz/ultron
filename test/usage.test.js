'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { emptyRecord, readLines } = require('../src/main/usage/parsers');
const { createScanner } = require('../src/main/usage/scan');
const { aggregate, prettyModel } = require('../src/main/usage/aggregate');
const { claudeTurn, codexRollout, jsonl, writeFixtureHome, HOUR, DAY } = require('./fixtures');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-test-'));
const noContext = { sessionOwner: new Map(), firstLaunch: {} };
const claudeAccount = { id: 'claude-a', provider: 'claude' };
const chatgptAccount = { id: 'chatgpt-a', provider: 'chatgpt' };

test('claude: streamed blocks with the same message id count once', () => {
  const t = Date.now();
  const turn = claudeTurn({ sessionId: 's', cwd: 'x', t, model: 'claude-opus-5-5', id: 'm1' });
  const rec = readLines(emptyRecord(), 'claude', jsonl([...turn, turn[1]]));
  assert.equal(rec.msgs.length, 2);
  const totals = aggregate({ f: { ...rec, provider: 'claude' } }, noContext, [claudeAccount], { range: '24h' }, t + 1000).totals;
  assert.equal(totals.messages, 1);
  assert.equal(totals.total, 10 + 100 + 1000 + 50);
});

test('codex: usage is the delta between cumulative totals', () => {
  const start = Date.now() - HOUR;
  const lines = codexRollout({ sessionId: 'c', cwd: 'x', start, turns: [{ input: 1000, cached: 800, output: 50 }, { input: 2000, cached: 1500, output: 70 }] });
  lines.push(lines[lines.length - 1]);
  const rec = readLines(emptyRecord(), 'chatgpt', jsonl(lines));
  assert.equal(rec.msgs.length, 2);
  const [first, second] = rec.msgs;
  assert.deepEqual(first.slice(2, 6), [200, 0, 800, 50]);
  assert.deepEqual(second.slice(2, 6), [500, 0, 1500, 70]);
  assert.equal(first[1], 'gpt-6-luna');
});

test('scanner reads appended lines only and waits for a complete line', async () => {
  const dir = tmp();
  const file = path.join(dir, 'p', 's.jsonl');
  fs.mkdirSync(path.dirname(file));
  const t = Date.now();
  fs.writeFileSync(file, jsonl(claudeTurn({ sessionId: 's', cwd: 'x', t, model: 'claude-opus-5-5', id: 'a' })));
  const scanner = createScanner(path.join(dir, 'cache.json'));
  const sources = [{ provider: 'claude', root: dir, account: null }];
  assert.equal(await scanner.refresh(sources), true);
  const second = jsonl(claudeTurn({ sessionId: 's', cwd: 'x', t: t + 1000, model: 'claude-opus-5-5', id: 'b' }));
  fs.appendFileSync(file, second.slice(0, 40));
  await scanner.refresh(sources);
  assert.equal(scanner.records()[file].msgs.length, 1);
  fs.appendFileSync(file, second.slice(40));
  await scanner.refresh(sources);
  assert.deepEqual(scanner.records()[file].msgs.map(m => m[6]), ['a', 'b']);
  assert.equal(await scanner.refresh(sources), false);
});

test('ranges pick hourly, daily and weekly buckets and keep rhythm sizes fixed', async () => {
  const home = writeFixtureHome(tmp(), { days: 700 });
  const scanner = createScanner(path.join(home, 'cache.json'));
  await scanner.refresh([
    { provider: 'claude', root: path.join(home, '.claude', 'projects'), account: null },
    { provider: 'chatgpt', root: path.join(home, '.codex', 'sessions'), account: null },
  ]);
  const accounts = [claudeAccount, chatgptAccount];
  const run = range => aggregate(scanner.records(), noContext, accounts, { range });
  const day = run('24h');
  assert.equal(day.timeline.unit, 'hour');
  assert.ok(day.timeline.buckets.length >= 24 && day.timeline.buckets.length <= 25);
  assert.equal(run('90d').timeline.unit, 'day');
  const all = run('all');
  assert.equal(all.timeline.unit, 'week');
  assert.ok(all.totals.messages > 1000);
  assert.ok(all.perAccount['chatgpt-a'].total > 0, 'codex sessions belong to the ChatGPT account');
  assert.equal(all.rhythm.week.length, 7);
  assert.equal(all.rhythm.days.length, run('7d').rhythm.days.length);
  assert.ok(all.projects.length > 8);
});

test('an account with its own CLI home owns its transcripts', () => {
  const rec = { ...emptyRecord(), provider: 'claude', account: 'claude-b', msgs: [[Date.now(), 'claude-opus-5-5', 1, 0, 0, 1, 'x']] };
  const stats = aggregate({ f: rec }, noContext, [claudeAccount, { id: 'claude-b', provider: 'claude' }], { range: '7d' });
  assert.equal(stats.perAccount['claude-b'].total, 2);
});

test('model names read naturally', () => {
  assert.equal(prettyModel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(prettyModel('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
  assert.equal(prettyModel('gpt-6-luna'), 'GPT-6 Luna');
  assert.equal(prettyModel('something-else'), 'something-else');
});

test('fixture timestamps stay inside the requested window', () => {
  const now = Date.now();
  const home = writeFixtureHome(tmp(), { days: 3, now });
  const file = fs.readdirSync(path.join(home, '.claude', 'projects'), { recursive: true }).find(f => f.endsWith('.jsonl'));
  const rec = readLines(emptyRecord(), 'claude', fs.readFileSync(path.join(home, '.claude', 'projects', file), 'utf8'));
  assert.ok(rec.msgs.every(m => m[0] > now - 4 * DAY && m[0] < now));
});
