// Markdown CRUD for today.md — flat checkbox task list
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';

function paths(workspace) {
  return {
    today: join(workspace, 'plans', 'meta', 'today.md'),
    memory: join(process.cwd(), 'src', 'memory.js'),
  };
}

function storeMemory(workspace, text) {
  const { memory } = paths(workspace);
  execFile('node', [memory, 'store', text, '--type', 'status'], (err, stdout) => {
    if (err) console.error('Memory store failed:', err.message);
    else if (stdout) console.log(stdout.trim());
  });
}

function todayStr() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function isToday(dateStr) {
  const today = todayStr();
  return dateStr === today;
}

export function readTasks(workspace) {
  const { today } = paths(workspace);
  if (!existsSync(today)) return { date: '', tasks: [] };
  const md = readFileSync(today, 'utf8');
  const lines = md.split('\n');
  let date = '';
  const tasks = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const titleMatch = line.match(/^# .+[—–-]\s*(.+)$/);
    if (titleMatch) { date = titleMatch[1].trim(); continue; }
    const checkedMatch = line.match(/^- \[x\] (.+)$/);
    const uncheckedMatch = !checkedMatch ? line.match(/^- \[ \] (.+)$/) : null;
    if (checkedMatch || uncheckedMatch) {
      const text = (checkedMatch || uncheckedMatch)[1];
      const checked = !!checkedMatch;
      // Collect indented detail lines
      const detailLines = [];
      while (li + 1 < lines.length && lines[li + 1].match(/^  \S/)) {
        li++;
        detailLines.push(lines[li].slice(2));
      }
      tasks.push({ text, checked, details: detailLines.length ? detailLines.join('\n') : '' });
      continue;
    }
  }
  // If the file is from a previous day, strip done items (fresh start)
  if (date && !isToday(date)) {
    const unchecked = tasks.filter(t => !t.checked);
    const newDate = todayStr();
    writeTasks(workspace, newDate, unchecked);
    return { date: newDate, tasks: unchecked };
  }
  return { date, tasks };
}

function writeTasks(workspace, date, tasks) {
  const { today } = paths(workspace);
  const title = date
    ? `# Today's Plan — ${date}`
    : `# Today's Plan — ${todayStr()}`;
  const lines = [title, ''];
  for (const t of tasks) {
    lines.push(`- [${t.checked ? 'x' : ' '}] ${t.text}`);
    if (t.details) {
      for (const dl of t.details.split('\n')) {
        lines.push(`  ${dl}`);
      }
    }
  }
  lines.push('');
  writeFileSync(today, lines.join('\n'));
}

export function toggleTask(workspace, taskText) {
  const { date, tasks } = readTasks(workspace);
  const idx = tasks.findIndex(t => t.text === taskText);
  if (idx < 0) return false;

  tasks[idx].checked = !tasks[idx].checked;
  const task = tasks.splice(idx, 1)[0];

  if (task.checked) {
    // Done items go to bottom
    tasks.push(task);
    const d = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    storeMemory(workspace, 'COMPLETED [' + d + ']: ' + taskText);
    writeTasks(workspace, date, tasks);
    return 'checked';
  } else {
    // Unchecked: place at top of undone list
    tasks.unshift(task);
    writeTasks(workspace, date, tasks);
    return 'unchecked';
  }
}

export function deleteTask(workspace, taskText) {
  const { date, tasks } = readTasks(workspace);
  const idx = tasks.findIndex(t => t.text === taskText);
  if (idx < 0) return false;
  tasks.splice(idx, 1);
  writeTasks(workspace, date, tasks);
  return true;
}

export function addTask(workspace, taskText) {
  const { date, tasks } = readTasks(workspace);
  // New items go to top of list (done items are at bottom)
  tasks.unshift({ text: taskText, checked: false, details: '' });
  writeTasks(
    workspace,
    date || todayStr(),
    tasks
  );
  return true;
}

export function editTask(workspace, oldText, newText) {
  const { date, tasks } = readTasks(workspace);
  const idx = tasks.findIndex(t => t.text === oldText);
  if (idx < 0) return false;
  tasks[idx].text = newText;
  writeTasks(workspace, date, tasks);
  return true;
}

export function reorderTasks(workspace, orderedTasks) {
  const { date } = readTasks(workspace);
  writeTasks(workspace, date, orderedTasks);
  return true;
}
