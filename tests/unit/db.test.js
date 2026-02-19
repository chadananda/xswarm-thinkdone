import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import {
  ensureSchema,
  getTasks, addTask, toggleTask, deleteTask, editTask, reorderTasks,
  storeMemory, getActiveMemories, supersedeMemory,
  seedPersonality,
  getActiveSession, saveSessionState, createActiveSession,
} from '../../src/lib/db.js';

let db;

beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
});

describe('ensureSchema', () => {
  it('creates all 8 tables', async () => {
    const tables = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    const names = tables.map(t => t.name);
    assert.ok(names.includes('tasks'), 'tasks table');
    assert.ok(names.includes('memories'), 'memories table');
    assert.ok(names.includes('routines'), 'routines table');
    assert.ok(names.includes('completions'), 'completions table');
    assert.ok(names.includes('conversations'), 'conversations table');
    assert.ok(names.includes('personality'), 'personality table');
    assert.ok(names.includes('connections'), 'connections table');
    assert.ok(names.includes('settings'), 'settings table');
  });

  it('is idempotent — runs twice without error', async () => {
    await ensureSchema(db);
    await ensureSchema(db);
  });
});

describe('Task CRUD', () => {
  it('starts with no tasks', async () => {
    const tasks = await getTasks(db, '2026-02-10');
    assert.equal(tasks.length, 0);
  });

  it('adds a task at position 0', async () => {
    await addTask(db, 'Buy groceries ~15m — personal', { planDate: '2026-02-10' });
    const tasks = await getTasks(db, '2026-02-10');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].text, 'Buy groceries ~15m — personal');
    assert.equal(tasks[0].position, 0);
    assert.equal(tasks[0].checked, 0);
  });

  it('new tasks insert at position 0 and shift others', async () => {
    await addTask(db, 'First task', { planDate: '2026-02-10' });
    await addTask(db, 'Second task', { planDate: '2026-02-10' });
    const tasks = await getTasks(db, '2026-02-10');
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].text, 'Second task');
    assert.equal(tasks[0].position, 0);
    assert.equal(tasks[1].text, 'First task');
    assert.equal(tasks[1].position, 1);
  });

  it('toggles task checked state', async () => {
    await addTask(db, 'Toggle me', { planDate: '2026-02-10' });
    let tasks = await getTasks(db, '2026-02-10');
    const id = tasks[0].id;

    const result = await toggleTask(db, id);
    assert.equal(result, 'checked');
    tasks = await getTasks(db, '2026-02-10');
    assert.equal(tasks[0].checked, 1);
    assert.ok(tasks[0].completed_at);

    const result2 = await toggleTask(db, id);
    assert.equal(result2, 'unchecked');
    tasks = await getTasks(db, '2026-02-10');
    assert.equal(tasks[0].checked, 0);
    assert.equal(tasks[0].completed_at, null);
  });

  it('deletes a task', async () => {
    await addTask(db, 'Delete me', { planDate: '2026-02-10' });
    let tasks = await getTasks(db, '2026-02-10');
    await deleteTask(db, tasks[0].id);
    tasks = await getTasks(db, '2026-02-10');
    assert.equal(tasks.length, 0);
  });

  it('edits task text', async () => {
    await addTask(db, 'Old text', { planDate: '2026-02-10' });
    let tasks = await getTasks(db, '2026-02-10');
    await editTask(db, tasks[0].id, 'New text ~30m — work');
    tasks = await getTasks(db, '2026-02-10');
    assert.equal(tasks[0].text, 'New text ~30m — work');
  });

  it('reorders tasks by id array', async () => {
    await addTask(db, 'A', { planDate: '2026-02-10' });
    await addTask(db, 'B', { planDate: '2026-02-10' });
    await addTask(db, 'C', { planDate: '2026-02-10' });
    let tasks = await getTasks(db, '2026-02-10');
    // Current order: C(0), B(1), A(2)
    const ids = tasks.map(t => t.id);
    // Reverse: A, B, C
    await reorderTasks(db, ids.reverse());
    tasks = await getTasks(db, '2026-02-10');
    assert.equal(tasks[0].text, 'A');
    assert.equal(tasks[1].text, 'B');
    assert.equal(tasks[2].text, 'C');
  });

  it('only returns tasks for the requested date', async () => {
    await addTask(db, 'Today', { planDate: '2026-02-10' });
    await addTask(db, 'Tomorrow', { planDate: '2026-02-11' });
    const today = await getTasks(db, '2026-02-10');
    assert.equal(today.length, 1);
    assert.equal(today[0].text, 'Today');
  });
});

describe('Memory CRUD', () => {
  it('stores a memory', async () => {
    const id = await storeMemory(db, 'Focus on Templeton grant', {
      project: 'drbi', type: 'decision', person: '', source: 'conversation',
    });
    assert.ok(id > 0);
  });

  it('retrieves active memories filtered by type', async () => {
    await storeMemory(db, 'Blocker A', { type: 'blocker' });
    await storeMemory(db, 'Decision B', { type: 'decision' });
    const blockers = await getActiveMemories(db, { type: 'blocker' });
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].content, 'Blocker A');
  });

  it('filters by project', async () => {
    await storeMemory(db, 'DRBI status', { project: 'drbi', type: 'status' });
    await storeMemory(db, 'Ocean status', { project: 'ocean', type: 'status' });
    const drbi = await getActiveMemories(db, { project: 'drbi' });
    assert.equal(drbi.length, 1);
    assert.equal(drbi[0].project, 'drbi');
  });

  it('filters by person', async () => {
    await storeMemory(db, 'Gilbert prefers email', { person: 'Gilbert', type: 'person_fact' });
    await storeMemory(db, 'Riazati timezone', { person: 'Riazati', type: 'person_fact' });
    const gilbert = await getActiveMemories(db, { person: 'Gilbert' });
    assert.equal(gilbert.length, 1);
    assert.match(gilbert[0].content, /Gilbert/);
  });

  it('supersedes a memory', async () => {
    const oldId = await storeMemory(db, 'Old status', { project: 'drbi', type: 'status' });
    const newId = await supersedeMemory(db, oldId, 'New status', { project: 'drbi', type: 'status' });
    assert.ok(newId > oldId);
    const active = await getActiveMemories(db, { project: 'drbi' });
    assert.equal(active.length, 1);
    assert.equal(active[0].content, 'New status');
  });

  it('superseded memories are excluded from getActiveMemories', async () => {
    const id1 = await storeMemory(db, 'Version 1', { type: 'status' });
    await supersedeMemory(db, id1, 'Version 2', { type: 'status' });
    const all = await getActiveMemories(db, { type: 'status' });
    assert.equal(all.length, 1);
    assert.equal(all[0].content, 'Version 2');
  });
});

describe('seedPersonality', () => {
  it('inserts default SOUL', async () => {
    await seedPersonality(db);
    const row = await db.prepare('SELECT soul FROM personality WHERE id = 1').get();
    assert.ok(row);
    assert.ok(row.soul.length > 50);
  });

  it('is idempotent — does not overwrite existing', async () => {
    await seedPersonality(db);
    // Manually update
    await db.prepare('UPDATE personality SET soul = ? WHERE id = 1').run('custom soul');
    await seedPersonality(db);
    const row = await db.prepare('SELECT soul FROM personality WHERE id = 1').get();
    assert.equal(row.soul, 'custom soul');
  });
});

describe('Active Session helpers', () => {
  it('createActiveSession inserts a row with INITIALIZING state', async () => {
    const id = await createActiveSession(db, 'morning_meeting', '2026-02-13T09:00:00.000Z');
    assert.ok(id > 0);
    const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    assert.equal(row.session_type, 'morning_meeting');
    assert.equal(row.state, 'INITIALIZING');
    assert.equal(row.messages, '[]');
    assert.equal(row.agenda, '[]');
    assert.equal(row.ended_at, null);
  });

  it('getActiveSession returns the most recent open session', async () => {
    await createActiveSession(db, 'onboarding', '2026-02-13T08:00:00.000Z');
    const id2 = await createActiveSession(db, 'morning_meeting', '2026-02-13T09:00:00.000Z');
    const active = await getActiveSession(db);
    assert.equal(active.id, id2);
    assert.equal(active.session_type, 'morning_meeting');
  });

  it('getActiveSession skips sessions with ended_at set', async () => {
    const id = await createActiveSession(db, 'morning_meeting', '2026-02-13T09:00:00.000Z');
    await db.prepare('UPDATE conversations SET ended_at = ? WHERE id = ?')
      .run('2026-02-13T10:00:00.000Z', id);
    const active = await getActiveSession(db);
    assert.ok(!active, 'should return falsy when no active sessions');
  });

  it('saveSessionState updates messages, agenda, state', async () => {
    const id = await createActiveSession(db, 'morning_meeting', '2026-02-13T09:00:00.000Z');
    const session = {
      type: 'morning_meeting',
      state: 'AGENDA_LOOP',
      messages: [{ role: 'user', content: 'Hello' }],
      agenda: [{ id: 'a1', status: 'pending', content: 'Review' }],
    };
    await saveSessionState(db, id, session);
    const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    assert.equal(row.state, 'AGENDA_LOOP');
    assert.deepEqual(JSON.parse(row.messages), [{ role: 'user', content: 'Hello' }]);
    assert.deepEqual(JSON.parse(row.agenda), [{ id: 'a1', status: 'pending', content: 'Review' }]);
  });
});
