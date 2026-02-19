#!/usr/bin/env node
// ThinkDone daily planner dashboard
// Full CRUD todo list: check/uncheck, add, delete, inline edit, drag-reorder
// Completion celebrations with sound. Paper/pencil aesthetic.
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

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
  });
}

function toggleTask(taskText) {
  if (!existsSync(TODAY)) return false;
  let md = readFileSync(TODAY, 'utf8');
  const unchecked = '- [ ] ' + taskText;
  const checked = '- [x] ' + taskText;
  if (md.includes(unchecked)) {
    md = md.replace(unchecked, checked);
    writeFileSync(TODAY, md);
    const d = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    storeMemory('COMPLETED [' + d + ']: ' + taskText);
    return 'checked';
  } else if (md.includes(checked)) {
    md = md.replace(checked, unchecked);
    writeFileSync(TODAY, md);
    return 'unchecked';
  }
  return false;
}

function deleteTask(taskText) {
  if (!existsSync(TODAY)) return false;
  let md = readFileSync(TODAY, 'utf8');
  for (const prefix of ['- [ ] ', '- [x] ']) {
    const line = prefix + taskText;
    if (md.includes(line)) {
      md = md.replace(line + '\n', '');
      md = md.replace(/\n{3,}/g, '\n\n');
      writeFileSync(TODAY, md);
      return true;
    }
  }
  return false;
}

function addTask(taskText, sectionName) {
  if (!existsSync(TODAY)) return false;
  const lines = readFileSync(TODAY, 'utf8').split('\n');
  let sectionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^## /) && lines[i].toLowerCase().includes(sectionName.toLowerCase())) {
      sectionIdx = i;
      break;
    }
  }
  if (sectionIdx === -1) return false;
  let insertIdx = sectionIdx + 1;
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^## /) || lines[i].match(/^# /)) break;
    if (lines[i].match(/^- /)) insertIdx = i + 1;
  }
  lines.splice(insertIdx, 0, '- [ ] ' + taskText);
  writeFileSync(TODAY, lines.join('\n'));
  return true;
}

function editTask(oldText, newText) {
  if (!existsSync(TODAY)) return false;
  let md = readFileSync(TODAY, 'utf8');
  for (const prefix of ['- [ ] ', '- [x] ']) {
    const oldLine = prefix + oldText;
    if (md.includes(oldLine)) {
      md = md.replace(oldLine, prefix + newText);
      writeFileSync(TODAY, md);
      return true;
    }
  }
  return false;
}

function reorderSection(sectionName, orderedTasks) {
  if (!existsSync(TODAY)) return false;
  const lines = readFileSync(TODAY, 'utf8').split('\n');
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const sec = lines[i].match(/^## (.+)$/);
    if (start === -1 && sec && sec[1].toLowerCase().includes(sectionName.toLowerCase())) {
      start = i;
    } else if (start >= 0 && i > start && (lines[i].match(/^## /) || lines[i].match(/^# /))) {
      end = i;
      break;
    }
  }
  if (start === -1) return false;
  const header = lines[start];
  const nonTaskLines = [];
  for (let i = start + 1; i < end; i++) {
    if (!lines[i].match(/^- \[[ x]\] /)) nonTaskLines.push(lines[i]);
  }
  const taskLines = orderedTasks.map(t => '- [' + (t.checked ? 'x' : ' ') + '] ' + t.text);
  lines.splice(start, end - start, header, ...taskLines, ...nonTaskLines);
  writeFileSync(TODAY, lines.join('\n'));
  return true;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Think&gt;Done — Today</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Patrick+Hand&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Patrick Hand', cursive;
    background: #f4efe6;
    color: #3a3226;
    min-height: 100vh;
    background-image:
      repeating-linear-gradient(transparent, transparent 31px, #d5cec3 31px, #d5cec3 32px);
    background-position: 0 140px;
  }

  .page {
    max-width: 520px;
    margin: 0 auto;
    padding: 1.2rem 2rem 2rem;
    min-height: 100vh;
    border-left: 2px solid #e8c4c4;
    border-right: 1px solid #ddd5c8;
    background: rgba(255,253,248,0.5);
  }

  .brand {
    text-align: center;
    padding: 0.8rem 0 0.4rem;
    border-bottom: 2px solid #c4b5a0;
    margin-bottom: 0.3rem;
  }
  .brand h1 {
    font-family: 'Caveat', cursive;
    font-weight: 700;
    font-size: 2.2rem;
    color: #5a4a3a;
  }
  .brand h1 .arrow { color: #b8860b; }
  .brand .quote {
    font-family: 'Caveat', cursive;
    font-size: 1rem;
    color: #8a7a6a;
    font-style: italic;
    margin-top: 0.15rem;
    min-height: 1.3em;
    transition: opacity 0.4s;
  }

  .date {
    font-family: 'Inter', sans-serif;
    font-size: 0.7rem;
    color: #a09080;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin: 0.6rem 0 0.3rem;
    text-align: right;
  }

  .section-group { margin-bottom: 0.2rem; }
  .section-header {
    font-family: 'Caveat', cursive;
    font-size: 1.15rem;
    font-weight: 600;
    color: #7a6a5a;
    margin: 0.6rem 0 0.15rem;
    padding-left: 2px;
  }
  .section-header.priorities { color: #8b4513; }
  .section-header.blockers { color: #b44; }
  .section-header.commitments { color: #6a5acd; }
  .section-header.watch { color: #888; }

  .sep { border: none; border-top: 1px dashed #c4b5a0; margin: 0.4rem 0; }

  .task-list { position: relative; }

  .task {
    display: flex;
    align-items: center;
    padding: 3px 4px;
    border-radius: 3px;
    transition: background 0.15s, box-shadow 0.15s;
    line-height: 1.55;
    font-size: 1.05rem;
    position: relative;
  }
  .task:hover { background: rgba(180,160,130,0.10); }

  .drag-handle {
    cursor: grab;
    opacity: 0;
    transition: opacity 0.15s;
    color: #c4b5a0;
    font-size: 0.75rem;
    margin-right: 4px;
    user-select: none;
    flex-shrink: 0;
    padding: 2px;
    line-height: 1;
  }
  .task:hover .drag-handle { opacity: 0.5; }
  .drag-handle:hover { opacity: 1 !important; color: #8b4513; }
  .drag-handle:active { cursor: grabbing; }

  .task input[type="checkbox"] {
    appearance: none; -webkit-appearance: none;
    width: 16px; height: 16px;
    border: 1.5px solid #a09080;
    border-radius: 2px;
    margin: 0 8px 0 0;
    cursor: pointer;
    flex-shrink: 0;
    position: relative;
    background: transparent;
    transition: border-color 0.2s;
  }
  .task input[type="checkbox"]:checked { border-color: #8a7; }
  .task input[type="checkbox"]:checked::after {
    content: '\\2713';
    position: absolute;
    top: -2px; left: 1px;
    font-size: 14px;
    color: #6a8a5a;
    font-weight: bold;
  }

  .task-label {
    cursor: default;
    flex: 1;
    min-width: 0;
    padding: 1px 0;
  }
  .task[data-task] .task-label { cursor: text; }
  .task.done .task-label {
    text-decoration: line-through;
    color: #b0a898;
  }

  .delete-btn {
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
    cursor: pointer;
    color: #c4b5a0;
    font-size: 0.85rem;
    margin-left: 8px;
    padding: 2px 6px;
    border-radius: 2px;
    flex-shrink: 0;
    line-height: 1;
  }
  .task:hover .delete-btn { opacity: 0.4; }
  .delete-btn:hover { opacity: 1 !important; color: #b44; background: rgba(180,60,60,0.08); }

  .edit-input {
    font-family: 'Patrick Hand', cursive;
    font-size: 1.05rem;
    border: none;
    border-bottom: 1.5px dashed #8b4513;
    background: rgba(139,69,19,0.04);
    outline: none;
    flex: 1;
    padding: 1px 2px;
    color: #3a3226;
    min-width: 0;
  }

  .add-wrap {
    padding: 4px 0 2px 42px;
    opacity: 0.4;
    transition: opacity 0.2s;
  }
  .add-wrap:focus-within { opacity: 1; }
  .add-input {
    font-family: 'Patrick Hand', cursive;
    font-size: 0.95rem;
    border: none;
    border-bottom: 1px dashed transparent;
    background: transparent;
    outline: none;
    width: 100%;
    color: #8a7a6a;
    padding: 2px 0;
    transition: border-color 0.2s, color 0.2s;
  }
  .add-input:focus { border-bottom-color: #c4b5a0; color: #3a3226; }
  .add-input::placeholder { color: #c4b5a0; }

  .priority-num {
    font-family: 'Caveat', cursive;
    font-weight: 700;
    font-size: 1.1rem;
    color: #8b4513;
    width: 22px;
    flex-shrink: 0;
  }

  .note {
    padding: 2px 0 2px 42px;
    font-size: 0.95rem;
    color: #6a5a4a;
    line-height: 1.5;
    position: relative;
  }
  .note::before {
    content: '\\2022';
    position: absolute;
    left: 28px;
    color: #b0a090;
  }

  .footer {
    font-family: 'Inter', sans-serif;
    font-size: 0.65rem;
    color: #b8a898;
    text-align: center;
    margin-top: 1.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #ddd5c8;
  }

  /* Animations */
  @keyframes completeFlash {
    0% { background: rgba(106,138,90,0.35); }
    100% { background: transparent; }
  }
  .task-completing { animation: completeFlash 0.6s ease-out; }

  @keyframes slideOut {
    0% { transform: translateX(0); opacity: 1; max-height: 40px; }
    60% { transform: translateX(60px); opacity: 0; max-height: 40px; }
    100% { transform: translateX(60px); opacity: 0; max-height: 0; padding: 0; margin: 0; }
  }
  .task-removing { animation: slideOut 0.35s ease-in forwards; overflow: hidden; }

  @keyframes slideIn {
    from { transform: translateX(-20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  .task-adding { animation: slideIn 0.3s ease-out; }

  /* FLIP transition helper */
  .task-moving { transition: transform 0.35s cubic-bezier(0.2, 0, 0, 1); }

  /* Drag states */
  .task.dragging { opacity: 0.25; }
  .task.drag-over-above { box-shadow: 0 -2px 0 0 #8b4513; }
  .task.drag-over-below { box-shadow: 0 2px 0 0 #8b4513; }

  .empty {
    font-family: 'Caveat', cursive;
    color: #a09080;
    font-size: 1.3rem;
    text-align: center;
    margin-top: 3rem;
  }

  strong { color: #3a3226; font-weight: 500; }
  code {
    font-family: 'Inter', sans-serif;
    background: rgba(180,160,130,0.15);
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 0.8em;
  }
</style>
</head>
<body>
<div class="page">
  <div class="brand">
    <h1>Think<span class="arrow">&gt;</span>Done</h1>
    <div class="quote" id="quote"></div>
  </div>
  <div id="plan"><p class="empty">Start a planning meeting to begin your day.</p></div>
  <div class="footer" id="ts"></div>
</div>
<script>
// ─── QUOTES ───
var QUOTES = [
  "Done is the engine of more.",
  "Finished is better than perfect.",
  "Small steps still move you forward.",
  "What gets scheduled gets done.",
  "Progress, not perfection.",
  "Today\\u2019s priorities shape tomorrow\\u2019s possibilities.",
  "The best plan is the one you actually follow.",
  "Clarity precedes action.",
  "Less deciding, more doing.",
  "Your future self will thank you.",
  "Focus is saying no to good ideas.",
  "Action cures anxiety.",
  "Ship it. Then improve it.",
  "One thing at a time. Most important thing first.",
  "Think strategically. Execute relentlessly."
];
var qi = Math.floor(Math.random() * QUOTES.length);
document.getElementById('quote').textContent = '\\u201C' + QUOTES[qi] + '\\u201D';
setInterval(function() {
  var el = document.getElementById('quote');
  el.style.opacity = '0';
  setTimeout(function() {
    qi = (qi + 1) % QUOTES.length;
    el.textContent = '\\u201C' + QUOTES[qi] + '\\u201D';
    el.style.opacity = '1';
  }, 400);
}, 12000);

// ─── SOUND ───
var audioCtx = null;
function playComplete() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var ctx = audioCtx;
    var now = ctx.currentTime;
    // Ascending celebration chime
    var notes = [523.25, 659.25, 783.99, 1046.50];
    for (var i = 0; i < notes.length; i++) {
      (function(freq, idx) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + idx * 0.07);
        gain.gain.linearRampToValueAtTime(0.1, now + idx * 0.07 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + 1.5);
      })(notes[i], i);
    }
    // Brief noise burst (light applause texture)
    var len = Math.floor(ctx.sampleRate * 0.25);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var j = 0; j < len; j++) d[j] = (Math.random() * 2 - 1);
    var noise = ctx.createBufferSource();
    noise.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 0.7;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(0.025, now + 0.04);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    noise.connect(bp); bp.connect(ng); ng.connect(ctx.destination);
    noise.start(now); noise.stop(now + 0.3);
  } catch(e) {}
}

// ─── HELPERS ───
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function inlinemd(s) {
  return esc(s)
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\\`(.+?)\\\`/g, '<code>$1</code>');
}

// ─── STATE ───
var busy = false;
var lastMd = '';

// ─── API ───
function api(endpoint, data) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data)
  }).then(function(r) { return r.json(); });
}

// ─── PARSE ───
function parseMd(md) {
  var lines = md.split('\\n');
  var data = { date: '', sections: [] };
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var titleMatch = line.match(/^# .+ \\u2014 (.+)$/);
    if (titleMatch) { data.date = titleMatch[1]; continue; }
    var secMatch = line.match(/^## (.+)$/);
    if (secMatch) { current = { name: secMatch[1], items: [] }; data.sections.push(current); continue; }
    if (!current) continue;
    var numMatch = line.match(/^(\\d+)\\. (.+)$/);
    if (numMatch) { current.items.push({ type: 'numbered', num: numMatch[1], text: numMatch[2] }); continue; }
    var checkedMatch = line.match(/^- \\[x\\] (.+)$/);
    if (checkedMatch) { current.items.push({ type: 'task', text: checkedMatch[1], checked: true }); continue; }
    var uncheckedMatch = line.match(/^- \\[ \\] (.+)$/);
    if (uncheckedMatch) { current.items.push({ type: 'task', text: uncheckedMatch[1], checked: false }); continue; }
    var bulletMatch = line.match(/^- (.+)$/);
    if (bulletMatch) { current.items.push({ type: 'bullet', text: bulletMatch[1] }); continue; }
  }
  return data;
}

function sectionClass(name) {
  var s = name.toLowerCase();
  if (s.indexOf('priorit') >= 0) return 'priorities';
  if (s.indexOf('blocker') >= 0) return 'blockers';
  if (s.indexOf('commit') >= 0) return 'commitments';
  if (s.indexOf('watch') >= 0) return 'watch';
  return '';
}

// ─── RENDER ───
function renderData(data) {
  var plan = document.getElementById('plan');
  if (!data.sections.length) {
    plan.innerHTML = '<p class="empty">Start a planning meeting to begin your day.</p>';
    return;
  }
  var html = '';
  if (data.date) html += '<div class="date">' + esc(data.date) + '</div>';

  for (var si = 0; si < data.sections.length; si++) {
    var sec = data.sections[si];
    if (si > 0) html += '<hr class="sep">';
    var cls = sectionClass(sec.name);
    var hasTasks = false;
    for (var j = 0; j < sec.items.length; j++) { if (sec.items[j].type === 'task') { hasTasks = true; break; } }

    html += '<div class="section-group" data-section="' + escAttr(sec.name) + '">';
    html += '<div class="section-header ' + cls + '">' + esc(sec.name) + '</div>';

    if (hasTasks) {
      // Sort: completed tasks first (grayed at top), then pending
      var checked = [], unchecked = [];
      for (var k = 0; k < sec.items.length; k++) {
        var item = sec.items[k];
        if (item.type === 'task' && item.checked) checked.push(item);
        else unchecked.push(item);
      }
      var sorted = checked.concat(unchecked);

      html += '<div class="task-list" data-section="' + escAttr(sec.name) + '">';
      for (var m = 0; m < sorted.length; m++) {
        var it = sorted[m];
        if (it.type === 'task') {
          var doneClass = it.checked ? ' done' : '';
          html += '<div class="task' + doneClass + '" draggable="true" data-task="' + escAttr(it.text) + '" data-checked="' + it.checked + '">';
          html += '<span class="drag-handle" title="Drag to reorder">\\u2807</span>';
          html += '<input type="checkbox"' + (it.checked ? ' checked' : '') + ' data-task="' + escAttr(it.text) + '">';
          html += '<span class="task-label" data-task="' + escAttr(it.text) + '">' + inlinemd(it.text) + '</span>';
          html += '<span class="delete-btn" data-delete="' + escAttr(it.text) + '" title="Delete">\\u00D7</span>';
          html += '</div>';
        } else if (it.type === 'numbered') {
          html += '<div class="task"><span class="priority-num">' + it.num + '.</span><span class="task-label">' + inlinemd(it.text) + '</span></div>';
        } else if (it.type === 'bullet') {
          html += '<div class="note">' + inlinemd(it.text) + '</div>';
        }
      }
      html += '</div>';
      html += '<div class="add-wrap"><input class="add-input" placeholder="Add a task\\u2026" data-section="' + escAttr(sec.name) + '"></div>';
    } else {
      for (var n = 0; n < sec.items.length; n++) {
        var bi = sec.items[n];
        if (bi.type === 'numbered') {
          html += '<div class="task"><span class="priority-num">' + bi.num + '.</span><span class="task-label">' + inlinemd(bi.text) + '</span></div>';
        } else {
          html += '<div class="note">' + inlinemd(bi.text) + '</div>';
        }
      }
    }
    html += '</div>';
  }
  plan.innerHTML = html;
}

// ─── INTERACTIONS (Event Delegation) ───
var plan = document.getElementById('plan');

// Toggle checkbox
plan.addEventListener('change', function(e) {
  if (!e.target.matches('input[type="checkbox"]')) return;
  var text = e.target.getAttribute('data-task');
  if (!text) return;
  busy = true;
  var task = e.target.closest('.task');
  api('/toggle', { task: text }).then(function(res) {
    if (res.result === 'checked') {
      task.classList.add('task-completing');
      playComplete();
    }
    setTimeout(function() { lastMd = ''; load().then(function() { busy = false; }); },
      res.result === 'checked' ? 600 : 200);
  });
});

// Delete
plan.addEventListener('click', function(e) {
  var btn = e.target.closest('.delete-btn');
  if (!btn) return;
  var text = btn.getAttribute('data-delete');
  if (!text) return;
  busy = true;
  var task = btn.closest('.task');
  task.classList.add('task-removing');
  api('/delete', { task: text });
  setTimeout(function() { lastMd = ''; load().then(function() { busy = false; }); }, 350);
});

// Inline edit on double-click
plan.addEventListener('dblclick', function(e) {
  var label = e.target.closest('.task-label[data-task]');
  if (!label) return;
  var oldText = label.getAttribute('data-task');
  busy = true;

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input';
  input.value = oldText;
  label.replaceWith(input);
  input.focus();
  input.select();

  var saved = false;
  function save() {
    if (saved) return;
    saved = true;
    var newText = input.value.trim();
    var promise = (newText && newText !== oldText)
      ? api('/edit', { oldTask: oldText, newTask: newText })
      : Promise.resolve();
    promise.then(function() { lastMd = ''; return load(); }).then(function() { busy = false; });
  }
  input.addEventListener('blur', save);
  input.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
    if (ev.key === 'Escape') { input.value = oldText; input.blur(); }
  });
});

// Add task on Enter
plan.addEventListener('keydown', function(e) {
  if (!e.target.matches('.add-input') || e.key !== 'Enter') return;
  var input = e.target;
  var text = input.value.trim();
  if (!text) return;
  busy = true;
  var section = input.getAttribute('data-section');
  api('/add', { task: text, section: section }).then(function() {
    input.value = '';
    lastMd = '';
    return load();
  }).then(function() {
    // Flash the new task
    var tasks = plan.querySelectorAll('.task[data-task="' + CSS.escape(text) + '"]');
    if (tasks.length) tasks[tasks.length - 1].classList.add('task-adding');
    busy = false;
  });
});

// ─── DRAG AND DROP ───
var dragEl = null;
var dragList = null;

plan.addEventListener('dragstart', function(e) {
  if (!e.target.closest('.drag-handle')) { e.preventDefault(); return; }
  var task = e.target.closest('.task[draggable]');
  if (!task) { e.preventDefault(); return; }
  dragEl = task;
  dragList = task.closest('.task-list');
  task.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
});

plan.addEventListener('dragend', function() {
  if (dragEl) dragEl.classList.remove('dragging');
  var overs = plan.querySelectorAll('.drag-over-above,.drag-over-below');
  for (var i = 0; i < overs.length; i++) overs[i].classList.remove('drag-over-above', 'drag-over-below');
  dragEl = null;
  dragList = null;
});

plan.addEventListener('dragover', function(e) {
  var task = e.target.closest('.task[draggable]');
  if (!task || !dragEl || task === dragEl) return;
  if (task.closest('.task-list') !== dragList) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var overs = plan.querySelectorAll('.drag-over-above,.drag-over-below');
  for (var i = 0; i < overs.length; i++) overs[i].classList.remove('drag-over-above', 'drag-over-below');
  var rect = task.getBoundingClientRect();
  var mid = rect.top + rect.height / 2;
  task.classList.add(e.clientY < mid ? 'drag-over-above' : 'drag-over-below');
});

plan.addEventListener('drop', function(e) {
  e.preventDefault();
  var target = e.target.closest('.task[draggable]');
  if (!target || !dragEl || target === dragEl) return;
  if (target.closest('.task-list') !== dragList) return;
  busy = true;
  var rect = target.getBoundingClientRect();
  var before = e.clientY < rect.top + rect.height / 2;
  if (before) dragList.insertBefore(dragEl, target);
  else dragList.insertBefore(dragEl, target.nextSibling);

  var section = dragList.getAttribute('data-section');
  var items = dragList.querySelectorAll('.task[draggable]');
  var tasks = [];
  for (var i = 0; i < items.length; i++) {
    tasks.push({ text: items[i].getAttribute('data-task'), checked: items[i].getAttribute('data-checked') === 'true' });
  }
  api('/reorder', { section: section, tasks: tasks }).then(function() {
    lastMd = '';
    return load();
  }).then(function() { busy = false; });
});

// ─── POLLING ───
function load() {
  if (busy) return Promise.resolve();
  return fetch('/today.md').then(function(r) {
    if (!r.ok) {
      document.getElementById('plan').innerHTML = '<p class="empty">Start a planning meeting to begin your day.</p>';
      return;
    }
    return r.text().then(function(md) {
      if (md !== lastMd) {
        lastMd = md;
        renderData(parseMd(md));
      }
      document.getElementById('ts').textContent = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    });
  }).catch(function() {});
}

load();
setInterval(load, 3000);
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  if (req.method === 'POST') {
    const body = await readBody(req);
    try {
      const data = JSON.parse(body);
      let result;
      switch (req.url) {
        case '/toggle': result = toggleTask(data.task); break;
        case '/add': result = addTask(data.task, data.section); break;
        case '/delete': result = deleteTask(data.task); break;
        case '/edit': result = editTask(data.oldTask, data.newTask); break;
        case '/reorder': result = reorderSection(data.section, data.tasks); break;
        default: res.writeHead(404); res.end('{}'); return;
      }
      res.writeHead(result ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: !!result, result }));
    } catch {
      res.writeHead(400);
      res.end('{}');
    }
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
  console.log('Think>Done planner: http://localhost:' + PORT);
  console.log('Watching: ' + TODAY);
});
