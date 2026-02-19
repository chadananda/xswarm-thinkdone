<svelte:options runes={false} />

<script>
  import { createEventDispatcher, afterUpdate, onMount, onDestroy } from 'svelte';
  import { resolveTtsProvider } from '../../lib/speech-service.js';
  import VoiceOrb from './VoiceOrb.svelte';

  export let messages = [];
  export let voiceActive = false;
  export let streaming = false;
  export let pendingVoiceText = '';
  export let speechService = null;
  export let s2sMode = false;
  export let liveAiTranscript = '';
  export let liveUserTranscript = '';

  const dispatch = createEventDispatcher();
  let inputText = '';
  let inputFocused = false;
  let chatArea;
  let textareaEl;

  // ── Audio / TTS state ──
  let audioEnabled = false;
  let speaking = false;
  let spokenLen = 0;
  let lastSpokenMsgCount = 0;

  // ── Paced display ──
  let pacedText = '';
  let pacedTimer = null;
  let pacedCharIdx = 0;
  let wasStreaming = false;

  // ~250 WPM ≈ 21 chars/sec → reveal ~3 chars every 140ms
  const PACE_INTERVAL = 140;
  const PACE_CHARS = 3;

  onMount(() => {
    if (typeof localStorage !== 'undefined') {
      audioEnabled = localStorage.getItem('thinkdone_audio') === '1';
    }
  });

  onDestroy(() => {
    stopPacing();
    if (autoSendTimer) clearTimeout(autoSendTimer);
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    speechService?.stopSpeaking();
  });

  function toggleAudio() {
    audioEnabled = !audioEnabled;
    console.log(`[ChatPanel] toggleAudio → ${audioEnabled} speechService=${!!speechService} profile=${speechService?.profileId}`);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('thinkdone_audio', audioEnabled ? '1' : '0');
    }
    if (!audioEnabled) {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      speechService?.stopSpeaking();
      speaking = false;
      stopPacing();
    }
  }

  // ── TTS: queue new sentences as they stream ──
  $: if (audioEnabled && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'ai') {
      // Reset when a new AI message begins
      if (messages.length !== lastSpokenMsgCount) {
        spokenLen = 0;
        lastSpokenMsgCount = messages.length;
        if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      }
      queueSentences(lastMsg.text);
    }
  }

  // Speak remaining text when streaming finishes
  $: if (!streaming && wasStreaming) {
    if (audioEnabled && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'ai') {
        const rest = lastMsg.text.slice(spokenLen).trim();
        if (rest) {
          spokenLen = lastMsg.text.length;
          speak(rest);
        }
      }
    }
    finishPacing();
  }

  $: wasStreaming = streaming;

  function queueSentences(fullText) {
    const newText = fullText.slice(spokenLen);
    if (!newText || newText.length < 2) return;
    // Find the last sentence boundary (. ! ? or \n followed by whitespace)
    let cut = -1;
    for (let i = 0; i < newText.length - 1; i++) {
      if ('.!?\n'.includes(newText[i]) && /\s/.test(newText[i + 1])) {
        cut = i + 1;
      }
    }
    if (cut > 0) {
      const chunk = newText.slice(0, cut).trim();
      spokenLen += cut;
      if (chunk) speak(chunk);
    }
  }

  let audioContext = null;

  function speak(text) {
    // S2S mode: Gemini already speaks — skip TTS entirely
    if (s2sMode) return;
    const ttsProvider = speechService ? resolveTtsProvider(speechService.profileId) : 'none';
    const usePremium = speechService && ttsProvider !== 'browser';
    console.log(`[ChatPanel] speak() text="${text.slice(0, 50)}..." ttsProvider=${ttsProvider} usePremium=${usePremium}`);
    // Premium TTS via speechService WS — only if the profile's TTS provider isn't browser
    if (usePremium) {
      speaking = true;
      console.log('[ChatPanel] → calling speechService.speak()');
      speechService.speak(text).then(result => {
        console.log(`[ChatPanel] speechService.speak resolved: chunks=${result?.audioChunks?.length || 0} durationMs=${result?.durationMs}`);
        if (result?.audioChunks?.length) {
          playAudioChunks(result.audioChunks);
        } else {
          speaking = false;
        }
      }).catch((err) => { console.error('[ChatPanel] speechService.speak error:', err); speaking = false; });
      return;
    }
    // Browser-native SpeechSynthesis fallback
    console.log('[ChatPanel] → browser SpeechSynthesis');
    if (typeof speechSynthesis === 'undefined') return;
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.05;
    utt.onstart = () => { speaking = true; };
    utt.onend = () => { speaking = false; };
    utt.onerror = () => { speaking = false; };
    speechSynthesis.speak(utt);
  }

  function playAudioChunks(chunks) {
    console.log(`[ChatPanel] playAudioChunks() ${chunks.length} chunks, total=${chunks.reduce((s, c) => s + c.byteLength, 0)} bytes`);
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Concatenate chunks into single ArrayBuffer
    const totalLen = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(new Uint8Array(chunk instanceof ArrayBuffer ? chunk : chunk.buffer), offset);
      offset += chunk.byteLength;
    }
    audioContext.decodeAudioData(merged.buffer).then(audioBuffer => {
      console.log(`[ChatPanel] decoded audio: duration=${audioBuffer.duration.toFixed(2)}s sampleRate=${audioBuffer.sampleRate}`);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => { console.log('[ChatPanel] audio playback ended'); speaking = false; };
      source.start();
    }).catch((err) => { console.error('[ChatPanel] decodeAudioData error:', err); speaking = false; });
  }

  // ── Paced display: reveal streaming text at readable speed ──
  $: if (audioEnabled && streaming && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'ai' && !pacedTimer) {
      startPacing();
    }
  }

  function startPacing() {
    pacedCharIdx = 0;
    pacedText = '';
    pacedTimer = setInterval(() => {
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.role !== 'ai') return;
      const full = lastMsg.text;
      if (pacedCharIdx >= full.length) return; // caught up, waiting for more
      // Advance to next word boundary after PACE_CHARS more characters
      let target = Math.min(pacedCharIdx + PACE_CHARS, full.length);
      // Snap to word boundary (don't split mid-word)
      while (target < full.length && full[target] !== ' ' && full[target] !== '\n') target++;
      pacedCharIdx = target;
      pacedText = full.slice(0, pacedCharIdx);
    }, PACE_INTERVAL);
  }

  function finishPacing() {
    if (pacedTimer) {
      clearInterval(pacedTimer);
      pacedTimer = null;
    }
    // Snap to full text
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'ai') pacedText = lastMsg.text;
    }
    pacedCharIdx = 0;
  }

  function stopPacing() {
    finishPacing();
  }

  function compact(text) {
    return text.replace(/\n{2,}/g, '\n');
  }

  function displayText(msg, idx) {
    // S2S mode: no pacing, transcripts arrive after audio
    if (s2sMode) return compact(msg.text);
    // Only pace the last AI message while actively streaming with audio on
    if (audioEnabled && streaming && idx === messages.length - 1 && msg.role === 'ai') {
      return compact(pacedText);
    }
    return compact(msg.text);
  }

  // ── Input handlers ──
  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 150) + 'px';
  }

  function handleSend() {
    const text = inputText.trim();
    if (!text || streaming) return;
    console.log(`[ChatPanel] handleSend() text="${text.slice(0, 50)}..."`);
    // Stop any ongoing speech when user sends
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    speechService?.stopSpeaking();
    speaking = false;
    dispatch('send', { text });
    inputText = '';
    if (textareaEl) textareaEl.style.height = 'auto';
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  let autoSendTimer = null;

  function scheduleAutoSend(text) {
    console.log(`[ChatPanel] scheduleAutoSend() text="${text.slice(0, 50)}..."`);
    if (autoSendTimer) clearTimeout(autoSendTimer);
    inputText = text;
    autoSendTimer = setTimeout(() => {
      autoSendTimer = null;
      if (inputText.trim() && !streaming) handleSend();
    }, 300);
  }

  function handleTranscript(e) {
    const { text, isFinal } = e.detail;
    console.log(`[ChatPanel] handleTranscript text="${text.slice(0, 50)}" isFinal=${isFinal}`);
    if (isFinal) {
      scheduleAutoSend(text);
    }
  }

  $: if (pendingVoiceText) {
    scheduleAutoSend(pendingVoiceText);
  }

  afterUpdate(() => {
    if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
  });
</script>

<div class="chat-wrap">
  <div class="chat-area" role="log" aria-label="Meeting conversation" aria-live="polite" bind:this={chatArea}>
    {#if messages.length === 0 && !streaming && !liveAiTranscript && !liveUserTranscript}
      <div class="ghost-messages" aria-label="Conversation preview">
        <div class="message ai ghost">
          <div class="message-bubble">Good morning! I've reviewed your projects and have a few items to discuss. Ready to plan your day?</div>
        </div>
        <div class="message user ghost">
          <div class="message-bubble">Let's do it. I have a call at 2pm today.</div>
        </div>
        <div class="message ai ghost">
          <div class="message-bubble">Got it — I'll block that out. Let's start with your top priorities and work around the 2pm call.</div>
        </div>
      </div>
    {/if}
    {#each messages as msg, idx}
      <div class="message {msg.role}" role="article" aria-label="{msg.role === 'ai' ? 'Assistant' : 'You'} said">
        <div class="message-bubble">{displayText(msg, idx)}</div>
      </div>
    {/each}
    {#if liveUserTranscript}
      <div class="message user composing" role="status" aria-label="You are speaking">
        <div class="message-bubble">{liveUserTranscript}</div>
      </div>
    {/if}
    {#if liveAiTranscript}
      <div class="message ai composing" role="status" aria-label="Assistant is speaking">
        <div class="message-bubble">{liveAiTranscript}</div>
      </div>
    {/if}
    {#if streaming}
      <div class="typing-indicator" role="status" aria-label="Assistant is thinking">
        <span class="dot" aria-hidden="true"></span>
        <span class="dot" aria-hidden="true"></span>
        <span class="dot" aria-hidden="true"></span>
      </div>
    {/if}
  </div>


</div>

<div class="input-area" role="form" aria-label="Message input">
  <div class="orb-desktop">
    <VoiceOrb active={voiceActive} {speechService} on:click on:transcript={handleTranscript} />
  </div>
  <div class="input-bar" class:focused={inputFocused} class:disabled={streaming}>
    <label for="chat-input" class="sr-only">Message</label>
    <textarea
      id="chat-input"
      class="text-input"
      rows="1"
      placeholder={streaming ? "Thinking..." : voiceActive ? "Listening..." : "Message..."}
      bind:value={inputText}
      bind:this={textareaEl}
      on:keydown={handleKeydown}
      on:input={autoResize}
      on:focus={() => inputFocused = true}
      on:blur={() => inputFocused = false}
      disabled={streaming}
      aria-describedby={streaming ? 'chat-status' : undefined}
    ></textarea>
    {#if streaming}<span id="chat-status" class="sr-only">Assistant is generating a response</span>{/if}
    <button
      class="send-btn"
      class:ready={inputText.trim() && !streaming}
      on:click={handleSend}
      disabled={streaming || !inputText.trim()}
      aria-label="Send message"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    </button>
  </div>
</div>

<style>
  /* ── Chat wrapper (positions audio toggle) ── */
  .chat-wrap {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .chat-area {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    background: repeating-linear-gradient(
      transparent,
      transparent 23px,
      rgba(74,127,181,0.08) 23px,
      rgba(74,127,181,0.08) 24px
    );
    scrollbar-width: none;
  }
  .chat-area::-webkit-scrollbar { display: none; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ── Ghost placeholder messages ── */
  .ghost-messages {
    opacity: 0.3;
    pointer-events: none;
  }
  .message.ghost .message-bubble {
    box-shadow: none;
  }

  /* ── Messages ── */
  .message {
    margin-bottom: 4px;
    display: flex;
    flex-direction: column;
  }
  .message.ai { align-items: flex-start; }
  .message.user { align-items: flex-end; }
  .message-bubble {
    max-width: 70%;
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--color-paper-bright);
    box-shadow: 2px 2px 8px rgba(0,0,0,0.08);
    line-height: 1.45;
    font-size: 14px;
    color: var(--color-ink);
    white-space: pre-line;
  }
  .message.ai .message-bubble { border-bottom-left-radius: 4px; }
  .message.user .message-bubble {
    background: light-dark(#f0f4f7, #222838);
    border-bottom-right-radius: 4px;
  }

  /* ── Composing (live transcript) ── */
  .message.composing .message-bubble {
    opacity: 0.7;
    border: 1px dashed var(--color-ink-faint);
    font-style: italic;
  }

  /* ── Typing indicator ── */
  .typing-indicator {
    display: flex;
    gap: 6px;
    padding: 14px 18px;
    align-items: center;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-ink-muted);
    animation: bounce 1.4s infinite ease-in-out;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }

  /* ── Input area ── */
  .input-area {
    padding: 12px 16px;
    display: flex;
    align-items: flex-end;
    gap: 10px;
    border-top: 1px solid var(--color-rule);
    background: var(--color-paper);
  }
  .input-bar {
    flex: 1;
    display: flex;
    align-items: flex-end;
    gap: 0;
    border: 1.5px solid var(--color-ink-faint);
    border-radius: 22px;
    background: var(--color-paper-bright);
    padding: 4px 4px 4px 16px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .input-bar.focused {
    border-color: var(--color-gold);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-gold) 10%, transparent);
  }
  .input-bar.disabled {
    opacity: 0.6;
  }
  .text-input {
    flex: 1;
    padding: 8px 0;
    border: none;
    background: transparent;
    font-family: var(--font-ui);
    font-size: 14px;
    color: var(--color-ink);
    outline: none;
    min-width: 0;
    resize: none;
    overflow-y: auto;
    line-height: 1.4;
    max-height: 150px;
  }
  .text-input::placeholder {
    color: var(--color-ink-muted);
  }
  .send-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: none;
    background: var(--color-ink-faint);
    color: var(--color-paper-bright);
    cursor: default;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    transition: background 0.2s, transform 0.15s;
  }
  .send-btn svg {
    width: 16px;
    height: 16px;
  }
  .send-btn.ready {
    background: var(--color-accent);
    cursor: pointer;
  }
  .send-btn.ready:hover {
    background: var(--color-gold);
    transform: scale(1.06);
  }
  .send-btn:disabled:not(.ready) {
    opacity: 0.4;
  }

  @media (max-width: 768px) {
    .orb-desktop { display: none; }
    .input-area { padding: 10px 12px; }
  }
</style>
