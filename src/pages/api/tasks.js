import { readTasks, toggleTask, addTask, deleteTask, editTask, reorderTasks } from '../../lib/tasks.js';

export async function GET() {
  const data = readTasks();
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    let result;
    switch (body.action) {
      case 'toggle': result = toggleTask(body.task); break;
      case 'add': result = addTask(body.task); break;
      case 'delete': result = deleteTask(body.task); break;
      case 'edit': result = editTask(body.oldTask, body.newTask); break;
      case 'reorder': result = reorderTasks(body.tasks); break;
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
