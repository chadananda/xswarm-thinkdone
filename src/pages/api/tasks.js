import { getUser } from '../../lib/user.js';
import { readTasks, toggleTask, addTask, deleteTask, editTask, reorderTasks } from '../../lib/tasks.js';

export async function GET() {
  const user = getUser();
  const data = readTasks(user.workspace);
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }) {
  try {
    const user = getUser();
    const body = await request.json();
    let result;
    switch (body.action) {
      case 'toggle': result = toggleTask(user.workspace, body.task); break;
      case 'add': result = addTask(user.workspace, body.task); break;
      case 'delete': result = deleteTask(user.workspace, body.task); break;
      case 'edit': result = editTask(user.workspace, body.oldTask, body.newTask); break;
      case 'reorder': result = reorderTasks(user.workspace, body.tasks); break;
      default:
        return new Response(JSON.stringify({ error: 'unknown action' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }
    return new Response(JSON.stringify({ ok: !!result, result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
