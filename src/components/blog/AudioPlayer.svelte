<script>
  import { Howl } from 'howler';

  let { src, duration = '' } = $props();

  let playing = $state(false);
  let currentTime = $state(0);
  let totalDuration = $state(0);
  let speed = $state(1);
  let sound = $state(null);
  let progressInterval = $state(null);

  const speeds = [1, 1.5, 2];

  $effect(() => {
    sound = new Howl({
      src: [src],
      html5: true,
      preload: 'metadata',
      onplay: () => {
        playing = true;
        progressInterval = setInterval(() => {
          currentTime = sound.seek() || 0;
        }, 250);
      },
      onpause: () => {
        playing = false;
        clearInterval(progressInterval);
      },
      onend: () => {
        playing = false;
        currentTime = 0;
        clearInterval(progressInterval);
      },
      onload: () => {
        totalDuration = sound.duration();
      },
    });
    return () => {
      clearInterval(progressInterval);
      sound?.unload();
    };
  });

  function togglePlay() {
    if (!sound) return;
    if (playing) {
      sound.pause();
    } else {
      sound.play();
    }
  }

  function seek(e) {
    if (!sound) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const t = pct * (totalDuration || 1);
    sound.seek(t);
    currentTime = t;
  }

  function cycleSpeed() {
    const idx = speeds.indexOf(speed);
    speed = speeds[(idx + 1) % speeds.length];
    if (sound) sound.rate(speed);
  }

  function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  let progress = $derived(totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0);
</script>

<div class="audio-player">
  <button onclick={togglePlay} class="audio-play-btn" aria-label={playing ? 'Pause' : 'Play'}>
    {#if playing}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
    {:else}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
    {/if}
  </button>

  <div class="audio-progress-wrap" onclick={seek} role="slider" tabindex="0" aria-label="Audio progress" aria-valuenow={Math.round(progress)} aria-valuemin="0" aria-valuemax="100">
    <div class="audio-progress-bar" style="width:{progress}%"></div>
  </div>

  <span class="audio-time">{fmt(currentTime)} / {duration || fmt(totalDuration)}</span>

  <button onclick={cycleSpeed} class="audio-speed-btn" aria-label="Playback speed">
    {speed}x
  </button>
</div>
