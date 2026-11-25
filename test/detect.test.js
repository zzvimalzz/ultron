'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ultron-detect-'));
Object.assign(process.env, { HOME: TEMP, USERPROFILE: TEMP, LOCALAPPDATA: path.join(TEMP, 'Local'), APPDATA: path.join(TEMP, 'Roaming') });

const { parseClaudeInit, parseCodexReplies, tierOf } = require('../src/hub/cli');
const { effectiveTier, eligible } = require('../src/main/crew');
const { healAccount } = require('../src/main/detect');

test('parseClaudeInit reads the plan and each model with its effort levels', () => {
  const reply = {
    type: 'control_response',
    response: {
      subtype: 'success',
      response: {
        account: { subscriptionType: 'pro', email: 'someone@example.com' },
        models: [
          { value: 'default', displayName: 'Default (recommended)', description: 'The usual one', supportedEffortLevels: ['low', 'medium'] },
          { value: 'model-big', displayName: 'Big', description: 'Most capable', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
          { value: 'model-small', displayName: 'Small', supportsEffort: false },
        ],
      },
    },
  };
  assert.deepStrictEqual(parseClaudeInit(reply), {
    plan: 'pro', tier: 'paid', limits: null,
    models: [
      { id: '', label: 'Default', description: 'The usual one', efforts: ['low', 'medium'] },
      { id: 'model-big', label: 'Big', description: 'Most capable', efforts: ['low', 'high'] },
      { id: 'model-small', label: 'Small', description: '', efforts: [] },
    ],
  });
});

test('parseCodexReplies joins model pages, drops hidden models and reads the first limit window', () => {
  const effort = reasoningEffort => ({ reasoningEffort });
  const found = parseCodexReplies({
    modelPages: [
      { data: [{ model: 'gpt-a', displayName: 'A', supportedReasoningEfforts: [effort('low'), effort('high')] }, { model: 'gpt-hidden', hidden: true }], nextCursor: 'next' },
      { data: [{ model: 'gpt-b', displayName: 'B', description: 'Fast' }] },
    ],
    account: { account: { planType: 'free' } },
    rateLimits: { rateLimits: { primary: { usedPercent: 11, resetsAt: 1800000000 } } },
  });
  assert.strictEqual(found.plan, 'free');
  assert.strictEqual(found.tier, 'free');
  assert.deepStrictEqual(found.models.map(m => m.id), ['', 'gpt-a', 'gpt-b']);
  assert.deepStrictEqual(found.models[1].efforts, ['low', 'high']);
  assert.deepStrictEqual(found.models[0], { id: '', label: 'Default', description: '', efforts: ['low', 'high'] });
  assert.deepStrictEqual(found.limits, { usedPercent: 11, resetsAt: 1800000000 });
});

test('plan names map to tiers, and anything unrecognised is unknown', () => {
  const table = [
    ['claude', 'free', 'free'], ['claude', 'pro', 'paid'], ['claude', 'max', 'paid'], ['claude', 'team', 'team'], ['claude', 'enterprise', 'team'],
    ['chatgpt', 'free', 'free'], ['chatgpt', 'plus', 'paid'], ['chatgpt', 'pro', 'paid'], ['chatgpt', 'team', 'team'], ['chatgpt', 'business', 'team'],
    ['chatgpt', 'mystery', 'unknown'], ['claude', null, 'unknown'],
  ];
  for (const [provider, plan, tier] of table) assert.strictEqual(tierOf(provider, plan), tier, `${provider} ${plan}`);
});

test('a detected plan wins over the user\'s answer, which only fills in while detection cannot tell', () => {
  const answered = { provider: 'claude', planAnswer: 'pro' };
  assert.strictEqual(effectiveTier(answered, 'free'), 'free');
  assert.strictEqual(effectiveTier(answered, 'unknown'), 'paid');
  assert.strictEqual(effectiveTier({ provider: 'claude', planAnswer: 'paid' }, 'unknown'), 'paid');
  assert.strictEqual(effectiveTier({ provider: 'chatgpt', planAnswer: 'business' }, 'unknown'), 'team');
  assert.strictEqual(effectiveTier({ provider: 'claude', planAnswer: null }, 'unknown'), 'unknown');
  assert.strictEqual(eligible(answered, 'unknown'), true);
  assert.strictEqual(eligible({}, 'team'), true);
  assert.strictEqual(eligible({}, 'free'), false);
  assert.strictEqual(eligible({}, 'unknown'), false);
});

const models = [
  { id: '', label: 'Default', efforts: ['low', 'high'] },
  { id: 'big', label: 'Big', efforts: ['low', 'medium', 'high', 'max'] },
  { id: 'small', label: 'Small', efforts: [] },
];

test('a saved model the CLI no longer lists goes back to the default, and so does an unsupported effort', () => {
  assert.strictEqual(healAccount({ model: 'big', effort: 'max' }, models), null);
  assert.deepStrictEqual(healAccount({ model: 'gone', effort: 'low' }, models), { model: '', effort: 'low', modelReset: true });
  assert.deepStrictEqual(healAccount({ model: 'gone', effort: 'max' }, models), { model: '', effort: '', modelReset: true });
  assert.deepStrictEqual(healAccount({ model: 'small', effort: 'low' }, models), { model: 'small', effort: '', modelReset: false });
  assert.strictEqual(healAccount({ model: 'gone', effort: '' }, []), null);
});
