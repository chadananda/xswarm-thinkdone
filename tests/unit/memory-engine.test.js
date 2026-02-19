import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, storeMemory } from '../../src/lib/db.js';
import { buildContext, getPriority1, getPriority2, estimateTokens, compressMemory, consolidateMemories } from '../../src/lib/memory-engine.js';
//
let db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
});
//
describe('getPriority1', () => {
  it('returns blockers, commitments, waiting_for', async () => {
    await storeMemory(db, 'Server is down', { type: 'blocker', project: 'ocean' });
    await storeMemory(db, 'Send draft to Gilbert', { type: 'commitment', person: 'Gilbert' });
    await storeMemory(db, 'Schema from Riazati', { type: 'waiting_for', person: 'Riazati' });
    const text = await getPriority1(db);
    assert.ok(text.includes('BLOCKERS'));
    assert.ok(text.includes('Server is down'));
    assert.ok(text.includes('COMMITMENTS'));
    assert.ok(text.includes('WAITING FOR'));
  });
  //
  it('returns empty string when no actionable memories', async () => {
    const text = await getPriority1(db);
    assert.equal(text, '');
  });
});
//
describe('getPriority2', () => {
  it('returns focus project statuses', async () => {
    await storeMemory(db, 'DRBI grant submitted', { type: 'status', project: 'drbi' });
    await storeMemory(db, 'Ocean redesign started', { type: 'status', project: 'ocean' });
    const text = await getPriority2(db, { focusProjects: ['drbi'] });
    assert.ok(text.includes('FOCUS PROJECTS'));
    assert.ok(text.includes('DRBI grant submitted'));
  });
  //
  it('returns recent decisions', async () => {
    await storeMemory(db, 'Switch to Astro 5', { type: 'decision', project: 'thinkdone' });
    const text = await getPriority2(db, {});
    assert.ok(text.includes('RECENT DECISIONS'));
    assert.ok(text.includes('Switch to Astro 5'));
  });
  //
  it('returns empty string when no matching memories', async () => {
    const text = await getPriority2(db, { focusProjects: ['nonexistent'] });
    assert.equal(text, '');
  });
});
//
describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    assert.equal(estimateTokens('hello world'), 3); // 11 chars / 4 = 2.75 -> 3
  });
  it('returns 0 for empty/null', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
  });
});
//
describe('compressMemory', () => {
  it('produces pipe-delimited format', () => {
    const result = compressMemory('Focus on Templeton grant for DRBI', 'decision');
    assert.ok(result.startsWith('DECISION:'));
    assert.ok(result.includes('|'));
  });
  //
  it('strips common words', () => {
    const result = compressMemory('The project is waiting for approval', 'status');
    assert.ok(result.startsWith('STATUS:'));
    // 'The', 'is', 'for' should be stripped
    assert.ok(!result.includes('|is|'));
  });
});
//
describe('buildContext', () => {
  it('returns text and tokenEstimate', async () => {
    await storeMemory(db, 'Blocker here', { type: 'blocker' });
    const result = await buildContext(db);
    assert.ok(typeof result.text === 'string');
    assert.ok(typeof result.tokenEstimate === 'number');
    assert.ok(result.text.includes('BLOCKERS'));
  });
  //
  it('stays within token budget', async () => {
    for (let i = 0; i < 50; i++) {
      await storeMemory(db, `Memory ${i} with some content here`, { type: 'insight' });
    }
    const { tokenEstimate } = await buildContext(db, { maxTokens: 500 });
    // Should respect the budget (allow some flex)
    assert.ok(tokenEstimate <= 600, `Token count ${tokenEstimate} should be near budget`);
  });
});
//
describe('consolidateMemories', () => {
  it('merges duplicate status memories per project', async () => {
    await storeMemory(db, 'Status 1', { type: 'status', project: 'drbi' });
    await storeMemory(db, 'Status 2', { type: 'status', project: 'drbi' });
    await storeMemory(db, 'Status 3', { type: 'status', project: 'drbi' });
    const count = await consolidateMemories(db);
    assert.equal(count, 2);
  });
  //
  it('keeps the most recent memory', async () => {
    await storeMemory(db, 'Old status', { type: 'status', project: 'drbi' });
    await storeMemory(db, 'Latest status', { type: 'status', project: 'drbi' });
    await consolidateMemories(db);
    const active = await db.prepare(
      "SELECT content FROM memories WHERE type = 'status' AND project = 'drbi' AND superseded_by IS NULL"
    ).all();
    assert.equal(active.length, 1);
    assert.equal(active[0].content, 'Latest status');
  });
  //
  it('does not consolidate across projects', async () => {
    await storeMemory(db, 'Status A', { type: 'status', project: 'drbi' });
    await storeMemory(db, 'Status B', { type: 'status', project: 'ocean' });
    const count = await consolidateMemories(db);
    assert.equal(count, 0);
  });
});
