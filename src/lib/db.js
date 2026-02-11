// Browser database layer — Turso WASM (OPFS) in browser, injected adapter in tests
// All methods are async to match Turso WASM API

const DEFAULT_SOUL = `# Think→Done — Your Strategic Partner

## Identity
I am a strategic thinking partner — part chief of staff, part research analyst,
part accountability coach. I think in systems, plan in sequences, and communicate
with clarity and warmth.

## Values
- Honesty over comfort. I tell you what you need to hear.
- Action over analysis. Planning is only valuable if it leads to doing.
- Compounding over sprinting. Small consistent progress beats heroic efforts.
- Context over completeness. I surface what matters now, not everything I know.

## How I Work
- Morning meetings: I come prepared. I know your schedule, your blockers,
  your streaks, and what you committed to yesterday.
- Throughout the day: I stay quiet unless something matters. No noise.
- Overnight: I think about your projects, research opportunities, prepare
  briefings, and consolidate what I've learned.

## Communication Style
- Direct and concise. No filler.
- I use questions to sharpen thinking, not to stall.
- I celebrate progress genuinely but briefly.
- I push back when you're overcommitting or avoiding something important.

## What I Track
- Every commitment you make to someone (and they make to you)
- Every decision and its context (so you don't re-litigate)
- Patterns in your productivity, energy, and effectiveness
- Your goals, and whether daily actions are aligned with them`;

// --- Singleton (browser only) ---
let _db = null;

export async function getDb() {
  if (_db) return _db;
  // Dynamic import — only works in browser with Vite bundling
  const { connect } = await import('@tursodatabase/database-wasm/vite');
  _db = await connect('thinkdone.db');
  return _db;
}

// Allow injecting a test db
export function setDb(db) {
  _db = db;
}

// --- Schema ---

export async function ensureSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      text        TEXT NOT NULL,
      project     TEXT DEFAULT '',
      minutes     INTEGER DEFAULT NULL,
      checked     INTEGER DEFAULT 0,
      details     TEXT DEFAULT NULL,
      position    INTEGER DEFAULT 0,
      plan_date   TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      completed_at TEXT DEFAULT NULL,
      source      TEXT DEFAULT 'manual'
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      content         TEXT NOT NULL,
      compressed      TEXT DEFAULT NULL,
      project         TEXT DEFAULT '',
      person          TEXT DEFAULT '',
      type            TEXT DEFAULT 'insight',
      source          TEXT DEFAULT 'manual',
      priority        INTEGER DEFAULT 0,
      created_at      TEXT NOT NULL,
      expires_at      TEXT DEFAULT NULL,
      superseded_by   INTEGER DEFAULT NULL,
      embedding       BLOB DEFAULT NULL
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS memories_type_idx ON memories (type, superseded_by)
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS memories_project_idx ON memories (project, superseded_by)
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS memories_person_idx ON memories (person, superseded_by)
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS routines (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      description       TEXT DEFAULT NULL,
      kind              TEXT NOT NULL DEFAULT 'habit',
      frequency         TEXT NOT NULL DEFAULT 'daily',
      days              TEXT DEFAULT NULL,
      time_slot         TEXT DEFAULT 'anytime',
      specific_time     TEXT DEFAULT NULL,
      project           TEXT DEFAULT '',
      person            TEXT DEFAULT '',
      minutes           INTEGER DEFAULT 15,
      active            INTEGER DEFAULT 1,
      remind_before     INTEGER DEFAULT 0,
      target_date       TEXT DEFAULT NULL,
      preparation_steps TEXT DEFAULT NULL,
      preparation_state TEXT DEFAULT NULL,
      recurrence_end    TEXT DEFAULT NULL,
      notes             TEXT DEFAULT NULL,
      last_reminded     TEXT DEFAULT NULL,
      identity          TEXT DEFAULT NULL,
      cue               TEXT DEFAULT NULL,
      craving           TEXT DEFAULT NULL,
      reward            TEXT DEFAULT NULL,
      two_min_version   TEXT DEFAULT NULL,
      stack_after       INTEGER DEFAULT NULL,
      bundle_with       TEXT DEFAULT NULL,
      difficulty        INTEGER DEFAULT 1,
      goal_quantity     REAL DEFAULT NULL,
      goal_unit         TEXT DEFAULT NULL,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS completions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      routine_id      INTEGER NOT NULL,
      completed_date  TEXT NOT NULL,
      completed_at    TEXT NOT NULL,
      notes           TEXT DEFAULT NULL,
      quality         INTEGER DEFAULT NULL,
      quantity        REAL DEFAULT NULL,
      used_two_min    INTEGER DEFAULT 0,
      skipped_reason  TEXT DEFAULT NULL,
      FOREIGN KEY (routine_id) REFERENCES routines(id)
    )
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS completions_routine_idx ON completions (routine_id, completed_date)
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS completions_date_idx ON completions (completed_date)
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_type    TEXT DEFAULT 'chat',
      started_at      TEXT NOT NULL,
      ended_at        TEXT DEFAULT NULL,
      summary         TEXT DEFAULT NULL,
      key_decisions   TEXT DEFAULT NULL,
      mood            TEXT DEFAULT NULL,
      memories_created TEXT DEFAULT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS personality (
      id          INTEGER PRIMARY KEY,
      soul        TEXT NOT NULL,
      style       TEXT DEFAULT NULL,
      disposition TEXT DEFAULT NULL,
      updated_at  TEXT NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER DEFAULT NULL,
      session_type    TEXT NOT NULL DEFAULT 'chat',
      model           TEXT NOT NULL,
      input_tokens    INTEGER NOT NULL,
      output_tokens   INTEGER NOT NULL,
      cost_usd        REAL NOT NULL,
      created_at      TEXT NOT NULL
    )
  `);
  //
  await db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      provider      TEXT NOT NULL UNIQUE,
      email         TEXT DEFAULT NULL,
      name          TEXT DEFAULT NULL,
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at    INTEGER NOT NULL,
      scopes        TEXT DEFAULT NULL,
      connected_at  TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    )
  `);
  //
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  //
  // Migrate api_usage: add cache-aware columns (safe if already present)
  try { await db.exec('ALTER TABLE api_usage ADD COLUMN provider TEXT DEFAULT NULL'); } catch {}
  try { await db.exec('ALTER TABLE api_usage ADD COLUMN cache_read_tokens INTEGER DEFAULT 0'); } catch {}
  try { await db.exec('ALTER TABLE api_usage ADD COLUMN cache_write_tokens INTEGER DEFAULT 0'); } catch {}
  //
  // Seed default settings (INSERT OR IGNORE preserves user changes)
  await db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_providers_enabled', '["thinkdone"]')`);
  await db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('voice_provider', 'web-speech')`);
  await db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('display_name', 'User')`);
}

// --- Reset ---

export async function clearDatabase(db) {
  await db.exec('DELETE FROM tasks');
  await db.exec('DELETE FROM memories');
  await db.exec('DELETE FROM routines');
  await db.exec('DELETE FROM completions');
  await db.exec('DELETE FROM conversations');
  await db.exec('DELETE FROM personality');
  await db.exec('DELETE FROM api_usage');
  await db.exec('DELETE FROM connections');
  await db.exec('DELETE FROM settings');
  await seedPersonality(db);
}

// --- Task CRUD ---

export async function getTasks(db, date) {
  return db.prepare(
    'SELECT id, text, project, minutes, checked, details, position, completed_at FROM tasks WHERE plan_date = ? ORDER BY position ASC'
  ).all(date);
}

export async function addTask(db, text, opts = {}) {
  const planDate = opts.planDate || new Date().toISOString().slice(0, 10);
  const source = opts.source || 'manual';
  const now = new Date().toISOString();

  // Parse minutes and project from text
  let minutes = null;
  const timeMatch = text.match(/~(\d+(?:\.\d+)?)(m|h)/);
  if (timeMatch) {
    minutes = timeMatch[2] === 'h' ? Math.round(parseFloat(timeMatch[1]) * 60) : parseInt(timeMatch[1]);
  }
  let project = '';
  const projMatch = text.match(/\s+[—–]\s+(\S+)$/);
  if (projMatch) project = projMatch[1];

  // Shift existing tasks down
  await db.prepare(
    'UPDATE tasks SET position = position + 1 WHERE plan_date = ?'
  ).run(planDate);

  const result = await db.prepare(
    'INSERT INTO tasks (text, project, minutes, position, plan_date, created_at, source) VALUES (?, ?, ?, 0, ?, ?, ?)'
  ).run(text, project, minutes, planDate, now, source);

  return result.lastInsertRowid;
}

export async function toggleTask(db, id) {
  const task = await db.prepare('SELECT checked FROM tasks WHERE id = ?').get(id);
  if (!task) return null;

  if (task.checked) {
    await db.prepare('UPDATE tasks SET checked = 0, completed_at = NULL WHERE id = ?').run(id);
    return 'unchecked';
  } else {
    await db.prepare('UPDATE tasks SET checked = 1, completed_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    return 'checked';
  }
}

export async function deleteTask(db, id) {
  await db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export async function editTask(db, id, newText) {
  let minutes = null;
  const timeMatch = newText.match(/~(\d+(?:\.\d+)?)(m|h)/);
  if (timeMatch) {
    minutes = timeMatch[2] === 'h' ? Math.round(parseFloat(timeMatch[1]) * 60) : parseInt(timeMatch[1]);
  }
  let project = '';
  const projMatch = newText.match(/\s+[—–]\s+(\S+)$/);
  if (projMatch) project = projMatch[1];

  await db.prepare(
    'UPDATE tasks SET text = ?, project = ?, minutes = ? WHERE id = ?'
  ).run(newText, project, minutes, id);
}

export async function reorderTasks(db, orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    await db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(i, orderedIds[i]);
  }
}

// --- Memory CRUD ---

export async function storeMemory(db, content, opts = {}) {
  const { project = '', type = 'insight', person = '', source = 'manual', priority = 0, embedding = null } = opts;
  const now = new Date().toISOString();

  const result = await db.prepare(
    'INSERT INTO memories (content, project, person, type, source, priority, created_at, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(content, project, person, type, source, priority, now, embedding);

  return Number(result.lastInsertRowid);
}

export async function getActiveMemories(db, filters = {}) {
  let sql = 'SELECT * FROM memories WHERE superseded_by IS NULL';
  const params = [];

  if (filters.type) {
    sql += ' AND type = ?';
    params.push(filters.type);
  }
  if (filters.project) {
    sql += ' AND project = ?';
    params.push(filters.project);
  }
  if (filters.person) {
    sql += ' AND person = ?';
    params.push(filters.person);
  }

  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

export async function supersedeMemory(db, oldId, newContent, opts = {}) {
  const old = await db.prepare('SELECT project, type, person FROM memories WHERE id = ?').get(oldId);
  if (!old) throw new Error(`Memory #${oldId} not found`);

  const newId = await storeMemory(db, newContent, {
    project: opts.project ?? old.project,
    type: opts.type ?? old.type,
    person: opts.person ?? old.person,
    source: opts.source || 'manual',
    priority: opts.priority || 0,
    embedding: opts.embedding || null,
  });

  await db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?').run(newId, oldId);
  return newId;
}

// --- Personality ---

// --- API Usage CRUD ---

export async function storeUsage(db, { conversationId = null, sessionType = 'chat', model, inputTokens, outputTokens, costUsd, provider = null, cacheReadTokens = 0, cacheWriteTokens = 0, createdAt = null }) {
  const now = createdAt || new Date().toISOString();
  const result = await db.prepare(
    'INSERT INTO api_usage (conversation_id, session_type, model, input_tokens, output_tokens, cost_usd, provider, cache_read_tokens, cache_write_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(conversationId, sessionType, model, inputTokens, outputTokens, costUsd, provider, cacheReadTokens, cacheWriteTokens, now);
  return Number(result.lastInsertRowid);
}

export async function getUsageSummary(db, { from, to }) {
  const row = await db.prepare(
    `SELECT
      COALESCE(SUM(input_tokens), 0)  AS total_input,
      COALESCE(SUM(output_tokens), 0) AS total_output,
      COALESCE(SUM(cost_usd), 0)      AS total_cost,
      COUNT(*)                         AS session_count
    FROM api_usage
    WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?`
  ).get(from, to);
  return row;
}

export async function getUsageByDay(db, { from, to }) {
  return db.prepare(
    `SELECT
      DATE(created_at)                AS date,
      COUNT(*)                        AS sessions,
      SUM(input_tokens)               AS total_input,
      SUM(output_tokens)              AS total_output,
      SUM(cost_usd)                   AS total_cost,
      SUM(cache_read_tokens)          AS cache_read,
      SUM(cache_write_tokens)         AS cache_write
    FROM api_usage
    WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
    GROUP BY DATE(created_at)
    ORDER BY date ASC`
  ).all(from, to);
}

export async function getUsageBySession(db, { from, to }) {
  return db.prepare(
    `SELECT
      session_type,
      COUNT(*)                        AS sessions,
      SUM(input_tokens)               AS total_input,
      SUM(output_tokens)              AS total_output,
      SUM(cost_usd)                   AS total_cost
    FROM api_usage
    WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
    GROUP BY session_type
    ORDER BY total_cost DESC`
  ).all(from, to);
}

export async function getUsageByModel(db, { from, to }) {
  return db.prepare(
    `SELECT model, COUNT(*) AS sessions, SUM(input_tokens) AS total_input, SUM(output_tokens) AS total_output, SUM(cost_usd) AS total_cost
    FROM api_usage WHERE DATE(created_at) >= ? AND DATE(created_at) <= ? GROUP BY model ORDER BY total_cost DESC`
  ).all(from, to);
}
//
export async function getUsageByProvider(db, { from, to }) {
  return db.prepare(
    `SELECT provider, COUNT(*) AS sessions, SUM(input_tokens) AS total_input, SUM(output_tokens) AS total_output, SUM(cost_usd) AS total_cost
    FROM api_usage WHERE DATE(created_at) >= ? AND DATE(created_at) <= ? GROUP BY provider ORDER BY total_cost DESC`
  ).all(from, to);
}
//
export async function getCacheSavings(db, { from, to }) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(input_tokens), 0) AS total_input, COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read, COALESCE(SUM(cache_write_tokens), 0) AS total_cache_write
    FROM api_usage WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?`
  ).get(from, to);
  return row;
}
//
// --- Settings CRUD ---
//
export async function getSetting(db, key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
//
export async function setSetting(db, key, value) {
  await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}
//
export async function getAllSettings(db) {
  return db.prepare('SELECT key, value FROM settings ORDER BY key').all();
}
//
// --- Connections CRUD ---
//
export async function getConnection(db, provider) {
  return db.prepare('SELECT * FROM connections WHERE provider = ?').get(provider);
}
//
export async function upsertConnection(db, provider, data) {
  const now = new Date().toISOString();
  const { email = null, name = null, access_token, refresh_token, expires_at, scopes = null } = data;
  await db.prepare(
    `INSERT INTO connections (provider, email, name, access_token, refresh_token, expires_at, scopes, connected_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       scopes = excluded.scopes,
       updated_at = excluded.updated_at`
  ).run(provider, email, name, access_token, refresh_token, expires_at, scopes, now, now);
}
//
export async function removeConnection(db, provider) {
  await db.prepare('DELETE FROM connections WHERE provider = ?').run(provider);
}
//
export async function updateAccessToken(db, provider, accessToken, expiresAt) {
  const now = new Date().toISOString();
  await db.prepare(
    'UPDATE connections SET access_token = ?, expires_at = ?, updated_at = ? WHERE provider = ?'
  ).run(accessToken, expiresAt, now, provider);
}
//
// --- Personality ---

export async function seedPersonality(db) {
  const existing = await db.prepare('SELECT id FROM personality WHERE id = 1').get();
  if (existing) return;

  await db.prepare(
    'INSERT INTO personality (id, soul, updated_at) VALUES (1, ?, ?)'
  ).run(DEFAULT_SOUL, new Date().toISOString());
}
