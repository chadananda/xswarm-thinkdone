import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/test-db.js';
import { ensureSchema } from '../../src/lib/db.js';
import { addRoutine, completeRoutine } from '../../src/lib/routines.js';
import {
  formatHabitForMeeting, getHabitStack, getRoutinesForMeeting,
  getHabitAnalytics, suggestProgression,
  getPreparationStatus, advancePreparation,
} from '../../src/lib/routines-engine.js';
//
let db;
//
beforeEach(async () => {
  db = await createTestDb();
  await ensureSchema(db);
});
//
// --- formatHabitForMeeting ---
//
describe('formatHabitForMeeting', () => {
  it('returns name with streak when completions exist', () => {
    const routine = { name: 'Arabic practice', identity: null, two_min_version: null, cue: null, reward: null, stack_after: null };
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const completions = [{ completed_date: today }, { completed_date: yesterday }];
    const result = formatHabitForMeeting(routine, completions, 'daily', null);
    assert.match(result, /Arabic practice/);
    assert.match(result, /🔥2/);
  });
  it('includes identity when set', () => {
    const routine = { name: 'Arabic practice', identity: 'I am someone who speaks Arabic', two_min_version: null, cue: null, reward: null, stack_after: null };
    const result = formatHabitForMeeting(routine, [], 'daily', null);
    assert.match(result, /Identity: I am someone who speaks Arabic/);
  });
  it('includes two_min_version when set', () => {
    const routine = { name: 'Meditate', identity: null, two_min_version: 'Sit and breathe 3 times', cue: null, reward: null, stack_after: null };
    const result = formatHabitForMeeting(routine, [], 'daily', null);
    assert.match(result, /2-min: Sit and breathe 3 times/);
  });
  it('includes cue and reward when set', () => {
    const routine = { name: 'Exercise', identity: null, two_min_version: null, cue: 'After coffee', reward: 'Smoothie', stack_after: null };
    const result = formatHabitForMeeting(routine, [], 'daily', null);
    assert.match(result, /Cue: After coffee/);
    assert.match(result, /Reward: Smoothie/);
  });
  it('joins all parts with pipe separator', () => {
    const routine = {
      name: 'Arabic practice', identity: 'I speak Arabic',
      two_min_version: 'Open Duolingo', cue: 'After coffee', reward: 'Tea break',
      stack_after: null, frequency: 'daily', days: null,
    };
    const today = new Date().toISOString().slice(0, 10);
    const result = formatHabitForMeeting(routine, [{ completed_date: today }], 'daily', null);
    assert.match(result, /\|/);
    // All parts present
    assert.match(result, /Identity:/);
    assert.match(result, /2-min:/);
    assert.match(result, /Cue:/);
    assert.match(result, /Reward:/);
  });
  it('returns just name with no extras when nothing is set', () => {
    const routine = { name: 'Walk', identity: null, two_min_version: null, cue: null, reward: null, stack_after: null };
    const result = formatHabitForMeeting(routine, [], 'daily', null);
    assert.equal(result, 'Walk');
  });
});
//
// --- getHabitStack ---
//
describe('getHabitStack', () => {
  it('follows stack_after chain for a 3-item stack', async () => {
    const id1 = await addRoutine(db, 'Wake up', { kind: 'habit', frequency: 'daily', time_slot: 'morning' });
    const id2 = await addRoutine(db, 'Meditate', { kind: 'habit', frequency: 'daily', time_slot: 'morning', stack_after: id1 });
    const id3 = await addRoutine(db, 'Journal', { kind: 'habit', frequency: 'daily', time_slot: 'morning', stack_after: id2 });
    // Query from any item in the chain
    const chain = await getHabitStack(db, id3);
    assert.equal(chain.length, 3);
    assert.equal(chain[0].name, 'Wake up');
    assert.equal(chain[1].name, 'Meditate');
    assert.equal(chain[2].name, 'Journal');
  });
  it('returns single-item array if no chain', async () => {
    const id = await addRoutine(db, 'Solo habit', { kind: 'habit', frequency: 'daily' });
    const chain = await getHabitStack(db, id);
    assert.equal(chain.length, 1);
    assert.equal(chain[0].name, 'Solo habit');
  });
  it('returns empty array for non-existent id', async () => {
    const chain = await getHabitStack(db, 9999);
    assert.equal(chain.length, 0);
  });
  it('works when queried from middle of chain', async () => {
    const id1 = await addRoutine(db, 'Step 1', { kind: 'habit', frequency: 'daily' });
    const id2 = await addRoutine(db, 'Step 2', { kind: 'habit', frequency: 'daily', stack_after: id1 });
    const id3 = await addRoutine(db, 'Step 3', { kind: 'habit', frequency: 'daily', stack_after: id2 });
    const chain = await getHabitStack(db, id2);
    assert.equal(chain.length, 3);
    assert.equal(chain[0].name, 'Step 1');
    assert.equal(chain[2].name, 'Step 3');
  });
});
//
// --- getRoutinesForMeeting ---
//
describe('getRoutinesForMeeting', () => {
  it('groups habits by time_slot for morning_meeting', async () => {
    await addRoutine(db, 'Morning run', { kind: 'habit', frequency: 'daily', time_slot: 'morning' });
    await addRoutine(db, 'Read', { kind: 'habit', frequency: 'daily', time_slot: 'midday' });
    await addRoutine(db, 'Journal', { kind: 'habit', frequency: 'daily', time_slot: 'evening' });
    await addRoutine(db, 'Stretch', { kind: 'habit', frequency: 'daily', time_slot: 'anytime' });
    const result = await getRoutinesForMeeting(db, 'morning_meeting', '2026-02-10');
    assert.equal(result.slots.morning.length, 1);
    assert.equal(result.slots.morning[0].name, 'Morning run');
    assert.equal(result.slots.midday.length, 1);
    assert.equal(result.slots.midday[0].name, 'Read');
    assert.equal(result.slots.evening.length, 1);
    assert.equal(result.slots.evening[0].name, 'Journal');
    assert.equal(result.slots.anytime.length, 1);
    assert.equal(result.slots.anytime[0].name, 'Stretch');
  });
  it('separates reminders and events', async () => {
    await addRoutine(db, 'Habit', { kind: 'habit', frequency: 'daily' });
    await addRoutine(db, 'Call doc', { kind: 'reminder', frequency: 'once' });
    await addRoutine(db, 'Anniversary', { kind: 'event', frequency: 'yearly', target_date: '2020-02-10' });
    const result = await getRoutinesForMeeting(db, 'morning_meeting', '2026-02-10');
    assert.equal(result.reminders.length, 1);
    assert.equal(result.events.length, 1);
    assert.equal(result.reminders[0].name, 'Call doc');
    assert.equal(result.events[0].name, 'Anniversary');
  });
  it('returns flat due list for non-morning meeting', async () => {
    await addRoutine(db, 'Habit', { kind: 'habit', frequency: 'daily' });
    const result = await getRoutinesForMeeting(db, 'checkin', '2026-02-10');
    // Flat format from getDueRoutines
    assert.ok(result.habits);
    assert.ok(!result.slots);
  });
});
//
// --- getHabitAnalytics ---
//
describe('getHabitAnalytics', () => {
  it('calculates completionRate, streak, twoMinRate correctly', async () => {
    const id = await addRoutine(db, 'Exercise', { kind: 'habit', frequency: 'daily' });
    // Complete last 5 days, 2 with two_min
    const today = new Date();
    for (let i = 0; i < 5; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      await completeRoutine(db, id, { date: ds, quality: 4, used_two_min: i < 2 });
    }
    const analytics = await getHabitAnalytics(db, id, 30);
    assert.ok(analytics);
    assert.ok(analytics.completionRate > 0);
    assert.equal(analytics.streak, 5);
    assert.equal(analytics.totalCompletions, 5);
    assert.equal(analytics.twoMinRate, 2 / 5);
    assert.equal(analytics.avgQuality, 4);
  });
  it('returns null for non-existent routine', async () => {
    const analytics = await getHabitAnalytics(db, 9999);
    assert.equal(analytics, null);
  });
  it('identifies weak days', async () => {
    const id = await addRoutine(db, 'Exercise', { kind: 'habit', frequency: 'daily' });
    // Complete some days, skip others - just verify weakDays is an array
    const today = new Date();
    for (let i = 0; i < 10; i += 2) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      await completeRoutine(db, id, { date: d.toISOString().slice(0, 10) });
    }
    const analytics = await getHabitAnalytics(db, id, 30);
    assert.ok(Array.isArray(analytics.weakDays));
  });
  it('handles weekdays frequency', async () => {
    const id = await addRoutine(db, 'Work task', { kind: 'habit', frequency: 'weekdays' });
    const today = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const day = d.getDay();
      if (day !== 0 && day !== 6) {
        await completeRoutine(db, id, { date: d.toISOString().slice(0, 10) });
      }
    }
    const analytics = await getHabitAnalytics(db, id, 30);
    assert.ok(analytics);
    assert.ok(analytics.applicableDays > 0);
  });
});
//
// --- suggestProgression ---
//
describe('suggestProgression', () => {
  it('suggests increase when streak > 30 and quality > 3.5', async () => {
    const id = await addRoutine(db, 'Exercise', { kind: 'habit', frequency: 'daily' });
    // Create 35 consecutive daily completions with quality 4
    const today = new Date();
    for (let i = 0; i < 35; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      await completeRoutine(db, id, { date: d.toISOString().slice(0, 10), quality: 4 });
    }
    const suggestion = await suggestProgression(db, id);
    assert.ok(suggestion);
    assert.equal(suggestion.action, 'increase');
    assert.match(suggestion.reason, /streak/i);
  });
  it('suggests decrease when twoMinRate > 50%', async () => {
    const id = await addRoutine(db, 'Exercise', { kind: 'habit', frequency: 'daily' });
    // Create 10 completions, 7 with two_min
    const today = new Date();
    for (let i = 0; i < 10; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      await completeRoutine(db, id, { date: d.toISOString().slice(0, 10), quality: 3, used_two_min: i < 7 });
    }
    const suggestion = await suggestProgression(db, id);
    assert.ok(suggestion);
    assert.equal(suggestion.action, 'decrease');
    assert.match(suggestion.reason, /2-min/i);
  });
  it('suggests maintain otherwise', async () => {
    const id = await addRoutine(db, 'Exercise', { kind: 'habit', frequency: 'daily' });
    // Create 20 completions with quality 3, no two_min (20/30 = 67% > 60% threshold)
    const today = new Date();
    for (let i = 0; i < 20; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      await completeRoutine(db, id, { date: d.toISOString().slice(0, 10), quality: 3 });
    }
    const suggestion = await suggestProgression(db, id);
    assert.ok(suggestion);
    assert.equal(suggestion.action, 'maintain');
  });
  it('returns null for non-existent routine', async () => {
    const suggestion = await suggestProgression(db, 9999);
    assert.equal(suggestion, null);
  });
});
//
// --- getPreparationStatus ---
//
describe('getPreparationStatus', () => {
  it('tracks prep chain steps', async () => {
    const steps = JSON.stringify([
      { name: 'Buy gift', days_before: 7 },
      { name: 'Wrap gift', days_before: 1 },
      { name: 'Party time', days_before: 0 },
    ]);
    const id = await addRoutine(db, 'Wife birthday', {
      kind: 'event', frequency: 'yearly', target_date: '1990-03-15',
    });
    // Set preparation_steps directly
    await db.prepare('UPDATE routines SET preparation_steps = ? WHERE id = ?').run(steps, id);
    const status = await getPreparationStatus(db, id);
    assert.ok(status);
    assert.equal(status.steps.length, 3);
    assert.equal(status.steps[0].name, 'Buy gift');
    assert.equal(status.steps[0].completed, false);
    assert.equal(status.steps[1].completed, false);
    assert.ok(status.nextStep);
    assert.equal(status.nextStep.name, 'Buy gift');
    assert.equal(status.nextStep.index, 0);
  });
  it('returns null if no preparation_steps', async () => {
    const id = await addRoutine(db, 'No prep', { kind: 'habit', frequency: 'daily' });
    const status = await getPreparationStatus(db, id);
    assert.equal(status, null);
  });
  it('returns null for non-existent routine', async () => {
    const status = await getPreparationStatus(db, 9999);
    assert.equal(status, null);
  });
  it('shows daysUntilEvent for yearly events', async () => {
    const id = await addRoutine(db, 'Birthday', {
      kind: 'event', frequency: 'yearly', target_date: '1990-03-15',
    });
    const steps = JSON.stringify([{ name: 'Buy gift', days_before: 7 }]);
    await db.prepare('UPDATE routines SET preparation_steps = ? WHERE id = ?').run(steps, id);
    const status = await getPreparationStatus(db, id);
    assert.ok(status.daysUntilEvent !== null);
    assert.equal(typeof status.daysUntilEvent, 'number');
  });
});
//
// --- advancePreparation ---
//
describe('advancePreparation', () => {
  it('marks step completed', async () => {
    const steps = JSON.stringify([
      { name: 'Step A', days_before: 7 },
      { name: 'Step B', days_before: 3 },
    ]);
    const id = await addRoutine(db, 'Event', {
      kind: 'event', frequency: 'yearly', target_date: '1990-06-01',
    });
    await db.prepare('UPDATE routines SET preparation_steps = ? WHERE id = ?').run(steps, id);
    // Advance step 0
    const ok = await advancePreparation(db, id, 0);
    assert.equal(ok, true);
    // Verify step 0 is completed, step 1 is not
    const status = await getPreparationStatus(db, id);
    assert.equal(status.steps[0].completed, true);
    assert.equal(status.steps[1].completed, false);
    assert.equal(status.nextStep.name, 'Step B');
    assert.equal(status.nextStep.index, 1);
  });
  it('returns false for non-existent routine', async () => {
    const ok = await advancePreparation(db, 9999, 0);
    assert.equal(ok, false);
  });
  it('advances multiple steps in sequence', async () => {
    const steps = JSON.stringify([
      { name: 'Step A', days_before: 7 },
      { name: 'Step B', days_before: 3 },
      { name: 'Step C', days_before: 0 },
    ]);
    const id = await addRoutine(db, 'Event', {
      kind: 'event', frequency: 'once', target_date: '2026-06-01',
    });
    await db.prepare('UPDATE routines SET preparation_steps = ? WHERE id = ?').run(steps, id);
    await advancePreparation(db, id, 0);
    await advancePreparation(db, id, 1);
    await advancePreparation(db, id, 2);
    const status = await getPreparationStatus(db, id);
    assert.equal(status.steps.every(s => s.completed), true);
    assert.equal(status.nextStep, null);
  });
});
