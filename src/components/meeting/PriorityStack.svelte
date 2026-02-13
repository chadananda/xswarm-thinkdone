<svelte:options runes={false} />

<script>
  export let tasks = [];

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

  const rotations = [-0.8, 0.6, -0.4, 0.9, -0.7, 0.3, -0.5, 0.7, -0.6, 0.4, -0.3, 0.8];

  $: doneCount = tasks.filter(t => t.checked).length;
  $: totalCount = tasks.length;
</script>

<div class="section-header" id="priority-stack-heading">
  Priority Stack
  {#if totalCount > 0}
    <span class="section-count" aria-label="{doneCount} of {totalCount} complete">{doneCount}/{totalCount}</span>
  {/if}
</div>
<div class="task-list" role="list" aria-labelledby="priority-stack-heading">
  {#each tasks as task, i}
    {@const parsed = parseTask(task.text)}
    <div
      class="task-card"
      class:done={task.checked}
      role="listitem"
      aria-label="{task.checked ? 'Completed: ' : ''}{parsed.label}{parsed.project ? ', project ' + parsed.project : ''}{parsed.minutes ? ', estimated ' + formatTime(parsed.minutes) : ''}"
      style="transform: rotate({rotations[i % rotations.length]}deg)"
    >
      <div class="task-priority" class:faded={i >= 4} class:very-faded={i >= 6} aria-label="Priority {i + 1}">P{i + 1}</div>
      <div class="task-text">{parsed.label}</div>
      <div class="task-meta">
        {#if parsed.project}
          <span class="task-project">{parsed.project}</span>
        {/if}
        {#if parsed.minutes}
          <span class="task-time">{formatTime(parsed.minutes)}</span>
        {/if}
      </div>
    </div>
  {/each}
  {#if tasks.length === 0}
    <div class="empty-tasks" role="status">No tasks yet. Start a planning meeting.</div>
  {/if}
</div>

<style>
  .section-header {
    font-family: var(--font-display);
    font-size: 18px;
    color: var(--color-ink);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
  .section-count {
    font-size: 16px;
    color: var(--color-ink-muted);
    font-weight: 400;
  }
  .task-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .task-card {
    background: #faf7f0;
    padding: 8px 10px;
    border-radius: 3px;
    box-shadow: 1px 2px 5px rgba(60,40,20,0.07), 0 1px 2px rgba(60,40,20,0.05);
    cursor: default;
    transition: transform 0.2s, box-shadow 0.2s;
    position: relative;
    border-left: 3px solid rgba(196,136,46,0.2);
  }
  .task-card:hover {
    transform: rotate(0deg) translateY(-2px) !important;
    box-shadow: 2px 4px 12px rgba(60,40,20,0.12);
  }
  .task-card.done {
    opacity: 0.6;
    background: #f0ebe3;
  }
  .task-card.done .task-text {
    text-decoration: line-through;
    text-decoration-color: #6b5d4f;
    text-decoration-thickness: 1.5px;
  }

  .task-text {
    font-size: 13px;
    line-height: 1.4;
    color: var(--color-ink);
    margin-bottom: 6px;
    padding-right: 24px;
  }
  .task-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .task-project {
    font-family: var(--font-ui);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 10px;
    background: rgba(196,136,46,0.15);
    color: var(--color-accent);
    font-weight: 600;
  }
  .task-time {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--color-ink-light);
  }
  .task-priority {
    position: absolute;
    top: 6px;
    right: 6px;
    font-family: var(--font-display);
    font-size: 14px;
    color: #c4882e;
    font-weight: 700;
  }
  .task-priority.faded { opacity: 0.5; }
  .task-priority.very-faded { opacity: 0.35; }
  .empty-tasks {
    font-family: var(--font-display);
    font-size: 16px;
    color: var(--color-ink-light);
    text-align: center;
    padding: 40px 0;
  }
</style>
