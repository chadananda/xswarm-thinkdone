<svelte:options runes={false} />

<script>
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';

  export let agenda = [];
  export let animated = false;

  const PHASE_MAP = {
    reflect: '--color-phase-reflect',
    orient: '--color-phase-orient',
    decide: '--color-phase-decide',
    create: '--color-phase-create',
    commit: '--color-phase-commit',
  };

  const R = 13;
  const C = 2 * Math.PI * R;

  // Custom poof transition: brief expand then shrink + fade
  function poof(node, { duration = 350 }) {
    return {
      duration,
      css: (t) => {
        let s, o;
        if (t > 0.7) {
          const p = (1 - t) / 0.3;
          s = 1 + p * 0.12;
          o = 1;
        } else {
          const p = t / 0.7;
          s = p * 1.12;
          o = Math.pow(p, 0.5);
        }
        return `opacity: ${o}; transform: scale(${s}); transform-origin: center;`;
      },
    };
  }

  $: doneCount = agenda.filter(a => a.status === 'done').length;
  $: total = agenda.length;
  $: offset = animated && total > 0 ? C - (doneCount / total) * C : C;
  $: visible = agenda.filter(a => a.status !== 'done');
</script>

<div class="section-title" id="agenda-heading">
  <span class="section-name">Agenda</span>
  <div class="agenda-ring" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={total} aria-label="Agenda progress: {doneCount} of {total} items complete">
    <svg width="30" height="30" aria-hidden="true">
      <circle class="ring-bg" cx="15" cy="15" r={R}/>
      <circle class="ring-fill" cx="15" cy="15" r={R}
        stroke-dasharray={C}
        stroke-dashoffset={offset}
      />
    </svg>
    <span class="agenda-label" aria-hidden="true">{doneCount}/{total}</span>
  </div>
</div>
<div class="agenda-list" role="list" aria-labelledby="agenda-heading">
  {#if visible.length > 0 || doneCount > 0}
    {#each visible as item (item.id)}
      <div
        class="agenda-item {item.status}"
        role="listitem"
        aria-label="{item.text} — {item.phase} phase, {item.status}"
        in:fade={{ duration: 200 }}
        out:poof={{ duration: 350 }}
        animate:flip={{ duration: 200 }}
      >
        <span class="agenda-dot" aria-hidden="true"></span>
        <span class="agenda-text">{item.text}</span>
        <span class="agenda-phase" style="--phase-color: var({PHASE_MAP[item.phase]})">{item.phase}</span>
      </div>
    {/each}
  {:else}
    <div class="empty-agenda" role="status">Agenda builds as the meeting starts</div>
  {/if}
</div>

<style>
  .section-title {
    font-family: var(--font-display);
    font-size: 20px;
    color: var(--color-ink);
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 2px dashed var(--color-ink-faint);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .section-name {
    font-size: 26px;
    color: var(--color-accent);
  }
  .agenda-ring {
    position: relative;
    width: 30px;
    height: 30px;
    margin-left: auto;
    flex-shrink: 0;
  }
  .agenda-ring svg { transform: rotate(-90deg); }
  .agenda-ring circle { fill: none; stroke-linecap: round; }
  .ring-bg { stroke: var(--color-ink-faint); opacity: 0.5; stroke-width: 3; }
  .ring-fill { stroke: var(--color-gold); stroke-width: 3; transition: stroke-dashoffset 0.8s ease; }
  .agenda-label {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
    font-family: var(--font-ui); font-size: 10px; font-weight: 600; color: var(--color-ink);
  }
  .agenda-list {
    display: flex; flex-direction: column; gap: 3px; position: relative;
    max-height: 55vh; overflow-y: auto;
    scrollbar-width: none;
  }
  .agenda-list::-webkit-scrollbar { display: none; }
  .empty-agenda {
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--color-ink-light);
    text-align: center;
    padding: 20px 12px;
    border: 1.5px dashed var(--color-ink-muted);
    border-radius: 6px;
    letter-spacing: 0.3px;
  }
  .agenda-item {
    padding: 5px 8px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
    background: #faf7f0;
    border: 1px solid rgba(60,40,20,0.06);
    box-shadow: 1px 1px 3px rgba(60,40,20,0.05);
  }
  .agenda-item.active {
    background: #fff8e8;
    border-left: 3px solid rgba(196,136,46,0.3);
    padding-left: 5px;
  }
  .agenda-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .agenda-item.active .agenda-dot { background: var(--color-accent); }
  .agenda-item.pending .agenda-dot { background: var(--color-ink-light); opacity: 0.4; }
  .agenda-text {
    flex: 1;
    font-size: 12px;
    line-height: 1.25;
    color: var(--color-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agenda-phase {
    font-family: var(--font-ui);
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 6px;
    font-weight: 600;
    text-transform: uppercase;
    background: color-mix(in srgb, var(--phase-color) 15%, transparent);
    color: var(--phase-color);
    flex-shrink: 0;
  }
</style>
