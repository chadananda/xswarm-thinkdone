// Subconscious Memory Recall — Keyword-based search for memories and past conversations
const STOPWORDS = new Set([
  'the', 'and', 'but', 'for', 'not', 'you', 'all', 'can', 'had', 'her', 'was',
  'one', 'our', 'out', 'are', 'has', 'his', 'how', 'its', 'may', 'new', 'now',
  'old', 'see', 'way', 'who', 'did', 'get', 'let', 'say', 'she', 'too', 'use',
  'with', 'have', 'from', 'this', 'that', 'what', 'will', 'been', 'than', 'them',
  'then', 'they', 'were', 'when', 'your', 'each', 'make', 'like', 'just', 'over',
  'such', 'take', 'very', 'some', 'into', 'most', 'other', 'would', 'about',
  'after', 'could', 'which', 'their', 'there', 'these', 'being', 'before',
  'should', 'through', 'where', 'while', 'does', 'more', 'also', 'want', 'went',
  'going', 'doing', 'here', 'much', 'well', 'really', 'think', 'still', 'look',
  'come', 'know', 'need', 'tell', 'give', 'keep', 'help', 'show', 'work', 'back',
  'only', 'good', 'even', 'many', 'mine', 'done', 'time', 'next'
]);
// Extract keywords from text
export function extractKeywords(text) {
  const cleaned = text.toLowerCase().replace(/[^\w\s]/g, '');
  const words = cleaned.split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));
  const unique = [...new Set(words)];
  return unique.slice(0, 8);
}
// Build recall query from session context
export function buildRecallQuery(session) {
  const parts = [];
  // Last 2 user messages
  const userMessages = (session.messages || []).filter(m => m.role === 'user');
  const lastTwo = userMessages.slice(-2);
  parts.push(...lastTwo.map(m => m.content));
  // Active agenda items
  const activeAgenda = (session.agenda || []).filter(a => a.status === 'active' || a.status === 'pending');
  const firstTwo = activeAgenda.slice(0, 2);
  parts.push(...firstTwo.map(a => a.content));
  const combined = parts.join(' ');
  return combined.slice(0, 500);
}
// Search memories by keywords
export async function searchMemories(db, keywords, limit = 5) {
  if (!keywords || keywords.length === 0) return [];
  const conditions = keywords.map(() => 'content LIKE ?').join(' OR ');
  const sql = `
    SELECT id, content, type, project, person FROM memories
    WHERE superseded_by IS NULL
      AND type NOT IN ('blocker', 'commitment', 'waiting_for')
      AND (${conditions})
    ORDER BY created_at DESC LIMIT ?
  `;
  const params = [...keywords.map(kw => `%${kw}%`), limit];
  const results = await db.prepare(sql).all(...params);
  return results;
}
// Search past conversations by keywords
export async function searchConversations(db, keywords, limit = 3) {
  if (!keywords || keywords.length === 0) return [];
  const conditions = keywords.map(() => 'summary LIKE ?').join(' OR ');
  const sql = `
    SELECT id, session_type, started_at, summary FROM conversations
    WHERE ended_at IS NOT NULL AND summary IS NOT NULL
      AND (${conditions})
    ORDER BY started_at DESC LIMIT ?
  `;
  const params = [...keywords.map(kw => `%${kw}%`), limit];
  const results = await db.prepare(sql).all(...params);
  return results;
}
// Recall memories and conversations for current turn
export async function recallForTurn(db, session, opts = {}) {
  const query = buildRecallQuery(session);
  if (!query) return null;
  const keywords = extractKeywords(query);
  if (!keywords.length) return null;
  const maxMemories = opts.maxMemories || 5;
  const maxConversations = opts.maxConversations || 3;
  const [memories, conversations] = await Promise.all([
    searchMemories(db, keywords, maxMemories),
    searchConversations(db, keywords, maxConversations)
  ]);
  if (!memories.length && !conversations.length) return null;
  return { memories, conversations };
}
// Format recalled context for system prompt
export function formatRecalledContext(recalled) {
  if (!recalled) return '';
  const parts = [];
  if (recalled.memories?.length) {
    parts.push('RECALLED MEMORIES:');
    for (const m of recalled.memories) {
      parts.push(`  [${m.type}] ${m.content}`);
    }
  }
  if (recalled.conversations?.length) {
    parts.push('RELATED PAST SESSIONS:');
    for (const c of recalled.conversations) {
      const date = c.started_at?.slice(0, 10) || 'unknown';
      parts.push(`  [${date} ${c.session_type}] ${c.summary}`);
    }
  }
  return parts.join('\n');
}
