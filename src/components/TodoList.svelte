<script>
  import { onMount, onDestroy } from 'svelte';

  let tasks = [];
  let date = '';
  let busy = false;
  let editIdx = -1;
  let editVal = '';
  let newTask = '';
  let dragIdx = -1;
  let overIdx = -1;
  let menuIdx = -1;
  let menuTimer = null;
  let audioCtx = null;
  let poll;

  const WORK_HOURS = 8;

  function parseTask(text) {
    // Extract time estimate: ~15m or ~1.5h at end or before project tag
    let minutes = 0;
    let clean = text;
    const timeMatch = text.match(/\s*~(\d+(?:\.\d+)?)(m|h)\s*/);
    if (timeMatch) {
      minutes = timeMatch[2] === 'h' ? Math.round(parseFloat(timeMatch[1]) * 60) : parseInt(timeMatch[1]);
      clean = text.replace(timeMatch[0], ' ').trim();
    }
    // Extract project tag
    const projMatch = clean.match(/^(.+?)\s+[—–]\s+(\S+)$/);
    const label = projMatch ? projMatch[1] : clean;
    const project = projMatch ? projMatch[2] : '';
    return { label, project, minutes };
  }

  function formatTime(mins) {
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h}h${m}m` : `${h}h`;
    }
    return `${mins}m`;
  }

  // Calculate where the "day ends" line falls
  function dayEndIndex(taskList) {
    let total = 0;
    const limit = WORK_HOURS * 60;
    for (let i = 0; i < taskList.length; i++) {
      if (taskList[i].checked) continue;
      const p = parseTask(taskList[i].text);
      total += p.minutes || 15; // default 15m if no estimate
      if (total > limit) return i;
    }
    return -1; // all tasks fit
  }

  async function fetchTasks() {
    if (busy) return;
    try {
      const r = await fetch('/api/tasks');
      const d = await r.json();
      if (!busy) { tasks = d.tasks; date = d.date; }
    } catch {}
  }

  async function api(action, data = {}) {
    const r = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data }),
    });
    return r.json();
  }

  async function toggle(text) {
    busy = true;
    menuIdx = -1;
    const r = await api('toggle', { task: text });
    if (r.result === 'checked') playComplete();
    await fetchTasks();
    busy = false;
  }

  async function add() {
    const t = newTask.trim();
    if (!t) return;
    busy = true;
    await api('add', { task: t });
    newTask = '';
    await fetchTasks();
    busy = false;
  }

  async function del(text) {
    busy = true;
    menuIdx = -1;
    await api('delete', { task: text });
    await fetchTasks();
    busy = false;
  }

  function startEdit(i, text) {
    menuIdx = -1;
    editIdx = i;
    editVal = text;
    setTimeout(() => {
      const input = document.querySelector('.edit-input');
      if (input) { input.focus(); input.select(); }
    }, 10);
  }

  async function saveEdit(oldText) {
    const newText = editVal.trim();
    editIdx = -1;
    if (!newText || newText === oldText) return;
    busy = true;
    await api('edit', { oldTask: oldText, newTask: newText });
    await fetchTasks();
    busy = false;
  }

  function toggleMenu(i) {
    clearTimeout(menuTimer);
    menuIdx = menuIdx === i ? -1 : i;
  }

  function startMenuDismiss() {
    menuTimer = setTimeout(() => { menuIdx = -1; }, 2000);
  }

  function cancelMenuDismiss() {
    clearTimeout(menuTimer);
  }

  function onDragStart(e, i) {
    menuIdx = -1;
    dragIdx = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  }

  function onDragOver(e, i) {
    if (dragIdx < 0 || dragIdx === i) return;
    e.preventDefault();
    overIdx = i;
  }

  function onDragEnd() { dragIdx = -1; overIdx = -1; }

  async function onDrop(e, targetIdx) {
    e.preventDefault();
    if (dragIdx < 0 || dragIdx === targetIdx) return;
    busy = true;
    const arr = [...tasks];
    const [item] = arr.splice(dragIdx, 1);
    arr.splice(targetIdx, 0, item);
    dragIdx = -1;
    overIdx = -1;
    tasks = arr;
    await api('reorder', { tasks: arr });
    await fetchTasks();
    busy = false;
  }

  function playComplete() {
    try {
      if (!audioCtx) audioCtx = new AudioContext();
      const now = audioCtx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.07);
        gain.gain.linearRampToValueAtTime(0.1, now + i * 0.07 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + i * 0.07);
        osc.stop(now + 1.5);
      });
      const len = Math.floor(audioCtx.sampleRate * 0.25);
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < len; j++) d[j] = Math.random() * 2 - 1;
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 0.7;
      const ng = audioCtx.createGain();
      ng.gain.setValueAtTime(0, now);
      ng.gain.linearRampToValueAtTime(0.025, now + 0.04);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      noise.connect(bp); bp.connect(ng); ng.connect(audioCtx.destination);
      noise.start(now); noise.stop(now + 0.3);
    } catch {}
  }

  // Close menu on outside click
  function onWindowClick(e) {
    if (menuIdx >= 0 && !e.target.closest('.menu-wrap')) {
      menuIdx = -1;
    }
  }

  onMount(() => {
    fetchTasks();
    poll = setInterval(fetchTasks, 3000);
    window.addEventListener('click', onWindowClick);
  });

  onDestroy(() => {
    clearInterval(poll);
    if (typeof window !== 'undefined') window.removeEventListener('click', onWindowClick);
  });

  $: cutoffIdx = dayEndIndex(tasks);
</script>

{#if date}
  <div class="date">{date}</div>
{/if}

{#if tasks.length === 0}
  <p class="empty">Start a planning meeting to begin your day.</p>
{:else}
  <div class="task-list">
    {#each tasks as task, i (task.text)}
      {@const parsed = parseTask(task.text)}
      {#if i === cutoffIdx && cutoffIdx > 0}
        <div class="day-end-line">
          <span class="day-end-label">~{WORK_HOURS}h day ends here</span>
        </div>
      {/if}
      <div
        class="task"
        class:done={task.checked}
        class:dragging={dragIdx === i}
        class:drag-over={overIdx === i}
        class:past-cutoff={cutoffIdx >= 0 && i >= cutoffIdx && !task.checked}
        draggable={editIdx !== i}
        on:dragstart={(e) => onDragStart(e, i)}
        on:dragover={(e) => onDragOver(e, i)}
        on:dragleave={() => overIdx = -1}
        on:dragend={onDragEnd}
        on:drop={(e) => onDrop(e, i)}
      >
        <input
          type="checkbox"
          checked={task.checked}
          on:change={() => toggle(task.text)}
        />
        {#if editIdx === i}
          <div class="edit-card">
            <input
              class="edit-input"
              type="text"
              bind:value={editVal}
              on:blur={() => saveEdit(task.text)}
              on:keydown={(e) => {
                if (e.key === 'Enter') saveEdit(task.text);
                if (e.key === 'Escape') editIdx = -1;
              }}
            />
            <div class="edit-actions">
              <button class="edit-card-btn save-btn" on:mousedown|preventDefault={() => saveEdit(task.text)}>Save</button>
              <button class="edit-card-btn cancel-btn" on:mousedown|preventDefault={() => { editIdx = -1; }}>Cancel</button>
              <button class="edit-card-btn del-btn" on:mousedown|preventDefault={() => del(task.text)}>Delete</button>
            </div>
          </div>
        {:else}
          <span
            class="task-label"
            on:dblclick={() => startEdit(i, task.text)}
          >
            {parsed.label}
            {#if parsed.minutes}
              <span class="time-tag">{formatTime(parsed.minutes)}</span>
            {/if}
            {#if parsed.project}
              <span class="project-tag">{parsed.project}</span>
            {/if}
          </span>
          <div class="menu-wrap" on:mouseenter={cancelMenuDismiss} on:mouseleave={startMenuDismiss}>
            <button class="menu-btn" on:click|stopPropagation={() => toggleMenu(i)} title="Options">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>
            </button>
            {#if menuIdx === i}
              <div class="menu-popup">
                <button class="menu-item" on:click|stopPropagation={() => startEdit(i, task.text)}>
                  <span class="mi-icon">&#9998;</span> Edit
                </button>
                <button class="menu-item menu-item-danger" on:click|stopPropagation={() => del(task.text)}>
                  <span class="mi-icon">&times;</span> Delete
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<div class="add-wrap">
  <input
    class="add-input"
    type="text"
    placeholder="Add a task…"
    bind:value={newTask}
    on:keydown={(e) => { if (e.key === 'Enter') add(); }}
  />
</div>

<style>
  .date {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-ink-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin: 0.4rem 0 0.3rem;
    text-align: right;
  }

  .task {
    display: flex;
    align-items: flex-start;
    padding: 5px 6px;
    border-radius: 5px;
    border: 1px solid transparent;
    transition: background 0.15s, box-shadow 0.2s, border-color 0.15s, opacity 0.2s, transform 0.15s;
    line-height: 1.5;
    font-size: 1.05rem;
    cursor: grab;
    position: relative;
  }
  .task:hover {
    background: var(--color-paper-bright);
    border-color: var(--color-ink-faint);
    box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06);
    transform: translateY(-1px);
  }
  .task:active { cursor: grabbing; transform: translateY(0); }
  .task.dragging { opacity: 0.25; transform: scale(0.98); }
  .task.drag-over { border-top: 2px solid var(--color-accent); }
  .task.past-cutoff { opacity: 0.45; }

  .task input[type="checkbox"] {
    appearance: none; -webkit-appearance: none;
    width: 16px; height: 16px;
    border: 1.5px solid var(--color-ink-muted);
    border-radius: 2px;
    margin: 6px 6px 0 0;
    cursor: pointer;
    flex-shrink: 0;
    position: relative;
    background: var(--color-paper-bright, #fffdf8);
    transition: border-color 0.2s, background 0.2s;
  }
  .task input[type="checkbox"]:checked { border-color: var(--color-check); background: var(--color-paper-bright, #fffdf8); }
  .task input[type="checkbox"]:checked::after {
    content: '\2713';
    position: absolute;
    top: -2px; left: 1px;
    font-size: 14px;
    color: var(--color-success);
    font-weight: bold;
  }

  .task-label {
    cursor: inherit;
    flex: 1;
    min-width: 0;
    padding: 2px 0;
    text-shadow:
      0 0 4px var(--color-paper, #f4efe6),
      0 0 8px var(--color-paper, #f4efe6),
      1px 0 3px var(--color-paper, #f4efe6),
      -1px 0 3px var(--color-paper, #f4efe6);
  }
  .task.done .task-label {
    text-decoration: line-through;
    color: var(--color-done);
  }

  .project-tag {
    display: inline-block;
    font-family: var(--font-ui);
    font-size: 0.6rem;
    color: var(--color-ink-muted);
    background: var(--color-tag-bg);
    padding: 0 5px;
    border-radius: 3px;
    margin-left: 6px;
    vertical-align: middle;
    text-transform: lowercase;
    letter-spacing: 0.5px;
  }
  .task.done .project-tag { opacity: 0.5; }

  .time-tag {
    display: inline-block;
    font-family: var(--font-ui);
    font-size: 0.6rem;
    color: var(--color-gold);
    background: oklch(0.85 0.06 85 / 0.2);
    padding: 0 4px;
    border-radius: 3px;
    margin-left: 4px;
    vertical-align: middle;
    letter-spacing: 0.3px;
  }
  .task.done .time-tag { opacity: 0.4; }

  /* Hamburger menu */
  .menu-wrap {
    position: relative;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .menu-btn {
    opacity: 0;
    cursor: pointer;
    color: var(--color-ink-muted);
    background: none;
    border: none;
    padding: 4px 6px;
    border-radius: 3px;
    transition: opacity 0.15s, background 0.15s;
    display: flex;
    align-items: center;
  }
  .task:hover .menu-btn { opacity: 0.6; }
  .menu-btn:hover { opacity: 1 !important; background: var(--color-hover); }

  .menu-popup {
    position: absolute;
    right: 0;
    top: 100%;
    background: var(--color-paper-bright);
    border: 1px solid var(--color-ink-faint);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08);
    z-index: 100;
    min-width: 120px;
    padding: 4px 0;
    animation: menuFade 0.12s ease-out;
  }
  @keyframes menuFade {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 14px;
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: 0.8rem;
    color: var(--color-ink);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }
  .menu-item:hover { background: var(--color-hover); }
  .menu-item-danger:hover { color: var(--color-danger); }
  .mi-icon { font-size: 1rem; width: 18px; text-align: center; }

  /* Edit card */
  .edit-card {
    flex: 1;
    min-width: 0;
    background: var(--color-paper-bright);
    border: 1px solid var(--color-accent);
    border-radius: 5px;
    padding: 4px 8px 6px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .edit-input {
    font-family: var(--font-hand);
    font-size: 1.05rem;
    border: none;
    background: transparent;
    outline: none;
    width: 100%;
    padding: 2px 0;
    color: var(--color-ink);
  }
  .edit-actions {
    display: flex;
    gap: 6px;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px dashed var(--color-ink-faint);
  }
  .edit-card-btn {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    padding: 3px 10px;
    border: 1px solid var(--color-ink-faint);
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    color: var(--color-ink-muted);
    transition: all 0.15s;
  }
  .save-btn:hover { background: var(--color-accent); color: white; border-color: var(--color-accent); }
  .cancel-btn:hover { background: var(--color-hover); }
  .del-btn { margin-left: auto; }
  .del-btn:hover { background: var(--color-danger); color: white; border-color: var(--color-danger); }

  /* Day end line */
  .day-end-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0;
    padding: 0 4px;
  }
  .day-end-line::before,
  .day-end-line::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-danger);
    opacity: 0.5;
  }
  .day-end-label {
    font-family: var(--font-ui);
    font-size: 0.6rem;
    color: var(--color-danger);
    text-transform: uppercase;
    letter-spacing: 1px;
    white-space: nowrap;
    opacity: 0.7;
  }

  .add-wrap {
    padding: 8px 0 2px 28px;
    opacity: 0.4;
    transition: opacity 0.2s;
  }
  .add-wrap:focus-within { opacity: 1; }
  .add-input {
    font-family: var(--font-hand);
    font-size: 0.95rem;
    border: none;
    border-bottom: 1px dashed transparent;
    background: transparent;
    outline: none;
    width: 100%;
    color: var(--color-ink-muted);
    padding: 2px 0;
    transition: border-color 0.2s, color 0.2s;
  }
  .add-input:focus { border-bottom-color: var(--color-ink-faint); color: var(--color-ink); }
  .add-input::placeholder { color: var(--color-ink-faint); }

  .empty {
    font-family: var(--font-display);
    color: var(--color-ink-muted);
    font-size: 1.3rem;
    text-align: center;
    margin-top: 2rem;
  }
</style>
