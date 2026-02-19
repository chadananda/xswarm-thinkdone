<svelte:options runes={false} />

<script>
  import GoalRing from './GoalRing.svelte';

  export let goals = [];
  export let events = [];
  export let animated = false;
</script>

<nav class="meeting-bar" aria-label="Meeting context">
  <div class="goal-orbit" role="group" aria-label="Active goals">
    {#if goals.length > 0}
      {#each goals as goal}
        <GoalRing {...goal} {animated} />
      {/each}
    {:else}
      <div class="ghost" aria-label="Example project goals">
        <div class="goal-orbit-inner">
          {#each [
            { name: 'Product Launch', progress: 65, color: 'var(--color-phase-decide)', icon: '\u25C8' },
            { name: 'Blog Redesign', progress: 30, color: 'var(--color-phase-reflect)', icon: '\u25C9' },
            { name: 'Q2 Planning', progress: 80, color: 'var(--color-phase-orient)', icon: '\u2726' },
            { name: 'Revenue Target', progress: 45, color: 'var(--color-gold)', icon: '\u25C7' },
            { name: 'Hiring Pipeline', progress: 20, color: 'var(--color-phase-commit)', icon: '\u2B21' },
            { name: 'Docs Update', progress: 90, color: 'var(--color-phase-create)', icon: '\u25CB' },
            { name: 'Mobile App', progress: 10, color: '#9b7fcf', icon: '\u25C7' },
          ] as goal}
            <GoalRing {...goal} animated={false} />
          {/each}
        </div>
      </div>
    {/if}
  </div>
  <div class="calendar-events" role="list" aria-label="Today's events">
    {#if events.length > 0}
      {#each events as event}
        <div class="event-chip" role="listitem">
          <span class="event-time">{event.time}</span>
          <span>{event.title}</span>
        </div>
      {/each}
    {:else}
      <div class="ghost" aria-label="Example meetings">
        <div class="events-inner">
          <div class="event-chip">
            <span class="event-time">9:00 AM</span>
            <span>Daily standup</span>
          </div>
          <div class="event-chip">
            <span class="event-time">11:30 AM</span>
            <span>Gilbert &mdash; Q1 planning</span>
          </div>
          <div class="event-chip">
            <span class="event-time">2:00 PM</span>
            <span>Dr. Riazati &mdash; OoL review</span>
          </div>
        </div>
      </div>
    {/if}
  </div>
</nav>

<style>
  .meeting-bar {
    background: var(--color-warm);
    border-bottom: 1px solid var(--color-rule);
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 20px;
    flex-shrink: 0;
  }
  .meeting-label {
    font-family: var(--font-display);
    font-size: 14px;
    color: var(--color-ink-light);
    letter-spacing: 0.5px;
  }
  .goal-orbit {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-right: auto;
  }
  .ghost { opacity: 0.3; pointer-events: none; }
  .goal-orbit-inner { display: flex; gap: 10px; align-items: center; }
  .events-inner { display: flex; gap: 8px; }
  .calendar-events { display: flex; gap: 8px; }
  .event-chip {
    background: var(--color-paper-bright);
    border: 1px solid var(--color-ink-faint);
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 1px 1px 4px rgba(0,0,0,0.06);
    color: var(--color-ink);
  }
  .event-chip:nth-child(1) { transform: rotate(-0.5deg); }
  .event-chip:nth-child(2) { transform: rotate(0.5deg); }
  .event-chip:nth-child(3) { transform: rotate(-0.3deg); }
  .event-time {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--color-accent);
    font-weight: 600;
  }

  @media (max-width: 768px) {
    .meeting-bar {
      flex-wrap: wrap;
      padding: 10px 12px;
      gap: 10px;
    }
    .goal-orbit {
      order: 3;
      width: 100%;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .goal-orbit::-webkit-scrollbar { display: none; }
    .calendar-events { flex-wrap: wrap; }
  }
</style>
