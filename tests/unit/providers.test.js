import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, PROVIDER_ORDER, getCheapestModel, buildProviderChain, SESSION_TIER_MAP, getModelForTier } from '../../src/lib/providers.js';
//
describe('PROVIDERS catalog', () => {
  it('has all expected providers', () => {
    const ids = Object.keys(PROVIDERS);
    assert.ok(ids.includes('thinkdone'));
    assert.ok(ids.includes('gemini'));
    assert.ok(ids.includes('groq'));
    assert.ok(ids.includes('deepseek'));
    assert.ok(ids.includes('grok'));
    assert.ok(ids.includes('openai'));
    assert.ok(ids.includes('anthropic'));
  });
  //
  it('every provider has id, name, models, auth, endpoint', () => {
    for (const [id, p] of Object.entries(PROVIDERS)) {
      assert.equal(p.id, id);
      assert.ok(p.name, `${id} missing name`);
      assert.ok(Array.isArray(p.models) && p.models.length > 0, `${id} missing models`);
      assert.ok(p.auth, `${id} missing auth`);
      assert.ok(p.endpoint, `${id} missing endpoint`);
    }
  });
  //
  it('every model has id, name, input, output cost', () => {
    for (const [pid, p] of Object.entries(PROVIDERS)) {
      for (const m of p.models) {
        assert.ok(m.id, `${pid} model missing id`);
        assert.ok(m.name, `${pid} model missing name`);
        assert.equal(typeof m.input, 'number', `${pid}/${m.id} input not a number`);
        assert.equal(typeof m.output, 'number', `${pid}/${m.id} output not a number`);
      }
    }
  });
  //
  it('thinkdone has builtin auth', () => {
    assert.equal(PROVIDERS.thinkdone.auth, 'builtin');
  });
  //
  it('gemini supports oauth and api_key', () => {
    assert.deepEqual(PROVIDERS.gemini.auth, ['oauth', 'api_key']);
  });
  //
  it('free providers are marked', () => {
    assert.ok(PROVIDERS.gemini.free);
    assert.ok(PROVIDERS.groq.free);
    assert.equal(PROVIDERS.openai.free, undefined);
  });
});
//
describe('PROVIDER_ORDER', () => {
  it('contains all provider IDs', () => {
    const ids = Object.keys(PROVIDERS);
    for (const id of ids) {
      assert.ok(PROVIDER_ORDER.includes(id), `${id} not in PROVIDER_ORDER`);
    }
  });
  //
  it('starts with thinkdone', () => {
    assert.equal(PROVIDER_ORDER[0], 'thinkdone');
  });
});
//
describe('getCheapestModel', () => {
  it('returns cheapest model for gemini (all free)', () => {
    const m = getCheapestModel('gemini');
    assert.ok(m);
    assert.equal(m.input, 0);
    assert.equal(m.output, 0);
  });
  //
  it('returns cheapest model for anthropic (haiku)', () => {
    const m = getCheapestModel('anthropic');
    assert.ok(m);
    assert.equal(m.id, 'claude-haiku-4-5-20251001');
    assert.equal(m.input, 1.0);
  });
  //
  it('returns cheapest model for openai (gpt-4o-mini)', () => {
    const m = getCheapestModel('openai');
    assert.ok(m);
    assert.equal(m.id, 'gpt-4o-mini');
  });
  //
  it('returns cheapest model for deepseek (chat)', () => {
    const m = getCheapestModel('deepseek');
    assert.ok(m);
    assert.equal(m.id, 'deepseek-chat');
  });
  //
  it('returns null for unknown provider', () => {
    assert.equal(getCheapestModel('nonexistent'), null);
  });
});
//
describe('buildProviderChain', () => {
  it('returns empty array when no providers enabled', () => {
    assert.deepEqual(buildProviderChain([], []), []);
  });
  //
  it('includes thinkdone without connection (builtin)', () => {
    const chain = buildProviderChain(['thinkdone'], []);
    assert.equal(chain.length, 1);
    assert.equal(chain[0].providerId, 'thinkdone');
    assert.equal(chain[0].connection, null);
  });
  //
  it('skips providers without connections', () => {
    const chain = buildProviderChain(['openai', 'thinkdone'], []);
    assert.equal(chain.length, 1);
    assert.equal(chain[0].providerId, 'thinkdone');
  });
  //
  it('includes providers with connections', () => {
    const conns = [{ provider: 'openai', access_token: 'sk-test' }];
    const chain = buildProviderChain(['openai', 'thinkdone'], conns);
    assert.equal(chain.length, 2);
  });
  //
  it('sorts free providers first', () => {
    const conns = [
      { provider: 'gemini', access_token: 'AIza-test' },
      { provider: 'openai', access_token: 'sk-test' },
    ];
    const chain = buildProviderChain(['openai', 'gemini', 'thinkdone'], conns);
    assert.equal(chain[0].providerId, 'gemini');
    // openai's cheapest (gpt-4o-mini $0.375 avg) < thinkdone's cheapest (haiku $3 avg)
    assert.equal(chain[1].providerId, 'openai');
    assert.equal(chain[2].providerId, 'thinkdone');
  });
  //
  it('uses cheapest model for each provider with basic tier', () => {
    const conns = [{ provider: 'anthropic', access_token: 'sk-ant-test' }];
    const chain = buildProviderChain(['anthropic'], conns, 'basic');
    assert.equal(chain[0].model, 'claude-haiku-4-5-20251001');
  });
  //
  it('skips unknown provider IDs', () => {
    const chain = buildProviderChain(['nonexistent', 'thinkdone'], []);
    assert.equal(chain.length, 1);
    assert.equal(chain[0].providerId, 'thinkdone');
  });
  //
  it('skips providers with empty access_token', () => {
    const conns = [{ provider: 'openai', access_token: '' }];
    const chain = buildProviderChain(['openai'], conns);
    assert.equal(chain.length, 0);
  });
  //
  it('includes endpoint from catalog', () => {
    const conns = [{ provider: 'groq', access_token: 'gsk_test' }];
    const chain = buildProviderChain(['groq'], conns);
    assert.equal(chain[0].endpoint, '/api/chat/openai');
  });
});
//
describe('SESSION_TIER_MAP', () => {
  it('maps all session types to tiers', () => {
    assert.equal(SESSION_TIER_MAP.check_in, 'basic');
    assert.equal(SESSION_TIER_MAP.morning_meeting, 'standard');
    assert.equal(SESSION_TIER_MAP.evening_review, 'standard');
    assert.equal(SESSION_TIER_MAP.onboarding, 'standard');
    assert.equal(SESSION_TIER_MAP.weekly_review, 'reasoning');
    assert.equal(SESSION_TIER_MAP.strategic, 'reasoning');
  });
});
//
describe('getModelForTier', () => {
  it('returns haiku for basic tier on thinkdone', () => {
    const m = getModelForTier('thinkdone', 'basic');
    assert.ok(m);
    assert.equal(m.id, 'claude-haiku-4-5-20251001');
  });
  //
  it('returns sonnet for standard tier on thinkdone', () => {
    const m = getModelForTier('thinkdone', 'standard');
    assert.ok(m);
    assert.equal(m.id, 'claude-sonnet-4-5-20250929');
  });
  //
  it('returns sonnet for reasoning tier on thinkdone', () => {
    const m = getModelForTier('thinkdone', 'reasoning');
    assert.ok(m);
    assert.equal(m.id, 'claude-sonnet-4-5-20250929');
  });
  //
  it('returns cheapest reasoning model for anthropic', () => {
    const m = getModelForTier('anthropic', 'reasoning');
    assert.ok(m);
    // reasoning keywords: sonnet, pro, gpt-4o, reasoner, grok-2, opus
    // sonnet (3+15=18) < opus (5+25=30), so sonnet wins
    assert.equal(m.id, 'claude-sonnet-4-5-20250929');
  });
  //
  it('returns cheapest mini for basic tier on openai', () => {
    const m = getModelForTier('openai', 'basic');
    assert.ok(m);
    assert.equal(m.id, 'gpt-4o-mini');
  });
  //
  it('returns gpt-4o for reasoning tier on openai', () => {
    const m = getModelForTier('openai', 'reasoning');
    assert.ok(m);
    assert.equal(m.id, 'gpt-4o');
  });
  //
  it('falls back to cheapest when no keyword match', () => {
    // groq with reasoning tier — no models match reasoning keywords
    const m = getModelForTier('groq', 'reasoning');
    assert.ok(m);
  });
  //
  it('returns null for unknown provider', () => {
    assert.equal(getModelForTier('nonexistent', 'basic'), null);
  });
  //
  it('defaults to standard tier when tier not specified', () => {
    const m = getModelForTier('thinkdone');
    assert.ok(m);
    assert.equal(m.id, 'claude-sonnet-4-5-20250929');
  });
});
//
describe('buildProviderChain with tier', () => {
  it('uses tier-appropriate model for thinkdone basic', () => {
    const chain = buildProviderChain(['thinkdone'], [], 'basic');
    assert.equal(chain.length, 1);
    assert.equal(chain[0].model, 'claude-haiku-4-5-20251001');
  });
  //
  it('uses tier-appropriate model for thinkdone reasoning', () => {
    const chain = buildProviderChain(['thinkdone'], [], 'reasoning');
    assert.equal(chain.length, 1);
    assert.equal(chain[0].model, 'claude-sonnet-4-5-20250929');
  });
  //
  it('default tier preserves existing behavior (standard)', () => {
    const chain = buildProviderChain(['thinkdone'], []);
    assert.equal(chain.length, 1);
    assert.equal(chain[0].model, 'claude-sonnet-4-5-20250929');
  });
  //
  it('selects appropriate models across multiple providers', () => {
    const conns = [{ provider: 'openai', access_token: 'sk-test' }];
    const chain = buildProviderChain(['openai', 'thinkdone'], conns, 'basic');
    const td = chain.find(c => c.providerId === 'thinkdone');
    const oa = chain.find(c => c.providerId === 'openai');
    assert.equal(td.model, 'claude-haiku-4-5-20251001');
    assert.equal(oa.model, 'gpt-4o-mini');
  });
});
