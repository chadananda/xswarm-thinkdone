// Context budget builder — assembles prioritized memory blocks for LLM prompt
//
export async function buildContext(db, opts = {}) {
  const { focusProjects = [], focusPeople = [], maxTokens = 20000 } = opts;
  const blocks = [];
  let tokenCount = 0;
  // Priority 1 — Always loaded (~4K tokens)
  const p1 = await getPriority1(db);
  blocks.push(p1);
  tokenCount += estimateTokens(p1);
  // Priority 2 — Focus-derived (~4K tokens)
  if (tokenCount < maxTokens) {
    const p2 = await getPriority2(db, { focusProjects, focusPeople });
    blocks.push(p2);
    tokenCount += estimateTokens(p2);
  }
  // Priority 3 — Contextual (~4K tokens, shed if needed)
  if (tokenCount < maxTokens * 0.8) {
    const p3 = await getPriority3(db, null);
    blocks.push(p3);
    tokenCount += estimateTokens(p3);
  }
  // Priority 4 — Background (~2K tokens, shed first)
  if (tokenCount < maxTokens * 0.6) {
    const p4 = await getPriority4(db);
    blocks.push(p4);
    tokenCount += estimateTokens(p4);
  }
  return { text: blocks.filter(Boolean).join('\n\n'), tokenEstimate: tokenCount };
}
//
export async function getPriority1(db) {
  const sections = [];
  const blockers = await db.prepare(
    "SELECT content, project FROM memories WHERE type = 'blocker' AND superseded_by IS NULL ORDER BY created_at DESC"
  ).all();
  if (blockers.length) sections.push('BLOCKERS:\n' + blockers.map(r => `  - ${r.content}`).join('\n'));
  const commitments = await db.prepare(
    "SELECT content, project, person FROM memories WHERE type = 'commitment' AND superseded_by IS NULL ORDER BY created_at DESC"
  ).all();
  if (commitments.length) sections.push('COMMITMENTS:\n' + commitments.map(r => `  - ${r.content}`).join('\n'));
  const waiting = await db.prepare(
    "SELECT content, project, person FROM memories WHERE type = 'waiting_for' AND superseded_by IS NULL ORDER BY created_at DESC"
  ).all();
  if (waiting.length) sections.push('WAITING FOR:\n' + waiting.map(r => `  - ${r.content}`).join('\n'));
  return sections.join('\n\n');
}
//
export async function getPriority2(db, focus = {}) {
  const { focusProjects = [], focusPeople = [] } = focus;
  const sections = [];
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  // Focus project summaries
  if (focusProjects.length) {
    const placeholders = focusProjects.map(() => '?').join(',');
    const statuses = await db.prepare(
      `SELECT content, project FROM memories WHERE type = 'status' AND superseded_by IS NULL AND project IN (${placeholders}) ORDER BY created_at DESC`
    ).all(...focusProjects);
    if (statuses.length) sections.push('FOCUS PROJECTS:\n' + statuses.map(r => `  [${r.project}] ${r.content}`).join('\n'));
  }
  // Person facts for focus people
  if (focusPeople.length) {
    const placeholders = focusPeople.map(() => '?').join(',');
    const facts = await db.prepare(
      `SELECT content, person FROM memories WHERE type = 'person_fact' AND superseded_by IS NULL AND person IN (${placeholders})`
    ).all(...focusPeople);
    if (facts.length) sections.push('KEY PEOPLE:\n' + facts.map(r => `  [${r.person}] ${r.content}`).join('\n'));
  }
  // Recent decisions
  const decisions = await db.prepare(
    "SELECT content, project FROM memories WHERE type = 'decision' AND superseded_by IS NULL AND created_at >= ? ORDER BY created_at DESC"
  ).all(cutoff);
  if (decisions.length) sections.push('RECENT DECISIONS:\n' + decisions.map(r => `  ${r.content}`).join('\n'));
  return sections.join('\n\n');
}
//
export async function getPriority3(db, queryEmbedding) {
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const related = await db.prepare(
    "SELECT content, type, project FROM memories WHERE superseded_by IS NULL AND type IN ('pattern', 'dependency', 'insight') AND created_at >= ? ORDER BY created_at DESC LIMIT 20"
  ).all(cutoff);
  if (!related.length) return '';
  return 'RELATED CONTEXT:\n' + related.map(r => `  [${r.type}] ${r.content}`).join('\n');
}
//
export async function getPriority4(db) {
  const sections = [];
  const statuses = await db.prepare(
    "SELECT content, project FROM memories WHERE type = 'status' AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 10"
  ).all();
  if (statuses.length) sections.push('OTHER PROJECTS:\n' + statuses.map(r => `  [${r.project}] ${r.content}`).join('\n'));
  const ideas = await db.prepare(
    "SELECT content FROM memories WHERE type = 'idea' AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 5"
  ).all();
  if (ideas.length) sections.push('IDEAS (untriaged):\n' + ideas.map(r => `  - ${r.content}`).join('\n'));
  return sections.join('\n\n');
}
//
export function compressMemory(content, type) {
  const prefix = type.toUpperCase();
  const compressed = content
    .replace(/\b(the|a|an|is|are|was|were|has|have|had|will|would|should|could|that|this|with|from|for|and|but|or)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '|');
  return `${prefix}:${compressed}`;
}
//
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
//
export async function consolidateMemories(db) {
  let consolidated = 0;
  for (const type of ['status', 'pattern']) {
    const groups = await db.prepare(
      "SELECT project, COUNT(*) as cnt FROM memories WHERE type = ? AND superseded_by IS NULL GROUP BY project HAVING cnt > 1"
    ).all(type);
    for (const g of groups) {
      const dupes = await db.prepare(
        "SELECT id FROM memories WHERE type = ? AND project = ? AND superseded_by IS NULL ORDER BY created_at DESC, id DESC"
      ).all(type, g.project);
      const keep = dupes[0].id;
      for (const old of dupes.slice(1)) {
        await db.prepare("UPDATE memories SET superseded_by = ? WHERE id = ?").run(keep, old.id);
        consolidated++;
      }
    }
  }
  return consolidated;
}
