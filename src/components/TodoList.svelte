<svelte:options runes={false} />

<script>
  import { onMount, onDestroy } from 'svelte';
  import { flip } from 'svelte/animate';
  import { playApplause, playClick, playDrop, playPoof } from '../lib/sounds.js';
  import { getDb, ensureSchema, getTasks, addTask as dbAddTask, toggleTask as dbToggleTask, deleteTask as dbDeleteTask, editTask as dbEditTask, reorderTasks as dbReorderTasks } from '../lib/db.js';
  export let userName = '';
  let tasks = [];
  let date = '';
  let loading = true;
  let db = null;
  let busy = false;
  let editIdx = -1;
  let editVal = '';
  let editMins = '';
  let editProject = '';
  let newTask = '';
  let newMins = '';
  let newProject = '';
  let newCustomProject = '';
  let showAdd = false;
  let dragIdx = -1;
  let menuIdx = -1;
  let menuTimer = null;
  let deletingId = null;
  let justAddedId = null;
  let infoIdx = -1;
  let undoTask = null;
  let undoTimer = null;
  let swipeX = 0;
  let swipeIdx = -1;
  let swipeDelta = 0;
  const WORK_HOURS = 8;
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
  function todayDisplay() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function parseTask(text) {
    let minutes = 0;
    let clean = text;
    const timeMatch = text.match(/\s*~(\d+(?:\.\d+)?)(m|h)\s*/);
    if (timeMatch) {
      minutes = timeMatch[2] === 'h' ? Math.round(parseFloat(timeMatch[1]) * 60) : parseInt(timeMatch[1]);
      clean = text.replace(timeMatch[0], ' ').trim();
    }
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
  function dayBreaks(taskList) {
    let total = 0;
    const limit = WORK_HOURS * 60;
    const breaks = {};
    let dayNum = 1;
    for (let i = 0; i < taskList.length; i++) {
      if (taskList[i].checked) continue;
      const p = parseTask(taskList[i].text);
      total += p.minutes || 15;
      while (total > limit * dayNum) {
        breaks[i] = dayNum;
        dayNum++;
      }
    }
    return breaks;
  }
  function dayLabel(daysFromNow) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }
  async function refreshTasks() {
    if (!db) return;
    tasks = await getTasks(db, todayStr());
    date = todayDisplay();
  }
  async function toggle(task) {
    busy = true;
    menuIdx = -1;
    const result = await dbToggleTask(db, task.id);
    if (result === 'checked') playApplause();
    else if (result === 'unchecked') playClick();
    await refreshTasks();
    busy = false;
  }
  function openAdd() {
    showAdd = true;
    newTask = '';
    newMins = '';
    newProject = '';
    newCustomProject = '';
    setTimeout(() => {
      const input = document.querySelector('.add-popup .add-text-input');
      if (input) input.focus();
    }, 10);
  }
  async function add() {
    let label = newTask.trim();
    if (!label) return;
    const mins = parseInt(newMins);
    if (mins > 0) label += ` ~${mins}m`;
    const proj = newProject === '__new__' ? newCustomProject.trim() : newProject;
    if (proj) label += ` — ${proj}`;
    busy = true;
    showAdd = false;
    const newId = await dbAddTask(db, label, { planDate: todayStr() });
    justAddedId = Number(newId);
    newTask = '';
    newMins = '';
    newProject = '';
    newCustomProject = '';
    playDrop();
    await refreshTasks();
    busy = false;
    setTimeout(() => { justAddedId = null; }, 400);
  }
  async function del(task) {
    menuIdx = -1;
    editIdx = -1;
    deletingId = task.id;
    playPoof();
    await new Promise(r => setTimeout(r, 400));
    // Remove from local list immediately but delay db delete for undo
    const removed = tasks.find(t => t.id === task.id);
    tasks = tasks.filter(t => t.id !== task.id);
    deletingId = null;
    if (!removed) return;
    // Cancel any previous undo
    if (undoTimer) { clearTimeout(undoTimer); }
    undoTask = removed;
    undoTimer = setTimeout(async () => {
      busy = true;
      await dbDeleteTask(db, removed.id);
      undoTask = null;
      undoTimer = null;
      await refreshTasks();
      busy = false;
    }, 3000);
  }
  async function undo() {
    if (!undoTask || !undoTimer) return;
    clearTimeout(undoTimer);
    const task = undoTask;
    undoTask = null;
    undoTimer = null;
    // Re-add locally (will be consistent since we never deleted from db)
    tasks = [task, ...tasks.filter(t => !t.checked), ...tasks.filter(t => t.checked)];
    playDrop();
  }
  $: projects = [...new Set(tasks.map(t => parseTask(t.text).project).filter(Boolean))].sort();
  function startEdit(i, text) {
    menuIdx = -1;
    editIdx = i;
    const p = parseTask(text);
    editMins = p.minutes ? String(p.minutes) : '';
    editProject = p.project;
    editVal = p.label;
    setTimeout(() => {
      const input = document.querySelector('.edit-input');
      if (input) { input.focus(); input.select(); }
    }, 10);
  }
  async function saveEdit(task) {
    let label = editVal.trim();
    if (!label) { editIdx = -1; return; }
    const mins = parseInt(editMins);
    let newText = label;
    if (mins > 0) newText += ` ~${mins}m`;
    if (editProject) newText += ` — ${editProject}`;
    editIdx = -1;
    if (newText === task.text) return;
    busy = true;
    await dbEditTask(db, task.id, newText);
    await refreshTasks();
    busy = false;
  }
  function toggleMenu(i) {
    clearTimeout(menuTimer);
    menuIdx = menuIdx === i ? -1 : i;
    infoIdx = -1;
  }
  let infoTimer;
  function toggleInfo(i) {
    clearTimeout(infoTimer);
    infoIdx = infoIdx === i ? -1 : i;
    menuIdx = -1;
  }
  function startInfoDismiss() {
    infoTimer = setTimeout(() => { infoIdx = -1; }, 2000);
  }
  function cancelInfoDismiss() {
    clearTimeout(infoTimer);
  }
  function startMenuDismiss() {
    menuTimer = setTimeout(() => { menuIdx = -1; }, 2000);
  }
  function cancelMenuDismiss() {
    clearTimeout(menuTimer);
  }
  // Pointer-based drag reordering (replaces HTML5 drag API)
  let dragClone = null;
  let dragOffsetY = 0;
  function onDragPointerDown(e, i) {
    if (e.button !== 0) return;
    if (e.target.closest('input, button, select, a, .edit-card, .info-popup, .menu-popup')) return;
    e.preventDefault();
    menuIdx = -1;
    infoIdx = -1;
    const wrap = e.currentTarget;
    const rect = wrap.getBoundingClientRect();
    dragOffsetY = e.clientY - rect.top;
    dragIdx = i;
    // Create floating clone
    dragClone = wrap.cloneNode(true);
    Object.assign(dragClone.style, {
      position: 'fixed',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      zIndex: '1000',
      pointerEvents: 'none',
      opacity: '0.92',
      boxShadow: '0 8px 24px rgba(139,69,19,0.2)',
      transform: 'scale(1.02)',
      borderRadius: '6px',
      background: 'var(--color-paper-bright)',
    });
    document.body.appendChild(dragClone);
    window.addEventListener('pointermove', onDragPointerMove);
    window.addEventListener('pointerup', onDragPointerUp);
  }
  function onDragPointerMove(e) {
    if (dragIdx < 0 || !dragClone) return;
    e.preventDefault();
    dragClone.style.top = (e.clientY - dragOffsetY) + 'px';
    // Find target index by comparing cursor to item midpoints
    const wraps = document.querySelectorAll('.task-wrap');
    const centerY = e.clientY;
    let targetIdx = dragIdx;
    for (let j = dragIdx - 1; j >= 0; j--) {
      const r = wraps[j].getBoundingClientRect();
      if (centerY < r.top + r.height / 2) targetIdx = j;
      else break;
    }
    if (targetIdx === dragIdx) {
      for (let j = dragIdx + 1; j < wraps.length; j++) {
        const r = wraps[j].getBoundingClientRect();
        if (centerY > r.top + r.height / 2) targetIdx = j;
        else break;
      }
    }
    if (targetIdx !== dragIdx) {
      const arr = [...tasks];
      const [item] = arr.splice(dragIdx, 1);
      arr.splice(targetIdx, 0, item);
      tasks = arr;
      dragIdx = targetIdx;
    }
  }
  async function onDragPointerUp() {
    window.removeEventListener('pointermove', onDragPointerMove);
    window.removeEventListener('pointerup', onDragPointerUp);
    if (dragClone) { dragClone.remove(); dragClone = null; }
    if (dragIdx >= 0) {
      playDrop();
      await dbReorderTasks(db, tasks.map(t => t.id));
    }
    dragIdx = -1;
  }
  // Swipe-to-complete (mobile)
  function onSwipeStart(e, i) {
    if (e.touches.length !== 1) return;
    swipeX = e.touches[0].clientX;
    swipeIdx = i;
    swipeDelta = 0;
  }
  function onSwipeMove(e) {
    if (swipeIdx < 0) return;
    swipeDelta = e.touches[0].clientX - swipeX;
    if (swipeDelta < 0) swipeDelta = 0; // only swipe right
  }
  function onSwipeEnd() {
    if (swipeIdx >= 0 && swipeDelta > 80) {
      const task = tasks[swipeIdx];
      if (task) toggle(task);
    }
    swipeIdx = -1;
    swipeDelta = 0;
  }
  function onWindowClick(e) {
    if (menuIdx >= 0 && !e.target.closest('.menu-wrap')) {
      menuIdx = -1;
    }
    if (infoIdx >= 0 && !e.target.closest('.info-wrap')) {
      infoIdx = -1;
    }
    if (editIdx >= 0 && !e.target.closest('.edit-card') && !e.target.closest('.menu-item')) {
      editIdx = -1;
    }
  }
  function onKeydown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'n' && !showAdd) { e.preventDefault(); openAdd(); }
  }
  onMount(async () => {
    db = await getDb();
    await ensureSchema(db);
    await refreshTasks();
    loading = false;
    window.addEventListener('click', onWindowClick);
    window.addEventListener('keydown', onKeydown);
  });
  onDestroy(() => {
    if (undoTimer) clearTimeout(undoTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('click', onWindowClick);
      window.removeEventListener('keydown', onKeydown);
    }
  });
  $: breaks = dayBreaks(tasks);
  $: firstBreak = Object.keys(breaks).length ? Math.min(...Object.keys(breaks).map(Number)) : -1;
  $: doneCount = tasks.filter(t => t.checked).length;
  $: totalCount = tasks.length;
  $: firstDoneIdx = tasks.findIndex(t => t.checked);
  $: nextUpIdx = tasks.findIndex(t => !t.checked);
</script>

<div style="view-transition-name: task-list">
{#if loading}
  <div class="empty" role="status" aria-label="Loading tasks"><span class="empty-icon" aria-hidden="true">&#9203;</span><p>Loading...</p></div>
{:else if date}
  <div class="date-row">
    <span class="date">{date}</span>
    {#if totalCount > 0}
      <span class="progress" aria-label="{doneCount} of {totalCount} tasks complete">{doneCount}/{totalCount}</span>
    {/if}
  </div>
{/if}

{#if !loading && tasks.length === 0}
  <div class="empty" role="status">
    <span class="empty-icon" aria-hidden="true">&#128161;</span>
    <p>Start a planning meeting to begin your day.</p>
  </div>
{:else if !loading}
  <div class="task-list" class:list-dragging={dragIdx >= 0} role="list" aria-label="Task list">
    {#each tasks as task, i (task.id)}
      {@const parsed = parseTask(task.text)}
      <div
        class="task-wrap"
        role="listitem"
        animate:flip={{ duration: 200 }}
        on:pointerdown={(e) => onDragPointerDown(e, i)}
        on:touchstart={(e) => onSwipeStart(e, i)}
        on:touchmove={onSwipeMove}
        on:touchend={onSwipeEnd}
      >
        {#if task.checked && i === firstDoneIdx && firstDoneIdx > 0}
          <div class="done-separator" role="separator" aria-label="Completed tasks">
            <span class="done-label" aria-hidden="true">completed</span>
          </div>
        {/if}
        {#if breaks[i] && !task.checked}
          <div class="day-break" role="separator" aria-label="Overflows to {dayLabel(breaks[i])}">{dayLabel(breaks[i])}</div>
        {/if}
        <div
          class="task"
          class:done={task.checked}
          class:next-up={i === nextUpIdx && editIdx !== i}
          class:past-cutoff={firstBreak >= 0 && i >= firstBreak && !task.checked}
          class:dragging={dragIdx === i}
          class:info-open={infoIdx === i}
          class:menu-open={menuIdx === i}
          class:deleting={deletingId === task.id}
          class:just-added={justAddedId === task.id}
          class:swiping={swipeIdx === i && swipeDelta > 10}
          style={swipeIdx === i && swipeDelta > 10 ? `transform: translateX(${Math.min(swipeDelta, 120)}px); opacity: ${1 - swipeDelta / 200}` : ''}
        >
        <input
          type="checkbox"
          checked={task.checked}
          on:change={() => toggle(task)}
          aria-label="{task.checked ? 'Mark incomplete' : 'Mark complete'}: {parsed.label}"
        />
        {#if editIdx === i}
          <div class="edit-card" role="form" aria-label="Edit task: {parsed.label}">
            <input
              class="edit-input"
              type="text"
              bind:value={editVal}
              aria-label="Task name"
              on:keydown={(e) => {
                if (e.key === 'Enter') saveEdit(task);
                if (e.key === 'Escape') editIdx = -1;
              }}
            />
            <div class="edit-row">
              <div class="time-group" role="group" aria-label="Time estimate">
                <div class="time-presets">
                  {#each [5, 15, 30, 60, 120] as m}
                    <button class="preset-btn" class:active={editMins === String(m)} aria-pressed={editMins === String(m)} aria-label="{m >= 60 ? `${m/60} hour` : `${m} minutes`}" on:mousedown|preventDefault={() => { editMins = String(m); }}>
                      {m >= 60 ? `${m/60}h` : `${m}m`}
                    </button>
                  {/each}
                </div>
              </div>
              <label class="field-label">
                <span class="field-label-text">project</span>
                <select class="project-select" bind:value={editProject}>
                  <option value="">none</option>
                  {#each projects as proj}
                    <option value={proj}>{proj}</option>
                  {/each}
                </select>
              </label>
            </div>
            <div class="edit-actions">
              <button class="edit-card-btn save-btn" on:mousedown|preventDefault={() => saveEdit(task)}>Save</button>
              <button class="edit-card-btn cancel-btn" on:mousedown|preventDefault={() => { editIdx = -1; }}>Cancel</button>
              <button class="edit-card-btn del-btn" on:mousedown|preventDefault={() => del(task)}>Delete</button>
            </div>
          </div>
        {:else}
          <span
            class="task-label"
            on:dblclick={() => startEdit(i, task.text)}
          >
            <span class="task-text">{parsed.label}</span>
            {#if i === nextUpIdx && !task.checked}
              <div class="next-up-detail">
                <span class="next-up-badge">next up</span>
                {#if parsed.minutes}
                  <span class="next-up-meta">{formatTime(parsed.minutes)}</span>
                {/if}
                {#if parsed.project}
                  <span class="next-up-meta">{parsed.project}</span>
                {/if}
              </div>
              {#if task.details}
                <div class="next-up-details-text">{task.details}</div>
              {/if}
            {:else if parsed.minutes || parsed.project}
              <span class="task-tags">
                {#if parsed.minutes}
                  <span class="time-tag">{formatTime(parsed.minutes)}</span>
                {/if}
                {#if parsed.project}
                  <span class="project-tag">{parsed.project}</span>
                {/if}
              </span>
            {/if}
          </span>
          <div class="info-wrap" on:mouseenter={cancelInfoDismiss} on:mouseleave={startInfoDismiss}>
            <button class="info-btn" on:click|stopPropagation={() => toggleInfo(i)} title="Task info" aria-label="Task details for {parsed.label}" aria-expanded={infoIdx === i} aria-haspopup="true">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="8" cy="8" r="6.5"/><path d="M8 7v4"/><circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none"/>
              </svg>
            </button>
            {#if infoIdx === i}
              <div class="info-popup">
                <div class="info-title">{parsed.label}</div>
                {#if parsed.project}
                  <div class="info-row"><span class="info-key">Project</span> <span class="info-val">{parsed.project}</span></div>
                {/if}
                {#if parsed.minutes}
                  <div class="info-row"><span class="info-key">Estimate</span> <span class="info-val">{formatTime(parsed.minutes)}</span></div>
                {/if}
                <div class="info-row"><span class="info-key">Status</span> <span class="info-val">{task.checked ? 'Done' : 'To do'}</span></div>
                {#if task.details}
                  <div class="info-details">{task.details}</div>
                {/if}
                <div class="info-raw">{task.text}</div>
              </div>
            {/if}
          </div>
          <div class="menu-wrap" on:mouseenter={cancelMenuDismiss} on:mouseleave={startMenuDismiss}>
            <button class="menu-btn" on:click|stopPropagation={() => toggleMenu(i)} title="Options" aria-label="Options for {parsed.label}" aria-expanded={menuIdx === i} aria-haspopup="menu">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>
            </button>
            {#if menuIdx === i}
              <div class="menu-popup" role="menu" aria-label="Task actions">
                <button class="menu-item" role="menuitem" on:click|stopPropagation={() => startEdit(i, task.text)}>
                  <span class="mi-icon" aria-hidden="true">&#9998;</span> Edit
                </button>
                <button class="menu-item menu-item-danger" role="menuitem" on:click|stopPropagation={() => del(task)}>
                  <span class="mi-icon" aria-hidden="true">&times;</span> Delete
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
      </div>
    {/each}
  </div>
{/if}

{#if !loading && showAdd}
  <div class="add-overlay" on:click|self={() => { showAdd = false; }} role="presentation"></div>
  <div class="add-popup" role="dialog" aria-label="Add new task" aria-modal="true">
    <label for="add-task-input" class="sr-only">Task description</label>
    <input
      id="add-task-input"
      class="add-text-input"
      type="text"
      placeholder="What needs to be done?"
      bind:value={newTask}
      on:keydown={(e) => {
        if (e.key === 'Enter') add();
        if (e.key === 'Escape') { showAdd = false; }
      }}
    />
    <div class="add-fields">
      <div class="time-group">
        <div class="time-presets">
          {#each [5, 15, 30, 60, 120] as m}
            <button class="preset-btn" class:active={newMins === String(m)} on:click|preventDefault={() => { newMins = String(m); }}>
              {m >= 60 ? `${m/60}h` : `${m}m`}
            </button>
          {/each}
        </div>
      </div>
      <label class="field-label">
        <span class="field-label-text">project</span>
        <select class="project-select" bind:value={newProject}>
          <option value="">none</option>
          {#each projects as proj}
            <option value={proj}>{proj}</option>
          {/each}
          <option value="__new__">+ new project</option>
        </select>
      </label>
      {#if newProject === '__new__'}
        <input
          class="new-project-input"
          type="text"
          placeholder="project tag"
          bind:value={newCustomProject}
          on:keydown={(e) => { if (e.key === 'Enter') add(); }}
        />
      {/if}
    </div>
    <div class="add-actions">
      <button class="add-action-btn add-save" on:click={add}>Add Task</button>
      <button class="add-action-btn add-cancel" on:click={() => { showAdd = false; }}>Cancel</button>
    </div>
  </div>
{/if}

{#if !loading}
  <button class="fab" on:click={openAdd} aria-label="Add task (N)">
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><line x1="11" y1="4" x2="11" y2="18"/><line x1="4" y1="11" x2="18" y2="11"/></svg>
  </button>
{/if}

{#if undoTask}
  <div class="undo-toast" role="alert" aria-live="assertive">
    <span>Deleted &ldquo;{undoTask.text.length > 30 ? undoTask.text.slice(0, 30) + '...' : undoTask.text}&rdquo;</span>
    <button class="undo-btn" on:click={undo}>Undo</button>
  </div>
{/if}
</div>

<style>
  .date-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 0.6rem 0 0.2rem;
    padding-bottom: 0.2rem;
    border-bottom: 1px solid var(--color-rule);
  }
  .date {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-ink-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    text-align: left;
  }
  .progress {
    font-family: var(--font-ui);
    font-size: 0.65rem;
    color: var(--color-success);
    letter-spacing: 0.5px;
    font-weight: 500;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .day-break {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-ink-light);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin: 0.4rem 0 0.1rem;
    padding-top: 0.2rem;
    border-top: 1px dashed var(--color-ink-muted);
  }
  .done-separator {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0.5rem 0 0.15rem;
  }
  .done-separator::before, .done-separator::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--color-ink-faint);
  }
  .done-label {
    font-family: var(--font-ui);
    font-size: 0.65rem;
    color: var(--color-ink-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    flex-shrink: 0;
  }

  .task-list {
    display: flex;
    flex-direction: column;
  }
  .task-list.list-dragging {
    user-select: none;
    -webkit-user-select: none;
  }

  .task {
    display: flex;
    align-items: flex-start;
    padding: 3px 6px;
    border-radius: 5px;
    border: 1px solid transparent;
    transition: background 0.15s, box-shadow 0.2s, border-color 0.15s, opacity 0.2s, transform 0.2s, max-height 0.3s ease, padding 0.3s ease, margin 0.3s ease;
    line-height: 1.4;
    font-size: 1.05rem;
    cursor: grab;
    position: relative;
    touch-action: none;
    max-height: 200px;
    overflow: visible;
  }
  .task.swiping {
    transition: none;
  }
  .task:hover {
    background: var(--color-paper-bright);
    border-color: var(--color-ink-faint);
    box-shadow: 0 2px 8px rgba(139,69,19,0.1), 0 1px 3px rgba(139,69,19,0.06);
    transform: translateY(-1px);
  }
  .task:active { cursor: grabbing; transform: translateY(0); }
  .task.dragging { opacity: 0.15; background: var(--color-ink-faint); border-radius: 4px; }
  .task.past-cutoff { opacity: 0.75; }
  .task.info-open { z-index: 100; }
  .task.menu-open { z-index: 100; }

  /* Deletion animation — poof explosion */
  .task.deleting {
    animation: poofExplode 0.4s ease-out forwards;
    pointer-events: none;
  }
  @keyframes poofExplode {
    0% {
      transform: scale(1);
      opacity: 1;
      max-height: 200px;
      padding-top: 5px;
      padding-bottom: 5px;
      filter: blur(0);
    }
    30% {
      transform: scale(1.06);
      opacity: 0.8;
      filter: blur(0.5px);
    }
    100% {
      transform: scale(0.2) translateX(60px);
      opacity: 0;
      max-height: 0;
      padding-top: 0;
      padding-bottom: 0;
      margin-top: 0;
      margin-bottom: 0;
      filter: blur(6px);
    }
  }

  /* New item slide-in animation */
  .task.just-added {
    animation: slideIn 0.35s ease-out;
  }
  @keyframes slideIn {
    0% {
      opacity: 0;
      max-height: 0;
      padding-top: 0;
      padding-bottom: 0;
      transform: translateY(-10px) scale(0.95);
    }
    50% {
      max-height: 200px;
      padding-top: 5px;
      padding-bottom: 5px;
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .task input[type="checkbox"] {
    appearance: none; -webkit-appearance: none;
    width: 16px; height: 16px;
    border: 1.5px solid var(--color-ink-muted);
    border-radius: 2px;
    margin: 4px 8px 0 2px;
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
    padding: 1px 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .task-text {
    text-shadow:
      0 0 3px rgba(255,255,255,0.85),
      0 0 6px var(--color-paper),
      2px 0 8px var(--color-paper),
      -2px 0 8px var(--color-paper);
  }
  .task-tags {
    display: flex;
    gap: 4px;
    align-items: center;
    margin-top: -2px;
    margin-bottom: -3px;
  }
  .task.done .task-text {
    text-decoration: line-through;
    color: var(--color-done);
    text-shadow: none;
  }

  /* Next up — expanded focus item */
  .task.next-up {
    background: var(--color-paper-bright);
    border-color: var(--color-accent);
    border-left: 3px solid var(--color-accent);
    padding: 6px 8px;
    margin-bottom: 2px;
  }
  .task.next-up .task-text {
    font-size: 1.1rem;
    font-weight: 500;
  }
  .next-up-detail {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }
  .next-up-badge {
    font-family: var(--font-ui);
    font-size: 0.55rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: white;
    background: var(--color-accent);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .next-up-meta {
    font-family: var(--font-ui);
    font-size: 0.6rem;
    color: var(--color-ink-muted);
    letter-spacing: 0.3px;
  }
  .next-up-details-text {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--color-ink-light);
    line-height: 1.45;
    margin-top: 4px;
    padding: 4px 0 2px;
    border-top: 1px dashed var(--color-ink-faint);
    white-space: pre-wrap;
  }

  .project-tag {
    display: inline-block;
    font-family: var(--font-ui);
    font-size: 0.6rem;
    color: var(--color-ink-light);
    background: var(--color-tag-bg);
    border: 1px solid var(--color-ink-faint);
    padding: 0 5px;
    border-radius: 3px;
    vertical-align: middle;
    text-transform: lowercase;
    letter-spacing: 0.5px;
    text-shadow: none;
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
    vertical-align: middle;
    letter-spacing: 0.3px;
    text-shadow: none;
  }
  .task.done .time-tag { opacity: 0.4; }

  /* Info button */
  .info-wrap {
    position: relative;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .info-btn {
    opacity: 0.35;
    cursor: pointer;
    color: var(--color-ink-muted);
    background: none;
    border: none;
    padding: 6px 4px;
    border-radius: 4px;
    transition: opacity 0.15s, color 0.15s;
    display: flex;
    align-items: center;
  }
  .task:hover .info-btn { opacity: 0.6; }
  .info-btn:hover { opacity: 1 !important; color: var(--color-accent); }

  .info-popup {
    position: absolute;
    right: 0;
    top: 100%;
    background: var(--color-paper-bright);
    border: 1px solid var(--color-ink-faint);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08);
    z-index: 200;
    min-width: 180px;
    max-width: 280px;
    padding: 8px 10px;
    animation: menuFade 0.12s ease-out;
  }
  .info-title {
    font-family: var(--font-hand);
    font-size: 0.95rem;
    color: var(--color-ink);
    margin-bottom: 6px;
    line-height: 1.3;
  }
  .info-row {
    display: flex;
    gap: 6px;
    font-family: var(--font-ui);
    font-size: 0.7rem;
    margin-bottom: 3px;
  }
  .info-key {
    color: var(--color-ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .info-val {
    color: var(--color-ink);
  }
  .info-details {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-ink-light);
    line-height: 1.4;
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px dashed var(--color-ink-faint);
    white-space: pre-wrap;
  }
  .info-raw {
    font-family: var(--font-ui);
    font-size: 0.65rem;
    color: var(--color-ink-muted);
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px dashed var(--color-ink-faint);
    word-break: break-all;
  }

  /* Hamburger menu */
  .menu-wrap {
    position: relative;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .menu-btn {
    opacity: 0.35;
    cursor: pointer;
    color: var(--color-ink-muted);
    background: none;
    border: none;
    padding: 6px 6px;
    border-radius: 4px;
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
    z-index: 200;
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
    background: white;
    border: 2px solid var(--color-accent);
    border-radius: 6px;
    padding: 6px 10px 8px;
    box-shadow: 0 4px 16px rgba(139,69,19,0.12), 0 2px 6px rgba(139,69,19,0.08);
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
  .edit-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .field-label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .field-label-text {
    font-family: var(--font-ui);
    font-size: 0.65rem;
    color: var(--color-ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .project-select {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    border: 1px solid var(--color-ink-faint);
    border-radius: 3px;
    background: transparent;
    padding: 2px 4px;
    color: var(--color-ink-muted);
    outline: none;
    cursor: pointer;
    max-width: 120px;
  }
  .project-select:focus { border-color: var(--color-accent); }
  .time-input {
    width: 52px;
    font-family: var(--font-ui);
    font-size: 0.8rem;
    border: 1px solid var(--color-ink-faint);
    border-radius: 3px;
    background: transparent;
    padding: 2px 4px;
    color: var(--color-gold);
    outline: none;
    text-align: center;
  }
  .time-input:focus { border-color: var(--color-gold); }
  .time-input::placeholder { color: var(--color-ink-muted); }

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

  /* Time presets */
  .time-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .time-presets {
    display: flex;
    gap: 2px;
  }
  .preset-btn {
    font-family: var(--font-ui);
    font-size: 0.6rem;
    padding: 2px 6px;
    border: 1px solid var(--color-ink-faint);
    border-radius: 3px;
    background: transparent;
    color: var(--color-ink-muted);
    cursor: pointer;
    transition: all 0.1s;
    line-height: 1.2;
  }
  .preset-btn:hover { border-color: var(--color-gold); color: var(--color-gold); }
  .preset-btn.active { background: var(--color-gold); color: white; border-color: var(--color-gold); }

  /* Undo toast */
  .undo-toast {
    position: fixed;
    bottom: 84px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-ink);
    color: var(--color-paper-bright);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    padding: 8px 16px;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 300;
    animation: toastIn 0.2s ease-out;
    max-width: calc(100vw - 32px);
  }
  @keyframes toastIn {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  .undo-btn {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 500;
    padding: 3px 10px;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 4px;
    background: transparent;
    color: var(--color-gold);
    cursor: pointer;
    transition: all 0.1s;
    white-space: nowrap;
  }
  .undo-btn:hover { background: rgba(255,255,255,0.1); }

  /* FAB */
  .fab {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    background: var(--color-accent);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 3px 12px rgba(0,0,0,0.2), 0 1px 4px rgba(0,0,0,0.12);
    transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
    z-index: 50;
    padding: 0;
  }
  .fab:hover {
    transform: scale(1.1);
    box-shadow: 0 4px 18px rgba(0,0,0,0.25);
    background: var(--color-gold);
  }
  .fab:active { transform: scale(0.95); }

  @media (max-width: 540px) {
    .task input[type="checkbox"] {
      width: 20px; height: 20px;
      margin: 4px 10px 0 0;
    }
    .task input[type="checkbox"]:checked::after {
      font-size: 16px;
      top: -1px; left: 2px;
    }
    .fab {
      bottom: calc(24px + env(safe-area-inset-bottom, 0px));
      right: calc(24px + env(safe-area-inset-right, 0px));
    }
  }

  /* Add popup overlay */
  .add-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.15);
    z-index: 200;
  }
  .add-popup {
    position: fixed;
    bottom: 84px;
    right: 24px;
    width: 320px;
    max-width: calc(100vw - 32px);
    background: var(--color-paper-bright);
    border: 1px solid var(--color-ink-faint);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1);
    padding: 12px 14px;
    z-index: 201;
    animation: popupSlide 0.15s ease-out;
  }
  @keyframes popupSlide {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .add-text-input {
    font-family: var(--font-hand);
    font-size: 1.05rem;
    border: none;
    border-bottom: 1.5px dashed var(--color-accent);
    background: transparent;
    outline: none;
    width: 100%;
    padding: 4px 0;
    color: var(--color-ink);
    margin-bottom: 8px;
  }
  .add-text-input::placeholder { color: var(--color-ink-muted); }
  .add-fields {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .new-project-input {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    border: 1px solid var(--color-ink-faint);
    border-radius: 3px;
    background: transparent;
    padding: 2px 6px;
    color: var(--color-ink);
    outline: none;
    width: 100px;
  }
  .new-project-input:focus { border-color: var(--color-accent); }
  .add-actions {
    display: flex;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px dashed var(--color-ink-faint);
  }
  .add-action-btn {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    padding: 5px 14px;
    border: 1px solid var(--color-ink-faint);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    color: var(--color-ink-muted);
    transition: all 0.15s;
  }
  .add-save { background: var(--color-accent); color: white; border-color: var(--color-accent); }
  .add-save:hover { background: var(--color-gold); border-color: var(--color-gold); }
  .add-cancel:hover { background: var(--color-hover); }

  .empty {
    text-align: center;
    margin-top: 3rem;
  }
  .empty-icon {
    font-size: 3rem;
    display: block;
    margin-bottom: 0.5rem;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.6; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.1); }
  }
  .empty p {
    font-family: var(--font-display);
    color: var(--color-ink-muted);
    font-size: 1.3rem;
  }
</style>
