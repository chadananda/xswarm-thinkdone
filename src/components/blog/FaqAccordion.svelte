<script>
  let { items = [] } = $props();
  let openIndex = $state(-1);

  function toggle(i) {
    openIndex = openIndex === i ? -1 : i;
  }
</script>

<div class="faq-accordion">
  {#each items as item, i}
    <div class="faq-item" class:faq-item-open={openIndex === i}>
      <button
        class="faq-question"
        onclick={() => toggle(i)}
        aria-expanded={openIndex === i}
      >
        <span>{item.q}</span>
        <span class="faq-toggle" aria-hidden="true">{openIndex === i ? '−' : '+'}</span>
      </button>
      {#if openIndex === i}
        <div class="faq-answer">
          <p>{item.a}</p>
        </div>
      {/if}
    </div>
  {/each}
</div>
