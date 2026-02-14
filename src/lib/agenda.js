// Agenda generation + management
// Runs in the browser. Generates agenda items from local database state.

let _itemCounter = 0;

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
const PRIORITY_ESCALATION = { low: 'normal', normal: 'high', high: 'critical', critical: 'critical' };

// --- Agenda Item Management ---

export function createAgendaItem(type, priority, content, question, context = null) {
  return {
    id: `item-${++_itemCounter}`,
    type,
    priority,
    content,
    question,
    followUps: [],
    context,
    sourceMemoryIds: [],
    status: 'pending',
    resolution: null,
    spawnedItems: [],
    estimatedTurns: 1,
  };
}

export function resolveItem(agenda, itemId, resolution) {
  const item = agenda.find(a => a.id === itemId);
  if (item) {
    item.status = 'resolved';
    item.resolution = resolution;
  }
}

export function deferItem(agenda, itemId) {
  const item = agenda.find(a => a.id === itemId);
  if (item) {
    item.status = 'deferred';
    item.priority = PRIORITY_ESCALATION[item.priority] || item.priority;
  }
}

export function applyAgendaUpdates(agenda, updates) {
  if (!updates) return;
  for (const r of (updates.resolves || [])) {
    resolveItem(agenda, r.id, r.resolution);
  }
  for (const d of (updates.defers || [])) {
    deferItem(agenda, d.id);
  }
  for (const a of (updates.adds || [])) {
    agenda.push(createAgendaItem(
      a.type || 'FOLLOW-UP', a.priority || 'normal', a.content, null
    ));
  }
}

export function getNextItem(agenda) {
  const pending = agenda.filter(a => a.status === 'pending');
  if (!pending.length) return null;

  pending.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    return pa - pb;
  });

  return pending[0];
}

// --- Morning Meeting Agenda Generation ---

export async function generateMorningAgenda(db) {
  const agenda = [];

  // Critical: Overdue blockers
  const blockers = await db.prepare(
    "SELECT id, content, project FROM memories WHERE type = 'blocker' AND superseded_by IS NULL ORDER BY created_at ASC"
  ).all();
  for (const b of blockers) {
    agenda.push(createAgendaItem(
      'FOLLOW-UP', 'critical', b.content,
      `This blocker${b.project ? ` on ${b.project}` : ''} is still open. What's the status?`,
      { memoryId: b.id }
    ));
  }

  // High: Overdue commitments
  const commitments = await db.prepare(
    "SELECT id, content, project, person FROM memories WHERE type = 'commitment' AND superseded_by IS NULL ORDER BY created_at ASC"
  ).all();
  for (const c of commitments) {
    agenda.push(createAgendaItem(
      'FOLLOW-UP', 'high', c.content,
      `${c.person ? `Committed to ${c.person}: ` : ''}${c.content}. Status?`,
      { memoryId: c.id }
    ));
  }

  // High: Waiting-for items
  const waiting = await db.prepare(
    "SELECT id, content, project, person FROM memories WHERE type = 'waiting_for' AND superseded_by IS NULL ORDER BY created_at ASC"
  ).all();
  for (const w of waiting) {
    agenda.push(createAgendaItem(
      'FOLLOW-UP', 'high', w.content,
      `Waiting on ${w.person || 'someone'}: ${w.content}. Any update?`,
      { memoryId: w.id }
    ));
  }

  // Normal: Active project statuses
  const statuses = await db.prepare(
    "SELECT DISTINCT project FROM memories WHERE type = 'status' AND superseded_by IS NULL AND project != '' ORDER BY project"
  ).all();
  if (statuses.length) {
    // Group as a single INFORM item unless there are specific issues
    const projects = statuses.map(s => s.project).join(', ');
    agenda.push(createAgendaItem(
      'INFORM', 'normal',
      `Active projects: ${projects}`,
      null
    ));
  }

  // Normal: Recent discoveries
  const discoveries = await db.prepare(
    "SELECT id, content, project FROM memories WHERE type = 'discovery' AND superseded_by IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT 3"
  ).all(new Date(Date.now() - 2 * 86400000).toISOString());
  for (const d of discoveries) {
    agenda.push(createAgendaItem(
      'RESEARCH', 'normal', d.content,
      'Worth pursuing, or skip?',
      { memoryId: d.id }
    ));
  }

  // Low: Stale projects (no recent activity)
  const staleProjects = await db.prepare(
    "SELECT project, MAX(created_at) as last_activity FROM memories WHERE superseded_by IS NULL AND project != '' GROUP BY project HAVING last_activity < ? ORDER BY last_activity ASC LIMIT 3"
  ).all(new Date(Date.now() - 5 * 86400000).toISOString());
  for (const sp of staleProjects) {
    // Don't add if already covered by blockers/commitments/waiting
    if (agenda.some(a => a.content.includes(sp.project))) continue;
    agenda.push(createAgendaItem(
      'DECIDE', 'low',
      `${sp.project} has been quiet. Still active?`,
      `No activity on ${sp.project} in 5+ days. Still a priority, or shelve it?`
    ));
  }

  return agenda;
}

// --- Check-In Agenda ---

export async function generateCheckInAgenda(db, userMessage) {
  // Minimal agenda — 0-3 items based on user's message
  const agenda = [];

  // Check if user mentions a project
  const projects = await db.prepare(
    "SELECT DISTINCT project FROM memories WHERE superseded_by IS NULL AND project != ''"
  ).all();
  const mentioned = projects.find(p => userMessage.toLowerCase().includes(p.project.toLowerCase()));

  if (mentioned) {
    // Add a context item for the mentioned project
    const status = await db.prepare(
      "SELECT content FROM memories WHERE type = 'status' AND superseded_by IS NULL AND project = ? ORDER BY created_at DESC LIMIT 1"
    ).get(mentioned.project);

    if (status) {
      agenda.push(createAgendaItem(
        'INFORM', 'normal',
        `Latest on ${mentioned.project}: ${status.content}`,
        null
      ));
    }
  }

  return agenda;
}

// --- Evening Review Agenda ---

export async function generateEveningAgenda(db) {
  const today = new Date().toISOString().slice(0, 10);
  const agenda = [];

  // Check today's tasks: completed vs. not
  const tasks = await db.prepare(
    'SELECT text, checked FROM tasks WHERE plan_date = ? ORDER BY position'
  ).all(today);

  const completed = tasks.filter(t => t.checked);
  const remaining = tasks.filter(t => !t.checked);

  if (completed.length) {
    agenda.push(createAgendaItem(
      'REFLECT', 'normal',
      `Completed ${completed.length} of ${tasks.length} tasks today`,
      completed.length === tasks.length ? 'Clean sweep! How did today feel?' : 'Good progress. How did the day go?'
    ));
  }

  if (remaining.length) {
    agenda.push(createAgendaItem(
      'FOLLOW-UP', 'normal',
      `${remaining.length} tasks still open: ${remaining.slice(0, 3).map(t => t.text).join(', ')}`,
      'Any of these to reschedule for tomorrow?'
    ));
  }

  // Open-ended capture
  agenda.push(createAgendaItem(
    'REFLECT', 'low',
    'Day wrap-up',
    'Anything happen today I should know about?'
  ));

  return agenda;
}

// --- Onboarding Agenda ---

export function generateOnboardingAgenda() {
  const GAP_IDS = [
    'profile_user_name', 'profile_ai_name', 'no_tasks_today',
    'no_projects', 'no_routines', 'profile_work_style', 'no_people',
  ];
  const items = [
    createAgendaItem(
      'INFORM', 'critical', 'Your name',
      'What do you wish me to call you?'
    ),
    createAgendaItem(
      'DECIDE', 'critical', 'Name your assistant',
      'What should you call me?'
    ),
    createAgendaItem(
      'FOLLOW-UP', 'high', 'Immediate tasks and meetings',
      'Do you have any immediate tasks or meetings coming up?'
    ),
    createAgendaItem(
      'DECIDE', 'high', 'Major projects',
      'What are some of your major projects right now?'
    ),
    createAgendaItem(
      'REFLECT', 'normal', 'Daily habits',
      'Are there any daily habits you are trying to build?'
    ),
    createAgendaItem(
      'PLAN', 'normal', 'Work style and preferences',
      'When do you like to plan your day? Morning, evening, or as-needed?'
    ),
    createAgendaItem(
      'FOLLOW-UP', 'low', 'People and commitments',
      'Who are the key people you work with or are accountable to?'
    ),
  ];
  items.forEach((item, i) => { item.heartbeatId = GAP_IDS[i]; });
  return items;
}

// --- Weekly Review Agenda ---

export async function generateWeeklyAgenda(db) {
  const agenda = [];

  // Phase 1: CAPTURE
  agenda.push(createAgendaItem(
    'REFLECT', 'critical',
    'Weekly mind dump',
    "Before we review the week, dump everything floating in your head — projects, ideas, worries, commitments. I'll capture it all."
  ));

  // Phase 2-6 items generated during the meeting dynamically
  // Pre-generate project review items
  const projects = await db.prepare(
    "SELECT DISTINCT project FROM memories WHERE superseded_by IS NULL AND project != '' ORDER BY project"
  ).all();
  for (const p of projects) {
    agenda.push(createAgendaItem(
      'DECIDE', 'normal',
      `Review: ${p.project}`,
      `${p.project} — still active? What's the next action?`
    ));
  }

  return agenda;
}
