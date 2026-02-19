<svelte:options runes={false} />

<script>
  export let tasks = [];
  export let onToggle = () => {};
  export let onDelete = () => {};

  function parseTask(text) {
    let minutes = 0;
    let clean = text;
    const timeMatch = text.match(/\s*~(\d+(?:\.\d+)?)(m|h)\s*/);
    if (timeMatch) {
      minutes = timeMatch[2] === 'h' ? Math.round(parseFloat(timeMatch[1]) * 60) : parseInt(timeMatch[1]);
      clean = text.replace(timeMatch[0], ' ').trim();
    }
    const projMatch = clean.match(/^(.+?)\s+[—–]\s+(\S+)$/);
    return {
      label: projMatch ? projMatch[1] : clean,
      project: projMatch ? projMatch[2] : '',
      minutes,
    };
  }

  function formatTime(mins) {
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h}h${m}m` : `${h}h`;
    }
    return `${mins}m`;
  }

  function dayLabel(dateStr) {
    if (!dateStr) return '';
    const today = new Date().toISOString().slice(0, 10);
    if (dateStr === today) return 'Today';
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (dateStr === tomorrow) return 'Tomorrow';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }

  $: doneCount = tasks.filter(t => t.checked).length;
  $: totalCount = tasks.length;
</script>

<div class="meeting-tasks" style="view-transition-name: task-list">
  <div class="section-header" id="meeting-tasks-heading">
    <span class="section-name">Today's Tasks</span>
    {#if totalCount > 0}
      <span class="section-count">{doneCount}/{totalCount}</span>
    {/if}
  </div>
  <div class="task-list" role="list" aria-labelledby="meeting-tasks-heading">
    {#each tasks as task, i}
      {@const parsed = parseTask(task.text)}
      <div class="task-row" class:done={task.checked}>
        <label class="task-check">
          <input
            type="checkbox"
            class="sr-only"
            checked={task.checked}
            on:change={() => onToggle(task)}
          />
          <span class="check-box">{task.checked ? '✓' : ''}</span>
        </label>
        <span class="task-name">{parsed.label}</span>
        {#if parsed.project}
          <span class="task-project">{parsed.project}</span>
        {/if}
        {#if parsed.minutes}
          <span class="task-time">{formatTime(parsed.minutes)}</span>
        {/if}
        <button
          class="task-delete"
          on:click|stopPropagation={() => onDelete(task)}
          aria-label="Delete task: {parsed.label}"
          title="Remove task"
        >×</button>
      </div>
    {/each}
    {#if tasks.length === 0}
      <div class="ghost-tasks" role="status" aria-label="Example tasks will appear here">
        {#each [
          { label: 'Review OoL editorial workflow PR', project: 'Ocean of Lights' },
          { label: 'Draft Q1 investor update letter', project: 'Immersive Ocean' },
          { label: 'Ship article tagging system v2', project: 'Ocean of Lights' },
        ] as ghost}
          <div class="task-row ghost">
            <span class="check-box"></span>
            <span class="task-name">{ghost.label}</span>
            <span class="task-project">{ghost.project}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .meeting-tasks {
    display: flex;
    flex-direction: column;
  }
  .section-header {
    font-family: var(--font-display);
    color: var(--color-ink);
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 2px dashed var(--color-ink-faint);
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-weight: 600;
  }
  .section-name {
    font-size: 24px;
    font-style: italic;
    color: var(--color-accent);
  }
  .section-count {
    font-size: 14px;
    color: var(--color-ink-muted);
    font-weight: 400;
  }
  .task-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
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

  /* Compact single-row layout */
  .task-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s;
    position: relative;
  }
  .task-row:hover {
    background: rgba(180,150,100,0.08);
  }
  .task-row.done {
    opacity: 0.45;
  }
  .check-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1.5px solid var(--color-ink-muted, #999);
    border-radius: 3px;
    font-size: 11px;
    line-height: 1;
    color: var(--color-accent);
    flex-shrink: 0;
  }
  .task-row.done .check-box {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: white;
  }
  .task-check {
    display: flex;
    cursor: pointer;
  }
  .task-name {
    font-family: var(--font-hand, 'Patrick Hand', cursive);
    font-size: 14px;
    line-height: 1.3;
    color: var(--color-ink);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task-row.done .task-name {
    text-decoration: line-through;
    text-decoration-color: var(--color-ink-muted);
  }
  .task-project {
    font-family: var(--font-hand, 'Patrick Hand', cursive);
    font-size: 11px;
    color: var(--color-accent);
    font-weight: 600;
    flex-shrink: 0;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task-time {
    font-family: var(--font-hand, 'Patrick Hand', cursive);
    font-size: 11px;
    color: var(--color-ink-light);
    flex-shrink: 0;
  }

  /* Hover-reveal delete button */
  .task-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: none;
    color: var(--color-ink-muted);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    border-radius: 3px;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, background 0.15s;
    flex-shrink: 0;
    padding: 0;
  }
  .task-row:hover .task-delete {
    opacity: 1;
  }
  .task-delete:hover {
    color: #c0392b;
    background: rgba(192,57,43,0.1);
  }

  /* Ghost placeholders */
  .ghost-tasks { opacity: 0.45; pointer-events: none; }
  .task-row.ghost {
    cursor: default;
  }
</style>
