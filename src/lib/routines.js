// Routines CRUD — browser-compatible, async, reusable from CLI or UI
// Ported from src/memory.js habit logic
//
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
//
// --- Pure helpers (no DB) ---
//
export function isDue(routine, dayName, targetDate) {
  if (routine.frequency === 'daily') return true;
  if (routine.frequency === 'weekdays') return !['sat', 'sun'].includes(dayName);
  if (routine.frequency === 'weekends') return ['sat', 'sun'].includes(dayName);
  if (routine.frequency === 'weekly') return (JSON.parse(routine.days || '[]')).includes(dayName);
  if (routine.frequency === 'yearly' && routine.target_date) return targetDate.slice(5) === routine.target_date.slice(5);
  if (routine.frequency === 'once') {
    if (routine.target_date) return targetDate >= routine.target_date;
    return true;
  }
  return false;
}
//
export function isUpcoming(routine, targetDate) {
  if (!routine.remind_before || routine.remind_before <= 0) return false;
  if (!routine.target_date) return false;
  let eventDate = routine.target_date;
  if (routine.frequency === 'yearly') eventDate = targetDate.slice(0, 4) + routine.target_date.slice(4);
  const target = new Date(targetDate + 'T00:00:00');
  const event = new Date(eventDate + 'T00:00:00');
  const daysUntil = Math.round((event - target) / 86400000);
  return daysUntil > 0 && daysUntil <= routine.remind_before;
}
//
export function calcStreak(completionDates, frequency, days) {
  const dateSet = new Set(completionDates);
  const todayStr = new Date().toISOString().slice(0, 10);
  let streak = dateSet.has(todayStr) ? 1 : 0;
  for (let i = 1; i <= 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const dn = DAY_NAMES[d.getDay()];
    if (frequency === 'weekdays' && ['sat', 'sun'].includes(dn)) continue;
    if (frequency === 'weekends' && !['sat', 'sun'].includes(dn)) continue;
    if (frequency === 'weekly' && !(JSON.parse(days || '[]')).includes(dn)) continue;
    if (dateSet.has(ds)) streak++;
    else break;
  }
  return streak;
}
//
// --- Database operations ---
//
function defaultKind(frequency) {
  if (frequency === 'once') return 'reminder';
  if (frequency === 'yearly') return 'event';
  return 'habit';
}
//
export async function addRoutine(db, name, opts = {}) {
  const kind = opts.kind || defaultKind(opts.frequency || 'daily');
  const frequency = opts.frequency || 'daily';
  const days = opts.days ? JSON.stringify(opts.days) : (opts.days_json || null);
  const time_slot = opts.time_slot || 'anytime';
  const now = new Date().toISOString();
  const result = await db.prepare(
    `INSERT INTO routines (name, description, kind, frequency, days, time_slot, specific_time,
     project, person, minutes, remind_before, target_date, identity, cue, craving, reward,
     two_min_version, stack_after, bundle_with, difficulty, goal_quantity, goal_unit,
     created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    name, opts.description || null, kind, frequency, days, time_slot, opts.specific_time || null,
    opts.project || '', opts.person || '', opts.minutes || 15,
    opts.remind_before || 0, opts.target_date || null,
    opts.identity || null, opts.cue || null, opts.craving || null, opts.reward || null,
    opts.two_min_version || null, opts.stack_after || null, opts.bundle_with || null,
    opts.difficulty || 1, opts.goal_quantity || null, opts.goal_unit || null,
    now, now
  );
  return Number(result.lastInsertRowid);
}
//
export async function listRoutines(db, filters = {}) {
  let sql = 'SELECT * FROM routines WHERE 1=1';
  const params = [];
  if (filters.active === false) {
    sql += ' AND active = 0';
  } else if (filters.active === undefined || filters.active === true) {
    sql += ' AND active = 1';
  }
  if (filters.kind) { sql += ' AND kind = ?'; params.push(filters.kind); }
  if (filters.project) { sql += ' AND project = ?'; params.push(filters.project); }
  sql += ' ORDER BY id';
  return db.prepare(sql).all(...params);
}
//
export async function getDueRoutines(db, date) {
  const d = new Date(date + 'T12:00:00');
  const dayName = DAY_NAMES[d.getDay()];
  const rows = await db.prepare('SELECT * FROM routines WHERE active = 1').all();
  const completedRows = await db.prepare('SELECT routine_id FROM completions WHERE completed_date = ?').all(date);
  const completed = new Set(completedRows.map(r => r.routine_id));
  const due = rows.filter(r => isDue(r, dayName, date) && !completed.has(r.id));
  const upcoming = rows.filter(r => !due.includes(r) && isUpcoming(r, date));
  // Calculate streaks for habits
  const habits = [];
  for (const r of due.filter(r => r.kind === 'habit')) {
    const dates = await db.prepare('SELECT completed_date FROM completions WHERE routine_id = ?').all(r.id);
    const streak = calcStreak(dates.map(c => c.completed_date), r.frequency, r.days);
    habits.push({ ...r, streak });
  }
  const reminders = due.filter(r => r.kind === 'reminder');
  const events = due.filter(r => r.kind === 'event');
  return { habits, reminders, events, upcoming };
}
//
export async function completeRoutine(db, routineId, opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  // Check for existing completion on this date
  const existing = await db.prepare('SELECT id FROM completions WHERE routine_id = ? AND completed_date = ?').get(routineId, date);
  if (!existing) {
    await db.prepare(
      'INSERT INTO completions (routine_id, completed_date, completed_at, notes, quality, quantity, used_two_min) VALUES (?,?,?,?,?,?,?)'
    ).run(routineId, date, now, opts.notes || null, opts.quality || null, opts.quantity || null, opts.used_two_min ? 1 : 0);
  }
  // Deactivate once-frequency routines
  const routine = await db.prepare('SELECT frequency FROM routines WHERE id = ?').get(routineId);
  if (routine && routine.frequency === 'once') {
    await db.prepare('UPDATE routines SET active = 0, updated_at = ? WHERE id = ?').run(now, routineId);
  }
}
//
export async function getStreak(db, routineId) {
  const routine = await db.prepare('SELECT frequency, days FROM routines WHERE id = ?').get(routineId);
  if (!routine) return 0;
  const dates = await db.prepare('SELECT completed_date FROM completions WHERE routine_id = ?').all(routineId);
  return calcStreak(dates.map(c => c.completed_date), routine.frequency, routine.days);
}
//
export async function pauseRoutine(db, id) {
  await db.prepare('UPDATE routines SET active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}
//
export async function resumeRoutine(db, id) {
  await db.prepare('UPDATE routines SET active = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}
//
export async function removeRoutine(db, id) {
  await db.prepare('DELETE FROM completions WHERE routine_id = ?').run(id);
  await db.prepare('DELETE FROM routines WHERE id = ?').run(id);
}
//
export async function updateRoutine(db, id, changes) {
  const allowedFields = [
    'name', 'description', 'kind', 'frequency', 'days', 'time_slot', 'specific_time',
    'project', 'person', 'minutes', 'remind_before', 'target_date',
    'identity', 'cue', 'craving', 'reward', 'two_min_version',
    'stack_after', 'bundle_with', 'difficulty', 'goal_quantity', 'goal_unit',
  ];
  const sets = [];
  const params = [];
  for (const field of allowedFields) {
    if (field in changes) {
      sets.push(`${field} = ?`);
      const val = field === 'days' && Array.isArray(changes[field]) ? JSON.stringify(changes[field]) : changes[field];
      params.push(val);
    }
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  await db.prepare(`UPDATE routines SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}
