<script>
  import { onMount, onDestroy } from 'svelte';
  import { getDb, ensureSchema, getTasks, getUsageSummary } from '../lib/db.js';
  import { formatTokens, formatCost } from '../lib/usage.js';

  let tasksDone = 0;
  let tasksLeft = 0;
  let tokensToday = 0;
  let costToday = 0;
  let costMonth = 0;
  let providerName = '';
  let providerIcon = '';
  let timer;

  function onProviderUpdate(e) {
    providerName = e.detail?.name || '';
    providerIcon = e.detail?.icon || '';
  }

  async function refresh() {
    try {
      const db = await getDb();
      await ensureSchema(db);
      const today = new Date().toISOString().slice(0, 10);
      const monthStart = today.slice(0, 8) + '01';

      const [tasks, usageToday, usageMonth] = await Promise.all([
        getTasks(db, today),
        getUsageSummary(db, { from: today, to: today }),
        getUsageSummary(db, { from: monthStart, to: today }),
      ]);

      tasksDone = tasks.filter(t => t.checked).length;
      tasksLeft = tasks.length - tasksDone;
      tokensToday = (usageToday.total_input || 0) + (usageToday.total_output || 0);
      costToday = usageToday.total_cost || 0;
      costMonth = usageMonth.total_cost || 0;
    } catch (e) {
      // DB not ready yet — silent
    }
  }

  function onStatusUpdate() { refresh(); }

  onMount(() => {
    refresh();
    timer = setInterval(refresh, 30_000);
    window.addEventListener('statusbar-refresh', onStatusUpdate);
    window.addEventListener('provider-update', onProviderUpdate);
  });

  onDestroy(() => {
    clearInterval(timer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('statusbar-refresh', onStatusUpdate);
      window.removeEventListener('provider-update', onProviderUpdate);
    }
  });
</script>

<div class="status-bar">
  <div class="group">
    <span class="done">&#10003; {tasksDone} done</span>
    <span class="sep">&middot;</span>
    <span>{tasksLeft} left</span>
  </div>
  <div class="group">
    {#if providerName}
      <span class="provider">{providerIcon} {providerName}</span>
      <span class="sep">&middot;</span>
    {/if}
    <span>{formatTokens(tokensToday)} tokens</span>
    <span class="sep">&middot;</span>
    <span class:cost-positive={costToday > 0}>{formatCost(costToday)} today</span>
    <span class="sep">&middot;</span>
    <span class:cost-positive={costMonth > 0}>{formatCost(costMonth)} /mo</span>
  </div>
</div>

<style>
  .status-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 10;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    background: var(--color-paper-bright);
    border-top: 1px solid var(--color-ink-faint);
    font-family: var(--font-ui);
    font-size: 0.65rem;
    color: var(--color-ink-muted);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sep {
    opacity: 0.4;
  }
  .provider {
    color: var(--color-accent);
    font-weight: 600;
  }
  .done {
    color: var(--color-check);
  }
  .cost-positive {
    color: var(--color-gold);
  }
</style>
