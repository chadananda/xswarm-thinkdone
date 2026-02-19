import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, storeMemory, addTask } from '../../src/lib/db.js';
import { getInbox, getProjects, getWaitingFor, getStaleProjects, generateWeeklyReview, triageIdea } from '../../src/lib/gtd-engine.js';
//
let db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
});
//
describe('getInbox', () => {
  it('returns ideas with no project', async () => {
    await storeMemory(db, 'Build a habit tracker', { type: 'idea' });
    await storeMemory(db, 'Try new framework', { type: 'idea' });
    await storeMemory(db, 'Assigned idea', { type: 'idea', project: 'thinkdone' });
    await storeMemory(db, 'A decision', { type: 'decision' });
    const inbox = await getInbox(db);
    assert.equal(inbox.length, 2);
    assert.ok(inbox.every(m => m.type === 'idea'));
    assert.ok(inbox.every(m => !m.project || m.project === ''));
  });
  //
  it('excludes superseded ideas', async () => {
    const id = await storeMemory(db, 'Old idea', { type: 'idea' });
    await db.prepare('UPDATE memories SET superseded_by = 999 WHERE id = ?').run(id);
    await storeMemory(db, 'Fresh idea', { type: 'idea' });
    const inbox = await getInbox(db);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].content, 'Fresh idea');
  });
  //
  it('returns newest first', async () => {
    const id1 = await storeMemory(db, 'First idea', { type: 'idea' });
    await db.prepare("UPDATE memories SET created_at = '2025-01-01T00:00:00.000Z' WHERE id = ?").run(id1);
    await storeMemory(db, 'Second idea', { type: 'idea' });
    const inbox = await getInbox(db);
    assert.equal(inbox[0].content, 'Second idea');
  });
});
//
describe('getProjects', () => {
  it('returns distinct projects with counts', async () => {
    await storeMemory(db, 'Status 1', { type: 'status', project: 'ocean' });
    await storeMemory(db, 'Status 2', { type: 'status', project: 'ocean' });
    await storeMemory(db, 'Decision', { type: 'decision', project: 'drbi' });
    const projects = await getProjects(db);
    assert.equal(projects.length, 2);
    const ocean = projects.find(p => p.project === 'ocean');
    assert.equal(ocean.memory_count, 2);
    const drbi = projects.find(p => p.project === 'drbi');
    assert.equal(drbi.memory_count, 1);
  });
  //
  it('excludes empty-project memories', async () => {
    await storeMemory(db, 'No project', { type: 'idea' });
    await storeMemory(db, 'Has project', { type: 'status', project: 'ocean' });
    const projects = await getProjects(db);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].project, 'ocean');
  });
  //
  it('includes task_count for today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await storeMemory(db, 'Status', { type: 'status', project: 'ocean' });
    await addTask(db, 'Do something — ocean', { planDate: today });
    await addTask(db, 'Do more — ocean', { planDate: today });
    const projects = await getProjects(db);
    const ocean = projects.find(p => p.project === 'ocean');
    assert.equal(ocean.task_count, 2);
  });
  //
  it('marks stale projects', async () => {
    await storeMemory(db, 'Old status', { type: 'status', project: 'stale-proj' });
    // Backdate the memory to 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
    await db.prepare('UPDATE memories SET created_at = ? WHERE project = ?').run(tenDaysAgo, 'stale-proj');
    const projects = await getProjects(db);
    const stale = projects.find(p => p.project === 'stale-proj');
    assert.equal(stale.stale, true);
  });
});
//
describe('getWaitingFor', () => {
  it('returns active waiting_for memories sorted by priority', async () => {
    await storeMemory(db, 'Low prio item', { type: 'waiting_for', priority: 0 });
    await storeMemory(db, 'High prio item', { type: 'waiting_for', priority: 5 });
    const items = await getWaitingFor(db);
    assert.equal(items.length, 2);
    assert.equal(items[0].content, 'High prio item');
    assert.equal(items[1].content, 'Low prio item');
  });
  //
  it('excludes superseded waiting_for', async () => {
    const id = await storeMemory(db, 'Old wait', { type: 'waiting_for' });
    await db.prepare('UPDATE memories SET superseded_by = 999 WHERE id = ?').run(id);
    await storeMemory(db, 'Active wait', { type: 'waiting_for' });
    const items = await getWaitingFor(db);
    assert.equal(items.length, 1);
    assert.equal(items[0].content, 'Active wait');
  });
});
//
describe('getStaleProjects', () => {
  it('finds projects with no activity in N days', async () => {
    await storeMemory(db, 'Old status', { type: 'status', project: 'abandoned' });
    const oldDate = new Date(Date.now() - 10 * 86400000).toISOString();
    await db.prepare('UPDATE memories SET created_at = ? WHERE project = ?').run(oldDate, 'abandoned');
    await storeMemory(db, 'Fresh status', { type: 'status', project: 'active' });
    const stale = await getStaleProjects(db, 5);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].project, 'abandoned');
  });
  //
  it('respects custom days threshold', async () => {
    await storeMemory(db, 'Status', { type: 'status', project: 'medium' });
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    await db.prepare('UPDATE memories SET created_at = ? WHERE project = ?').run(threeDaysAgo, 'medium');
    // Not stale at 5 days
    const notStale = await getStaleProjects(db, 5);
    assert.equal(notStale.length, 0);
    // Stale at 2 days
    const stale = await getStaleProjects(db, 2);
    assert.equal(stale.length, 1);
  });
});
//
describe('generateWeeklyReview', () => {
  it('returns wins from completed tasks', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await addTask(db, 'Shipped feature — ocean', { planDate: today });
    // Mark as completed recently
    const recentDate = new Date().toISOString();
    await db.prepare('UPDATE tasks SET checked = 1, completed_at = ? WHERE text LIKE ?').run(recentDate, 'Shipped%');
    const review = await generateWeeklyReview(db);
    assert.ok(review.wins.length >= 1);
    assert.equal(review.wins[0].text, 'Shipped feature — ocean');
  });
  //
  it('returns misses from uncompleted past tasks', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await addTask(db, 'Missed task — drbi', { planDate: yesterday });
    const review = await generateWeeklyReview(db);
    assert.ok(review.misses.length >= 1);
    assert.equal(review.misses[0].text, 'Missed task — drbi');
  });
  //
  it('returns project statuses', async () => {
    await storeMemory(db, 'Ocean redesign in progress', { type: 'status', project: 'ocean' });
    const review = await generateWeeklyReview(db);
    assert.ok(review.projectStatuses['ocean']);
    assert.ok(review.projectStatuses['ocean'].includes('Ocean redesign in progress'));
  });
  //
  it('returns commitments and waitingFor', async () => {
    await storeMemory(db, 'Send report to boss', { type: 'commitment', person: 'boss' });
    await storeMemory(db, 'API keys from vendor', { type: 'waiting_for', person: 'vendor' });
    const review = await generateWeeklyReview(db);
    assert.equal(review.commitments.length, 1);
    assert.equal(review.commitments[0].content, 'Send report to boss');
    assert.equal(review.waitingFor.length, 1);
    assert.equal(review.waitingFor[0].content, 'API keys from vendor');
  });
  //
  it('returns habit scorecard', async () => {
    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO routines (name, kind, frequency, active, created_at, updated_at) VALUES ('Exercise', 'habit', 'daily', 1, ?, ?)"
    ).run(now, now);
    const review = await generateWeeklyReview(db);
    assert.ok(Array.isArray(review.habitScorecard));
    assert.equal(review.habitScorecard[0].name, 'Exercise');
  });
});
//
describe('triageIdea', () => {
  it('moves idea to a project (action=project)', async () => {
    const id = await storeMemory(db, 'Build widget', { type: 'idea' });
    await triageIdea(db, id, { action: 'project', project: 'thinkdone', priority: 2 });
    const mem = await db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    assert.equal(mem.type, 'status');
    assert.equal(mem.project, 'thinkdone');
    assert.equal(mem.priority, 2);
  });
  //
  it('marks idea as someday (action=someday)', async () => {
    const id = await storeMemory(db, 'Maybe later', { type: 'idea' });
    await triageIdea(db, id, { action: 'someday' });
    const mem = await db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    assert.equal(mem.priority, -1);
    assert.equal(mem.type, 'idea'); // type unchanged
  });
  //
  it('converts idea to reference (action=reference)', async () => {
    const id = await storeMemory(db, 'Useful pattern', { type: 'idea' });
    await triageIdea(db, id, { action: 'reference' });
    const mem = await db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    assert.equal(mem.type, 'insight');
  });
  //
  it('deletes idea by superseding (action=delete)', async () => {
    const id = await storeMemory(db, 'Bad idea', { type: 'idea' });
    await triageIdea(db, id, { action: 'delete' });
    const mem = await db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    assert.equal(mem.superseded_by, -1);
  });
  //
  it('throws on unknown action', async () => {
    const id = await storeMemory(db, 'Test idea', { type: 'idea' });
    await assert.rejects(() => triageIdea(db, id, { action: 'invalid' }), /Unknown triage action/);
  });
  //
  it('throws on non-existent memory', async () => {
    await assert.rejects(() => triageIdea(db, 99999, { action: 'project' }), /not found/);
  });
});
