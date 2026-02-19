import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, PROVIDER_ORDER, PROVIDER_GROUPS, getCheapestModel, buildProviderChain, SESSION_TIER_MAP, getModelForTier, parseCustomProviders, getAllProviders, getFetchedModels, getEffectiveModels, formatProviderPricing } from '../../src/lib/providers.js';
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
    assert.ok(ids.includes('mistral'));
    assert.ok(ids.includes('together'));
    assert.ok(ids.includes('fireworks'));
    assert.ok(ids.includes('openrouter'));
    assert.ok(ids.includes('perplexity'));
    assert.ok(ids.includes('ollama'));
    assert.ok(ids.includes('lmstudio'));
    assert.ok(ids.includes('kimi'));
  });
  //
  it('every provider has id, name, auth, endpoint', () => {
    for (const [id, p] of Object.entries(PROVIDERS)) {
      assert.equal(p.id, id);
      assert.ok(p.name, `${id} missing name`);
      assert.ok(p.auth, `${id} missing auth`);
      assert.ok(p.endpoint, `${id} missing endpoint`);
    }
  });
  //
  it('every non-local provider has models', () => {
    for (const [id, p] of Object.entries(PROVIDERS)) {
      if (p.local) {
        assert.ok(Array.isArray(p.models), `${id} models should be array`);
      } else {
        assert.ok(Array.isArray(p.models) && p.models.length > 0, `${id} missing models`);
      }
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
  //
  it('local providers have local flag and empty models', () => {
    assert.ok(PROVIDERS.ollama.local);
    assert.ok(PROVIDERS.lmstudio.local);
    assert.equal(PROVIDERS.ollama.auth, 'local');
    assert.equal(PROVIDERS.lmstudio.auth, 'local');
    assert.deepEqual(PROVIDERS.ollama.models, []);
    assert.deepEqual(PROVIDERS.lmstudio.models, []);
  });
  //
  it('local providers have sensible default apiBase', () => {
    assert.ok(PROVIDERS.ollama.apiBase.includes('11434'));
    assert.ok(PROVIDERS.lmstudio.apiBase.includes('1234'));
  });
  //
  it('new cloud providers use openai endpoint', () => {
    for (const id of ['mistral', 'together', 'fireworks', 'openrouter', 'perplexity', 'kimi']) {
      assert.equal(PROVIDERS[id].endpoint, '/api/chat/openai');
      assert.ok(PROVIDERS[id].apiBase, `${id} missing apiBase`);
    }
  });
});
//
describe('PROVIDER_GROUPS', () => {
  it('is an array of groups with label and ids', () => {
    assert.ok(Array.isArray(PROVIDER_GROUPS));
    for (const g of PROVIDER_GROUPS) {
      assert.ok(g.label);
      assert.ok(Array.isArray(g.ids));
      assert.ok(g.ids.length > 0);
    }
  });
  //
  it('covers all built-in providers', () => {
    const allGroupIds = PROVIDER_GROUPS.flatMap(g => g.ids);
    for (const id of Object.keys(PROVIDERS)) {
      assert.ok(allGroupIds.includes(id), `${id} not in any group`);
    }
  });
  //
  it('has no duplicates across groups', () => {
    const allGroupIds = PROVIDER_GROUPS.flatMap(g => g.ids);
    assert.equal(allGroupIds.length, new Set(allGroupIds).size);
  });
  //
  it('local group contains ollama and lmstudio', () => {
    const localGroup = PROVIDER_GROUPS.find(g => g.label === 'Local');
    assert.ok(localGroup);
    assert.ok(localGroup.ids.includes('ollama'));
    assert.ok(localGroup.ids.includes('lmstudio'));
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
  //
  it('matches PROVIDER_GROUPS flatMap', () => {
    assert.deepEqual(PROVIDER_ORDER, PROVIDER_GROUPS.flatMap(g => g.ids));
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
  //
  it('returns null for local provider with no models', () => {
    assert.equal(getCheapestModel('ollama'), null);
  });
  //
  it('returns cheapest capable model for mistral (small, skips weak nemo)', () => {
    const m = getCheapestModel('mistral');
    assert.ok(m);
    assert.equal(m.id, 'mistral-small-latest');
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
  //
  it('includes local provider with model from scopes', () => {
    const conns = [{ provider: 'ollama', scopes: JSON.stringify({ modelId: 'llama3.2', baseUrl: 'http://localhost:11434/v1' }) }];
    const chain = buildProviderChain(['ollama'], conns);
    assert.equal(chain.length, 1);
    assert.equal(chain[0].providerId, 'ollama');
    assert.equal(chain[0].model, 'llama3.2');
  });
  //
  it('skips local provider without model in scopes', () => {
    const conns = [{ provider: 'ollama', scopes: '{}' }];
    const chain = buildProviderChain(['ollama'], conns);
    assert.equal(chain.length, 0);
  });
  //
  it('includes local provider without access_token', () => {
    const conns = [{ provider: 'ollama', scopes: JSON.stringify({ modelId: 'llama3.2' }) }];
    const chain = buildProviderChain(['ollama'], conns);
    assert.equal(chain.length, 1);
  });
  //
  it('accepts allProviders param for custom providers', () => {
    const custom = {
      ...PROVIDERS,
      'my-custom': {
        id: 'my-custom', name: 'My Custom', auth: 'local',
        endpoint: '/api/chat/openai', models: [], local: true,
        apiBase: 'http://gpu:8000/v1',
      },
    };
    const conns = [{ provider: 'my-custom', scopes: JSON.stringify({ modelId: 'mistral-7b' }) }];
    const chain = buildProviderChain(['my-custom', 'thinkdone'], conns, 'standard', custom);
    assert.equal(chain.length, 2);
    assert.ok(chain.some(c => c.providerId === 'my-custom' && c.model === 'mistral-7b'));
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
  //
  it('returns null for local provider with no models', () => {
    assert.equal(getModelForTier('ollama', 'standard'), null);
  });
  //
  it('returns small for basic tier on mistral (skips weak nemo)', () => {
    const m = getModelForTier('mistral', 'basic');
    assert.ok(m);
    assert.ok(m.id.includes('small'));
  });
  //
  it('returns large for reasoning tier on mistral', () => {
    const m = getModelForTier('mistral', 'reasoning');
    assert.ok(m);
    assert.ok(m.id.includes('large'));
  });
  //
  it('returns sonar for basic tier on perplexity', () => {
    const m = getModelForTier('perplexity', 'basic');
    assert.ok(m);
    assert.equal(m.id, 'sonar');
  });
  //
  it('returns sonar-pro for reasoning tier on perplexity', () => {
    const m = getModelForTier('perplexity', 'reasoning');
    assert.ok(m);
    assert.equal(m.id, 'sonar-pro');
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
//
describe('parseCustomProviders', () => {
  it('returns empty array for null/undefined', () => {
    assert.deepEqual(parseCustomProviders(null), []);
    assert.deepEqual(parseCustomProviders(undefined), []);
    assert.deepEqual(parseCustomProviders(''), []);
  });
  //
  it('returns empty array for invalid JSON', () => {
    assert.deepEqual(parseCustomProviders('not json'), []);
  });
  //
  it('returns empty array for non-array JSON', () => {
    assert.deepEqual(parseCustomProviders('{}'), []);
  });
  //
  it('parses valid custom provider', () => {
    const json = JSON.stringify([{ id: 'custom-1', name: 'My vLLM', baseUrl: 'http://gpu:8000/v1' }]);
    const result = parseCustomProviders(json);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'custom-1');
    assert.equal(result[0].name, 'My vLLM');
    assert.equal(result[0].apiBase, 'http://gpu:8000/v1');
    assert.equal(result[0].auth, 'local');
    assert.ok(result[0].local);
    assert.ok(result[0].custom);
    assert.equal(result[0].endpoint, '/api/chat/openai');
  });
  //
  it('skips entries missing required fields', () => {
    const json = JSON.stringify([
      { id: 'ok', name: 'OK', baseUrl: 'http://localhost:8000/v1' },
      { id: 'no-name', baseUrl: 'http://x/v1' },
      { name: 'no-id', baseUrl: 'http://x/v1' },
      { id: 'no-url', name: 'No URL' },
    ]);
    const result = parseCustomProviders(json);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'ok');
  });
});
//
describe('getAllProviders', () => {
  it('returns PROVIDERS when no custom JSON', () => {
    const result = getAllProviders(null);
    assert.equal(result, PROVIDERS);
  });
  //
  it('returns PROVIDERS when empty custom JSON', () => {
    const result = getAllProviders('[]');
    assert.equal(result, PROVIDERS);
  });
  //
  it('merges custom providers into catalog', () => {
    const json = JSON.stringify([{ id: 'custom-1', name: 'My GPU', baseUrl: 'http://gpu:8000/v1' }]);
    const result = getAllProviders(json);
    assert.ok(result['custom-1']);
    assert.equal(result['custom-1'].name, 'My GPU');
    assert.ok(result.thinkdone); // built-ins still present
    assert.ok(result.openai);
  });
  //
  it('does not mutate original PROVIDERS', () => {
    const json = JSON.stringify([{ id: 'custom-x', name: 'X', baseUrl: 'http://x/v1' }]);
    getAllProviders(json);
    assert.equal(PROVIDERS['custom-x'], undefined);
  });
});
//
describe('getFetchedModels', () => {
  it('returns empty array for null connection', () => {
    assert.deepEqual(getFetchedModels(null), []);
  });
  //
  it('returns empty array for connection without scopes', () => {
    assert.deepEqual(getFetchedModels({}), []);
  });
  //
  it('returns empty array for invalid scopes JSON', () => {
    assert.deepEqual(getFetchedModels({ scopes: 'bad json' }), []);
  });
  //
  it('returns empty array when scopes has no models', () => {
    assert.deepEqual(getFetchedModels({ scopes: '{}' }), []);
  });
  //
  it('returns models from scopes JSON', () => {
    const conn = { scopes: JSON.stringify({ models: [{ id: 'llama3', name: 'Llama 3' }] }) };
    const result = getFetchedModels(conn);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'llama3');
    assert.equal(result[0].name, 'Llama 3');
  });
  //
  it('returns empty when models is not an array', () => {
    const conn = { scopes: JSON.stringify({ models: 'not-array' }) };
    assert.deepEqual(getFetchedModels(conn), []);
  });
});
//
describe('getEffectiveModels', () => {
  it('returns empty for unknown provider', () => {
    assert.deepEqual(getEffectiveModels('nonexistent', null), []);
  });
  //
  it('returns hardcoded models for providers with models', () => {
    const result = getEffectiveModels('openai', null);
    assert.ok(result.length > 0);
    assert.equal(result[0].id, 'gpt-4o');
  });
  //
  it('returns fetched models for local provider with scopes', () => {
    const conn = { scopes: JSON.stringify({ models: [{ id: 'llama3', name: 'Llama 3' }] }) };
    const result = getEffectiveModels('ollama', conn);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'llama3');
    assert.equal(result[0].input, 0);
    assert.equal(result[0].output, 0);
  });
  //
  it('returns empty for local provider without scopes', () => {
    assert.deepEqual(getEffectiveModels('ollama', null), []);
  });
  //
  it('uses allProviders param for custom providers', () => {
    const custom = {
      ...PROVIDERS,
      'my-gpu': { id: 'my-gpu', name: 'GPU', auth: 'local', endpoint: '/api/chat/openai', models: [], local: true },
    };
    const conn = { scopes: JSON.stringify({ models: [{ id: 'mistral-7b' }] }) };
    const result = getEffectiveModels('my-gpu', conn, custom);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'mistral-7b');
  });
});
//
describe('formatProviderPricing', () => {
  it('returns Default for thinkdone', () => {
    assert.equal(formatProviderPricing('thinkdone'), 'Default');
  });
  //
  it('returns Free tier for free providers', () => {
    assert.equal(formatProviderPricing('gemini'), 'Free tier');
    assert.equal(formatProviderPricing('groq'), 'Free tier');
  });
  //
  it('returns Self-hosted for local providers', () => {
    assert.equal(formatProviderPricing('ollama'), 'Self-hosted');
    assert.equal(formatProviderPricing('lmstudio'), 'Self-hosted');
  });
  //
  it('returns dollar price for paid providers', () => {
    const pricing = formatProviderPricing('openai');
    assert.ok(pricing.startsWith('From $'));
    assert.ok(pricing.includes('MTok'));
  });
  //
  it('returns empty for unknown provider', () => {
    assert.equal(formatProviderPricing('nonexistent'), '');
  });
  //
  it('returns price based on cheapest model', () => {
    const pricing = formatProviderPricing('deepseek');
    assert.ok(pricing.includes('0.14'));
  });
});
//
describe('buildProviderChain with fetched models', () => {
  it('includes local provider with fetched models in scopes', () => {
    const conns = [{
      provider: 'ollama',
      scopes: JSON.stringify({ models: [{ id: 'llama3.2', name: 'Llama 3.2' }] }),
    }];
    const chain = buildProviderChain(['ollama'], conns);
    assert.equal(chain.length, 1);
    assert.equal(chain[0].providerId, 'ollama');
    assert.equal(chain[0].model, 'llama3.2');
  });
  //
  it('uses tier keywords to select from fetched models', () => {
    const conns = [{
      provider: 'ollama',
      scopes: JSON.stringify({ models: [
        { id: 'llama3.2:70b', name: 'Llama 3.2 70B' },
        { id: 'llama3.2:8b', name: 'Llama 3.2 8B' },
      ]}),
    }];
    const chain = buildProviderChain(['ollama'], conns, 'basic');
    assert.equal(chain[0].model, 'llama3.2:8b');
  });
  //
  it('falls back to first fetched model when no tier match', () => {
    const conns = [{
      provider: 'ollama',
      scopes: JSON.stringify({ models: [{ id: 'custom-model', name: 'Custom' }] }),
    }];
    const chain = buildProviderChain(['ollama'], conns);
    assert.equal(chain[0].model, 'custom-model');
  });
  //
  it('prefers fetched models over legacy modelId', () => {
    const conns = [{
      provider: 'ollama',
      scopes: JSON.stringify({ modelId: 'old-model', models: [{ id: 'new-model', name: 'New' }] }),
    }];
    const chain = buildProviderChain(['ollama'], conns);
    assert.equal(chain[0].model, 'new-model');
  });
});
