import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, seedPersonality } from '../../src/lib/db.js';
import {
  getSoul, updateDisposition, getPersonalityCalibration,
} from '../../src/lib/personality.js';
//
let db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
});
//
describe('getSoul', () => {
  it('returns soul from personality table when seeded', async () => {
    await seedPersonality(db);
    const result = await getSoul(db);
    assert.ok(result.soul.includes('Strategic Partner'));
    assert.equal(result.style, null);
    assert.equal(result.disposition, null);
  });
  //
  it('returns default soul when table is empty', async () => {
    const result = await getSoul(db);
    assert.ok(result.soul.includes('Strategic Partner'));
    assert.equal(result.style, null);
    assert.equal(result.disposition, null);
  });
  //
  it('returns parsed disposition when set', async () => {
    await seedPersonality(db);
    await db.prepare(
      "UPDATE personality SET disposition = ? WHERE id = 1"
    ).run(JSON.stringify({ formality: 'casual', detail_level: 'high' }));
    const result = await getSoul(db);
    assert.deepEqual(result.disposition, { formality: 'casual', detail_level: 'high' });
  });
  //
  it('returns style when set', async () => {
    await seedPersonality(db);
    await db.prepare("UPDATE personality SET style = ? WHERE id = 1").run('concise');
    const result = await getSoul(db);
    assert.equal(result.style, 'concise');
  });
});
//
describe('updateDisposition', () => {
  it('merges new signals into empty disposition', async () => {
    await seedPersonality(db);
    const result = await updateDisposition(db, { formality: 'casual' });
    assert.deepEqual(result, { formality: 'casual' });
    // Verify persisted
    const row = await db.prepare('SELECT disposition FROM personality WHERE id = 1').get();
    assert.deepEqual(JSON.parse(row.disposition), { formality: 'casual' });
  });
  //
  it('merges into existing disposition, overwriting keys', async () => {
    await seedPersonality(db);
    await db.prepare(
      "UPDATE personality SET disposition = ? WHERE id = 1"
    ).run(JSON.stringify({ formality: 'formal', verbosity: 'low' }));
    const result = await updateDisposition(db, { formality: 'casual', detail_level: 'high' });
    assert.deepEqual(result, { formality: 'casual', verbosity: 'low', detail_level: 'high' });
  });
  //
  it('updates the updated_at timestamp', async () => {
    await seedPersonality(db);
    const before = await db.prepare('SELECT updated_at FROM personality WHERE id = 1').get();
    // Small delay to ensure different timestamp
    await new Promise(r => setTimeout(r, 10));
    await updateDisposition(db, { test: 'value' });
    const after = await db.prepare('SELECT updated_at FROM personality WHERE id = 1').get();
    assert.notEqual(before.updated_at, after.updated_at);
  });
});
//
describe('getPersonalityCalibration', () => {
  it('returns formatted calibration string when disposition exists', async () => {
    await seedPersonality(db);
    await db.prepare(
      "UPDATE personality SET disposition = ? WHERE id = 1"
    ).run(JSON.stringify({ formality: 'casual', detail_level: 'high' }));
    const result = await getPersonalityCalibration(db);
    assert.ok(result.startsWith('## Personality Calibration'));
    assert.ok(result.includes('- formality: casual'));
    assert.ok(result.includes('- detail level: high'));
  });
  //
  it('returns empty string when no disposition', async () => {
    await seedPersonality(db);
    const result = await getPersonalityCalibration(db);
    assert.equal(result, '');
  });
  //
  it('returns empty string when personality table is empty', async () => {
    const result = await getPersonalityCalibration(db);
    assert.equal(result, '');
  });
});
