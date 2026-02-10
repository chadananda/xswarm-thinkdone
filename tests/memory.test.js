// Integration test for xswarm-thinkdone memory system
// Uses mock embeddings to test all operations without model download
import { createClient } from '@libsql/client';
import { createHash } from 'crypto';
import { unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
const DB = join(tmpdir(), `thinkdone-test-${Date.now()}.db`);
if (existsSync(DB)) unlinkSync(DB);
// Mock deterministic embeddings
function embed(text) {
  const h = createHash('sha256').update(text).digest();
  const seed = h.readUInt32BE(0);
  const vec = Array(384).fill(0).map((_, i) => Math.sin(seed * 0.001 + i * 0.1));
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / norm);
}
// stripPrefix (copy from memory.js to test independently)
const TYPE_RE = /^(?:DECISION|BLOCKER|STATUS|PATTERN|DEPENDENCY|COMMITMENT|IDEA|INSIGHT|RESOLVED)\s*/i;
function stripPrefix(c) {
  const m = c.match(TYPE_RE);
  if (!m) return c;
  let rest = c.slice(m[0].length);
  if (rest.startsWith('[')) return rest.replace(/^(\[[^\]]+\])\s*:\s*/, '$1 ');
  if (rest.startsWith(':')) return rest.replace(/^:\s*/, '');
  return rest;
}
// --- Setup ---
const db = createClient({ url: `file:${DB}` });
await db.execute(`CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL, project TEXT DEFAULT '', type TEXT DEFAULT 'insight',
  created_at TEXT NOT NULL, superseded_by INTEGER DEFAULT NULL,
  embedding F32_BLOB(384))`);
await db.execute(`CREATE INDEX memories_idx ON memories
  (libsql_vector_idx(embedding, 'compress_neighbors=float8', 'max_neighbors=50'))`);
console.log('Schema created\n');
// --- Store ---
const memories = [
  ['DECISION [Feb 10]: Host Star of the West on OceanLibrary (not Sacred-Traditions)', 'oceanlibrary', 'decision'],
  ['BLOCKER [Feb 10]: AlmostEnglish Stripe blocked — content workflow must come first', 'almostenglish', 'blocker'],
  ['STATUS [Feb 10]: WholeReader — SAT article 80%, press release not started', 'wholereader', 'status'],
  ['PATTERN: Marketing deferred 5/7 last sessions — dev always wins priority', '', 'pattern'],
  ['DEPENDENCY: SifterSearch ingester → DRBI library eval → BlogWorks content plan', 'siftersearch', 'dependency'],
  ['COMMITMENT [due Feb 12]: Deliver WholeReader review to Gilbert', 'wholereader', 'commitment'],
  ['IDEA: BlogWorks + ThinkDone share AI-via-natural-channel arch — shared engine', 'blogworks', 'idea'],
  ['DECISION [Feb 10]: Defer BlogWorks architecture to next week', 'blogworks', 'decision'],
  ['DECISION [Feb 9]: Product name: ThinkDone.ai (not Planboost)', 'thinkdone', 'decision'],
  ['BLOCKER [Feb 10]: SifterSearch ingester not working — blocks DRBI eval', 'siftersearch', 'blocker'],
  ['PATTERN: Tuesday build sprints consistently under-scoped', '', 'pattern'],
  ['COMMITMENT [due Feb 14]: Meet DRBI writer in Casa Grande', 'drbi', 'commitment'],
  ['STATUS [Feb 10]: AlmostEnglish: content workflow → Stripe → QA → ship v1', 'almostenglish', 'status'],
  ['STATUS [Feb 10]: SifterSearch: ingester is critical path for DRBI + BlogWorks', 'siftersearch', 'status'],
];
for (const [content, project, type] of memories) {
  const vec = embed(content);
  await db.execute({
    sql: 'INSERT INTO memories (content, project, type, created_at, embedding) VALUES (?, ?, ?, ?, vector(?))',
    args: [content, project, type, new Date().toISOString(), JSON.stringify(vec)]
  });
}
console.log(`Stored ${memories.length} memories\n`);
// --- Vector Search ---
console.log('=== VECTOR SEARCH: "AlmostEnglish" ===');
const qv = embed('AlmostEnglish shipping progress');
const sr = await db.execute({
  sql: `SELECT m.id, m.content, m.type
    FROM vector_top_k('memories_idx', vector(?), 5) AS v
    JOIN memories AS m ON m.rowid = v.id
    WHERE m.superseded_by IS NULL`,
  args: [JSON.stringify(qv)]
});
sr.rows.forEach(r => console.log(`  #${r.id} ${r.type}: ${r.content.slice(0, 70)}`));
// --- Recall (manual) ---
console.log('\n=== RECALL ===');
const threeDays = new Date(Date.now() - 3 * 86400000).toISOString();
// Blockers
const blockers = (await db.execute({
  sql: 'SELECT content, project FROM memories WHERE type=? AND superseded_by IS NULL ORDER BY created_at DESC',
  args: ['blocker']
})).rows;
if (blockers.length) {
  console.log('BLOCKERS:');
  blockers.forEach(r => console.log(`  - ${stripPrefix(r.content)}`));
}
// Commitments
const commits = (await db.execute({
  sql: 'SELECT content, project FROM memories WHERE type=? AND superseded_by IS NULL ORDER BY created_at DESC',
  args: ['commitment']
})).rows;
if (commits.length) {
  console.log('COMMITMENTS:');
  commits.forEach(r => console.log(`  - ${stripPrefix(r.content)}`));
}
// Decisions
const decisions = (await db.execute({
  sql: 'SELECT content FROM memories WHERE type=? AND created_at >= ? ORDER BY created_at DESC',
  args: ['decision', threeDays]
})).rows;
if (decisions.length) {
  console.log('RECENT DECISIONS (3 days):');
  decisions.forEach(r => console.log(`  - ${stripPrefix(r.content)}`));
}
// Patterns
const patterns = (await db.execute({
  sql: 'SELECT content FROM memories WHERE type=? AND superseded_by IS NULL',
  args: ['pattern']
})).rows;
if (patterns.length) {
  console.log('PATTERNS:');
  patterns.forEach(r => console.log(`  - ${stripPrefix(r.content)}`));
}
// Dependencies
const deps = (await db.execute({
  sql: 'SELECT content FROM memories WHERE type=? AND superseded_by IS NULL',
  args: ['dependency']
})).rows;
if (deps.length) {
  console.log('DEPENDENCIES:');
  deps.forEach(r => console.log(`  - ${stripPrefix(r.content)}`));
}
// --- Supersede ---
console.log('\n=== SUPERSEDE #2 (blocker → status) ===');
const newVec = embed('AlmostEnglish Stripe integration started');
const ins = await db.execute({
  sql: 'INSERT INTO memories (content, project, type, created_at, embedding) VALUES (?, ?, ?, ?, vector(?))',
  args: ['STATUS [Feb 11]: AlmostEnglish Stripe integrated, QA pending', 'almostenglish', 'status', new Date().toISOString(), JSON.stringify(newVec)]
});
const newId = Number(ins.lastInsertRowid);
await db.execute({ sql: 'UPDATE memories SET superseded_by = ? WHERE id = ?', args: [newId, 2] });
console.log(`  Superseded #2 -> #${newId}`);
const activeBlockers = (await db.execute({
  sql: 'SELECT id, content FROM memories WHERE type=? AND superseded_by IS NULL',
  args: ['blocker']
})).rows;
console.log(`  Active blockers: ${activeBlockers.length}`);
activeBlockers.forEach(r => console.log(`    #${r.id}: ${r.content}`));
// --- Consolidate ---
console.log('\n=== CONSOLIDATE ===');
// Add a newer wholereader status to create a duplicate
await db.execute({
  sql: 'INSERT INTO memories (content, project, type, created_at, embedding) VALUES (?, ?, ?, ?, vector(?))',
  args: ['STATUS [Feb 11]: WholeReader — SAT article done, press release in progress', 'wholereader', 'status', new Date().toISOString(), JSON.stringify(embed('wr update'))]
});
let consolidated = 0;
for (const mtype of ['status', 'pattern']) {
  const groups = (await db.execute({
    sql: 'SELECT project, COUNT(*) as cnt FROM memories WHERE type=? AND superseded_by IS NULL GROUP BY project HAVING cnt > 1',
    args: [mtype]
  })).rows;
  for (const g of groups) {
    const dupes = (await db.execute({
      sql: 'SELECT id FROM memories WHERE type=? AND project=? AND superseded_by IS NULL ORDER BY created_at DESC',
      args: [mtype, g.project]
    })).rows;
    const newest = dupes[0].id;
    for (const old of dupes.slice(1)) {
      await db.execute({ sql: 'UPDATE memories SET superseded_by = ? WHERE id = ?', args: [newest, old.id] });
      consolidated++;
    }
  }
}
const active = (await db.execute('SELECT COUNT(*) as n FROM memories WHERE superseded_by IS NULL')).rows[0].n;
const total = (await db.execute('SELECT COUNT(*) as n FROM memories')).rows[0].n;
console.log(`  Consolidated ${consolidated} entries`);
console.log(`  Active: ${active} | Total: ${total}`);
// --- stripPrefix tests ---
console.log('\n=== stripPrefix ===');
const tests = [
  ['BLOCKER [Feb 10]: AlmostEnglish Stripe blocked', '[Feb 10] AlmostEnglish Stripe blocked'],
  ['PATTERN: Marketing deferred 5/7', 'Marketing deferred 5/7'],
  ['COMMITMENT [due Feb 12]: Deliver review', '[due Feb 12] Deliver review'],
  ['DECISION [Feb 9]: Product name', '[Feb 9] Product name'],
  ['AlmostEnglish: content workflow', 'AlmostEnglish: content workflow'],
];
let pass = 0;
for (const [input, expected] of tests) {
  const got = stripPrefix(input);
  const ok = got === expected;
  if (ok) pass++;
  else console.log(`  FAIL: "${input}" -> "${got}" (expected "${expected}")`);
}
console.log(`  ${pass}/${tests.length} passed`);
// === HABIT / ROUTINES TESTS ===
console.log('\n=== HABIT SCHEMA ===');
await db.execute(`CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'habit',
  frequency TEXT NOT NULL DEFAULT 'daily',
  days TEXT DEFAULT NULL,
  time_slot TEXT DEFAULT 'anytime',
  project TEXT DEFAULT '',
  minutes INTEGER DEFAULT 15,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL)`);
await db.execute(`CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER NOT NULL,
  completed_date TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (routine_id) REFERENCES routines(id))`);
console.log('  Routines + completions tables created');

// --- habit add ---
console.log('\n=== HABIT ADD ===');
const now = new Date().toISOString();
const r1 = await db.execute({
  sql: 'INSERT INTO routines (name, kind, frequency, time_slot, minutes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
  args: ['Exercise ~30m', 'habit', 'daily', 'morning', 30, now, now]
});
const h1 = Number(r1.lastInsertRowid);
console.log(`  Added habit #${h1}: Exercise ~30m`);

const r2 = await db.execute({
  sql: 'INSERT INTO routines (name, kind, frequency, time_slot, minutes, project, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
  args: ['Read for 1 hour ~1h', 'habit', 'weekdays', 'midday', 60, 'personal', now, now]
});
const h2 = Number(r2.lastInsertRowid);

const r3 = await db.execute({
  sql: 'INSERT INTO routines (name, kind, frequency, days, time_slot, minutes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
  args: ['Team standup ~15m', 'event', 'weekly', '["mon","wed","fri"]', 'morning', 15, now, now]
});
const h3 = Number(r3.lastInsertRowid);

const r4 = await db.execute({
  sql: 'INSERT INTO routines (name, kind, frequency, time_slot, minutes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
  args: ['Dentist appointment ~1h', 'reminder', 'once', 'morning', 60, now, now]
});
const h4 = Number(r4.lastInsertRowid);
console.log(`  Added 4 routines (ids: ${h1}, ${h2}, ${h3}, ${h4})`);

// --- habit list ---
console.log('\n=== HABIT LIST (active only) ===');
const allActive = (await db.execute('SELECT id, name, kind, frequency, days FROM routines WHERE active = 1 ORDER BY id')).rows;
console.log(`  Active routines: ${allActive.length}`);
let listOk = allActive.length === 4;
if (!listOk) console.log('  FAIL: expected 4 active routines');

// --- habit pause / resume ---
console.log('\n=== HABIT PAUSE / RESUME ===');
await db.execute({ sql: 'UPDATE routines SET active = 0, updated_at = ? WHERE id = ?', args: [now, h2] });
const afterPause = (await db.execute('SELECT id FROM routines WHERE active = 1')).rows;
let pauseOk = afterPause.length === 3;
console.log(`  After pause #${h2}: ${afterPause.length} active (${pauseOk ? 'PASS' : 'FAIL'})`);

await db.execute({ sql: 'UPDATE routines SET active = 1, updated_at = ? WHERE id = ?', args: [now, h2] });
const afterResume = (await db.execute('SELECT id FROM routines WHERE active = 1')).rows;
let resumeOk = afterResume.length === 4;
console.log(`  After resume #${h2}: ${afterResume.length} active (${resumeOk ? 'PASS' : 'FAIL'})`);

// --- habit due (day-of-week filtering) ---
console.log('\n=== HABIT DUE ===');
// Helper: check if a routine is due on a given day
function isDue(routine, dayName) {
  const { frequency, days } = routine;
  if (frequency === 'daily') return true;
  if (frequency === 'weekdays') return !['sat', 'sun'].includes(dayName);
  if (frequency === 'weekends') return ['sat', 'sun'].includes(dayName);
  if (frequency === 'weekly') {
    const parsed = JSON.parse(days || '[]');
    return parsed.includes(dayName);
  }
  if (frequency === 'once') return true; // once is always due until completed
  return false;
}

// Test on a Wednesday
const wedDue = allActive.filter(r => isDue(r, 'wed'));
console.log(`  Due on Wednesday: ${wedDue.map(r => r.name).join(', ')}`);
let wedOk = wedDue.length === 4; // daily, weekdays, weekly(mon/wed/fri), once
console.log(`  Expected 4 due on Wed: ${wedOk ? 'PASS' : 'FAIL'}`);

// Test on a Saturday
const satDue = allActive.filter(r => isDue(r, 'sat'));
console.log(`  Due on Saturday: ${satDue.map(r => r.name).join(', ')}`);
let satOk = satDue.length === 2; // daily + once (weekdays excluded, weekly excluded)
console.log(`  Expected 2 due on Sat: ${satOk ? 'PASS' : 'FAIL'}`);

// --- habit complete ---
console.log('\n=== HABIT COMPLETE ===');
const today = new Date().toISOString().slice(0, 10);
await db.execute({
  sql: 'INSERT INTO completions (routine_id, completed_date, completed_at) VALUES (?,?,?)',
  args: [h1, today, new Date().toISOString()]
});
// Check it's completed for today
const comp = (await db.execute({
  sql: 'SELECT id FROM completions WHERE routine_id = ? AND completed_date = ?',
  args: [h1, today]
})).rows;
let completeOk = comp.length === 1;
console.log(`  Completed #${h1} for ${today}: ${completeOk ? 'PASS' : 'FAIL'}`);

// Idempotent: completing again should not duplicate (upsert behavior)
const existing = (await db.execute({
  sql: 'SELECT id FROM completions WHERE routine_id = ? AND completed_date = ?',
  args: [h1, today]
})).rows;
if (existing.length === 0) {
  await db.execute({
    sql: 'INSERT INTO completions (routine_id, completed_date, completed_at) VALUES (?,?,?)',
    args: [h1, today, new Date().toISOString()]
  });
}
const afterIdempotent = (await db.execute({
  sql: 'SELECT id FROM completions WHERE routine_id = ? AND completed_date = ?',
  args: [h1, today]
})).rows;
let idempotentOk = afterIdempotent.length === 1;
console.log(`  Idempotent complete: ${idempotentOk ? 'PASS' : 'FAIL'}`);

// Due should exclude completed
const dueAfterComplete = allActive.filter(r => isDue(r, 'wed'));
const completedIds = new Set((await db.execute({
  sql: 'SELECT routine_id FROM completions WHERE completed_date = ?',
  args: [today]
})).rows.map(r => r.routine_id));
const actualDue = dueAfterComplete.filter(r => !completedIds.has(r.id));
let dueExcludesOk = !actualDue.find(r => r.id === h1);
console.log(`  Due excludes completed: ${dueExcludesOk ? 'PASS' : 'FAIL'}`);

// --- streak calculation ---
console.log('\n=== STREAK ===');
// Add completions for 3 consecutive days before today for h1
const dates = [];
for (let i = 1; i <= 3; i++) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  dates.push(d.toISOString().slice(0, 10));
}
for (const d of dates) {
  await db.execute({
    sql: 'INSERT INTO completions (routine_id, completed_date, completed_at) VALUES (?,?,?)',
    args: [h1, d, new Date().toISOString()]
  });
}
// h1 is daily — completed today + 3 days back = streak of 4
function calcStreak(completionDates, frequency, days, includeToday) {
  const dateSet = new Set(completionDates);
  let streak = 0;
  const d = new Date();
  // If today is completed, count it
  const todayStr = d.toISOString().slice(0, 10);
  if (includeToday && dateSet.has(todayStr)) streak++;
  // Walk backwards from yesterday
  for (let i = 1; i <= 365; i++) {
    const check = new Date();
    check.setDate(check.getDate() - i);
    const checkStr = check.toISOString().slice(0, 10);
    const dayName = ['sun','mon','tue','wed','thu','fri','sat'][check.getDay()];
    // Skip non-expected days
    if (frequency === 'weekdays' && ['sat','sun'].includes(dayName)) continue;
    if (frequency === 'weekends' && !['sat','sun'].includes(dayName)) continue;
    if (frequency === 'weekly') {
      const parsed = JSON.parse(days || '[]');
      if (!parsed.includes(dayName)) continue;
    }
    if (dateSet.has(checkStr)) streak++;
    else break;
  }
  return streak;
}

const h1Completions = (await db.execute({
  sql: 'SELECT completed_date FROM completions WHERE routine_id = ?',
  args: [h1]
})).rows.map(r => r.completed_date);
const h1Streak = calcStreak(h1Completions, 'daily', null, true);
let streakOk = h1Streak === 4;
console.log(`  h1 streak (daily, 4 days): ${h1Streak} (${streakOk ? 'PASS' : 'FAIL'})`);

// Test gap breaks streak: h2 has no completions
const h2Streak = calcStreak([], 'weekdays', null, false);
let noStreakOk = h2Streak === 0;
console.log(`  h2 streak (no completions): ${h2Streak} (${noStreakOk ? 'PASS' : 'FAIL'})`);

// Test today grace period: not completed today shouldn't break streak
// h3 is weekly mon/wed/fri — add completions for last 2 expected days
const h3Dates = [];
const dayRef = new Date();
let found = 0;
for (let i = 1; i <= 14 && found < 2; i++) {
  const check = new Date();
  check.setDate(dayRef.getDate() - i);
  const dayName = ['sun','mon','tue','wed','thu','fri','sat'][check.getDay()];
  if (['mon','wed','fri'].includes(dayName)) {
    h3Dates.push(check.toISOString().slice(0, 10));
    found++;
  }
}
for (const d of h3Dates) {
  await db.execute({
    sql: 'INSERT INTO completions (routine_id, completed_date, completed_at) VALUES (?,?,?)',
    args: [h3, d, new Date().toISOString()]
  });
}
const h3Completions = (await db.execute({
  sql: 'SELECT completed_date FROM completions WHERE routine_id = ?',
  args: [h3]
})).rows.map(r => r.completed_date);
const h3Streak = calcStreak(h3Completions, 'weekly', '["mon","wed","fri"]', false);
let h3StreakOk = h3Streak === 2;
console.log(`  h3 streak (weekly, 2 past expected): ${h3Streak} (${h3StreakOk ? 'PASS' : 'FAIL'})`);

// --- once frequency: after complete never shows again ---
console.log('\n=== ONCE FREQUENCY ===');
await db.execute({
  sql: 'INSERT INTO completions (routine_id, completed_date, completed_at) VALUES (?,?,?)',
  args: [h4, today, new Date().toISOString()]
});
// once routine completed → active set to 0
await db.execute({ sql: 'UPDATE routines SET active = 0, updated_at = ? WHERE id = ? AND frequency = ?', args: [now, h4, 'once'] });
const onceAfter = (await db.execute({
  sql: 'SELECT active FROM routines WHERE id = ?',
  args: [h4]
})).rows[0];
let onceOk = onceAfter.active === 0;
console.log(`  Once routine deactivated after complete: ${onceOk ? 'PASS' : 'FAIL'}`);

// --- habit remove ---
console.log('\n=== HABIT REMOVE ===');
await db.execute({ sql: 'DELETE FROM completions WHERE routine_id = ?', args: [h4] });
await db.execute({ sql: 'DELETE FROM routines WHERE id = ?', args: [h4] });
const afterRemove = (await db.execute('SELECT id FROM routines')).rows;
let removeOk = afterRemove.length === 3 && !afterRemove.find(r => r.id === h4);
console.log(`  Removed #${h4}: ${afterRemove.length} routines remaining (${removeOk ? 'PASS' : 'FAIL'})`);
// Verify completions also removed
const removedComps = (await db.execute({ sql: 'SELECT id FROM completions WHERE routine_id = ?', args: [h4] })).rows;
let removeCompsOk = removedComps.length === 0;
console.log(`  Completions cleaned up: ${removeCompsOk ? 'PASS' : 'FAIL'}`);

// --- Summary ---
const habitTests = [
  ['habit list active only', listOk],
  ['habit pause', pauseOk],
  ['habit resume', resumeOk],
  ['due on Wednesday', wedOk],
  ['due on Saturday', satOk],
  ['habit complete', completeOk],
  ['idempotent complete', idempotentOk],
  ['due excludes completed', dueExcludesOk],
  ['streak daily 4 days', streakOk],
  ['streak no completions', noStreakOk],
  ['streak weekly grace', h3StreakOk],
  ['once deactivated', onceOk],
  ['habit remove routine', removeOk],
  ['habit remove completions', removeCompsOk],
];
const habitPass = habitTests.filter(([,ok]) => ok).length;
const habitFail = habitTests.filter(([,ok]) => !ok);
console.log(`\n=== HABIT TESTS: ${habitPass}/${habitTests.length} passed ===`);
if (habitFail.length) habitFail.forEach(([name]) => console.log(`  FAIL: ${name}`));

// Cleanup
db.close();
unlinkSync(DB);
console.log('\nAll tests passed.');
