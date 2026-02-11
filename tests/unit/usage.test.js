import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, storeUsage, getUsageSummary, getUsageByDay, getUsageBySession, getUsageByModel, getUsageByProvider, getCacheSavings } from '../../src/lib/db.js';
import { calculateCost, formatCost, formatTokens } from '../../src/lib/usage.js';

let db;

beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
});

describe('calculateCost', () => {
  it('returns correct cost for claude-sonnet', () => {
    // 1000 input * 3.0/1M + 500 output * 15.0/1M = 0.003 + 0.0075 = 0.0105
    const cost = calculateCost('claude-sonnet-4-5-20250929', 1000, 500);
    assert.equal(cost, 0.0105);
  });

  it('returns correct cost for claude-haiku', () => {
    // 1000 * 1.0/1M + 500 * 5.0/1M = 0.001 + 0.0025 = 0.0035
    const cost = calculateCost('claude-haiku-4-5-20251001', 1000, 500);
    assert.equal(cost, 0.0035);
  });

  it('returns correct cost for claude-opus', () => {
    // 1000 * 5.0/1M + 500 * 25.0/1M = 0.005 + 0.0125 = 0.0175
    const cost = calculateCost('claude-opus-4-5-20250929', 1000, 500);
    assert.equal(cost, 0.0175);
  });

  it('uses fallback pricing for unknown models', () => {
    // Falls back to sonnet pricing: 3.0 input, 15.0 output
    const cost = calculateCost('claude-unknown-model', 1000, 500);
    assert.equal(cost, 0.0105);
  });
});

describe('formatCost', () => {
  it('formats to nearest penny', () => {
    assert.equal(formatCost(1.5), '$1.50');
    assert.equal(formatCost(12.345), '$12.35');
    assert.equal(formatCost(0.0105), '$0.01');
    assert.equal(formatCost(0.05), '$0.05');
    assert.equal(formatCost(0.001234), '$0.00');
    assert.equal(formatCost(0), '$0.00');
  });
});

describe('formatTokens', () => {
  it('formats millions', () => {
    assert.equal(formatTokens(1_500_000), '1.5M');
    assert.equal(formatTokens(2_000_000), '2.0M');
  });

  it('formats thousands', () => {
    assert.equal(formatTokens(1200), '1.2K');
    assert.equal(formatTokens(45300), '45.3K');
  });

  it('returns raw number for small values', () => {
    assert.equal(formatTokens(500), '500');
    assert.equal(formatTokens(0), '0');
  });
});

describe('storeUsage', () => {
  it('inserts a usage row', async () => {
    await storeUsage(db, {
      sessionType: 'morning_meeting',
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.0105,
    });

    const rows = await db.prepare('SELECT * FROM api_usage').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].model, 'claude-sonnet-4-5-20250929');
    assert.equal(rows[0].input_tokens, 1000);
    assert.equal(rows[0].output_tokens, 500);
    assert.equal(rows[0].cost_usd, 0.0105);
    assert.equal(rows[0].session_type, 'morning_meeting');
  });

  it('stores optional conversationId', async () => {
    await storeUsage(db, {
      conversationId: 42,
      sessionType: 'chat',
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });

    const row = await db.prepare('SELECT conversation_id FROM api_usage WHERE id = 1').get();
    assert.equal(row.conversation_id, 42);
  });
});

describe('getUsageSummary', () => {
  beforeEach(async () => {
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500, costUsd: 0.01, createdAt: '2026-02-01T10:00:00Z' });
    await storeUsage(db, { sessionType: 'check_in', model: 'claude-sonnet-4-5-20250929', inputTokens: 2000, outputTokens: 1000, costUsd: 0.02, createdAt: '2026-02-02T10:00:00Z' });
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-haiku-4-5-20251001', inputTokens: 500, outputTokens: 200, costUsd: 0.005, createdAt: '2026-02-03T10:00:00Z' });
  });

  it('aggregates totals for a date range', async () => {
    const summary = await getUsageSummary(db, { from: '2026-02-01', to: '2026-02-28' });
    assert.equal(summary.total_input, 3500);
    assert.equal(summary.total_output, 1700);
    assert.equal(summary.total_cost, 0.035);
    assert.equal(summary.session_count, 3);
  });

  it('filters by date range', async () => {
    const summary = await getUsageSummary(db, { from: '2026-02-02', to: '2026-02-02' });
    assert.equal(summary.total_input, 2000);
    assert.equal(summary.session_count, 1);
  });
});

describe('getUsageByDay', () => {
  beforeEach(async () => {
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500, costUsd: 0.01, createdAt: '2026-02-01T10:00:00Z' });
    await storeUsage(db, { sessionType: 'check_in', model: 'claude-sonnet-4-5-20250929', inputTokens: 2000, outputTokens: 1000, costUsd: 0.02, createdAt: '2026-02-01T14:00:00Z' });
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-sonnet-4-5-20250929', inputTokens: 500, outputTokens: 200, costUsd: 0.005, createdAt: '2026-02-02T10:00:00Z' });
  });

  it('groups usage by date', async () => {
    const days = await getUsageByDay(db, { from: '2026-02-01', to: '2026-02-28' });
    assert.equal(days.length, 2);
    assert.equal(days[0].date, '2026-02-01');
    assert.equal(days[0].total_input, 3000);
    assert.equal(days[0].sessions, 2);
    assert.equal(days[1].date, '2026-02-02');
    assert.equal(days[1].total_input, 500);
  });
});

describe('getUsageBySession', () => {
  beforeEach(async () => {
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500, costUsd: 0.01, createdAt: '2026-02-01T10:00:00Z' });
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-sonnet-4-5-20250929', inputTokens: 2000, outputTokens: 1000, costUsd: 0.02, createdAt: '2026-02-02T10:00:00Z' });
    await storeUsage(db, { sessionType: 'check_in', model: 'claude-sonnet-4-5-20250929', inputTokens: 500, outputTokens: 200, costUsd: 0.005, createdAt: '2026-02-01T14:00:00Z' });
  });

  it('groups usage by session type', async () => {
    const types = await getUsageBySession(db, { from: '2026-02-01', to: '2026-02-28' });
    assert.equal(types.length, 2);

    const morning = types.find(t => t.session_type === 'morning_meeting');
    const checkin = types.find(t => t.session_type === 'check_in');

    assert.equal(morning.sessions, 2);
    assert.equal(morning.total_input, 3000);
    assert.equal(checkin.sessions, 1);
    assert.equal(checkin.total_input, 500);
  });
});
//
// === Cache-aware usage tests ===
//
describe('calculateCost with cache tokens', () => {
  it('reduces cost for cache read tokens (90% savings)', () => {
    // 1000 input, 500 output, 200 cache read
    // Regular: (1000-200) * 3.0/1M = 0.0024
    // Cache read: 200 * 3.0 * 0.1/1M = 0.00006
    // Output: 500 * 15.0/1M = 0.0075
    // Total: 0.009960
    const cost = calculateCost('claude-sonnet-4-5-20250929', 1000, 500, { cacheReadTokens: 200 });
    assert.ok(Math.abs(cost - 0.00996) < 0.0001);
  });
  it('increases cost for cache write tokens (125% surcharge)', () => {
    // 1000 input, 500 output, 300 cache write
    // Regular: (1000-300) * 3.0/1M = 0.0021
    // Cache write: 300 * 3.0 * 1.25/1M = 0.001125
    // Output: 500 * 15.0/1M = 0.0075
    // Total: 0.010725
    const cost = calculateCost('claude-sonnet-4-5-20250929', 1000, 500, { cacheWriteTokens: 300 });
    assert.ok(Math.abs(cost - 0.010725) < 0.0001);
  });
  it('handles both read and write cache tokens', () => {
    const cost = calculateCost('claude-sonnet-4-5-20250929', 1000, 500, { cacheReadTokens: 200, cacheWriteTokens: 300 });
    // Regular: (1000-200-300) * 3.0/1M = 0.0015
    // Cache read: 200 * 3.0 * 0.1/1M = 0.00006
    // Cache write: 300 * 3.0 * 1.25/1M = 0.001125
    // Output: 500 * 15.0/1M = 0.0075
    // Total: 0.010185
    assert.ok(Math.abs(cost - 0.010185) < 0.0001);
  });
  it('backward compatible — no cache params same as before', () => {
    const withParams = calculateCost('claude-sonnet-4-5-20250929', 1000, 500, {});
    const without = calculateCost('claude-sonnet-4-5-20250929', 1000, 500);
    assert.equal(withParams, without);
    assert.equal(without, 0.0105);
  });
});
//
describe('storeUsage with cache columns', () => {
  it('stores provider and cache tokens', async () => {
    const id = await storeUsage(db, {
      sessionType: 'morning_meeting',
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.01,
      provider: 'anthropic',
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
    });
    const row = await db.prepare('SELECT provider, cache_read_tokens, cache_write_tokens FROM api_usage WHERE id = ?').get(id);
    assert.equal(row.provider, 'anthropic');
    assert.equal(row.cache_read_tokens, 200);
    assert.equal(row.cache_write_tokens, 100);
  });
  it('defaults cache columns to 0 and provider to null', async () => {
    const id = await storeUsage(db, {
      sessionType: 'check_in',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 500,
      outputTokens: 200,
      costUsd: 0.003,
    });
    const row = await db.prepare('SELECT provider, cache_read_tokens, cache_write_tokens FROM api_usage WHERE id = ?').get(id);
    assert.equal(row.provider, null);
    assert.equal(row.cache_read_tokens, 0);
    assert.equal(row.cache_write_tokens, 0);
  });
});
//
describe('getUsageByModel', () => {
  it('groups usage by model', async () => {
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500, costUsd: 0.01, createdAt: '2026-02-01T10:00:00Z' });
    await storeUsage(db, { sessionType: 'check_in', model: 'claude-haiku-4-5-20251001', inputTokens: 500, outputTokens: 200, costUsd: 0.003, createdAt: '2026-02-01T14:00:00Z' });
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-sonnet-4-5-20250929', inputTokens: 2000, outputTokens: 1000, costUsd: 0.02, createdAt: '2026-02-02T10:00:00Z' });
    const models = await getUsageByModel(db, { from: '2026-02-01', to: '2026-02-28' });
    assert.equal(models.length, 2);
    const sonnet = models.find(m => m.model === 'claude-sonnet-4-5-20250929');
    assert.equal(sonnet.sessions, 2);
    assert.equal(sonnet.total_input, 3000);
  });
});
//
describe('getUsageByProvider', () => {
  it('groups usage by provider', async () => {
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500, costUsd: 0.01, provider: 'thinkdone', createdAt: '2026-02-01T10:00:00Z' });
    await storeUsage(db, { sessionType: 'check_in', model: 'gemini-2.0-flash', inputTokens: 500, outputTokens: 200, costUsd: 0.0, provider: 'gemini', createdAt: '2026-02-01T14:00:00Z' });
    const providers = await getUsageByProvider(db, { from: '2026-02-01', to: '2026-02-28' });
    assert.equal(providers.length, 2);
  });
});
//
describe('getCacheSavings', () => {
  it('returns cache read/write totals', async () => {
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500, costUsd: 0.01, cacheReadTokens: 300, cacheWriteTokens: 100, createdAt: '2026-02-01T10:00:00Z' });
    await storeUsage(db, { sessionType: 'check_in', model: 'claude-sonnet-4-5-20250929', inputTokens: 2000, outputTokens: 800, costUsd: 0.02, cacheReadTokens: 500, createdAt: '2026-02-02T10:00:00Z' });
    const savings = await getCacheSavings(db, { from: '2026-02-01', to: '2026-02-28' });
    assert.equal(savings.total_input, 3000);
    assert.equal(savings.total_cache_read, 800);
    assert.equal(savings.total_cache_write, 100);
  });
});
//
describe('getUsageByDay with cache columns', () => {
  it('includes cache_read and cache_write in daily data', async () => {
    await storeUsage(db, { sessionType: 'morning_meeting', model: 'claude-sonnet-4-5-20250929', inputTokens: 1000, outputTokens: 500, costUsd: 0.01, cacheReadTokens: 200, cacheWriteTokens: 50, createdAt: '2026-02-01T10:00:00Z' });
    await storeUsage(db, { sessionType: 'check_in', model: 'claude-sonnet-4-5-20250929', inputTokens: 2000, outputTokens: 1000, costUsd: 0.02, cacheReadTokens: 400, cacheWriteTokens: 100, createdAt: '2026-02-01T14:00:00Z' });
    const days = await getUsageByDay(db, { from: '2026-02-01', to: '2026-02-28' });
    assert.equal(days.length, 1);
    assert.equal(days[0].cache_read, 600);
    assert.equal(days[0].cache_write, 150);
  });
});
