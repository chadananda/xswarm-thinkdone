#!/usr/bin/env node
// Tiny server that renders plans/meta/today.md as a live dashboard
import { createServer } from 'http';
import { readFileSync, watchFile } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const TODAY = join(ROOT, 'plans', 'meta', 'today.md');
const PORT = process.env.PORT || 3456;

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
  ul, ol { padding-left: 1.25rem; }
  li { margin: 0.3rem 0; }
  li input[type="checkbox"] { margin-right: 0.5rem; accent-color: #38bdf8; }
  .done { text-decoration: line-through; opacity: 0.5; }
  .blocker { color: #fb923c; }
  .commitment { color: #a78bfa; }
  .priority-1 { border-left: 3px solid #38bdf8; padding-left: 0.75rem; margin: 0.5rem 0; }
  code { background: #1e293b; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.9em; }
  .updated { color: #475569; font-size: 0.8rem; text-align: right; margin-top: 2rem; }
  .empty { color: #64748b; font-style: italic; margin-top: 3rem; text-align: center; }
  strong { color: #f0f9ff; }
</style>
</head>
<body>
<div id="plan"><p class="empty">No plan yet. Start a planning meeting to create today.md</p></div>
<div class="updated" id="ts"></div>
<script>
async function load() {
  try {
    const r = await fetch('/today.md');
    if (!r.ok) { document.getElementById('plan').innerHTML = '<p class="empty">No plan yet. Start a planning meeting to create today.md</p>'; return; }
    const md = await r.text();
    document.getElementById('plan').innerHTML = render(md);
    document.getElementById('ts').textContent = 'Updated: ' + new Date().toLocaleTimeString();
  } catch(e) {}
}
function render(md) {
  return md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^(\\d+)\\. (.+)$/gm, (_, n, t) => '<div class="priority-1"><strong>' + n + '.</strong> ' + inline(t) + '</div>')
    .replace(/^- \\[x\\] (.+)$/gm, (_, t) => '<div style="margin:0.3rem 0"><input type="checkbox" checked disabled><span class="done">' + inline(t) + '</span></div>')
    .replace(/^- \\[ \\] (.+)$/gm, (_, t) => '<div style="margin:0.3rem 0"><input type="checkbox" disabled>' + inline(t) + '</div>')
    .replace(/^- (.+)$/gm, (_, t) => '<div style="margin:0.3rem 0;padding-left:1.25rem">&bull; ' + inline(t) + '</div>')
    .replace(/\\n{2,}/g, '<br>');
}
function inline(s) {
  return s
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\`(.+?)\`/g, '<code>$1</code>');
}
load();
setInterval(load, 5000);
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  if (req.url === '/today.md') {
    try {
      const md = readFileSync(TODAY, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
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
  console.log('Auto-refreshes every 5 seconds.');
});
