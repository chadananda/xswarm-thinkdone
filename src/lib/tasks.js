// Markdown CRUD for today.md — flat checkbox task list
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';

const WORKSPACE = join(process.cwd(), '..');
const TODAY = join(WORKSPACE, 'plans', 'meta', 'today.md');
const MEMORY = join(process.cwd(), 'src', 'memory.js');

function storeMemory(text) {
  execFile('node', [MEMORY, 'store', text, '--type', 'status'], (err, stdout) => {
    if (err) console.error('Memory store failed:', err.message);
    else if (stdout) console.log(stdout.trim());
  });
}

function todayStr() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function isToday(dateStr) {
  // Compare the date in the file header with today's date
  const today = todayStr();
  return dateStr === today;
}

export function readTasks() {
  if (!existsSync(TODAY)) return { date: '', tasks: [] };
  const md = readFileSync(TODAY, 'utf8');
  const lines = md.split('\n');
  let date = '';
  const tasks = [];
  for (const line of lines) {
    const titleMatch = line.match(/^# .+[—–-]\s*(.+)$/);
    if (titleMatch) { date = titleMatch[1].trim(); continue; }
    const checkedMatch = line.match(/^- \[x\] (.+)$/);
    if (checkedMatch) { tasks.push({ text: checkedMatch[1], checked: true }); continue; }
    const uncheckedMatch = line.match(/^- \[ \] (.+)$/);
    if (uncheckedMatch) { tasks.push({ text: uncheckedMatch[1], checked: false }); continue; }
  }
  // If the file is from a previous day, strip done items (fresh start)
  if (date && !isToday(date)) {
    const unchecked = tasks.filter(t => !t.checked);
    const newDate = todayStr();
    writeTasks(newDate, unchecked);
    return { date: newDate, tasks: unchecked };
  }
  return { date, tasks };
}

function writeTasks(date, tasks) {
  const title = date
    ? `# Today's Plan — ${date}`
    : `# Today's Plan — ${todayStr()}`;
  const lines = [title, ''];
  for (const t of tasks) {
    lines.push(`- [${t.checked ? 'x' : ' '}] ${t.text}`);
  }
  lines.push('');
  writeFileSync(TODAY, lines.join('\n'));
}

export function toggleTask(taskText) {
  const { date, tasks } = readTasks();
  const idx = tasks.findIndex(t => t.text === taskText);
  if (idx < 0) return false;

  tasks[idx].checked = !tasks[idx].checked;
  const task = tasks.splice(idx, 1)[0];

  if (task.checked) {
    // Done items go to top
    tasks.unshift(task);
    const d = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    storeMemory('COMPLETED [' + d + ']: ' + taskText);
    writeTasks(date, tasks);
    return 'checked';
  } else {
    // Unchecked: place after last done item (top of undone list)
    let insertAt = 0;
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].checked) insertAt = i + 1;
      else break;
    }
    tasks.splice(insertAt, 0, task);
    writeTasks(date, tasks);
    return 'unchecked';
  }
}

export function deleteTask(taskText) {
  const { date, tasks } = readTasks();
  const idx = tasks.findIndex(t => t.text === taskText);
  if (idx < 0) return false;
  tasks.splice(idx, 1);
  writeTasks(date, tasks);
  return true;
}

export function addTask(taskText) {
  const { date, tasks } = readTasks();
  // New items go to top of undone list (after done items)
  let insertAt = 0;
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].checked) insertAt = i + 1;
    else break;
  }
  tasks.splice(insertAt, 0, { text: taskText, checked: false });
  writeTasks(
    date || todayStr(),
    tasks
  );
  return true;
}

export function editTask(oldText, newText) {
  const { date, tasks } = readTasks();
  const idx = tasks.findIndex(t => t.text === oldText);
  if (idx < 0) return false;
  tasks[idx].text = newText;
  writeTasks(date, tasks);
  return true;
}

export function reorderTasks(orderedTasks) {
  const { date } = readTasks();
  writeTasks(date, orderedTasks);
  return true;
}
