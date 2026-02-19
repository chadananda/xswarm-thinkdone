import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import {
  ensureSchema, clearDatabase,
  getSetting, setSetting, getAllSettings,
  getConnection, upsertConnection, removeConnection, updateAccessToken,
} from '../../src/lib/db.js';
//
let db;
//
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
});
//
describe('Settings CRUD', () => {
  it('seeds default settings on ensureSchema', async () => {
    const all = await getAllSettings(db);
    const keys = all.map(s => s.key);
    assert.ok(keys.includes('ai_providers_enabled'));
    assert.ok(keys.includes('voice_provider'));
    assert.ok(keys.includes('display_name'));
    assert.equal(all.find(s => s.key === 'ai_providers_enabled').value, '["thinkdone"]');
    assert.equal(all.find(s => s.key === 'voice_provider').value, 'web-speech');
    assert.equal(all.find(s => s.key === 'display_name').value, 'User');
  });
  //
  it('getSetting returns value for existing key', async () => {
    const val = await getSetting(db, 'ai_providers_enabled');
    assert.equal(val, '["thinkdone"]');
  });
  //
  it('getSetting returns null for missing key', async () => {
    const val = await getSetting(db, 'nonexistent');
    assert.equal(val, null);
  });
  //
  it('setSetting inserts a new key', async () => {
    await setSetting(db, 'theme', 'dark');
    const val = await getSetting(db, 'theme');
    assert.equal(val, 'dark');
  });
  //
  it('setSetting upserts an existing key', async () => {
    await setSetting(db, 'ai_providers_enabled', '["thinkdone","gemini"]');
    const val = await getSetting(db, 'ai_providers_enabled');
    assert.equal(val, '["thinkdone","gemini"]');
  });
  //
  it('getAllSettings returns all rows', async () => {
    await setSetting(db, 'custom_key', 'custom_val');
    const all = await getAllSettings(db);
    assert.ok(all.length >= 4); // 3 defaults + 1 custom
    assert.ok(all.find(s => s.key === 'custom_key'));
  });
  //
  it('default settings are not overwritten on re-run of ensureSchema', async () => {
    await setSetting(db, 'ai_providers_enabled', '["thinkdone","gemini"]');
    await ensureSchema(db);
    const val = await getSetting(db, 'ai_providers_enabled');
    assert.equal(val, '["thinkdone","gemini"]');
  });
});
//
describe('Connections CRUD', () => {
  const googleData = {
    email: 'chad@example.com',
    name: 'Chad',
    access_token: 'access_123',
    refresh_token: 'refresh_456',
    expires_at: 1700000000,
    scopes: 'calendar,email',
  };
  //
  it('getConnection returns null when none exists', async () => {
    const conn = await getConnection(db, 'google');
    assert.equal(conn, null);
  });
  //
  it('upsertConnection inserts a new connection', async () => {
    await upsertConnection(db, 'google', googleData);
    const conn = await getConnection(db, 'google');
    assert.equal(conn.provider, 'google');
    assert.equal(conn.email, 'chad@example.com');
    assert.equal(conn.name, 'Chad');
    assert.equal(conn.access_token, 'access_123');
    assert.equal(conn.refresh_token, 'refresh_456');
    assert.equal(conn.expires_at, 1700000000);
    assert.equal(conn.scopes, 'calendar,email');
    assert.ok(conn.connected_at);
    assert.ok(conn.updated_at);
  });
  //
  it('upsertConnection updates an existing connection', async () => {
    await upsertConnection(db, 'google', googleData);
    const updated = { ...googleData, access_token: 'new_access', email: 'new@example.com' };
    await upsertConnection(db, 'google', updated);
    const conn = await getConnection(db, 'google');
    assert.equal(conn.access_token, 'new_access');
    assert.equal(conn.email, 'new@example.com');
    // Should still be one row
    const all = await db.prepare('SELECT COUNT(*) as cnt FROM connections').get();
    assert.equal(all.cnt, 1);
  });
  //
  it('removeConnection deletes a connection', async () => {
    await upsertConnection(db, 'google', googleData);
    await removeConnection(db, 'google');
    const conn = await getConnection(db, 'google');
    assert.equal(conn, null);
  });
  //
  it('updateAccessToken updates only token and expires_at', async () => {
    await upsertConnection(db, 'google', googleData);
    const before = await getConnection(db, 'google');
    await updateAccessToken(db, 'google', 'refreshed_token', 1800000000);
    const after = await getConnection(db, 'google');
    assert.equal(after.access_token, 'refreshed_token');
    assert.equal(after.expires_at, 1800000000);
    // Other fields unchanged
    assert.equal(after.email, before.email);
    assert.equal(after.refresh_token, before.refresh_token);
    assert.equal(after.scopes, before.scopes);
    // updated_at should change
    assert.ok(after.updated_at >= before.updated_at);
  });
  //
  it('multiple providers coexist', async () => {
    await upsertConnection(db, 'google', googleData);
    await upsertConnection(db, 'github', { ...googleData, email: 'gh@example.com' });
    const google = await getConnection(db, 'google');
    const github = await getConnection(db, 'github');
    assert.equal(google.email, 'chad@example.com');
    assert.equal(github.email, 'gh@example.com');
  });
});
//
describe('clearDatabase clears settings and connections', () => {
  it('clears settings and connections tables', async () => {
    await setSetting(db, 'custom', 'val');
    await upsertConnection(db, 'google', {
      email: 'a@b.com', name: 'A',
      access_token: 'x', refresh_token: 'y',
      expires_at: 123, scopes: null,
    });
    await clearDatabase(db);
    // Settings should be empty (clearDatabase deletes them)
    const settings = await getAllSettings(db);
    assert.equal(settings.length, 0);
    // Connections should be empty
    const conn = await getConnection(db, 'google');
    assert.equal(conn, null);
  });
});
