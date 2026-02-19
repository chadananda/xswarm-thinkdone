// Heartbeat — periodic DB scan for data gaps, generates agenda items
// Runs in the browser. Detects missing profile fields, empty tables, stale data.
// Level 1: basics (profile, empty tables)
// Level 2: per-entity depth (per project, routine, person)

export const HEARTBEAT_INTERVALS = {
  free: 5 * 60 * 1000,     // 5 min — most frequent (free users need more guidance)
  starter: 10 * 60 * 1000, // 10 min
  pro: 15 * 60 * 1000,     // 15 min — least frequent (power users)
};

const PROFILE_FIELDS = [
  { key: 'user_name', question: 'What should I call you?', content: 'Your name' },
  { key: 'ai_name', question: 'What would you like to call me?', content: 'Name your assistant' },
  { key: 'timezone', question: 'What timezone are you in?', content: 'Your timezone' },
  { key: 'role', question: "What's your role or title?", content: 'Your role' },
  { key: 'work_style', question: 'When do you prefer to plan — morning, evening, or as-needed?', content: 'Planning preference' },
];

// Scan DB for all detectable data gaps (Level 1 + Level 2)
export async function detectDataGaps(db) {
  const gaps = [];

  // --- Level 1: Profile gaps ---
  const row = await db.prepare('SELECT disposition FROM personality WHERE id = 1').get();
  let disp = {};
  if (row?.disposition) {
    try { disp = JSON.parse(row.disposition); } catch {}
  }

  for (const f of PROFILE_FIELDS) {
    if (!disp[f.key]) {
      gaps.push({
        id: `profile_${f.key}`,
        type: 'INFORM',
        priority: f.key === 'user_name' || f.key === 'ai_name' ? 'critical' : 'high',
        content: f.content,
        question: f.question,
      });
    }
  }

  // --- Level 1: Data gaps ---
  const today = new Date().toISOString().slice(0, 10);

  const taskCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM tasks WHERE plan_date = ?'
  ).get(today);
  if (!taskCount?.cnt) {
    gaps.push({
      id: 'no_tasks_today',
      type: 'DECIDE',
      priority: 'high',
      content: 'No tasks planned for today',
      question: 'What are your priorities for today?',
    });
  }

  const routineCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM routines WHERE active = 1'
  ).get();
  if (!routineCount?.cnt) {
    gaps.push({
      id: 'no_routines',
      type: 'DECIDE',
      priority: 'normal',
      content: 'No habits or routines set up',
      question: 'Do you have any daily habits or routines you want to track?',
    });
  }

  const projectCount = await db.prepare(
    "SELECT COUNT(DISTINCT project) as cnt FROM memories WHERE project != '' AND superseded_by IS NULL"
  ).get();
  if (!projectCount?.cnt) {
    gaps.push({
      id: 'no_projects',
      type: 'DECIDE',
      priority: 'normal',
      content: 'No projects tracked yet',
      question: 'What projects are you working on?',
    });
  }

  const peopleCount = await db.prepare(
    "SELECT COUNT(DISTINCT person) as cnt FROM memories WHERE person != '' AND superseded_by IS NULL"
  ).get();
  if (!peopleCount?.cnt) {
    gaps.push({
      id: 'no_people',
      type: 'FOLLOW-UP',
      priority: 'low',
      content: 'No contacts or collaborators tracked',
      question: 'Who are the key people you work with or are accountable to?',
    });
  }

  // --- Level 1: Staleness ---

  const blockers = await db.prepare(
    "SELECT id, content, project FROM memories WHERE type = 'blocker' AND superseded_by IS NULL ORDER BY created_at ASC LIMIT 5"
  ).all();
  for (const b of blockers) {
    gaps.push({
      id: `open_blocker:${b.id}`,
      type: 'FOLLOW-UP',
      priority: 'critical',
      content: b.content,
      question: `This blocker${b.project ? ` on ${b.project}` : ''} is still open. Resolved?`,
    });
  }

  const cutoff5d = new Date(Date.now() - 5 * 86400000).toISOString();
  const staleProjects = await db.prepare(
    "SELECT project, MAX(created_at) as last_activity FROM memories WHERE superseded_by IS NULL AND project != '' GROUP BY project HAVING last_activity < ? ORDER BY last_activity ASC"
  ).all(cutoff5d);
  for (const sp of staleProjects) {
    gaps.push({
      id: `stale_project:${sp.project}`,
      type: 'DECIDE',
      priority: 'low',
      content: `${sp.project} has been quiet`,
      question: `No activity on ${sp.project} in 5+ days. Still a priority?`,
    });
  }

  // --- Level 2: Per-project depth ---
  const projects = await db.prepare(
    "SELECT DISTINCT project FROM memories WHERE project != '' AND superseded_by IS NULL"
  ).all();

  for (const { project } of projects) {
    // No next action for this project?
    const hasOpenTask = await db.prepare(
      "SELECT 1 FROM tasks WHERE project = ? AND checked = 0 LIMIT 1"
    ).get(project);
    if (!hasOpenTask) {
      gaps.push({
        id: `project_next_action:${project}`,
        type: 'DECIDE',
        priority: 'normal',
        content: `${project}: no next action`,
        question: `What's the next concrete step for ${project}?`,
      });
    }

    // No status update in 3+ days?
    const cutoff3d = new Date(Date.now() - 3 * 86400000).toISOString();
    const recentStatus = await db.prepare(
      "SELECT 1 FROM memories WHERE project = ? AND type = 'status' AND superseded_by IS NULL AND created_at > ? LIMIT 1"
    ).get(project, cutoff3d);
    if (!recentStatus) {
      gaps.push({
        id: `project_status:${project}`,
        type: 'FOLLOW-UP',
        priority: 'normal',
        content: `${project}: no recent status`,
        question: `How is ${project} going? Any updates?`,
      });
    }

    // No goal/deadline defined?
    const hasGoal = await db.prepare(
      "SELECT 1 FROM memories WHERE project = ? AND superseded_by IS NULL AND (type = 'commitment' OR content LIKE '%deadline%' OR content LIKE '%goal%' OR content LIKE '%target%' OR content LIKE '%by %') LIMIT 1"
    ).get(project);
    if (!hasGoal) {
      gaps.push({
        id: `project_goal:${project}`,
        type: 'PLAN',
        priority: 'low',
        content: `${project}: no goal or deadline`,
        question: `What's the goal or deadline for ${project}?`,
      });
    }

    // No team/people associated?
    const hasPeople = await db.prepare(
      "SELECT 1 FROM memories WHERE project = ? AND person != '' AND superseded_by IS NULL LIMIT 1"
    ).get(project);
    if (!hasPeople) {
      gaps.push({
        id: `project_people:${project}`,
        type: 'FOLLOW-UP',
        priority: 'low',
        content: `${project}: no team members`,
        question: `Who else is involved in ${project}?`,
      });
    }
  }

  // --- Level 2: Per-routine depth (Atomic Habits) ---
  const routines = await db.prepare(
    "SELECT id, name, cue, reward, two_min_version, stack_after FROM routines WHERE active = 1"
  ).all();

  for (const r of routines) {
    if (!r.cue) {
      gaps.push({
        id: `routine_cue:${r.id}`,
        type: 'PLAN',
        priority: 'low',
        content: `${r.name}: no cue defined`,
        question: `What triggers "${r.name}"? (e.g., after coffee, when alarm goes off)`,
      });
    }
    if (!r.reward) {
      gaps.push({
        id: `routine_reward:${r.id}`,
        type: 'PLAN',
        priority: 'low',
        content: `${r.name}: no reward defined`,
        question: `What reward follows "${r.name}"? (makes the habit stick)`,
      });
    }
    if (!r.two_min_version) {
      gaps.push({
        id: `routine_2min:${r.id}`,
        type: 'PLAN',
        priority: 'low',
        content: `${r.name}: no 2-minute version`,
        question: `What's a tiny 2-minute version of "${r.name}"? (for low-energy days)`,
      });
    }
  }

  // --- Level 2: Per-person depth ---
  const people = await db.prepare(
    "SELECT DISTINCT person FROM memories WHERE person != '' AND superseded_by IS NULL"
  ).all();

  for (const { person } of people) {
    // No relationship/role defined?
    const hasRole = await db.prepare(
      "SELECT 1 FROM memories WHERE person = ? AND superseded_by IS NULL AND (content LIKE '%manager%' OR content LIKE '%report%' OR content LIKE '%client%' OR content LIKE '%colleague%' OR content LIKE '%partner%' OR type = 'insight') LIMIT 1"
    ).get(person);
    if (!hasRole) {
      gaps.push({
        id: `person_role:${person}`,
        type: 'INFORM',
        priority: 'low',
        content: `${person}: relationship unclear`,
        question: `What's your relationship with ${person}? (manager, report, client, collaborator...)`,
      });
    }
  }

  // --- Level 2: Task depth ---
  const unestimatedTasks = await db.prepare(
    "SELECT COUNT(*) as cnt FROM tasks WHERE plan_date = ? AND checked = 0 AND minutes IS NULL"
  ).get(today);
  if (unestimatedTasks?.cnt > 2) {
    gaps.push({
      id: 'tasks_unestimated',
      type: 'PLAN',
      priority: 'low',
      content: `${unestimatedTasks.cnt} tasks without time estimates`,
      question: 'Want to add time estimates to your tasks? It helps plan the day.',
    });
  }

  // No tasks for tomorrow?
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const tomorrowCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM tasks WHERE plan_date = ?'
  ).get(tomorrow);
  if (!tomorrowCount?.cnt && taskCount?.cnt > 0) {
    gaps.push({
      id: 'no_tasks_tomorrow',
      type: 'PLAN',
      priority: 'low',
      content: 'Nothing planned for tomorrow',
      question: 'Want to get ahead and plan a few tasks for tomorrow?',
    });
  }

  return gaps;
}

// Filter out gaps already represented in the agenda (by heartbeatId or content match)
export function filterNewGaps(gaps, existingAgenda) {
  const heartbeatIds = new Set(
    existingAgenda
      .filter(a => a.heartbeatId)
      .map(a => a.heartbeatId)
  );
  const existingContent = new Set(
    existingAgenda.map(a => (a.content || '').toLowerCase())
  );
  return gaps.filter(g =>
    !heartbeatIds.has(g.id) && !existingContent.has(g.content.toLowerCase())
  );
}
