<svelte:options runes={false} />

<script>
  import { onMount } from 'svelte';
  import { getDb, ensureSchema, getUsageSummary, getUsageByDay, getUsageBySession, getUsageByModel, getUsageByProvider, getCacheSavings } from '../lib/db.js';
  import { formatCost, formatTokens } from '../lib/usage.js';

  let loading = true;
  let range = 'month'; // 'week' | 'month' | 'all'
  let summary = { total_input: 0, total_output: 0, total_cost: 0, session_count: 0 };
  let dailyData = [];
  let sessionData = [];
  let modelData = [];
  let providerData = [];
  let cacheSavings = { total_input: 0, total_cache_read: 0, total_cache_write: 0 };
  let db = null;

  function getDateRange(r) {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    if (r === 'week') {
      const from = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
      return { from, to };
    }
    if (r === 'month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      return { from, to };
    }
    return { from: '2020-01-01', to };
  }

  async function loadData() {
    if (!db) return;
    const { from, to } = getDateRange(range);
    const [s, d, sess, models, providers, cache] = await Promise.all([
      getUsageSummary(db, { from, to }),
      getUsageByDay(db, { from, to }),
      getUsageBySession(db, { from, to }),
      getUsageByModel(db, { from, to }),
      getUsageByProvider(db, { from, to }),
      getCacheSavings(db, { from, to }),
    ]);
    summary = s;
    dailyData = d;
    sessionData = sess;
    modelData = models;
    providerData = providers;
    cacheSavings = cache;
  }

  async function setRange(r) {
    range = r;
    await loadData();
  }

  $: maxDailyCost = Math.max(...dailyData.map(d => d.total_cost), 0.001);
  $: avgPerSession = summary.session_count > 0 ? summary.total_cost / summary.session_count : 0;
  $: totalSessionCost = sessionData.reduce((s, d) => s + d.total_cost, 0) || 1;
  $: cacheHitRate = cacheSavings.total_input > 0 ? Math.round((cacheSavings.total_cache_read / cacheSavings.total_input) * 100) : 0;
  $: totalModelCost = modelData.reduce((s, d) => s + d.total_cost, 0) || 1;
  $: totalProviderCost = providerData.reduce((s, d) => s + d.total_cost, 0) || 1;

  onMount(async () => {
    db = await getDb();
    await ensureSchema(db);
    await loadData();
    loading = false;
  });
</script>

{#if loading}
  <div class="loading" role="status" aria-label="Loading usage data">
    <div class="spinner" aria-hidden="true"></div>
    <span>Loading usage data...</span>
  </div>
{:else}
  <!-- Range selector -->
  <div class="range-bar" role="tablist" aria-label="Date range">
    <button class="range-btn" class:active={range === 'week'} role="tab" aria-selected={range === 'week'} on:click={() => setRange('week')}>This Week</button>
    <button class="range-btn" class:active={range === 'month'} role="tab" aria-selected={range === 'month'} on:click={() => setRange('month')}>This Month</button>
    <button class="range-btn" class:active={range === 'all'} role="tab" aria-selected={range === 'all'} on:click={() => setRange('all')}>All Time</button>
  </div>

  <!-- Summary cards -->
  <div class="summary-row" role="group" aria-label="Usage summary">
    <div class="stat-card cost-card" aria-label="Total cost: {formatCost(summary.total_cost)}">
      <div class="stat-label">Total Cost</div>
      <div class="stat-value gold">{formatCost(summary.total_cost)}</div>
    </div>
    <div class="stat-card" aria-label="Total tokens: {formatTokens(summary.total_input + summary.total_output)}">
      <div class="stat-label">Total Tokens</div>
      <div class="stat-value sage">{formatTokens(summary.total_input + summary.total_output)}</div>
    </div>
    <div class="stat-card" aria-label="Average per session: {formatCost(avgPerSession)}">
      <div class="stat-label">Avg / Session</div>
      <div class="stat-value gold">{formatCost(avgPerSession)}</div>
    </div>
    <div class="stat-card" aria-label="Cache hit rate: {cacheHitRate}%">
      <div class="stat-label">Cache Hits</div>
      <div class="stat-value sage">{cacheHitRate}%</div>
    </div>
  </div>

  <!-- Daily chart -->
  {#if dailyData.length > 0}
    <div class="section">
      <h2 id="usage-daily">Daily Usage</h2>
      <div class="chart" role="img" aria-labelledby="usage-daily" aria-label="Bar chart showing daily costs">
        {#each dailyData as day}
          <div class="bar-col" aria-label="{day.date}: {formatCost(day.total_cost)}">
            <div class="bar-wrap">
              <div class="bar" style="height: {Math.max((day.total_cost / maxDailyCost) * 100, 2)}%" role="presentation">
                <span class="bar-tooltip" role="tooltip">{formatCost(day.total_cost)}</span>
              </div>
            </div>
            <div class="bar-label" aria-hidden="true">{day.date.slice(5)}</div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Session type breakdown -->
  {#if sessionData.length > 0}
    <div class="section">
      <h2 id="usage-sessions">By Session Type</h2>
      <div class="breakdown" role="list" aria-labelledby="usage-sessions">
        {#each sessionData as sess}
          <div class="breakdown-row" role="listitem" aria-label="{sess.session_type.replace(/_/g, ' ')}: {formatCost(sess.total_cost)}, {sess.sessions} calls">
            <div class="breakdown-label">{sess.session_type.replace(/_/g, ' ')}</div>
            <div class="breakdown-bar-wrap" role="progressbar" aria-valuenow={Math.round((sess.total_cost / totalSessionCost) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="{sess.session_type.replace(/_/g, ' ')} proportion">
              <div class="breakdown-bar" style="width: {(sess.total_cost / totalSessionCost) * 100}%"></div>
            </div>
            <div class="breakdown-stats">
              <span class="gold">{formatCost(sess.total_cost)}</span>
              <span class="muted">{sess.sessions} calls</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- By Model breakdown -->
  {#if modelData.length > 0}
    <div class="section">
      <h2 id="usage-models">By Model</h2>
      <div class="breakdown" role="list" aria-labelledby="usage-models">
        {#each modelData as m}
          <div class="breakdown-row" role="listitem" aria-label="{m.model}: {formatCost(m.total_cost)}, {m.sessions} calls">
            <div class="breakdown-label">{m.model.replace(/^claude-|^gpt-/i, '').replace(/-\d{8}$/, '')}</div>
            <div class="breakdown-bar-wrap" role="progressbar" aria-valuenow={Math.round((m.total_cost / totalModelCost) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div class="breakdown-bar" style="width: {(m.total_cost / totalModelCost) * 100}%"></div>
            </div>
            <div class="breakdown-stats">
              <span class="gold">{formatCost(m.total_cost)}</span>
              <span class="muted">{m.sessions} calls</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- By Provider breakdown -->
  {#if providerData.length > 0}
    <div class="section">
      <h2 id="usage-providers">By Provider</h2>
      <div class="breakdown" role="list" aria-labelledby="usage-providers">
        {#each providerData as p}
          <div class="breakdown-row" role="listitem" aria-label="{p.provider}: {formatCost(p.total_cost)}, {p.sessions} calls">
            <div class="breakdown-label">{p.provider || 'thinkdone'}</div>
            <div class="breakdown-bar-wrap" role="progressbar" aria-valuenow={Math.round((p.total_cost / totalProviderCost) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div class="breakdown-bar" style="width: {(p.total_cost / totalProviderCost) * 100}%"></div>
            </div>
            <div class="breakdown-stats">
              <span class="gold">{formatCost(p.total_cost)}</span>
              <span class="muted">{p.sessions} calls</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Detail table -->
  {#if dailyData.length > 0}
    <div class="section">
      <h2 id="usage-breakdown">Daily Breakdown</h2>
      <div class="table-wrap" role="region" aria-labelledby="usage-breakdown" tabindex="0">
        <table aria-label="Daily usage breakdown">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Sessions</th>
              <th scope="col">Input</th>
              <th scope="col">Output</th>
              <th scope="col">Cache</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {#each dailyData as day}
              <tr>
                <td>{day.date}</td>
                <td>{day.sessions}</td>
                <td class="sage">{formatTokens(day.total_input)}</td>
                <td class="sage">{formatTokens(day.total_output)}</td>
                <td class="sage">{formatTokens(day.cache_read || 0)}</td>
                <td class="gold">{formatCost(day.total_cost)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  {#if dailyData.length === 0 && sessionData.length === 0}
    <div class="empty" role="status" aria-label="No usage data">
      <p>No usage data yet. Start a planning meeting to see token usage here.</p>
    </div>
  {/if}
{/if}

<style>
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 0;
    gap: 16px;
    color: var(--color-ink-light);
    font-family: var(--font-hand);
    font-size: 16px;
  }
  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-ink-faint);
    border-top-color: var(--color-gold);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Range bar */
  .range-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 1.5rem;
  }
  .range-btn {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    padding: 6px 16px;
    border: 1px solid var(--color-ink-faint);
    background: transparent;
    color: var(--color-ink-light);
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .range-btn.active {
    background: var(--color-gold);
    color: white;
    border-color: var(--color-gold);
  }
  .range-btn:hover:not(.active) {
    border-color: var(--color-gold);
    color: var(--color-gold);
  }

  /* Summary cards */
  .summary-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 2rem;
  }
  .stat-card {
    background: var(--color-warm);
    border: 1px solid var(--color-rule);
    border-radius: 8px;
    padding: 16px;
    text-align: center;
  }
  .stat-label {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-ink-light);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  .stat-value {
    font-family: var(--font-display);
    font-size: 1.8rem;
    font-weight: 700;
    line-height: 1.2;
  }
  .gold { color: var(--color-gold); }
  .sage { color: var(--color-sage); }
  .muted { color: var(--color-ink-light); font-size: 0.75rem; }

  /* Sections */
  .section {
    margin-bottom: 2rem;
  }
  .section h2 {
    font-family: var(--font-display);
    font-size: 1.5rem;
    color: var(--color-ink-light);
    margin-bottom: 0.75rem;
  }

  /* Bar chart */
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 160px;
    padding: 8px 0;
    border-bottom: 1px solid var(--color-rule);
  }
  .bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    height: 100%;
  }
  .bar-wrap {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .bar {
    width: 80%;
    max-width: 40px;
    background: var(--color-gold);
    border-radius: 3px 3px 0 0;
    position: relative;
    transition: height 0.3s;
    min-height: 2px;
  }
  .bar:hover {
    opacity: 0.85;
  }
  .bar-tooltip {
    display: none;
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-ink);
    color: var(--color-paper);
    font-family: var(--font-ui);
    font-size: 0.65rem;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    margin-bottom: 4px;
  }
  .bar:hover .bar-tooltip {
    display: block;
  }
  .bar-label {
    font-family: var(--font-ui);
    font-size: 0.65rem;
    color: var(--color-ink-light);
    margin-top: 4px;
    white-space: nowrap;
  }

  /* Session breakdown */
  .breakdown {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .breakdown-row {
    display: grid;
    grid-template-columns: 140px 1fr auto;
    align-items: center;
    gap: 12px;
  }
  .breakdown-label {
    font-family: var(--font-hand);
    font-size: 0.95rem;
    color: var(--color-ink);
    text-transform: capitalize;
  }
  .breakdown-bar-wrap {
    height: 12px;
    background: var(--color-rule);
    border-radius: 6px;
    overflow: hidden;
  }
  .breakdown-bar {
    height: 100%;
    background: var(--color-sage);
    border-radius: 6px;
    min-width: 4px;
    transition: width 0.3s;
  }
  .breakdown-stats {
    display: flex;
    gap: 8px;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  /* Table */
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-ui);
    font-size: 0.8rem;
  }
  th {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 2px solid var(--color-rule);
    color: var(--color-ink-light);
    font-weight: 500;
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.5px;
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-ink-faint);
    color: var(--color-ink);
  }
  tr:hover td {
    background: var(--color-hover);
  }

  /* Empty state */
  .empty {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--color-ink-light);
    font-family: var(--font-hand);
    font-size: 1.1rem;
  }

  /* Responsive */
  @media (max-width: 540px) {
    .summary-row {
      grid-template-columns: 1fr;
    }
    .stat-value {
      font-size: 1.4rem;
    }
    .breakdown-row {
      grid-template-columns: 1fr;
      gap: 4px;
    }
    .breakdown-stats {
      justify-content: flex-end;
    }
    .chart {
      height: 120px;
    }
    .bar-label {
      font-size: 0.5rem;
    }
  }
</style>
