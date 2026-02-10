#!/usr/bin/env node
// xswarm-thinkdone: semantic memory for daily planning sessions
// libsql (local/Turso) + @huggingface/transformers BGE-small-en-v1.5
import { createClient } from '@libsql/client';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, statSync, mkdirSync } from 'fs';
// --- config ---
const __dir = dirname(fileURLToPath(import.meta.url));
let DB_PATH = process.env.THINKDONE_DB || join(__dir, '..', '..', '.claude', 'memory.db');
const TURSO_URL = process.env.THINKDONE_TURSO_URL || '';
const TURSO_TOKEN = process.env.THINKDONE_TURSO_TOKEN || '';
const TYPES = new Set(['decision','blocker','status','pattern','dependency','commitment','idea','insight']);
// --- embedding (lazy) ---
let _emb = null;
const getEmb = async () => _emb ??= await (await import('@huggingface/transformers')).pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'fp32' });
const embed = async text => Array.from((await (await getEmb())(text, { pooling: 'cls', normalize: true })).data);
// --- db ---
const getDb = (path = DB_PATH) => {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return TURSO_URL && TURSO_TOKEN
    ? createClient({ url: `file:${path}`, syncUrl: TURSO_URL, authToken: TURSO_TOKEN })
    : createClient({ url: `file:${path}` });
};
const schema = db => db.batch([
  { sql: `CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL,
    project TEXT DEFAULT '', type TEXT DEFAULT 'insight',
    created_at TEXT NOT NULL, superseded_by INTEGER DEFAULT NULL,
    embedding F32_BLOB(384))`, args: [] },
  { sql: `CREATE INDEX IF NOT EXISTS memories_idx ON memories
    (libsql_vector_idx(embedding, 'compress_neighbors=float8', 'max_neighbors=50'))`, args: [] },
  { sql: `CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'habit',
    frequency TEXT NOT NULL DEFAULT 'daily',
    days TEXT DEFAULT NULL, time_slot TEXT DEFAULT 'anytime',
    project TEXT DEFAULT '', minutes INTEGER DEFAULT 15,
    active INTEGER DEFAULT 1, remind_before INTEGER DEFAULT 0,
    target_date TEXT DEFAULT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`, args: [] },
  { sql: `CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL, completed_date TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    FOREIGN KEY (routine_id) REFERENCES routines(id))`, args: [] }
]);
const sync = db => TURSO_URL ? db.sync().catch(() => {}) : Promise.resolve();
// --- queries ---
const store = (db, content, project, type, vec) =>
  db.execute({ sql: 'INSERT INTO memories (content, project, type, created_at, embedding) VALUES (?,?,?,?,vector(?))', args: [content, project, type, new Date().toISOString(), JSON.stringify(vec)] }).then(() => sync(db));
const search = (db, vec, n = 5, inclSup = false) => {
  const sup = inclSup ? '' : 'AND m.superseded_by IS NULL';
  return db.execute({ sql: `SELECT m.id, m.content, m.project, m.type, m.created_at, m.superseded_by FROM vector_top_k('memories_idx', vector(?), ${Math.min(n*3,100)}) AS v JOIN memories AS m ON m.rowid = v.id WHERE 1=1 ${sup}`, args: [JSON.stringify(vec)] }).then(r => r.rows.slice(0, n));
};
const q = (db, sql, args = []) => db.execute({ sql, args }).then(r => r.rows);
// --- recall helpers ---
const TYPE_RE = /^(?:DECISION|BLOCKER|STATUS|PATTERN|DEPENDENCY|COMMITMENT|IDEA|INSIGHT|RESOLVED)\s*/i;
const strip = c => { const m = c.match(TYPE_RE); if (!m) return c; const r = c.slice(m[0].length); return r.startsWith('[') ? r.replace(/^(\[[^\]]+\])\s*:\s*/, '$1 ') : r.startsWith(':') ? r.replace(/^:\s*/, '') : r; };
// --- commands ---
const cmds = {
  async setup(db) {
    await schema(db);
    const mode = TURSO_URL ? `Turso (${TURSO_URL})` : 'local';
    console.log(`Database: ${DB_PATH} (${mode})`);
    console.log('Testing embedding model (first run downloads ~100MB)...');
    const vec = await embed('test memory');
    console.log(`  ${vec.length} dimensions — setup complete.`);
  },
  async store(db, { _: [content], project = '', type = 'insight' }) {
    const t = type.toLowerCase();
    if (!TYPES.has(t)) { console.log(`Invalid type. Valid: ${[...TYPES].sort().join(', ')}`); process.exit(1); }
    await schema(db);
    await store(db, content, project, t, await embed(content));
    console.log(`Stored ${t}${project ? ` [${project}]` : ''}: ${content}`);
  },
  async search(db, { _: [query], n = 5, includeSuperseded = false }) {
    await schema(db);
    const rows = await search(db, await embed(query), n, includeSuperseded);
    if (!rows.length) return console.log('No results.');
    rows.forEach(r => console.log(`  #${r.id} ${r.type}${r.project ? ` [${r.project}]` : ''}: ${r.content}${r.superseded_by ? ' [SUPERSEDED]' : ''}`));
  },
  async recall(db) {
    await schema(db);
    const cutoff = new Date(Date.now() - 3 * 86400000).toISOString();
    const sections = [], focus = new Set();
    // blockers
    const bl = await q(db, 'SELECT content, project FROM memories WHERE type=? AND superseded_by IS NULL ORDER BY created_at DESC', ['blocker']);
    if (bl.length) { bl.forEach(r => r.project && focus.add(r.project)); sections.push(['BLOCKERS', bl.map(r => `  - ${strip(r.content)}`)]); }
    // commitments
    const cm = await q(db, 'SELECT content, project FROM memories WHERE type=? AND superseded_by IS NULL ORDER BY created_at DESC', ['commitment']);
    if (cm.length) { cm.forEach(r => r.project && focus.add(r.project)); sections.push(['COMMITMENTS', cm.map(r => `  - ${strip(r.content)}`)]); }
    // recent decisions
    const dc = await q(db, 'SELECT content FROM memories WHERE type=? AND created_at>=? ORDER BY created_at DESC', ['decision', cutoff]);
    if (dc.length) sections.push(['RECENT DECISIONS (3 days)', dc.map(r => `  - ${strip(r.content)}`)]);
    // patterns
    const pt = await q(db, 'SELECT content FROM memories WHERE type=? AND superseded_by IS NULL ORDER BY created_at DESC', ['pattern']);
    if (pt.length) sections.push(['PATTERNS', pt.map(r => `  - ${strip(r.content)}`)]);
    // dependencies
    const dp = await q(db, 'SELECT content FROM memories WHERE type=? AND superseded_by IS NULL ORDER BY created_at DESC', ['dependency']);
    if (dp.length) sections.push(['DEPENDENCIES', dp.map(r => `  - ${strip(r.content)}`)]);
    // context: statuses/ideas for focus projects + recent
    const fp = [...focus].sort();
    const ctxSql = fp.length
      ? `SELECT content FROM memories WHERE type IN ('status','idea') AND superseded_by IS NULL AND (project IN (${fp.map(()=>'?').join(',')}) OR created_at>=?) ORDER BY type, created_at DESC`
      : `SELECT content FROM memories WHERE type IN ('status','idea') AND superseded_by IS NULL AND created_at>=? ORDER BY type, created_at DESC`;
    const ctx = await q(db, ctxSql, fp.length ? [...fp, cutoff] : [cutoff]);
    if (ctx.length) sections.push([`ACTIVE CONTEXT (focus: ${fp.join(', ') || 'general'})`, ctx.map(r => `  - ${strip(r.content)}`)]);
    // output
    const d = new Date();
    console.log(`=== ThinkDone Memory Context (${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}) ===\n`);
    if (!sections.length) console.log('No active memories. Use "store" to add some.');
    sections.forEach(([h, lines]) => { console.log(`${h}:`); lines.forEach(l => console.log(l)); console.log(); });
    console.log('===');
  },
  async recent(db, { days = 3 }) {
    await schema(db);
    const rows = await q(db, 'SELECT id, content, project, type, superseded_by FROM memories WHERE created_at>=? ORDER BY created_at DESC', [new Date(Date.now() - days * 86400000).toISOString()]);
    if (!rows.length) return console.log(`No memories in last ${days} days.`);
    rows.forEach(r => console.log(`  #${r.id} ${r.type}${r.project ? ` [${r.project}]` : ''}: ${r.content}${r.superseded_by ? ' [SUPERSEDED]' : ''}`));
  },
  async project(db, { _: [name] }) {
    await schema(db);
    const rows = await q(db, 'SELECT id, content, type FROM memories WHERE project=? AND superseded_by IS NULL ORDER BY type, created_at DESC', [name]);
    if (!rows.length) return console.log(`No active memories for '${name}'.`);
    rows.forEach(r => console.log(`  #${r.id} ${r.type}: ${r.content}`));
  },
  async supersede(db, { _: [id, content], type, project }) {
    await schema(db);
    const old = (await q(db, 'SELECT project, type, content FROM memories WHERE id=?', [+id]))[0];
    if (!old) { console.log(`Memory #${id} not found.`); process.exit(1); }
    const vec = await embed(content);
    const r = await db.execute({ sql: 'INSERT INTO memories (content, project, type, created_at, embedding) VALUES (?,?,?,?,vector(?))', args: [content, project ?? old.project, type ?? old.type, new Date().toISOString(), JSON.stringify(vec)] });
    const newId = Number(r.lastInsertRowid);
    await db.execute({ sql: 'UPDATE memories SET superseded_by=? WHERE id=?', args: [newId, +id] });
    await sync(db);
    console.log(`Superseded #${id} -> #${newId}\n  OLD: ${old.content}\n  NEW: ${content}`);
  },
  async consolidate(db) {
    await schema(db);
    let n = 0;
    for (const t of ['status', 'pattern']) {
      const groups = await q(db, 'SELECT project, COUNT(*) as cnt FROM memories WHERE type=? AND superseded_by IS NULL GROUP BY project HAVING cnt>1', [t]);
      for (const g of groups) {
        const dupes = await q(db, 'SELECT id FROM memories WHERE type=? AND project=? AND superseded_by IS NULL ORDER BY created_at DESC', [t, g.project]);
        for (const old of dupes.slice(1)) { await db.execute({ sql: 'UPDATE memories SET superseded_by=? WHERE id=?', args: [dupes[0].id, old.id] }); n++; }
      }
    }
    await sync(db);
    const active = (await q(db, 'SELECT COUNT(*) as n FROM memories WHERE superseded_by IS NULL'))[0].n;
    const total = (await q(db, 'SELECT COUNT(*) as n FROM memories'))[0].n;
    console.log(`Consolidated ${n} redundant memories.\n  Active: ${active} | Total: ${total} | Archived: ${total - active}`);
  },
  async stats(db) {
    await schema(db);
    const total = (await q(db, 'SELECT COUNT(*) as n FROM memories'))[0].n;
    const active = (await q(db, 'SELECT COUNT(*) as n FROM memories WHERE superseded_by IS NULL'))[0].n;
    const types = await q(db, 'SELECT type, COUNT(*) as n FROM memories WHERE superseded_by IS NULL GROUP BY type ORDER BY type');
    const projects = await q(db, "SELECT project, COUNT(*) as n FROM memories WHERE superseded_by IS NULL AND project!='' GROUP BY project ORDER BY n DESC");
    console.log(`=== ThinkDone Memory Stats (${TURSO_URL ? 'Turso' : 'local'}) ===`);
    console.log(`Total: ${total} | Active: ${active} | Archived: ${total - active}`);
    if (types.length) { console.log('\nBy type:'); types.forEach(r => console.log(`  ${r.type}: ${r.n}`)); }
    if (projects.length) { console.log('\nBy project:'); projects.forEach(r => console.log(`  ${r.project}: ${r.n}`)); }
    if (existsSync(DB_PATH)) { const sz = statSync(DB_PATH).size; console.log(`\nDB size: ${sz >= 1048576 ? (sz/1048576).toFixed(1)+' MB' : (sz/1024).toFixed(1)+' KB'}`); }
  }
};
// --- habit helpers ---
const FREQS = new Set(['daily', 'weekdays', 'weekends', 'weekly', 'yearly', 'once']);
const SLOTS = new Set(['morning', 'midday', 'evening', 'anytime']);
const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];
const isDue = (r, dayName, targetDate) => {
  if (r.frequency === 'daily') return true;
  if (r.frequency === 'weekdays') return !['sat','sun'].includes(dayName);
  if (r.frequency === 'weekends') return ['sat','sun'].includes(dayName);
  if (r.frequency === 'weekly') return (JSON.parse(r.days || '[]')).includes(dayName);
  if (r.frequency === 'yearly' && r.target_date) {
    return targetDate.slice(5) === r.target_date.slice(5); // match MM-DD
  }
  if (r.frequency === 'once') {
    if (r.target_date) return targetDate >= r.target_date;
    return true;
  }
  return false;
};
// Check if a reminder/event is within its remind_before window
const isUpcoming = (r, targetDate) => {
  if (!r.remind_before || r.remind_before <= 0) return false;
  if (!r.target_date) return false;
  // For yearly, compute this year's occurrence
  let eventDate = r.target_date;
  if (r.frequency === 'yearly') eventDate = targetDate.slice(0, 4) + r.target_date.slice(4);
  const target = new Date(targetDate + 'T00:00:00');
  const event = new Date(eventDate + 'T00:00:00');
  const daysUntil = Math.round((event - target) / 86400000);
  return daysUntil > 0 && daysUntil <= r.remind_before;
};
const calcStreak = (completionDates, frequency, days) => {
  const dateSet = new Set(completionDates);
  const todayStr = new Date().toISOString().slice(0, 10);
  let streak = dateSet.has(todayStr) ? 1 : 0;
  for (let i = 1; i <= 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const dn = DAY_NAMES[d.getDay()];
    if (frequency === 'weekdays' && ['sat','sun'].includes(dn)) continue;
    if (frequency === 'weekends' && !['sat','sun'].includes(dn)) continue;
    if (frequency === 'weekly' && !(JSON.parse(days || '[]')).includes(dn)) continue;
    if (dateSet.has(ds)) streak++;
    else break;
  }
  return streak;
};
// --- habit sub-commands ---
const habitCmds = {
  async add(db, args) {
    const name = args._[0];
    if (!name) { console.log('Usage: habit add "<name>" [--freq daily] [--slot morning] [--days mon,wed,fri] [--date YYYY-MM-DD] [--remind-before 3] [--kind habit|reminder|event] [-p project]'); process.exit(1); }
    const freq = args.freq || 'daily';
    if (!FREQS.has(freq)) { console.log(`Invalid frequency. Valid: ${[...FREQS].join(', ')}`); process.exit(1); }
    const slot = args.slot || 'anytime';
    if (!SLOTS.has(slot)) { console.log(`Invalid slot. Valid: ${[...SLOTS].join(', ')}`); process.exit(1); }
    const days = args.days ? JSON.stringify(args.days.split(',').map(d => d.trim().toLowerCase())) : null;
    const mins = parseInt((name.match(/~(\d+)m/) || [])[1] || (name.match(/~(\d+)h/) || [])[1] && parseInt((name.match(/~(\d+)h/) || [])[1]) * 60 || 15);
    const kind = args.kind || (freq === 'once' ? 'reminder' : freq === 'yearly' ? 'event' : 'habit');
    const remindBefore = args.remindBefore || 0;
    const targetDate = args.date || null;
    const now = new Date().toISOString();
    const r = await db.execute({
      sql: 'INSERT INTO routines (name, kind, frequency, days, time_slot, project, minutes, remind_before, target_date, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      args: [name, kind, freq, days, slot, args.project || '', mins, remindBefore, targetDate, now, now]
    });
    const extra = [];
    if (targetDate) extra.push(`date: ${targetDate}`);
    if (remindBefore) extra.push(`remind ${remindBefore}d before`);
    console.log(`Added #${Number(r.lastInsertRowid)} [${kind}]: ${name} (${freq}, ${slot}${extra.length ? ', ' + extra.join(', ') : ''})`);
  },
  async list(db) {
    const rows = await q(db, 'SELECT id, name, kind, frequency, days, time_slot, remind_before, target_date FROM routines WHERE active = 1 ORDER BY id');
    if (!rows.length) return console.log('No active routines.');
    rows.forEach(r => {
      const daysStr = r.days ? ` ${JSON.parse(r.days).join('/')}` : '';
      const dateStr = r.target_date ? ` on ${r.target_date}` : '';
      const remindStr = r.remind_before ? ` (remind ${r.remind_before}d before)` : '';
      console.log(`  #${r.id} [${r.kind}] ${r.name} — ${r.frequency}${daysStr}${dateStr}, ${r.time_slot}${remindStr}`);
    });
  },
  async due(db, args) {
    const targetDate = args.date || new Date().toISOString().slice(0, 10);
    const d = new Date(targetDate + 'T12:00:00');
    const dayName = DAY_NAMES[d.getDay()];
    const rows = await q(db, 'SELECT id, name, kind, frequency, days, time_slot, minutes, remind_before, target_date FROM routines WHERE active = 1');
    const completed = new Set((await q(db, 'SELECT routine_id FROM completions WHERE completed_date = ?', [targetDate])).map(r => r.routine_id));
    const due = rows.filter(r => isDue(r, dayName, targetDate) && !completed.has(r.id));
    const upcoming = rows.filter(r => !due.includes(r) && isUpcoming(r, targetDate));
    // Calculate streaks for habits
    const streaks = {};
    for (const r of due.filter(r => r.kind === 'habit')) {
      const dates = (await q(db, 'SELECT completed_date FROM completions WHERE routine_id = ?', [r.id])).map(c => c.completed_date);
      streaks[r.id] = calcStreak(dates, r.frequency, r.days);
    }
    const fmtDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const habits = due.filter(r => r.kind === 'habit');
    const reminders = due.filter(r => r.kind !== 'habit');
    // Habits → become tasks in today.md
    if (habits.length) {
      console.log(`=== Habits Due (${fmtDate}) — add to today.md ===\n`);
      for (const slot of ['morning', 'midday', 'anytime', 'evening']) {
        const items = habits.filter(r => (r.time_slot || 'anytime') === slot);
        if (!items.length) continue;
        console.log(`${slot.toUpperCase()}:`);
        items.forEach(r => {
          const daysStr = r.days ? ` ${JSON.parse(r.days).join('/')}` : '';
          const streak = streaks[r.id] ? `, 🔥${streaks[r.id]} streak` : '';
          console.log(`  #${r.id} ${r.name}  (${r.frequency}${daysStr}${streak})`);
        });
      }
      console.log();
    }
    // Reminders/events → mention conversationally, don't add as tasks
    if (reminders.length) {
      console.log(`=== Reminders & Events Today (${fmtDate}) — mention in meeting, not tasks ===\n`);
      reminders.forEach(r => {
        const daysStr = r.days ? ` ${JSON.parse(r.days).join('/')}` : '';
        console.log(`  #${r.id} [${r.kind}] ${r.name}  (${r.frequency}${daysStr})`);
      });
      console.log();
    }
    // Upcoming reminders within remind_before window
    if (upcoming.length) {
      console.log(`=== Coming Up (advance reminders) ===\n`);
      upcoming.forEach(r => {
        let eventDate = r.target_date;
        if (r.frequency === 'yearly') eventDate = targetDate.slice(0, 4) + r.target_date.slice(4);
        const daysUntil = Math.round((new Date(eventDate + 'T00:00:00') - new Date(targetDate + 'T00:00:00')) / 86400000);
        console.log(`  #${r.id} [${r.kind}] ${r.name}  (in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}, ${eventDate})`);
      });
      console.log();
    }
    if (!habits.length && !reminders.length && !upcoming.length) {
      console.log(`=== Nothing due (${fmtDate}) ===`);
    }
  },
  async complete(db, args) {
    const id = +args._[0];
    if (!id) { console.log('Usage: habit complete <id>'); process.exit(1); }
    const routine = (await q(db, 'SELECT id, name, frequency FROM routines WHERE id = ?', [id]))[0];
    if (!routine) { console.log(`Routine #${id} not found.`); process.exit(1); }
    const today = new Date().toISOString().slice(0, 10);
    const exists = (await q(db, 'SELECT id FROM completions WHERE routine_id = ? AND completed_date = ?', [id, today]));
    if (!exists.length) {
      await db.execute({ sql: 'INSERT INTO completions (routine_id, completed_date, completed_at) VALUES (?,?,?)', args: [id, today, new Date().toISOString()] });
    }
    if (routine.frequency === 'once') {
      await db.execute({ sql: 'UPDATE routines SET active = 0, updated_at = ? WHERE id = ?', args: [new Date().toISOString(), id] });
      console.log(`Completed #${id}: ${routine.name} (one-time — deactivated)`);
    } else {
      const dates = (await q(db, 'SELECT completed_date FROM completions WHERE routine_id = ?', [id])).map(r => r.completed_date);
      const streak = calcStreak(dates, routine.frequency, null);
      console.log(`Completed #${id}: ${routine.name} (🔥${streak} streak)`);
    }
  },
  async pause(db, args) {
    const id = +args._[0];
    if (!id) { console.log('Usage: habit pause <id>'); process.exit(1); }
    await db.execute({ sql: 'UPDATE routines SET active = 0, updated_at = ? WHERE id = ?', args: [new Date().toISOString(), id] });
    console.log(`Paused routine #${id}.`);
  },
  async resume(db, args) {
    const id = +args._[0];
    if (!id) { console.log('Usage: habit resume <id>'); process.exit(1); }
    await db.execute({ sql: 'UPDATE routines SET active = 1, updated_at = ? WHERE id = ?', args: [new Date().toISOString(), id] });
    console.log(`Resumed routine #${id}.`);
  },
  async remove(db, args) {
    const id = +args._[0];
    if (!id) { console.log('Usage: habit remove <id>'); process.exit(1); }
    await db.execute({ sql: 'DELETE FROM completions WHERE routine_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM routines WHERE id = ?', args: [id] });
    console.log(`Removed routine #${id} and its completions.`);
  },
  async streak(db, args) {
    const id = args._[0] ? +args._[0] : null;
    const where = id ? 'WHERE id = ? AND active = 1' : 'WHERE active = 1';
    const wArgs = id ? [id] : [];
    const rows = await q(db, `SELECT id, name, frequency, days FROM routines ${where} ORDER BY id`, wArgs);
    if (!rows.length) return console.log(id ? `Routine #${id} not found or inactive.` : 'No active routines.');
    for (const r of rows) {
      const dates = (await q(db, 'SELECT completed_date FROM completions WHERE routine_id = ?', [r.id])).map(c => c.completed_date);
      const s = calcStreak(dates, r.frequency, r.days);
      console.log(`  #${r.id} ${r.name} — ${s > 0 ? `🔥${s}` : '0'} streak`);
    }
  }
};
cmds.habit = async (db, args) => {
  await schema(db);
  const [sub, ...rest] = args._;
  if (!sub || !habitCmds[sub]) {
    console.log('Usage: habit <add|list|due|complete|pause|resume|remove|streak> [args]');
    process.exit(1);
  }
  await habitCmds[sub](db, { ...args, _: rest });
};
// --- arg parsing ---
const parseArgs = argv => {
  const r = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--project') r.project = argv[++i];
    else if (a === '-t' || a === '--type') r.type = argv[++i];
    else if (a === '-n') r.n = +argv[++i];
    else if (a === '--days') r.days = +argv[++i];
    else if (a === '--include-superseded') r.includeSuperseded = true;
    else if (a === '--db') r.db = argv[++i];
    else if (a === '--freq') r.freq = argv[++i];
    else if (a === '--slot') r.slot = argv[++i];
    else if (a === '--days') r.days = argv[++i];
    else if (a === '--date') r.date = argv[++i];
    else if (a === '--remind-before') r.remindBefore = +argv[++i];
    else if (a === '--kind') r.kind = argv[++i];
    else r._.push(a);
  }
  return r;
};
// --- main ---
const USAGE = `xswarm-thinkdone: semantic memory for daily planning
Commands:
  setup                               Create DB, test embeddings
  store <text> [-p project] [-t type]  Store a memory
  search <query> [-n 5]               Semantic search
  recall                              Morning context loader
  recent [--days 3]                   Recent memories
  project <name>                      Project memories
  supersede <id> <text> [-t type]     Supersede old → new
  consolidate                         Weekly compression
  stats                               Memory health

  habit add "<name>" [--freq daily|weekdays|weekends|weekly|yearly|once] [--slot morning|midday|evening|anytime] [--days mon,wed,fri] [--date YYYY-MM-DD] [--remind-before N] [--kind habit|reminder|event] [-p project]
  habit list                          Active routines
  habit due [--date YYYY-MM-DD]       What's due today
  habit complete <id>                 Mark done for today
  habit pause <id>                    Deactivate
  habit resume <id>                   Reactivate
  habit remove <id>                   Delete permanently
  habit streak [<id>]                 Show streaks
Env: THINKDONE_DB, THINKDONE_TURSO_URL, THINKDONE_TURSO_TOKEN`;
const argv = process.argv.slice(2);
if (!argv.length) { console.log(USAGE); process.exit(0); }
const dbIdx = argv.indexOf('--db');
if (dbIdx !== -1) { DB_PATH = argv[dbIdx + 1]; argv.splice(dbIdx, 2); }
const [cmd, ...rest] = argv;
const args = parseArgs(rest);
if (!cmds[cmd]) { console.log(USAGE); process.exit(1); }
const db = getDb();
try { await cmds[cmd](db, args); } finally { db.close(); }
