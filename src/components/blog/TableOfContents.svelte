<script>
  let { headings = [] } = $props();
  let activeSlug = $state('');
  let isOpen = $state(false);
  //
  $effect(() => {
    const els = headings.map(h => document.getElementById(h.slug)).filter(Boolean);
    if (!els.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { activeSlug = entry.target.id; break; }
      }
    }, { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 });
    els.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  });
</script>
<!-- Mobile toggle -->
<button class="md:hidden flex items-center gap-2 font-ui text-sm text-ink-muted mb-3 hover:text-accent transition-colors" onclick={() => isOpen = !isOpen}>
  <svg class="w-4 h-4 transition-transform" class:rotate-90={isOpen} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
  </svg>
  Table of Contents
</button>
<!-- TOC list -->
<nav class="font-ui text-sm" class:hidden={!isOpen} class:md:block={true}>
  <ul class="space-y-1 border-l-2 border-rule pl-0">
    {#each headings as heading}
      <li style="padding-left: {(heading.depth - 2) * 12 + 12}px">
        <a
          href="#{heading.slug}"
          class="block py-1 no-underline transition-colors duration-200 border-l-2 -ml-[2px]"
          class:text-accent={activeSlug === heading.slug}
          class:border-accent={activeSlug === heading.slug}
          class:font-medium={activeSlug === heading.slug}
          class:text-ink-muted={activeSlug !== heading.slug}
          class:border-transparent={activeSlug !== heading.slug}
          class:hover:text-ink-light={activeSlug !== heading.slug}
        >
          {heading.text}
        </a>
      </li>
    {/each}
  </ul>
</nav>
