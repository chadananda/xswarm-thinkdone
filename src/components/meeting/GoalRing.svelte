<svelte:options runes={false} />

<script>
  export let name = '';
  export let progress = 0;
  export let color = '';
  export let icon = '';
  export let animated = false;

  const R = 16;
  const C = 2 * Math.PI * R;
  $: offset = animated ? C - (progress / 100) * C : C;

  let tipEl;
  function clampTooltip() {
    if (!tipEl) return;
    tipEl.style.left = '50%';
    tipEl.style.transform = 'translateX(-50%)';
    const rect = tipEl.getBoundingClientRect();
    const pad = 8;
    if (rect.left < pad) {
      tipEl.style.left = '0';
      tipEl.style.transform = `translateX(${pad - rect.left}px)`;
    } else if (rect.right > window.innerWidth - pad) {
      tipEl.style.left = '0';
      tipEl.style.transform = `translateX(${window.innerWidth - pad - rect.right}px)`;
    }
  }
</script>

<div class="goal-ring" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="{name}: {progress}% complete"
  on:mouseenter={clampTooltip}>
  <svg width="36" height="36" aria-hidden="true">
    <circle class="ring-bg" cx="18" cy="18" r={R}/>
    <circle class="ring-progress" cx="18" cy="18" r={R}
      stroke={color}
      stroke-dasharray={C}
      stroke-dashoffset={offset}
    />
  </svg>
  <span class="goal-icon" aria-hidden="true">{icon}</span>
  <div class="goal-tooltip" bind:this={tipEl} role="tooltip">{name}: {progress}%</div>
</div>

<style>
  .goal-ring {
    position: relative;
    width: 36px;
    height: 36px;
    cursor: pointer;
  }
  .goal-ring svg { transform: rotate(-90deg); }
  .goal-ring circle {
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
  }
  .ring-bg { stroke: var(--color-ink-faint); opacity: 0.5; }
  .ring-progress { transition: stroke-dashoffset 1.2s ease; }
  .goal-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 14px;
    pointer-events: none;
  }
  .goal-ring:hover .goal-icon {
    transform: translate(-50%, -50%) scale(1.15);
  }
  .goal-tooltip {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-paper-bright);
    border: 1px solid var(--color-rule);
    padding: 6px 10px;
    border-radius: 6px;
    font-family: var(--font-ui);
    font-size: 11px;
    white-space: nowrap;
    box-shadow: 2px 2px 8px rgba(0,0,0,0.12);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
    z-index: 10;
    color: var(--color-ink);
  }
  .goal-ring:hover .goal-tooltip { opacity: 1; }
</style>
