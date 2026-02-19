// Post-meeting extraction — persist tasks, memories, conversations, deferred items
//
import { storeMemory, addTask, getActiveMemories } from './db.js';
import { parseMeetingState } from './conversation.js';
//
// Validate deadline is a proper YYYY-MM-DD date; return null if not.
// Gemini often returns natural language ("Thursday", "today") — reject those.
function normalizeDeadline(deadline) {
  if (!deadline) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return deadline;
  return null;
}

export async function processExtractions(db, extractions) {
  const created = { tasks: [], memories: [] };
  const today = new Date().toISOString().slice(0, 10);
  // Load existing tasks for dedup (case-insensitive)
  const existing = await db.prepare('SELECT text FROM tasks WHERE plan_date = ?').all(today);
  const existingSet = new Set(existing.map(t => t.text.toLowerCase().trim()));
  // Process tasks
  for (const task of extractions.tasks || []) {
    const key = task.text.toLowerCase().trim();
    if (existingSet.has(key)) continue;
    existingSet.add(key);
    const id = await addTask(db, task.text, {
      planDate: normalizeDeadline(task.deadline) || today,
      source: 'meeting',
    });
    created.tasks.push(id);
  }
  // Process decisions
  for (const dec of extractions.decisions || []) {
    const id = await storeMemory(db, dec.content, {
      type: 'decision',
      project: dec.project || '',
      source: 'conversation',
    });
    created.memories.push(id);
  }
  // Process commitments
  for (const com of extractions.commitments || []) {
    const id = await storeMemory(db, com.content, {
      type: 'commitment',
      person: com.to || '',
      source: 'conversation',
    });
    created.memories.push(id);
  }
  // Process waiting_for
  for (const wf of extractions.waitingFor || []) {
    const id = await storeMemory(db, wf.content, {
      type: 'waiting_for',
      person: wf.from || '',
      source: 'conversation',
    });
    created.memories.push(id);
  }
  return created;
}
//
// Map onboarding agenda content to personality.disposition field names
const PROFILE_FIELD_MAP = {
  'your name': 'user_name',
  'name your assistant': 'ai_name',
  'work style and preferences': 'planning_time',
};
//
// Persist resolved agenda Q+A as memories (and profile fields for onboarding).
// Called immediately after applyAgendaUpdates so facts are stored the moment they're learned.
export async function persistResolutions(db, agenda, updates, sessionType) {
  if (!updates?.resolves?.length) return [];
  const stored = [];
  let dispUpdated = false;
  let disp = {};

  // Pre-load disposition for onboarding
  if (sessionType === 'onboarding') {
    const row = await db.prepare('SELECT disposition FROM personality WHERE id = 1').get();
    if (row?.disposition) {
      try { disp = JSON.parse(row.disposition); } catch {}
    }
  }

  for (const r of updates.resolves) {
    if (!r.resolution?.trim()) continue;
    const item = agenda.find(a => a.id === r.id);
    if (!item?.question) continue;

    // Dedup: skip if we already have this exact Q+A stored
    const content = `${item.content}: ${r.resolution}`;
    const existing = await db.prepare(
      "SELECT id FROM memories WHERE content = ? AND superseded_by IS NULL LIMIT 1"
    ).get(content);
    if (existing) continue;

    // Store as memory
    const memId = await storeMemory(db, content, {
      type: 'insight',
      source: 'conversation',
    });
    stored.push(memId);

    // For onboarding, also update personality.disposition
    if (sessionType === 'onboarding') {
      const key = PROFILE_FIELD_MAP[item.content.toLowerCase()];
      if (key) {
        disp[key] = r.resolution.trim();
        dispUpdated = true;
      }
    }
  }

  if (dispUpdated) {
    await db.prepare('UPDATE personality SET disposition = ?, updated_at = ? WHERE id = 1').run(
      JSON.stringify(disp), new Date().toISOString()
    );
  }

  return stored;
}
//
export async function persistConversation(db, session) {
  const summary = buildSessionSummary(session);
  const endedAt = session.endedAt || new Date().toISOString();
  const decisions = session.keyDecisions ? JSON.stringify(session.keyDecisions) : null;

  // Close existing snapshot row if present
  if (session._convId) {
    await db.prepare(
      'UPDATE conversations SET ended_at = ?, summary = ?, key_decisions = ?, mood = ?, memories_created = ? WHERE id = ?'
    ).run(endedAt, summary, decisions, session.mood || null, session.memoriesCreated ? JSON.stringify(session.memoriesCreated) : null, session._convId);
    return session._convId;
  }

  const result = await db.prepare(
    'INSERT INTO conversations (session_type, started_at, ended_at, summary, key_decisions, mood, memories_created) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    session.type,
    session.startedAt,
    endedAt,
    summary,
    decisions,
    session.mood || null,
    session.memoriesCreated ? JSON.stringify(session.memoriesCreated) : null,
  );
  return Number(result.lastInsertRowid);
}
//
// Build a terse summary from session state (no AI call)
export function buildSessionSummary(session) {
  const parts = [];
  const msgCount = session.messages.length;
  const resolved = session.agenda.filter(a => a.status === 'resolved').length;
  const total = session.agenda.length;
  const pending = session.agenda.filter(a => a.status === 'pending').length;

  if (msgCount) parts.push(`${msgCount} turns`);
  if (total) parts.push(`agenda ${resolved}/${total} done`);
  if (pending) parts.push(`${pending} pending`);

  // Last 3 resolved agenda items as key topics
  const topics = session.agenda
    .filter(a => a.status === 'resolved')
    .slice(-3)
    .map(a => a.content);
  if (topics.length) parts.push(`topics: ${topics.join('; ')}`);

  return parts.join('. ') || 'Session started';
}
//
// Upsert an active conversation snapshot (called periodically)
export async function snapshotConversation(db, session) {
  if (!session || !db) return;
  const summary = buildSessionSummary(session);
  const decisions = session.agenda
    .filter(a => a.status === 'resolved' && a.resolution)
    .map(a => a.resolution);

  const messagesJson = JSON.stringify(session.messages);
  const agendaJson = JSON.stringify(session.agenda);
  const stateVal = session.state || 'INITIALIZING';

  // Check for existing active row for this session
  if (!session._convId) {
    const existing = await db.prepare(
      'SELECT id FROM conversations WHERE ended_at IS NULL AND session_type = ? ORDER BY id DESC LIMIT 1'
    ).get(session.type);
    if (existing) {
      session._convId = existing.id;
    } else {
      const result = await db.prepare(
        'INSERT INTO conversations (session_type, started_at, summary, messages, agenda, state) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(session.type, session.startedAt, summary, messagesJson, agendaJson, stateVal);
      session._convId = Number(result.lastInsertRowid);
      return;
    }
  }

  await db.prepare(
    'UPDATE conversations SET summary = ?, key_decisions = ?, messages = ?, agenda = ?, state = ? WHERE id = ?'
  ).run(summary, decisions.length ? JSON.stringify(decisions) : null, messagesJson, agendaJson, stateVal, session._convId);
}
//
export async function processOnboardingExtractions(db, extractions) {
  // Process standard extractions (tasks, decisions, commitments, waiting_for)
  const result = await processExtractions(db, extractions);

  // Process profile fields into personality.disposition
  const profiles = extractions.profiles || [];
  if (profiles.length > 0) {
    const row = await db.prepare('SELECT disposition FROM personality WHERE id = 1').get();
    let disp = {};
    if (row?.disposition) {
      try { disp = JSON.parse(row.disposition); } catch {}
    }
    for (const p of profiles) {
      if (p.field) disp[p.field] = p.value;
    }
    await db.prepare('UPDATE personality SET disposition = ?, updated_at = ? WHERE id = 1').run(
      JSON.stringify(disp), new Date().toISOString()
    );
  }

  return result;
}
//
export async function persistOnboardingSummary(db, session) {
  const id = await persistConversation(db, session);
  await storeMemory(db, 'Onboarding completed. User profile established.', {
    type: 'status',
    source: 'conversation',
  });
  return id;
}
//
export async function carryOverDeferred(db, session) {
  const deferred = (session.agenda || []).filter(a => a.status === 'deferred');
  const carried = [];
  for (const item of deferred) {
    // Count existing deferred pattern memories for this content
    const existing = await db.prepare(
      "SELECT COUNT(*) as cnt FROM memories WHERE content LIKE ? AND type = 'pattern'"
    ).get(`%deferred:%${item.content}%`);
    const deferCount = (existing?.cnt || 0) + 1;
    if (deferCount >= 3) {
      // Flag as pattern — stop auto-surfacing
      await storeMemory(db, `deferred:${deferCount}x: ${item.content}. Consider breaking down or dropping.`, {
        type: 'pattern',
        source: 'conversation',
      });
    }
    // Store as follow-up memory with escalated priority
    const priorityMap = { low: 0, normal: 0, high: 1, critical: 1 };
    await storeMemory(db, `Deferred from meeting: ${item.content}`, {
      type: 'follow_up',
      priority: (priorityMap[item.priority] || 0) + 1,
      source: 'conversation',
    });
    carried.push({ content: item.content, deferCount });
  }
  return carried;
}
//
export async function extractFromTranscript(transcript, options = {}) {
  const { apiKey, accessToken, agenda, meetingType, fetchFn } = options;
  const _fetch = fetchFn || globalThis.fetch;
  // Build the extraction prompt
  const agendaContext = agenda?.length
    ? '\n\nCurrent agenda items:\n' + agenda.map(a => `- [${a.id}] (${a.status}): ${a.content}`).join('\n')
    : '';
  const extractionPrompt = `You are a meeting extraction assistant. Analyze the following planning conversation and extract structured data.

## What to Extract
- **Tasks**: Specific, concrete next actions — things the USER needs to do. Include tasks mentioned explicitly ("add a task") AND tasks implied by discussion ("I need to call the dentist"). Do NOT extract vague goals, aspirations, or broad intentions (e.g. "address procrastination patterns", "improve workflow efficiency"). Do NOT extract the AI assistant's own responsibilities (learning the user's name, understanding their workflow, establishing rapport) as tasks. Only extract things the user themselves must act on.
- **Decisions**: Conclusions reached during discussion.
- **Commitments**: Promises made to specific people.
- **Waiting for**: Things the user is waiting on from others.

## Agenda Updates
- **Resolve**: Mark agenda items as done when the conversation addressed them.
- **Add**: New topics that came up during conversation.
${agendaContext}

## Output Format
Respond with ONLY a <meeting_state> XML block:
<meeting_state>
  <extractions>
    <task deadline="" project="">description</task>
    <decision project="">what was decided</decision>
    <commitment to="" deadline="">what was promised</commitment>
    <waiting_for from="" due="">what you're waiting for</waiting_for>
  </extractions>
  <agenda_updates>
    <resolve id="" resolution=""/>
    <defer id=""/>
    <add type="" priority="" content=""/>
  </agenda_updates>
  <next_item></next_item>
</meeting_state>

Only include tags for items actually found. If nothing to extract, return empty tags.`;
  // No Gemini credentials — use server proxy extraction
  if (!apiKey && !accessToken) {
    console.log('[extractFromTranscript] No Gemini key — using server proxy');
    return extractViaServerProxy(_fetch, transcript, agenda, meetingType);
  }
  const url = accessToken
    ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
    : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  const body = {
    systemInstruction: { parts: [{ text: extractionPrompt }] },
    contents: [{ role: 'user', parts: [{ text: transcript || '(empty transcript)' }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024 },
  };
  try {
    const response = await _fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error(`[extractFromTranscript] Gemini error: ${response.status}`, errBody.slice(0, 200));
      // Fall back to server proxy on any Gemini error (429, 403, 500, etc.)
      console.log('[extractFromTranscript] Falling back to server proxy...');
      return extractViaServerProxy(_fetch, transcript, agenda, meetingType);
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`[extractFromTranscript] Gemini response (${text.length} chars):`, text.slice(0, 300));
    const parsed = parseMeetingState(text);
    const taskCount = parsed.extractions?.tasks?.length || 0;
    const decCount = parsed.extractions?.decisions?.length || 0;
    console.log(`[extractFromTranscript] Parsed: ${taskCount} tasks, ${decCount} decisions`);
    return parsed;
  } catch (err) {
    console.error('[extractFromTranscript] Gemini failed:', err);
    console.log('[extractFromTranscript] Falling back to server proxy...');
    return extractViaServerProxy(_fetch, transcript, agenda, meetingType);
  }
}
//
async function extractViaServerProxy(_fetch, transcript, agenda, meetingType) {
  try {
    const response = await _fetch('/api/chat/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcript || '', agenda, meetingType }),
    });
    if (!response.ok) {
      console.error(`[extractFromTranscript] Server proxy error: ${response.status}`);
      return emptyExtractionResult();
    }
    const data = await response.json();
    const text = data.text || '';
    console.log(`[extractFromTranscript] Server proxy response (${text.length} chars):`, text.slice(0, 300));
    const parsed = parseMeetingState(text);
    const taskCount = parsed.extractions?.tasks?.length || 0;
    console.log(`[extractFromTranscript] Server proxy parsed: ${taskCount} tasks`);
    return parsed;
  } catch (err) {
    console.error('[extractFromTranscript] Server proxy failed:', err);
    return emptyExtractionResult();
  }
}
//
function emptyExtractionResult() {
  return {
    displayText: '',
    extractions: { tasks: [], decisions: [], commitments: [], waitingFor: [], profiles: [] },
    agendaUpdates: { resolves: [], defers: [], adds: [] },
    nextItem: null,
  };
}
//
// Ensure extractions exist — if parseMeetingState found nothing (e.g. Gemini didn't
// output XML), fall back to a dedicated extraction call.
// extractionOpts.transcript can override what gets sent to the extraction model —
// use this to include user message + AI response for better context.
export async function ensureExtractions(result, extractionOpts = {}) {
  const ext = result.extractions || {};
  const ag = result.agendaUpdates || {};
  const hasExtractions = (
    ext.tasks?.length || ext.decisions?.length || ext.commitments?.length ||
    ext.waitingFor?.length || ext.profiles?.length
  );
  const hasAgendaUpdates = (
    ag.resolves?.length || ag.defers?.length || ag.adds?.length
  );
  if (hasExtractions || hasAgendaUpdates) return result;

  // Nothing inline — try post-hoc extraction from conversation context
  const text = extractionOpts.transcript || result.displayText;
  if (!text) return result;
  console.log(`[ensureExtractions] No inline XML — calling fallback extraction (${text.length} chars)`);
  try {
    const fallback = await extractFromTranscript(text, extractionOpts);
    const taskCount = fallback.extractions?.tasks?.length || 0;
    const decCount = fallback.extractions?.decisions?.length || 0;
    console.log(`[ensureExtractions] Fallback found: ${taskCount} tasks, ${decCount} decisions`);
    return {
      ...result,
      extractions: fallback.extractions,
      agendaUpdates: fallback.agendaUpdates,
    };
  } catch (err) {
    console.error('[ensureExtractions] Fallback failed:', err);
    return result;
  }
}
