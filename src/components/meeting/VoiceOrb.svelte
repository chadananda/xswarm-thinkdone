<svelte:options runes={false} />

<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { resolveSttProvider } from '../../lib/speech-service.js';

  export let active = false;
  export let mobile = false;
  export let speechService = null;
  export let s2sMode = false;

  const dispatch = createEventDispatcher();
  let recognition = null;
  let mediaRecorder = null;
  let mediaStream = null;

  function getSpeechRecognition() {
    if (typeof window === 'undefined') return null;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    return new SR();
  }

  function usePremiumSTT() {
    const result = speechService && resolveSttProvider(speechService.profileId) !== 'browser';
    console.log(`[VoiceOrb] usePremiumSTT=${result} profileId=${speechService?.profileId} sttProvider=${speechService ? resolveSttProvider(speechService.profileId) : 'none'}`);
    return result;
  }

  function startListening() {
    console.log('[VoiceOrb] startListening()');
    if (usePremiumSTT()) {
      startPremiumListening();
      return;
    }
    startBrowserListening();
  }

  function startBrowserListening() {
    console.log('[VoiceOrb] startBrowserListening()');
    recognition = getSpeechRecognition();
    if (!recognition) {
      dispatch('error', { message: 'Speech recognition not supported in this browser' });
      return;
    }
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let transcript = '';
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      dispatch('transcript', { text: transcript, isFinal });
    };

    recognition.onerror = (event) => {
      if (event.error !== 'aborted') {
        dispatch('error', { message: event.error });
      }
      active = false;
      dispatch('click');
    };

    recognition.onend = () => {
      if (active) {
        try { recognition.start(); } catch {}
      }
    };

    recognition.start();
  }

  async function startPremiumListening() {
    console.log('[VoiceOrb] startPremiumListening()');
    try {
      console.log('[VoiceOrb] requesting getUserMedia...');
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[VoiceOrb] got mediaStream, tracks:', mediaStream.getTracks().length);
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      console.log(`[VoiceOrb] creating MediaRecorder mime=${mime}`);
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType: mime });
      mediaRecorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          console.log(`[VoiceOrb] audio chunk ${e.data.size} bytes`);
          const buf = await e.data.arrayBuffer();
          speechService.sendAudio(buf);
        }
      };
      mediaRecorder.onerror = (err) => {
        console.error('[VoiceOrb] MediaRecorder error:', err);
        active = false;
        dispatch('click');
      };
      // Send audio in 250ms chunks
      console.log('[VoiceOrb] mediaRecorder.start(250) + speechService.listen()');
      mediaRecorder.start(250);
      // Register transcript callback and signal server to start listening
      speechService.listen((text, isFinal) => {
        console.log(`[VoiceOrb] premium transcript: "${text.slice(0, 60)}" final=${isFinal}`);
        dispatch('transcript', { text, isFinal });
      });
    } catch (err) {
      console.error('[VoiceOrb] startPremiumListening error:', err);
      dispatch('error', { message: err.message || 'Microphone access denied' });
      active = false;
      dispatch('click');
    }
  }

  function stopListening() {
    console.log(`[VoiceOrb] stopListening() recognition=${!!recognition} recorder=${!!mediaRecorder} stream=${!!mediaStream}`);
    if (recognition) {
      recognition.abort();
      recognition = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
    if (speechService && speechService.mode !== 'browser') {
      speechService.stopListening();
    }
  }

  function handleClick() {
    console.log(`[VoiceOrb] handleClick() active=${active} s2sMode=${s2sMode}`);
    if (s2sMode) {
      // S2S: parent manages mic lifecycle via toggleVoice
      dispatch('click');
      return;
    }
    if (active) {
      stopListening();
    } else {
      startListening();
    }
    dispatch('click');
  }

  onDestroy(() => {
    stopListening();
  });
</script>

<button
  class="voice-orb"
  class:active
  class:mobile
  on:click={handleClick}
  aria-label={active ? 'Stop listening' : 'Start voice input'}
  aria-pressed={active}
>
  <svg class="orb-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    {#if active}
      <rect x="6" y="4" width="12" height="12" rx="2" />
    {:else}
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0014 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    {/if}
  </svg>
</button>

<style>
  .voice-orb {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--color-paper-bright);
    border: 1.5px solid var(--color-ink-faint);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    flex-shrink: 0;
    padding: 0;
    color: var(--color-ink-muted);
  }
  .voice-orb:hover {
    border-color: var(--color-gold);
    color: var(--color-gold);
    background: color-mix(in srgb, var(--color-gold) 6%, var(--color-paper-bright));
  }
  .voice-orb.active {
    background: var(--color-gold);
    border-color: var(--color-gold);
    color: white;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-gold) 20%, transparent);
    animation: orb-pulse 1.8s ease-in-out infinite;
  }
  .voice-orb.mobile {
    width: 56px;
    height: 56px;
    box-shadow: 0 4px 12px rgba(184,120,32,0.3);
    background: radial-gradient(circle at 30% 30%, #d4a756, var(--color-gold), #b87820);
    border: none;
    color: white;
  }
  .voice-orb.mobile:hover {
    transform: scale(1.05);
    color: white;
  }
  .voice-orb.mobile.active {
    background: radial-gradient(circle at 30% 30%, #f4d794, #e4b868, #d4a756);
    box-shadow: 0 6px 20px rgba(184,120,32,0.5), 0 0 30px rgba(184,120,32,0.3);
  }
  @keyframes orb-pulse {
    0%, 100% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-gold) 20%, transparent); }
    50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--color-gold) 10%, transparent); }
  }
  .orb-icon {
    width: 18px;
    height: 18px;
    pointer-events: none;
  }
  .mobile .orb-icon {
    width: 24px;
    height: 24px;
  }
</style>
