// GTD Engine — Inbox, Projects, Waiting-For, Weekly Review, Triage
//
export async function getInbox(db) {
  return db.prepare(
    "SELECT * FROM memories WHERE type = 'idea' AND (project = '' OR project IS NULL) AND superseded_by IS NULL ORDER BY created_at DESC"
  ).all();
}
//
export async function getProjects(db) {
  const projects = await db.prepare(
    "SELECT project, COUNT(*) as memory_count, MAX(created_at) as last_activity FROM memories WHERE superseded_by IS NULL AND project != '' GROUP BY project ORDER BY last_activity DESC"
  ).all();
  const today = new Date().toISOString().slice(0, 10);
  for (const p of projects) {
    const taskCount = await db.prepare(
      'SELECT COUNT(*) as cnt FROM tasks WHERE project = ? AND plan_date = ?'
    ).get(p.project, today);
    p.task_count = taskCount?.cnt || 0;
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
    p.stale = p.last_activity < fiveDaysAgo;
  }
  return projects;
}
//
export async function getWaitingFor(db) {
  return db.prepare(
    "SELECT * FROM memories WHERE type = 'waiting_for' AND superseded_by IS NULL ORDER BY priority DESC, created_at ASC"
  ).all();
}
//
export async function getStaleProjects(db, days = 5) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(
    "SELECT project, MAX(created_at) as last_activity FROM memories WHERE superseded_by IS NULL AND project != '' GROUP BY project HAVING last_activity < ? ORDER BY last_activity ASC"
  ).all(cutoff);
}
//
export async function generateWeeklyReview(db) {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  //
  const wins = await db.prepare(
    "SELECT text, project, completed_at FROM tasks WHERE checked = 1 AND completed_at >= ? ORDER BY completed_at DESC"
  ).all(weekAgo);
  //
  const misses = await db.prepare(
    "SELECT text, project, plan_date FROM tasks WHERE checked = 0 AND plan_date < ? ORDER BY plan_date ASC"
  ).all(today);
  //
  const projectStatuses = await db.prepare(
    "SELECT project, content, created_at FROM memories WHERE type = 'status' AND superseded_by IS NULL AND project != '' ORDER BY project, created_at DESC"
  ).all();
  //
  const commitments = await db.prepare(
    "SELECT content, person, project FROM memories WHERE type = 'commitment' AND superseded_by IS NULL ORDER BY created_at ASC"
  ).all();
  //
  const waitingFor = await db.prepare(
    "SELECT content, person, project FROM memories WHERE type = 'waiting_for' AND superseded_by IS NULL ORDER BY created_at ASC"
  ).all();
  //
  const completions = await db.prepare(
    "SELECT r.name, COUNT(c.id) as done FROM routines r LEFT JOIN completions c ON r.id = c.routine_id AND c.completed_date >= ? WHERE r.active = 1 AND r.kind = 'habit' GROUP BY r.id ORDER BY r.name"
  ).all(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  //
  return {
    wins: wins.map(w => ({ text: w.text, project: w.project })),
    misses: misses.map(m => ({ text: m.text, project: m.project, date: m.plan_date })),
    projectStatuses: projectStatuses.reduce((acc, s) => {
      if (!acc[s.project]) acc[s.project] = [];
      acc[s.project].push(s.content);
      return acc;
    }, {}),
    commitments,
    waitingFor,
    habitScorecard: completions,
  };
}
//
export async function triageIdea(db, memoryId, opts) {
  const { action, project, priority } = opts;
  const idea = await db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId);
  if (!idea) throw new Error(`Memory #${memoryId} not found`);
  switch (action) {
    case 'project':
      await db.prepare(
        "UPDATE memories SET type = 'status', project = ?, priority = ? WHERE id = ?"
      ).run(project || '', priority || 0, memoryId);
      break;
    case 'someday':
      await db.prepare(
        "UPDATE memories SET priority = -1 WHERE id = ?"
      ).run(memoryId);
      break;
    case 'reference':
      await db.prepare(
        "UPDATE memories SET type = 'insight' WHERE id = ?"
      ).run(memoryId);
      break;
    case 'delete':
      await db.prepare(
        "UPDATE memories SET superseded_by = -1 WHERE id = ?"
      ).run(memoryId);
      break;
    default:
      throw new Error(`Unknown triage action: ${action}`);
  }
}
