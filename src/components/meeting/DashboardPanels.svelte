<svelte:options runes={false} />

<script>
  export let habits = [];
  export let projects = [];
  export let scorecard = [];
  export let animated = false;
</script>

<!-- Habits -->
<section class="panel" aria-labelledby="habits-heading">
  <h3 class="section-title" id="habits-heading">Habit Streaks</h3>
  {#if habits.length > 0}
    <div class="habits-grid" role="list" aria-label="Active habits">
      {#each habits as h}
        <div class="habit-chip" role="listitem" aria-label="{h.name}, {h.streak} day streak">
          <span class="habit-icon" aria-hidden="true">{h.icon}</span>
          <span>{h.name}</span>
          <span class="habit-streak" aria-hidden="true">{h.streak}</span>
        </div>
      {/each}
    </div>
  {:else}
    <div class="ghost" aria-label="Example habits">
      <div class="habits-grid">
        {#each [
          { icon: '\u25C7', name: 'Exercise', streak: 12 },
          { icon: '\u25C7', name: 'Read', streak: 5 },
          { icon: '\u25C7', name: 'Journal', streak: 3 },
        ] as h}
          <div class="habit-chip">
            <span class="habit-icon">{h.icon}</span>
            <span>{h.name}</span>
            <span class="habit-streak">{h.streak}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>

<!-- Projects -->
<section class="panel" aria-labelledby="projects-heading">
  <h3 class="section-title" id="projects-heading">Project Health</h3>
  {#if projects.length > 0}
    <div class="project-list" role="list" aria-label="Project status">
      {#each projects as p}
        {@const healthClass = p.health.includes('needs') ? 'needs' : p.health.includes('steady') ? 'steady' : ''}
        <div class="project-item" role="listitem" aria-label="{p.name}, {p.health}">
          <span class="project-velocity" style="color: {p.color}" aria-hidden="true">{p.velocity}</span>
          <span class="project-name">{p.name}</span>
          <span class="project-health {healthClass}">{p.health}</span>
        </div>
      {/each}
    </div>
  {:else}
    <div class="ghost" aria-label="Example projects">
      <div class="project-list">
        {#each [
          { velocity: '\u25B2', name: 'Product Launch', health: 'on track', color: 'var(--color-phase-orient)' },
          { velocity: '\u25BC', name: 'Blog Redesign', health: 'needs focus', color: 'var(--color-phase-commit)' },
          { velocity: '\u25B2', name: 'Q2 Planning', health: 'on track', color: 'var(--color-phase-orient)' },
        ] as p}
          {@const healthClass = p.health.includes('needs') ? 'needs' : ''}
          <div class="project-item">
            <span class="project-velocity" style="color: {p.color}">{p.velocity}</span>
            <span class="project-name">{p.name}</span>
            <span class="project-health {healthClass}">{p.health}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>

<!-- Scorecard -->
<section class="panel" aria-labelledby="scorecard-heading">
  <h3 class="section-title" id="scorecard-heading">Weekly Scorecard</h3>
  {#if scorecard.length > 0 && scorecard.some(s => s.pct > 0)}
    <div class="scorecard-grid" role="list" aria-label="Weekly metrics">
      {#each scorecard as item}
        <div class="scorecard-card" role="listitem">
          <div class="scorecard-label">{item.label}</div>
          <div class="scorecard-value">{item.value}</div>
          <div class="scorecard-bar" role="progressbar" aria-valuenow={item.pct} aria-valuemin={0} aria-valuemax={100} aria-label="{item.label}: {item.pct}%">
            <div class="scorecard-bar-fill" style="width: {animated ? item.pct : 0}%"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="ghost" aria-label="Example scorecard">
      <div class="scorecard-grid">
        {#each [
          { label: 'Tasks Done', value: '8/12', pct: 67 },
          { label: 'Habits', value: '3 tracked', pct: 45 },
        ] as item}
          <div class="scorecard-card">
            <div class="scorecard-label">{item.label}</div>
            <div class="scorecard-value">{item.value}</div>
            <div class="scorecard-bar">
              <div class="scorecard-bar-fill" style="width: {item.pct}%"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .panel { margin-bottom: 24px; }
  .ghost { opacity: 0.3; pointer-events: none; }
  .section-title {
    font-family: var(--font-display);
    font-size: 20px;
    color: var(--color-ink);
    margin-bottom: 12px;
    font-weight: 600;
  }

  /* Habits */
  .habits-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .habit-chip {
    background: var(--color-paper-bright);
    border: 1px solid var(--color-ink-faint);
    padding: 6px 10px;
    border-radius: 12px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 1px 1px 4px rgba(0,0,0,0.06);
    color: var(--color-ink);
  }
  .habit-icon { font-size: 14px; }
  .habit-streak {
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 600;
    color: var(--color-accent);
  }
  .habit-streak::after { content: '\1F525'; margin-left: 2px; }

  /* Projects */
  .project-list { display: flex; flex-direction: column; gap: 8px; }
  .project-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    padding: 6px;
    background: var(--color-paper-bright);
    border-radius: 4px;
    color: var(--color-ink);
  }
  .project-velocity { font-size: 14px; flex-shrink: 0; }
  .project-name { flex: 1; }
  .project-health {
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 6px;
    background: rgba(90,158,74,0.15);
    color: var(--color-phase-orient);
  }
  .project-health.steady {
    background: rgba(184,150,11,0.15);
    color: var(--color-gold);
  }
  .project-health.needs {
    background: rgba(196,90,58,0.15);
    color: var(--color-phase-commit);
  }

  /* Scorecard */
  .scorecard-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
  .scorecard-card {
    background: var(--color-paper-bright);
    border: 1px solid var(--color-ink-faint);
    padding: 10px;
    border-radius: 6px;
    box-shadow: 2px 2px 6px rgba(0,0,0,0.06);
  }
  .scorecard-label {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--color-ink);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  .scorecard-value {
    font-family: var(--font-display);
    font-size: 20px;
    color: var(--color-ink);
    font-weight: 700;
    margin-bottom: 6px;
  }
  .scorecard-bar {
    height: 4px;
    background: var(--color-ink-faint);
    border-radius: 2px;
    overflow: hidden;
    opacity: 0.6;
  }
  .scorecard-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--color-gold), #d4a756);
    transition: width 1s ease;
  }
</style>
