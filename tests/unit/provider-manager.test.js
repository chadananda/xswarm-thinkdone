import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, seedPersonality, upsertConnection, setSetting, storeUsage } from '../../src/lib/db.js';
import { createProviderManager } from '../../src/lib/provider-manager.js';
//
let db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
  await seedPersonality(db);
});
//
describe('createProviderManager', () => {
  it('returns an object with expected methods', async () => {
    const pm = await createProviderManager(db);
    assert.equal(typeof pm.init, 'function');
    assert.equal(typeof pm.callAI, 'function');
    assert.equal(typeof pm.trackUsage, 'function');
    assert.equal(typeof pm.getExtractionCredentials, 'function');
    assert.equal(typeof pm.extractionOpts, 'function');
    assert.ok('primary' in pm);
  });
});
//
describe('init', () => {
  it('builds chains for all 3 tiers with thinkdone (builtin)', async () => {
    const pm = await createProviderManager(db);
    await pm.init();
    const p = pm.primary;
    assert.ok(p);
    assert.equal(p.id, 'thinkdone');
  });
  //
  it('uses enabled providers from settings', async () => {
    await setSetting(db, 'ai_providers_enabled', JSON.stringify(['thinkdone']));
    const pm = await createProviderManager(db);
    await pm.init();
    assert.equal(pm.primary.id, 'thinkdone');
  });
  //
  it('auto-enables providers that have connections', async () => {
    await upsertConnection(db, 'gemini', { access_token: 'AIzaSy-test', refresh_token: '', expires_at: 0 });
    const pm = await createProviderManager(db);
    await pm.init();
    // Gemini should be in the chain (free, sorted first)
    assert.equal(pm.primary.id, 'gemini');
  });
  //
  it('fires provider-update event on init', async () => {
    let eventFired = false;
    const origDispatch = globalThis.window?.dispatchEvent;
    globalThis.window = { dispatchEvent: (e) => { if (e.type === 'provider-update') eventFired = true; } };
    try {
      const pm = await createProviderManager(db);
      await pm.init();
      assert.ok(eventFired);
    } finally {
      if (origDispatch) globalThis.window.dispatchEvent = origDispatch;
      else delete globalThis.window;
    }
  });
});
//
describe('callAI', () => {
  it('calls the chain and returns response + provider', async () => {
    // Inject a mock chain
    const pm = await createProviderManager(db);
    await pm.init();
    // Override internal callAI to test the interface
    const mockResult = { response: { ok: true, body: 'test' }, provider: { providerId: 'thinkdone', model: 'test-model' } };
    pm._setCallFn(async () => mockResult);
    const result = await pm.callAI({ system: 'test', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.response.ok, true);
    assert.equal(result.provider.providerId, 'thinkdone');
  });
  //
  it('defaults to standard tier', async () => {
    const pm = await createProviderManager(db);
    await pm.init();
    let usedTier = null;
    pm._setCallFn(async (chain, opts) => {
      usedTier = chain._tier;
      return { response: { ok: true }, provider: chain[0] };
    });
    await pm.callAI({ system: 'test', messages: [] });
    assert.equal(usedTier, 'standard');
  });
  //
  it('respects tier parameter', async () => {
    const pm = await createProviderManager(db);
    await pm.init();
    let usedTier = null;
    pm._setCallFn(async (chain) => {
      usedTier = chain._tier;
      return { response: { ok: true }, provider: chain[0] };
    });
    await pm.callAI({ system: 'test', messages: [], tier: 'basic' });
    assert.equal(usedTier, 'basic');
  });
  //
  it('persists refreshed tokens automatically', async () => {
    await upsertConnection(db, 'gemini', {
      access_token: 'old-token',
      refresh_token: 'rt-test',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const pm = await createProviderManager(db);
    await pm.init();
    pm._setCallFn(async (chain) => {
      // Simulate a token refresh
      const provider = { ...chain[0], connection: { ...chain[0].connection, _refreshed: true, access_token: 'new-token', expires_at: 9999999999, provider: 'gemini' } };
      return { response: { ok: true }, provider };
    });
    await pm.callAI({ system: 'test', messages: [] });
    // Verify token was persisted
    const conn = await db.prepare('SELECT access_token FROM connections WHERE provider = ?').get('gemini');
    assert.equal(conn.access_token, 'new-token');
  });
});
//
describe('trackUsage', () => {
  it('stores usage in api_usage table', async () => {
    const pm = await createProviderManager(db);
    await pm.init();
    await pm.trackUsage({
      usage: { model: 'claude-sonnet-4-5-20250929', input_tokens: 100, output_tokens: 50 },
      usedProvider: { providerId: 'thinkdone' },
    }, 'morning_meeting');
    const row = await db.prepare('SELECT * FROM api_usage ORDER BY id DESC LIMIT 1').get();
    assert.ok(row);
    assert.equal(row.model, 'claude-sonnet-4-5-20250929');
    assert.equal(row.input_tokens, 100);
    assert.equal(row.provider, 'thinkdone');
  });
  //
  it('fires statusbar-refresh event', async () => {
    let eventFired = false;
    globalThis.window = { dispatchEvent: (e) => { if (e.type === 'statusbar-refresh') eventFired = true; } };
    try {
      const pm = await createProviderManager(db);
      await pm.init();
      await pm.trackUsage({
        usage: { model: 'test', input_tokens: 1, output_tokens: 1 },
        usedProvider: { providerId: 'thinkdone' },
      }, 'check_in');
      assert.ok(eventFired);
    } finally {
      delete globalThis.window;
    }
  });
  //
  it('no-ops when usage is null', async () => {
    const pm = await createProviderManager(db);
    await pm.init();
    await pm.trackUsage({ usage: null }, 'check_in');
    const row = await db.prepare('SELECT COUNT(*) as c FROM api_usage').get();
    assert.equal(row.c, 0);
  });
});
//
describe('getExtractionCredentials', () => {
  it('returns null when no Gemini-compatible credentials', async () => {
    const pm = await createProviderManager(db);
    await pm.init();
    const creds = pm.getExtractionCredentials();
    assert.equal(creds.apiKey, undefined);
    assert.equal(creds.accessToken, undefined);
  });
  //
  it('returns apiKey for Gemini API key connection', async () => {
    await upsertConnection(db, 'gemini', { access_token: 'AIzaSy-test', refresh_token: '', expires_at: 0 });
    const pm = await createProviderManager(db);
    await pm.init();
    const creds = pm.getExtractionCredentials();
    assert.equal(creds.apiKey, 'AIzaSy-test');
  });
  //
  it('returns accessToken for Gemini OAuth connection', async () => {
    await upsertConnection(db, 'gemini', {
      access_token: 'ya29.test',
      refresh_token: 'rt-test',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const pm = await createProviderManager(db);
    await pm.init();
    const creds = pm.getExtractionCredentials();
    assert.equal(creds.accessToken, 'ya29.test');
  });
});
//
describe('extractionOpts', () => {
  it('returns object with credentials and optional extras', async () => {
    await upsertConnection(db, 'gemini', { access_token: 'AIzaSy-test', refresh_token: '', expires_at: 0 });
    const pm = await createProviderManager(db);
    await pm.init();
    const opts = pm.extractionOpts({ agenda: [{ id: 'a1' }], meetingType: 'morning_meeting' });
    assert.equal(opts.apiKey, 'AIzaSy-test');
    assert.deepEqual(opts.agenda, [{ id: 'a1' }]);
    assert.equal(opts.meetingType, 'morning_meeting');
  });
  //
  it('works with no extras', async () => {
    const pm = await createProviderManager(db);
    await pm.init();
    const opts = pm.extractionOpts();
    assert.equal(typeof opts, 'object');
  });
});
//
describe('primary', () => {
  it('returns primary provider info', async () => {
    const pm = await createProviderManager(db);
    await pm.init();
    const p = pm.primary;
    assert.ok(p.id);
    assert.ok(p.name);
    assert.ok(p.model);
  });
  //
  it('returns null before init', async () => {
    const pm = await createProviderManager(db);
    assert.equal(pm.primary, null);
  });
});
//
describe('getSpeechCredentials', () => {
  it('returns credentials for a connected provider', async () => {
    await upsertConnection(db, 'gemini', {
      access_token: 'speech-key',
      refresh_token: 'rt-speech',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const pm = await createProviderManager(db);
    await pm.init();
    const creds = await pm.getSpeechCredentials('gemini');
    assert.ok(creds);
    assert.equal(creds.apiKey, 'speech-key');
    assert.equal(creds.isOAuth, true);
  });
  //
  it('returns null for unconnected provider', async () => {
    const pm = await createProviderManager(db);
    await pm.init();
    const creds = await pm.getSpeechCredentials('gemini');
    assert.equal(creds, null);
  });
});
