// Routines Engine — Atomic Habits features: formatting, stacking, analytics, progression
// Builds on routines.js CRUD layer
//
import { getDueRoutines, calcStreak } from './routines.js';
//
export function formatHabitForMeeting(routine, completions, frequency, days) {
  const parts = [routine.name];
  // Calculate streak from completions
  const dates = completions.map(c => c.completed_date);
  const streak = calcStreak(dates, frequency || routine.frequency, days || routine.days);
  if (streak > 0) parts[0] += ` 🔥${streak}`;
  if (routine.identity) parts.push(`Identity: ${routine.identity}`);
  if (routine.two_min_version) parts.push(`2-min: ${routine.two_min_version}`);
  if (routine.cue) parts.push(`Cue: ${routine.cue}`);
  if (routine.reward) parts.push(`Reward: ${routine.reward}`);
  return parts.join(' | ');
}
//
export async function getHabitStack(db, startId) {
  const routines = await db.prepare('SELECT * FROM routines WHERE active = 1 ORDER BY id').all();
  const byId = new Map(routines.map(r => [r.id, r]));
  let current = byId.get(startId);
  if (!current) return [];
  // Walk backward to find root
  const visited = new Set();
  while (current && current.stack_after && byId.has(current.stack_after) && !visited.has(current.id)) {
    visited.add(current.id);
    current = byId.get(current.stack_after);
  }
  // Walk forward from root
  const chain = [current];
  visited.clear();
  visited.add(current.id);
  let next = routines.find(r => r.stack_after === current.id && !visited.has(r.id));
  while (next) {
    chain.push(next);
    visited.add(next.id);
    next = routines.find(r => r.stack_after === next.id && !visited.has(r.id));
  }
  return chain;
}
//
export async function getRoutinesForMeeting(db, meetingType, date) {
  const due = await getDueRoutines(db, date);
  if (meetingType === 'morning_meeting') {
    const slots = { morning: [], midday: [], anytime: [], evening: [] };
    for (const h of due.habits) {
      const slot = h.time_slot || 'anytime';
      if (slots[slot]) slots[slot].push(h);
      else slots.anytime.push(h);
    }
    return { slots, reminders: due.reminders, events: due.events, upcoming: due.upcoming };
  }
  return due;
}
//
export async function getHabitAnalytics(db, routineId, days = 30) {
  const routine = await db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId);
  if (!routine) return null;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const completions = await db.prepare(
    'SELECT completed_date, quality, used_two_min FROM completions WHERE routine_id = ? AND completed_date >= ? ORDER BY completed_date'
  ).all(routineId, cutoff);
  // Count applicable days
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const completionSet = new Set(completions.map(c => c.completed_date));
  const dayCount = {};
  let applicableDays = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const ds = d.toISOString().slice(0, 10);
    const dn = dayNames[d.getDay()];
    let isApplicable = true;
    if (routine.frequency === 'weekdays' && ['sat', 'sun'].includes(dn)) isApplicable = false;
    if (routine.frequency === 'weekends' && !['sat', 'sun'].includes(dn)) isApplicable = false;
    if (routine.frequency === 'weekly' && routine.days) {
      const routineDays = JSON.parse(routine.days);
      if (!routineDays.includes(dn)) isApplicable = false;
    }
    if (isApplicable) {
      applicableDays++;
      dayCount[dn] = (dayCount[dn] || 0) + 1;
      if (!completionSet.has(ds)) dayCount[dn + '_missed'] = (dayCount[dn + '_missed'] || 0) + 1;
    }
  }
  const completionRate = applicableDays > 0 ? completions.length / applicableDays : 0;
  // Streak
  const allDates = completions.map(c => c.completed_date);
  const streak = calcStreak(allDates, routine.frequency, routine.days);
  // Average quality
  const rated = completions.filter(c => c.quality != null);
  const avgQuality = rated.length ? rated.reduce((s, c) => s + c.quality, 0) / rated.length : null;
  // Two-min rate
  const twoMinCount = completions.filter(c => c.used_two_min).length;
  const twoMinRate = completions.length > 0 ? twoMinCount / completions.length : 0;
  // Weak days (highest miss rate)
  const weakDays = Object.entries(dayCount)
    .filter(([k]) => !k.includes('_missed') && dayCount[k + '_missed'])
    .sort((a, b) => (dayCount[b[0] + '_missed'] || 0) / b[1] - (dayCount[a[0] + '_missed'] || 0) / a[1])
    .slice(0, 2)
    .map(([day]) => day);
  return { completionRate, streak, avgQuality, twoMinRate, weakDays, totalCompletions: completions.length, applicableDays };
}
//
export async function suggestProgression(db, routineId) {
  const analytics = await getHabitAnalytics(db, routineId, 30);
  if (!analytics) return null;
  if (analytics.streak >= 30 && analytics.avgQuality && analytics.avgQuality >= 3.5) {
    return { action: 'increase', reason: `${analytics.streak}-day streak with avg quality ${analytics.avgQuality.toFixed(1)}. Ready to level up.` };
  }
  if (analytics.twoMinRate > 0.5) {
    return { action: 'decrease', reason: `Using 2-min version ${Math.round(analytics.twoMinRate * 100)}% of the time. Consider scaling back.` };
  }
  if (analytics.completionRate < 0.6) {
    return { action: 'decrease', reason: `Only ${Math.round(analytics.completionRate * 100)}% completion rate. Lower the bar to rebuild consistency.` };
  }
  return { action: 'maintain', reason: 'On track. Keep building consistency.' };
}
//
export async function getPreparationStatus(db, routineId) {
  const routine = await db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId);
  if (!routine || !routine.preparation_steps) return null;
  const steps = JSON.parse(routine.preparation_steps);
  const state = routine.preparation_state ? JSON.parse(routine.preparation_state) : {};
  // Calculate days until event
  let eventDate = routine.target_date;
  if (routine.frequency === 'yearly' && eventDate) {
    const today = new Date().toISOString().slice(0, 10);
    eventDate = today.slice(0, 4) + routine.target_date.slice(4);
  }
  const daysUntil = eventDate
    ? Math.round((new Date(eventDate + 'T00:00:00') - new Date()) / 86400000)
    : null;
  const enrichedSteps = steps.map((step, i) => ({
    ...step,
    completed: !!state[i],
    index: i,
  }));
  const nextStep = enrichedSteps.find(s => !s.completed);
  return { steps: enrichedSteps, nextStep: nextStep || null, daysUntilEvent: daysUntil };
}
//
export async function advancePreparation(db, routineId, stepIndex) {
  const routine = await db.prepare('SELECT preparation_state FROM routines WHERE id = ?').get(routineId);
  if (!routine) return false;
  const state = routine.preparation_state ? JSON.parse(routine.preparation_state) : {};
  state[stepIndex] = true;
  await db.prepare(
    'UPDATE routines SET preparation_state = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(state), new Date().toISOString(), routineId);
  return true;
}
