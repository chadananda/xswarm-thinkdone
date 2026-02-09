#!/usr/bin/env node
// Tiny server that renders plans/meta/today.md as a live dashboard
// Checkboxes are interactive — checking one updates today.md and stores a memory
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const TODAY = join(ROOT, 'plans', 'meta', 'today.md');
const MEMORY = join(__dir, '..', 'src', 'memory.js');
const PORT = process.env.PORT || 3456;

function storeMemory(text) {
  execFile('node', [MEMORY, 'store', text, '--type', 'status'], (err, stdout) => {
    if (err) console.error('Memory store failed:', err.message);
    else console.log(stdout.trim());
  });
}

function toggleTask(taskText) {
  if (!existsSync(TODAY)) return false;
  let md = readFileSync(TODAY, 'utf8');
  const unchecked = `- [ ] ${taskText}`;
  const checked = `- [x] ${taskText}`;
  if (md.includes(unchecked)) {
    md = md.replace(unchecked, checked);
    writeFileSync(TODAY, md);
    storeMemory(`COMPLETED [${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}]: ${taskText}`);
    return true;
  } else if (md.includes(checked)) {
    md = md.replace(checked, unchecked);
    writeFileSync(TODAY, md);
    return true;
  }
  return false;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ThinkDone — Today's Plan</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f172a; color: #e2e8f0;
    max-width: 640px; margin: 0 auto; padding: 2rem 1.5rem;
    line-height: 1.6;
  }
  h1 { color: #38bdf8; font-size: 1.5rem; margin-bottom: 1.5rem; border-bottom: 2px solid #1e3a5f; padding-bottom: 0.5rem; }
  h2 { color: #7dd3fc; font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
  .priority { border-left: 3px solid #38bdf8; padding-left: 0.75rem; margin: 0.5rem 0; }
  .task { margin: 0.4rem 0; cursor: pointer; padding: 0.3rem 0.5rem; border-radius: 4px; transition: background 0.15s; }
  .task:hover { background: #1e293b; }
  .task input[type="checkbox"] { margin-right: 0.5rem; accent-color: #38bdf8; cursor: pointer; }
  .task.done label { text-decoration: line-through; opacity: 0.5; }
  .bullet { margin: 0.3rem 0; padding-left: 1.25rem; }
  code { background: #1e293b; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.9em; }
  strong { color: #f0f9ff; }
  .meta { color: #475569; font-size: 0.8rem; text-align: right; margin-top: 2rem; }
  .empty { color: #64748b; font-style: italic; margin-top: 3rem; text-align: center; }
  .flash { animation: flash 0.4s ease-out; }
  @keyframes flash { 0% { background: #164e63; } 100% { background: transparent; } }
</style>
</head>
<body>
<div id="plan"><p class="empty">No plan yet. Start a planning meeting to create today.md</p></div>
<div class="meta" id="ts"></div>
<script>
let lastMd = '';
async function load() {
  try {
    const r = await fetch('/today.md');
    if (!r.ok) { document.getElementById('plan').innerHTML = '<p class="empty">No plan yet. Start a planning meeting.</p>'; return; }
    const md = await r.text();
    if (md !== lastMd) { lastMd = md; document.getElementById('plan').innerHTML = render(md); }
    document.getElementById('ts').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch(e) {}
}

async function toggle(text, el) {
  el.closest('.task').classList.add('flash');
  await fetch('/toggle', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({task: text}) });
  lastMd = ''; // force re-render
  await load();
}

function render(md) {
  return md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^(\\d+)\\. (.+)$/gm, (_, n, t) => '<div class="priority"><strong>' + n + '.</strong> ' + inline(t) + '</div>')
    .replace(/^- \\[x\\] (.+)$/gm, (_, t) => {
      const esc = t.replace(/'/g, "\\\\'");
      return '<div class="task done"><input type="checkbox" checked onclick="toggle(\\'' + esc + '\\', this)"><label>' + inline(t) + '</label></div>';
    })
    .replace(/^- \\[ \\] (.+)$/gm, (_, t) => {
      const esc = t.replace(/'/g, "\\\\'");
      return '<div class="task"><input type="checkbox" onclick="toggle(\\'' + esc + '\\', this)"><label>' + inline(t) + '</label></div>';
    })
    .replace(/^- (.+)$/gm, (_, t) => '<div class="bullet">&bull; ' + inline(t) + '</div>')
    .replace(/\\n{2,}/g, '<br>');
}

function inline(s) {
  return s
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\`(.+?)\`/g, '<code>$1</code>');
}

load();
setInterval(load, 3000);
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/toggle') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { task } = JSON.parse(body);
        const ok = toggleTask(task);
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok }));
      } catch {
        res.writeHead(400);
        res.end('{}');
      }
    });
  } else if (req.url === '/today.md') {
    try {
      const md = readFileSync(TODAY, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(md);
    } catch {
      res.writeHead(404);
      res.end('');
    }
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  }
});

server.listen(PORT, () => {
  console.log(`ThinkDone dashboard: http://localhost:${PORT}`);
  console.log(`Watching: ${TODAY}`);
  console.log('Checkboxes update today.md and store completion memories.');
});
