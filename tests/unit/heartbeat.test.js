import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema, seedPersonality, storeMemory, addTask } from '../../src/lib/db.js';
import { detectDataGaps, filterNewGaps, HEARTBEAT_INTERVALS } from '../../src/lib/heartbeat.js';
import { generateOnboardingAgenda } from '../../src/lib/agenda.js';

describe('heartbeat', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
    await ensureSchema(db);
    await seedPersonality(db);
  });

  // --- detectDataGaps ---

  describe('detectDataGaps', () => {
    it('returns array', async () => {
      const gaps = await detectDataGaps(db);
      assert.ok(Array.isArray(gaps));
    });

    it('each gap has id, type, priority, content, question', async () => {
      const gaps = await detectDataGaps(db);
      for (const g of gaps) {
        assert.ok(g.id, `gap missing id: ${JSON.stringify(g)}`);
        assert.ok(g.type);
        assert.ok(g.priority);
        assert.ok(g.content);
        assert.ok(g.question);
      }
    });

    // -- Profile gaps --

    it('detects missing user_name on fresh db', async () => {
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'profile_user_name'));
    });

    it('does not flag user_name when set', async () => {
      await db.prepare('UPDATE personality SET disposition = ? WHERE id = 1')
        .run(JSON.stringify({ user_name: 'Chad' }));
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'profile_user_name'));
    });

    it('detects missing ai_name', async () => {
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'profile_ai_name'));
    });

    it('does not flag ai_name when set', async () => {
      await db.prepare('UPDATE personality SET disposition = ? WHERE id = 1')
        .run(JSON.stringify({ ai_name: 'Nova' }));
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'profile_ai_name'));
    });

    it('detects missing timezone', async () => {
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'profile_timezone'));
    });

    it('does not flag timezone when set', async () => {
      await db.prepare('UPDATE personality SET disposition = ? WHERE id = 1')
        .run(JSON.stringify({ timezone: 'America/New_York' }));
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'profile_timezone'));
    });

    it('detects missing role', async () => {
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'profile_role'));
    });

    it('detects missing work_style', async () => {
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'profile_work_style'));
    });

    // -- Data gaps --

    it('detects no tasks today', async () => {
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'no_tasks_today'));
    });

    it('does not flag tasks when they exist', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await addTask(db, 'Test task', { planDate: today });
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'no_tasks_today'));
    });

    it('detects no routines', async () => {
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'no_routines'));
    });

    it('does not flag routines when they exist', async () => {
      const now = new Date().toISOString();
      await db.prepare(
        "INSERT INTO routines (name, kind, frequency, time_slot, active, created_at, updated_at) VALUES (?, 'habit', 'daily', 'morning', 1, ?, ?)"
      ).run('Exercise', now, now);
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'no_routines'));
    });

    it('detects no projects', async () => {
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'no_projects'));
    });

    it('does not flag projects when they exist in memories', async () => {
      await storeMemory(db, 'Working on launch', { project: 'ProductLaunch', type: 'status' });
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'no_projects'));
    });

    it('detects no people', async () => {
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'no_people'));
    });

    it('does not flag people when they exist in memories', async () => {
      await storeMemory(db, 'Waiting on review', { person: 'Alice', type: 'waiting_for' });
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'no_people'));
    });

    // -- Staleness gaps --

    it('detects open blockers', async () => {
      await storeMemory(db, 'Blocked on API key', { type: 'blocker' });
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id.startsWith('open_blocker:')));
    });

    it('does not flag superseded blockers', async () => {
      const id = await storeMemory(db, 'Old blocker', { type: 'blocker' });
      await db.prepare('UPDATE memories SET superseded_by = 999 WHERE id = ?').run(id);
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id.startsWith('open_blocker:')));
    });

    it('detects stale projects (>5 days inactive)', async () => {
      const staleDate = new Date(Date.now() - 7 * 86400000).toISOString();
      await db.prepare(
        "INSERT INTO memories (content, project, type, source, created_at) VALUES (?, ?, 'status', 'manual', ?)"
      ).run('Old status', 'StaleProject', staleDate);
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'stale_project:StaleProject'));
    });

    it('does not flag recently active projects as stale', async () => {
      await storeMemory(db, 'Active status', { project: 'ActiveProject', type: 'status' });
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'stale_project:ActiveProject'));
    });

    // -- Full profile suppresses profile gaps --

    it('returns no profile gaps when all fields set', async () => {
      await db.prepare('UPDATE personality SET disposition = ? WHERE id = 1')
        .run(JSON.stringify({
          user_name: 'Chad',
          ai_name: 'Nova',
          timezone: 'America/New_York',
          role: 'CEO',
          work_style: 'morning planner',
        }));
      const gaps = await detectDataGaps(db);
      const profileGaps = gaps.filter(g => g.id.startsWith('profile_'));
      assert.equal(profileGaps.length, 0);
    });

    // -- Level 2: Per-project depth --

    it('detects project with no next action', async () => {
      await storeMemory(db, 'Launch is underway', { project: 'Launch', type: 'status' });
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'project_next_action:Launch'));
    });

    it('does not flag project_next_action when open task exists', async () => {
      await storeMemory(db, 'Active project', { project: 'Alpha', type: 'status' });
      await addTask(db, 'Do the thing — Alpha');
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'project_next_action:Alpha'));
    });

    it('detects project with no recent status (>3 days)', async () => {
      const staleDate = new Date(Date.now() - 4 * 86400000).toISOString();
      await db.prepare(
        "INSERT INTO memories (content, project, type, source, created_at) VALUES (?, ?, 'status', 'manual', ?)"
      ).run('Old status', 'Stale3d', staleDate);
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'project_status:Stale3d'));
    });

    it('does not flag project_status when recent status exists', async () => {
      await storeMemory(db, 'Fresh status', { project: 'Fresh', type: 'status' });
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'project_status:Fresh'));
    });

    it('detects project with no goal or deadline', async () => {
      await storeMemory(db, 'Working on it', { project: 'NoGoal', type: 'status' });
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'project_goal:NoGoal'));
    });

    it('does not flag project_goal when commitment exists', async () => {
      await storeMemory(db, 'Ship by March', { project: 'HasGoal', type: 'commitment' });
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'project_goal:HasGoal'));
    });

    it('detects project with no team members', async () => {
      await storeMemory(db, 'Solo project', { project: 'Solo', type: 'status' });
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'project_people:Solo'));
    });

    it('does not flag project_people when person linked', async () => {
      await storeMemory(db, 'Working with Alice', { project: 'Team', type: 'status', person: 'Alice' });
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'project_people:Team'));
    });

    // -- Level 2: Per-routine depth --

    it('detects routine with no cue', async () => {
      const now = new Date().toISOString();
      await db.prepare(
        "INSERT INTO routines (name, kind, frequency, time_slot, active, created_at, updated_at) VALUES (?, 'habit', 'daily', 'morning', 1, ?, ?)"
      ).run('Exercise', now, now);
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id.startsWith('routine_cue:')));
    });

    it('detects routine with no reward', async () => {
      const now = new Date().toISOString();
      await db.prepare(
        "INSERT INTO routines (name, kind, frequency, time_slot, active, cue, created_at, updated_at) VALUES (?, 'habit', 'daily', 'morning', 1, 'After coffee', ?, ?)"
      ).run('Exercise', now, now);
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id.startsWith('routine_reward:')));
    });

    it('detects routine with no 2-minute version', async () => {
      const now = new Date().toISOString();
      await db.prepare(
        "INSERT INTO routines (name, kind, frequency, time_slot, active, cue, reward, created_at, updated_at) VALUES (?, 'habit', 'daily', 'morning', 1, 'After coffee', 'Smoothie', ?, ?)"
      ).run('Exercise', now, now);
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id.startsWith('routine_2min:')));
    });

    it('does not flag routine gaps when all Atomic Habits fields set', async () => {
      const now = new Date().toISOString();
      await db.prepare(
        "INSERT INTO routines (name, kind, frequency, time_slot, active, cue, reward, two_min_version, created_at, updated_at) VALUES (?, 'habit', 'daily', 'morning', 1, 'After coffee', 'Smoothie', 'One pushup', ?, ?)"
      ).run('Exercise', now, now);
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id.startsWith('routine_cue:') || g.id.startsWith('routine_reward:') || g.id.startsWith('routine_2min:')));
    });

    // -- Level 2: Per-person depth --

    it('detects person with no relationship defined', async () => {
      await storeMemory(db, 'Talked to Bob about specs', { person: 'Bob', type: 'status' });
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'person_role:Bob'));
    });

    it('does not flag person_role when insight memory mentions role', async () => {
      await storeMemory(db, 'Bob is my manager', { person: 'Bob', type: 'insight' });
      const gaps = await detectDataGaps(db);
      assert.ok(!gaps.some(g => g.id === 'person_role:Bob'));
    });

    // -- Level 2: Task depth --

    it('detects unestimated tasks when >2 exist', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await addTask(db, 'Task A', { planDate: today });
      await addTask(db, 'Task B', { planDate: today });
      await addTask(db, 'Task C', { planDate: today });
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'tasks_unestimated'));
    });

    it('detects nothing planned for tomorrow', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await addTask(db, 'Today task', { planDate: today });
      const gaps = await detectDataGaps(db);
      assert.ok(gaps.some(g => g.id === 'no_tasks_tomorrow'));
    });
  });

  // --- filterNewGaps ---

  describe('filterNewGaps', () => {
    it('returns all gaps when agenda is empty', () => {
      const gaps = [
        { id: 'profile_user_name', type: 'INFORM', priority: 'critical', content: 'Name', question: 'What is your name?' },
      ];
      const result = filterNewGaps(gaps, []);
      assert.equal(result.length, 1);
    });

    it('filters out gaps whose id matches existing agenda heartbeat ids', () => {
      const gaps = [
        { id: 'profile_user_name', type: 'INFORM', priority: 'critical', content: 'Name', question: '?' },
        { id: 'no_tasks_today', type: 'INFORM', priority: 'normal', content: 'Tasks', question: '?' },
      ];
      const existingAgenda = [
        { id: 'item-1', heartbeatId: 'profile_user_name', status: 'pending' },
      ];
      const result = filterNewGaps(gaps, existingAgenda);
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'no_tasks_today');
    });

    it('filters out resolved heartbeat items', () => {
      const gaps = [
        { id: 'profile_user_name', type: 'INFORM', priority: 'critical', content: 'Name', question: '?' },
      ];
      const existingAgenda = [
        { id: 'item-1', heartbeatId: 'profile_user_name', status: 'resolved' },
      ];
      const result = filterNewGaps(gaps, existingAgenda);
      assert.equal(result.length, 0);
    });

    it('filters out dismissed heartbeat items', () => {
      const gaps = [
        { id: 'no_routines', type: 'DECIDE', priority: 'normal', content: 'Routines', question: '?' },
      ];
      const existingAgenda = [
        { id: 'item-2', heartbeatId: 'no_routines', status: 'dismissed' },
      ];
      const result = filterNewGaps(gaps, existingAgenda);
      assert.equal(result.length, 0);
    });

    it('filters by content match even without heartbeatId', () => {
      const gaps = [
        { id: 'no_tasks_today', type: 'DECIDE', priority: 'high', content: 'No tasks planned for today', question: '?' },
      ];
      const existingAgenda = [
        { id: 'item-3', content: 'No tasks planned for today', status: 'pending' },
      ];
      const result = filterNewGaps(gaps, existingAgenda);
      assert.equal(result.length, 0);
    });

    it('content match is case-insensitive', () => {
      const gaps = [
        { id: 'profile_role', type: 'INFORM', priority: 'high', content: 'Your role', question: '?' },
      ];
      const existingAgenda = [
        { id: 'item-4', content: 'your role', status: 'pending' },
      ];
      const result = filterNewGaps(gaps, existingAgenda);
      assert.equal(result.length, 0);
    });

    it('onboarding agenda items prevent heartbeat duplicates', async () => {
      const onboarding = generateOnboardingAgenda();
      const db = await createTestDb();
      await ensureSchema(db);
      await seedPersonality(db);
      const gaps = await detectDataGaps(db);
      const newGaps = filterNewGaps(gaps, onboarding);
      // Heartbeat should add at most timezone (not in onboarding) and nothing else
      const profileDups = newGaps.filter(g =>
        ['profile_user_name', 'profile_ai_name', 'no_tasks_today', 'no_projects', 'no_routines', 'profile_work_style', 'no_people'].includes(g.id)
      );
      assert.equal(profileDups.length, 0, `Found duplicates: ${profileDups.map(g => g.id).join(', ')}`);
    });
  });

  // --- HEARTBEAT_INTERVALS ---

  describe('HEARTBEAT_INTERVALS', () => {
    it('exports interval constants', () => {
      assert.ok(HEARTBEAT_INTERVALS.free);
      assert.ok(HEARTBEAT_INTERVALS.starter);
      assert.ok(HEARTBEAT_INTERVALS.pro);
    });

    it('free interval is shortest (most frequent)', () => {
      assert.ok(HEARTBEAT_INTERVALS.free <= HEARTBEAT_INTERVALS.starter);
      assert.ok(HEARTBEAT_INTERVALS.starter <= HEARTBEAT_INTERVALS.pro);
    });

    it('default is 5 minutes', () => {
      assert.equal(HEARTBEAT_INTERVALS.free, 5 * 60 * 1000);
    });
  });
});
