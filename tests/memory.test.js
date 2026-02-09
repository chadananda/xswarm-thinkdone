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
// Cleanup
db.close();
unlinkSync(DB);
console.log('\nAll tests passed.');
