<svelte:options runes={false} />

<script>
  import { onMount, onDestroy } from 'svelte';
  import MeetingBar from './meeting/MeetingBar.svelte';
  import PriorityStack from './meeting/PriorityStack.svelte';
  import ChatPanel from './meeting/ChatPanel.svelte';
  import AgendaPanel from './meeting/AgendaPanel.svelte';
  import DashboardPanels from './meeting/DashboardPanels.svelte';
  import VoiceOrb from './meeting/VoiceOrb.svelte';

  // Engine imports
  import { getDb, ensureSchema, getTasks, seedPersonality, clearDatabase, storeUsage, getSetting, getConnection, updateAccessToken } from '../lib/db.js';
  import { createSession, initializeSession, processUserMessage, deliverOpeningTurn, transitionState, assembleS2sSystemPrompt } from '../lib/conversation.js';
  import { calculateCost } from '../lib/usage.js';
  import { generateMorningAgenda, generateOnboardingAgenda } from '../lib/agenda.js';
  import { getRoutinesForMeeting, getHabitAnalytics } from '../lib/routines-engine.js';
  import { getStreak } from '../lib/routines.js';
  import { getProjects } from '../lib/gtd-engine.js';
  import { processExtractions, extractFromTranscript, processOnboardingExtractions, persistConversation, persistOnboardingSummary, carryOverDeferred } from '../lib/extraction.js';
  import { resolveItem, deferItem } from '../lib/agenda.js';
  import { buildProviderChain, PROVIDER_ORDER, SESSION_TIER_MAP, getAllProviders } from '../lib/providers.js';
  import { ensureFreshToken } from '../lib/provider.js';
  import { createSpeechService, resolveMode, resolveTtsProvider, canDirectConnect, SPEECH_PROVIDER_CONNECTION_MAP } from '../lib/speech-service.js';

  let tasks = [];
  let voiceActive = false;
  let activeTab = 'chat';
  let mounted = false;
  let loading = true;
  let meetingStarted = false;
  let db = null;
  let session = null;

  // Live data (replaces mock constants)
  let goals = [];
  let agenda = [];
  let messages = [];
  let events = [];
  let habits = [];
  let projects = [];
  let scorecard = [];
  let streaming = false;
  let providerChain = [];
  let speechService = null;

  // S2S state
  let s2sMode = false;
  let s2sApiKey = null;
  let s2sIsOAuth = false;
  let playbackCtx = null;
  let streamPlayhead = 0;
  let userTranscript = '';
  let micAudioCtx = null;
  let micProcessor = null;
  let micStream = null;
  let browserRecognition = null;

  // --- Initialize ---
  async function init() {
    try {
      db = await getDb();
      await ensureSchema(db);
      await seedPersonality(db);

      // Build provider chain from settings + connections (including custom providers)
      const enabledJson = await getSetting(db, 'ai_providers_enabled');
      const enabledIds = enabledJson ? JSON.parse(enabledJson) : ['thinkdone'];
      const customJson = await getSetting(db, 'custom_providers');
      const allProviders = getAllProviders(customJson);
      const connections = [];
      for (const id of Object.keys(allProviders)) {
        const conn = await getConnection(db, id);
        if (conn) connections.push(conn);
      }

      // ?reset clears all data for a fresh start
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('reset')) {
        await clearDatabase(db);
        window.history.replaceState({}, '', window.location.pathname);
      }

      // First-time detection: onboarding if no prior conversations
      const { cnt } = await db.prepare('SELECT COUNT(*) as cnt FROM conversations').get();
      if (cnt === 0) {
        session = createSession('onboarding');
        await initializeSession(session, db, () => generateOnboardingAgenda());
      } else {
        session = createSession('morning_meeting');
        await initializeSession(session, db, generateMorningAgenda);
      }

      // Build provider chain with tier-appropriate model selection
      const tier = SESSION_TIER_MAP[session.type] || 'standard';
      providerChain = buildProviderChain(enabledIds, connections, tier, allProviders);

      const today = new Date().toISOString().slice(0, 10);
      tasks = await getTasks(db, today);
      syncAgenda();
      await loadDashboardData(today);

      // Initialize speech service from saved profile
      try {
        const profileId = await getSetting(db, 'speech_profile') || 'browser-native';
        const mode = resolveMode(profileId);
        console.log(`[Dashboard] speech init: profile=${profileId} mode=${mode}`);
        let apiKey = null;
        let isOAuth = false;
        if (mode !== 'browser') {
          const ttsP = resolveTtsProvider(profileId);
          const connKey = SPEECH_PROVIDER_CONNECTION_MAP[ttsP] || ttsP;
          const conn = await getConnection(db, connKey);
          apiKey = conn?.access_token || null;
          isOAuth = !!(conn?.refresh_token);
          // Refresh expired OAuth tokens before using them
          if (isOAuth && conn) {
            try {
              apiKey = await ensureFreshToken(conn);
              if (conn._refreshed) await updateAccessToken(db, connKey, conn.access_token, conn.expires_at);
            } catch (e) {
              console.error('[Dashboard] token refresh failed:', e);
            }
          }
          console.log(`[Dashboard] speech: ttsProvider=${ttsP} connKey=${connKey} hasApiKey=${!!apiKey} isOAuth=${isOAuth}`);
        }
        // S2S mode: Gemini Live with meeting system prompt
        if (mode === 's2s' && apiKey && canDirectConnect(profileId)) {
          console.log('[Dashboard] → S2S mode: assembling system prompt for Gemini Live');
          const { flat } = await assembleS2sSystemPrompt(session, db);
          speechService = createSpeechService(profileId, {
            apiKey: isOAuth ? undefined : apiKey,
            accessToken: isOAuth ? apiKey : undefined,
            systemPrompt: flat,
          });
          s2sMode = true;
          s2sApiKey = apiKey;
          s2sIsOAuth = isOAuth;
          console.log('[Dashboard] S2S mode enabled');
        } else if (apiKey && canDirectConnect(profileId)) {
          // Try browser-direct first (no server needed)
          console.log('[Dashboard] → browser-direct speech path');
          speechService = createSpeechService(profileId, {
            apiKey: isOAuth ? undefined : apiKey,
            accessToken: isOAuth ? apiKey : undefined,
          });
        } else if (mode !== 'browser') {
          speechService = createSpeechService(profileId, {
            WebSocket: globalThis.WebSocket,
            wsUrl: `ws://${location.host}/ws/speech`,
            apiKey,
          });
        } else {
          speechService = createSpeechService(profileId);
        }
        console.log(`[Dashboard] speechService created: mode=${speechService.mode} s2s=${s2sMode} profileId=${speechService.profileId}`);
      } catch (err) {
        console.error('[Dashboard] Speech service init failed:', err);
      }

      loading = false;
      if (typeof window !== 'undefined') window.__initDone = true;
    } catch (err) {
      console.error('MeetingDashboard init failed:', err);
      loading = false;
    }
  }

  function syncAgenda() {
    if (!session) return;
    agenda = session.agenda.map(item => ({
      id: item.id,
      text: item.content,
      question: item.question,
      phase: typeToPhase(item.type),
      status: item.status === 'resolved' ? 'done' : item.status,
      priority: item.priority,
    }));
  }

  function typeToPhase(type) {
    const map = {
      'REFLECT': 'reflect',
      'DECIDE': 'decide',
      'COMMIT': 'commit',
      'INFORM': 'orient',
      'RESEARCH': 'create',
      'PLAN': 'decide',
      'FOLLOW-UP': 'commit',
    };
    return map[type] || 'orient';
  }

  async function loadDashboardData(today) {
    if (!db) return;

    // Load routines for meeting
    try {
      const routineData = await getRoutinesForMeeting(db, 'morning_meeting', today);

      // Build habits with streaks
      const allHabits = [
        ...(routineData.slots?.morning || []),
        ...(routineData.slots?.midday || []),
        ...(routineData.slots?.anytime || []),
        ...(routineData.slots?.evening || []),
      ];
      habits = [];
      for (const h of allHabits) {
        const streak = await getStreak(db, h.id);
        habits.push({ name: h.name, streak, icon: '\u25C7' });
      }

      // Build events from reminders + events
      events = [];
      for (const r of (routineData.reminders || [])) {
        events.push({ time: r.specific_time || r.time_slot || '', title: r.name });
      }
      for (const e of (routineData.events || [])) {
        events.push({ time: e.specific_time || '', title: e.name });
      }
    } catch (err) {
      console.error('Failed to load routines:', err);
    }

    // Load projects
    try {
      const projectData = await getProjects(db);
      projects = projectData.map(p => ({
        name: p.project,
        velocity: p.stale ? '\u25BC' : '\u25B2',
        health: p.stale ? 'needs focus' : 'on track',
        color: p.stale ? 'var(--color-phase-commit)' : 'var(--color-phase-orient)',
      }));
    } catch (err) {
      console.error('Failed to load projects:', err);
    }

    // Build goals from top projects
    goals = projects.slice(0, 4).map((p, i) => {
      const colors = [
        'var(--color-phase-decide)',
        'var(--color-phase-reflect)',
        'var(--color-phase-orient)',
        'var(--color-gold)',
      ];
      const icons = ['\u25C8', '\u25C9', '\u2726', '\u2B21'];
      return { name: p.name, progress: 0, color: colors[i] || colors[0], icon: icons[i] || icons[0] };
    });

    // Scorecard: tasks done this week + habits this week
    try {
      const weekTasks = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        const dayTasks = await getTasks(db, d);
        weekTasks.push(...dayTasks);
      }
      const tasksDone = weekTasks.filter(t => t.checked).length;
      const tasksTotal = weekTasks.length || 1;

      scorecard = [
        { label: 'Tasks Done', value: `${tasksDone}/${tasksTotal}`, pct: Math.round((tasksDone / tasksTotal) * 100) },
        { label: 'Habits', value: `${habits.length} tracked`, pct: habits.length ? Math.min(100, habits.reduce((s, h) => s + (h.streak > 0 ? 1 : 0), 0) / habits.length * 100) : 0 },
      ];
    } catch {
      scorecard = [];
    }
  }

  // --- Start Meeting (from lobby) ---
  async function startMeeting() {
    meetingStarted = true;
    if (s2sMode) {
      initS2sConversation();
      return;
    }
    // Text mode: AI delivers opening turn
    streaming = true;
    let streamedText = '';
    const result = await deliverOpeningTurn(session, db, (chunk) => {
      streamedText += chunk;
      messages = [{
        role: 'ai',
        text: streamedText.replace(/<meeting_state>[\s\S]*?<\/meeting_state>/, '').trim(),
      }];
    }, { chain: providerChain });

    // Process extractions
    if (result.extractions) {
      await processExtractions(db, result.extractions);
    }
    if (result.agendaUpdates) {
      for (const r of result.agendaUpdates.resolves) {
        resolveItem(session.agenda, r.id, r.resolution);
      }
      for (const d of result.agendaUpdates.defers) {
        deferItem(session.agenda, d.id);
      }
    }
    if (result.usage) {
      const cost = calculateCost(result.usage.model, result.usage.input_tokens, result.usage.output_tokens, {
        cacheReadTokens: result.usage.cache_read_input_tokens || 0,
        cacheWriteTokens: result.usage.cache_creation_input_tokens || 0,
      });
      await storeUsage(db, {
        sessionType: session.type,
        model: result.usage.model,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        costUsd: cost,
        provider: result.usedProvider?.providerId || 'thinkdone',
        cacheReadTokens: result.usage.cache_read_input_tokens || 0,
        cacheWriteTokens: result.usage.cache_creation_input_tokens || 0,
      });
    }

    // Finalize messages and agenda
    messages = session.messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'ai',
      text: m.content,
    }));
    syncAgenda();
    streaming = false;
  }

  // --- S2S Conversation ---

  function initS2sConversation() {
    if (!speechService || !s2sMode) return;
    console.log('[Dashboard] initS2sConversation: wiring S2S callbacks');

    // Streaming PCM playback — zero-latency audio as chunks arrive
    speechService.onStreamingAudio((pcmData) => {
      streamPcmChunk(pcmData);
    });

    // Full turn complete — transcript + WAV
    speechService.onAiAudio((wav, transcript) => {
      handleS2sTurnComplete(transcript);
    });

    // Send opening context so Gemini greets the user
    const openingText = buildOpeningText();
    console.log(`[Dashboard] S2S sending opening: "${openingText.slice(0, 80)}..."`);
    speechService.speak(openingText);
  }

  function buildOpeningText() {
    const agendaItems = session.agenda
      .filter(a => a.status === 'pending')
      .slice(0, 5)
      .map(a => a.content)
      .join(', ');
    const agendaPart = agendaItems ? ` Today's agenda includes: ${agendaItems}.` : '';
    return `Start the meeting. Greet the user with a brief, warm morning greeting.${agendaPart} Then introduce the first agenda item and ask one question.`;
  }

  function streamPcmChunk(pcmData) {
    if (!playbackCtx) {
      playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      streamPlayhead = playbackCtx.currentTime;
    }
    // Convert PCM 16-bit LE to float32
    const samples = pcmData.length / 2;
    const float32 = new Float32Array(samples);
    const view = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
    for (let i = 0; i < samples; i++) {
      float32[i] = view.getInt16(i * 2, true) / 32768;
    }
    const buffer = playbackCtx.createBuffer(1, samples, 24000);
    buffer.copyToChannel(float32, 0);
    const source = playbackCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackCtx.destination);
    // Schedule on timeline for gapless playback
    const startAt = Math.max(playbackCtx.currentTime, streamPlayhead);
    source.start(startAt);
    streamPlayhead = startAt + buffer.duration;
  }

  async function handleS2sTurnComplete(transcript) {
    if (!session || !db) return;
    console.log(`[Dashboard] S2S turn complete: user="${userTranscript.slice(0, 60)}" ai="${transcript.slice(0, 60)}"`);

    // Add user message from browser STT
    if (userTranscript.trim()) {
      session.messages.push({ role: 'user', content: userTranscript.trim() });
    }
    // Add assistant transcript
    if (transcript.trim()) {
      session.messages.push({ role: 'assistant', content: transcript.trim() });
    }

    // Update reactive messages for ChatPanel
    messages = session.messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'ai',
      text: m.content,
    }));

    // Post-hoc extraction via Gemini Flash text API
    if (transcript.trim()) {
      try {
        const result = await extractFromTranscript(transcript, {
          apiKey: s2sIsOAuth ? undefined : s2sApiKey,
          accessToken: s2sIsOAuth ? s2sApiKey : undefined,
          agenda: session.agenda,
          meetingType: session.type,
        });

        // Process extractions
        if (result.extractions) {
          await processExtractions(db, result.extractions);
        }

        // Apply agenda updates
        if (result.agendaUpdates) {
          for (const r of result.agendaUpdates.resolves) {
            resolveItem(session.agenda, r.id, r.resolution);
          }
          for (const d of result.agendaUpdates.defers) {
            deferItem(session.agenda, d.id);
          }
        }
      } catch (err) {
        console.error('[Dashboard] S2S extraction failed:', err);
      }
    }

    // Advance state machine
    if (session.state === 'OPENING') {
      transitionState(session, 'user_message');
    }
    transitionState(session, 'turn_complete');

    // Refresh tasks and agenda
    const today = new Date().toISOString().slice(0, 10);
    tasks = await getTasks(db, today);
    syncAgenda();

    // Reset user transcript for next turn
    userTranscript = '';
  }

  function startS2sMic() {
    console.log('[Dashboard] startS2sMic');
    // 16kHz AudioContext for mic capture
    micAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      micStream = stream;
      const source = micAudioCtx.createMediaStreamSource(stream);
      // ScriptProcessorNode: 4096 samples per buffer at 16kHz
      micProcessor = micAudioCtx.createScriptProcessor(4096, 1, 1);
      micProcessor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0);
        // Convert float32 to 16-bit PCM LE
        const pcm = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          pcm[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32768)));
        }
        speechService.sendAudio(new Uint8Array(pcm.buffer));
      };
      source.connect(micProcessor);
      micProcessor.connect(micAudioCtx.destination);
      console.log('[Dashboard] mic capture active at 16kHz');
    }).catch(err => {
      console.error('[Dashboard] mic access denied:', err);
      voiceActive = false;
    });

    // Parallel: browser SpeechRecognition for user transcript
    startBrowserSTT();
  }

  function stopS2sMic() {
    console.log('[Dashboard] stopS2sMic');
    if (micProcessor) { micProcessor.disconnect(); micProcessor = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (micAudioCtx) { micAudioCtx.close().catch(() => {}); micAudioCtx = null; }
    stopBrowserSTT();
  }

  function startBrowserSTT() {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    browserRecognition = new SR();
    browserRecognition.continuous = true;
    browserRecognition.interimResults = true;
    browserRecognition.lang = 'en-US';
    browserRecognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      userTranscript = transcript;
    };
    browserRecognition.onend = () => {
      if (voiceActive && browserRecognition) {
        try { browserRecognition.start(); } catch {}
      }
    };
    browserRecognition.start();
  }

  function stopBrowserSTT() {
    if (browserRecognition) {
      browserRecognition.abort();
      browserRecognition = null;
    }
  }

  // --- Send Message ---
  async function handleSendMessage(event) {
    const text = event.detail?.text;
    if (!text || !session || !db || streaming) return;

    // S2S mode: send text to Gemini, it speaks back
    if (s2sMode && speechService) {
      session.messages.push({ role: 'user', content: text });
      messages = session.messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'ai',
        text: m.content,
      }));
      speechService.speak(text);
      return;
    }

    streaming = true;
    let streamedText = '';

    const result = await processUserMessage(session, text, db, (chunk) => {
      streamedText += chunk;
      // Update messages reactively during stream
      const current = session.messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'ai',
        text: m.content,
      }));
      // Replace last assistant message with streaming version (strip meeting_state)
      if (current.length && current[current.length - 1].role === 'ai') {
        current[current.length - 1].text = streamedText.replace(/<meeting_state>[\s\S]*?<\/meeting_state>/, '').trim();
      }
      messages = current;
    }, {
      chain: providerChain,
    });

    // Persist refreshed token if needed
    const usedConn = result.usedProvider?.connection;
    if (usedConn?._refreshed) {
      await updateAccessToken(db, usedConn.provider, usedConn.access_token, usedConn.expires_at);
      usedConn._refreshed = false;
    }

    // Process extractions from Claude's response
    if (result.extractions) {
      if (session.type === 'onboarding') {
        await processOnboardingExtractions(db, result.extractions);
      } else {
        await processExtractions(db, result.extractions);
      }
    }

    // Apply agenda updates
    if (result.agendaUpdates) {
      for (const r of result.agendaUpdates.resolves) {
        resolveItem(session.agenda, r.id, r.resolution);
      }
      for (const d of result.agendaUpdates.defers) {
        deferItem(session.agenda, d.id);
      }
    }

    // Store API usage
    if (result.usage) {
      const cost = calculateCost(result.usage.model, result.usage.input_tokens, result.usage.output_tokens, {
        cacheReadTokens: result.usage.cache_read_input_tokens || 0,
        cacheWriteTokens: result.usage.cache_creation_input_tokens || 0,
      });
      await storeUsage(db, {
        sessionType: session.type,
        model: result.usage.model,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        costUsd: cost,
        provider: result.usedProvider?.providerId || 'thinkdone',
        cacheReadTokens: result.usage.cache_read_input_tokens || 0,
        cacheWriteTokens: result.usage.cache_creation_input_tokens || 0,
      });
    }

    // Refresh tasks (extractions may have added new ones)
    const today = new Date().toISOString().slice(0, 10);
    tasks = await getTasks(db, today);

    // Sync messages and agenda
    messages = session.messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'ai',
      text: m.content,
    }));
    syncAgenda();

    // Auto-transition from onboarding to first morning meeting
    if (session.type === 'onboarding' && session.state === 'OPEN_FLOOR') {
      await transitionToFirstMeeting();
    }

    streaming = false;
  }

  // --- Transition from onboarding to first morning meeting ---
  async function transitionToFirstMeeting() {
    if (!session || !db) return;
    session.endedAt = new Date().toISOString();
    await persistOnboardingSummary(db, session);

    // Create new morning meeting session
    session = createSession('morning_meeting');
    await initializeSession(session, db, generateMorningAgenda);

    messages = [];
    syncAgenda();

    const today = new Date().toISOString().slice(0, 10);
    await loadDashboardData(today);
  }

  // --- Close Meeting ---
  async function closeMeeting() {
    if (!session || !db) return;
    session.endedAt = new Date().toISOString();
    if (session.type === 'onboarding') {
      await persistOnboardingSummary(db, session);
    } else {
      await persistConversation(db, session);
      await carryOverDeferred(db, session);
    }
  }

  let pendingVoiceText = '';

  function toggleVoice() {
    voiceActive = !voiceActive;
    if (s2sMode) {
      voiceActive ? startS2sMic() : stopS2sMic();
    }
  }

  function handleMobileTranscript(e) {
    const { text, isFinal } = e.detail;
    if (isFinal) pendingVoiceText = text;
  }

  onMount(() => {
    init();
    mounted = true;
  });

  onDestroy(() => {
    closeMeeting();
    if (s2sMode) stopS2sMic();
    if (playbackCtx) playbackCtx.close().catch(() => {});
    speechService?.destroy();
  });
</script>

{#if loading}
  <div class="loading-state" role="status" aria-label="Loading planning session">
    <div class="loading-spinner" aria-hidden="true"></div>
    <span>Setting up your planning session...</span>
  </div>
{:else if !meetingStarted}
  <!-- Pre-meeting lobby -->
  <div class="lobby" role="main" aria-label="Meeting lobby">
    <div class="lobby-sidebar">
      <AgendaPanel {agenda} animated={mounted} />
    </div>
    <div class="lobby-center">
      <div class="lobby-type">{session?.type === 'onboarding' ? 'Welcome Meeting' : 'Morning Meeting'}</div>
      <div class="lobby-hint">{agenda.filter(a => a.status === 'pending' || a.status === 'active').length} agenda items</div>
      <button class="lobby-start-btn" on:click={startMeeting} aria-label="Start meeting">
        Start Meeting
      </button>
    </div>
  </div>
{:else}
  <MeetingBar {goals} {events} animated={mounted} />

  <!-- Mobile tabs -->
  <div class="mobile-tabs" role="tablist" aria-label="Meeting sections">
    <button class="tab-btn" class:active={activeTab === 'chat'} on:click={() => activeTab = 'chat'} role="tab" aria-selected={activeTab === 'chat'} aria-controls="panel-chat" id="tab-chat">Chat</button>
    <button class="tab-btn" class:active={activeTab === 'tasks'} on:click={() => activeTab = 'tasks'} role="tab" aria-selected={activeTab === 'tasks'} aria-controls="panel-tasks" id="tab-tasks">Tasks</button>
    <button class="tab-btn" class:active={activeTab === 'dashboard'} on:click={() => activeTab = 'dashboard'} role="tab" aria-selected={activeTab === 'dashboard'} aria-controls="panel-dashboard" id="tab-dashboard">Dashboard</button>
    <button class="tab-btn" class:active={activeTab === 'agenda'} on:click={() => activeTab = 'agenda'} role="tab" aria-selected={activeTab === 'agenda'} aria-controls="panel-agenda" id="tab-agenda">Agenda</button>
  </div>

  <!-- 3-Column Layout -->
  <main class="main-content" aria-label="Meeting dashboard">
    <div class="column left-column" class:mobile-visible={activeTab === 'tasks'} id="panel-tasks" role="tabpanel" aria-labelledby="tab-tasks">
      <PriorityStack {tasks} />
    </div>

    <div class="column center-column" class:mobile-visible={activeTab === 'chat'} id="panel-chat" role="tabpanel" aria-labelledby="tab-chat">
      <ChatPanel {messages} {voiceActive} {streaming} {pendingVoiceText} {speechService} {s2sMode} on:click={toggleVoice} on:send={handleSendMessage} />
    </div>

    <div class="column right-column" class:mobile-visible={activeTab === 'agenda' || activeTab === 'dashboard'}>
      <div class="panel" class:mobile-hidden={activeTab === 'dashboard'} id="panel-agenda" role="tabpanel" aria-labelledby="tab-agenda">
        <AgendaPanel {agenda} animated={mounted} />
      </div>
      <div class:mobile-hidden={activeTab === 'agenda'} id="panel-dashboard" role="tabpanel" aria-labelledby="tab-dashboard">
        <DashboardPanels
          {habits}
          {projects}
          {scorecard}
          animated={mounted}
        />
      </div>
    </div>
  </main>

  <!-- Mobile voice orb -->
  <div class="mobile-voice-bar">
    <VoiceOrb active={voiceActive} mobile {speechService} {s2sMode} on:click={toggleVoice} on:transcript={handleMobileTranscript} />
  </div>
{/if}

<style>
  /* ── Loading State ── */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 16px;
    color: var(--color-ink);
    font-family: var(--font-hand);
    font-size: 16px;
  }
  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-ink-faint);
    border-top-color: var(--color-gold);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Lobby ── */
  .lobby {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  .lobby-sidebar {
    width: 280px;
    border-right: 1px solid var(--color-rule);
    padding: 20px;
    overflow-y: auto;
    background: var(--color-warm);
    flex-shrink: 0;
  }
  .lobby-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }
  .lobby-type {
    font-family: var(--font-display);
    font-size: 28px;
    color: var(--color-ink);
    font-weight: 600;
  }
  .lobby-hint {
    font-family: var(--font-ui);
    font-size: 14px;
    color: var(--color-ink-light);
    margin-bottom: 8px;
  }
  .lobby-start-btn {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 600;
    color: var(--color-ink);
    background: var(--color-gold);
    border: none;
    padding: 14px 36px;
    border-radius: 24px;
    cursor: pointer;
    box-shadow: 0 2px 12px color-mix(in srgb, var(--color-gold) 40%, transparent);
    transition: transform 0.15s, box-shadow 0.2s;
  }
  .lobby-start-btn:hover {
    transform: scale(1.04);
    box-shadow: 0 4px 20px color-mix(in srgb, var(--color-gold) 50%, transparent);
  }

  /* ── Mobile Tabs ── */
  .mobile-tabs {
    display: none;
    background: var(--color-warm);
    border-bottom: 1px solid var(--color-rule);
    padding: 0 8px;
    gap: 0;
  }
  .tab-btn {
    flex: 1;
    padding: 8px 4px;
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 500;
    color: var(--color-ink-light);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.2s, border-color 0.2s;
  }
  .tab-btn.active {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
  }

  /* ── Main 3-column layout ── */
  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  .column {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 20px;
    scrollbar-width: none;
  }
  .column::-webkit-scrollbar { display: none; }
  .left-column {
    width: 300px;
    border-right: 1px solid var(--color-rule);
    flex-shrink: 0;
  }
  .center-column {
    flex: 1;
    padding: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .right-column {
    width: 280px;
    border-left: 1px solid var(--color-rule);
    background-color: var(--color-warm);
    flex-shrink: 0;
  }

  .panel { margin-bottom: 0; }

  /* ── Mobile voice bar ── */
  .mobile-voice-bar { display: none; }

  /* ── Responsive ── */
  @media (max-width: 768px) {
    .mobile-tabs { display: flex; }
    .main-content { flex-direction: column; }
    .left-column, .right-column {
      display: none;
      width: 100%;
      border: none;
      background: none;
    }
    .left-column.mobile-visible,
    .right-column.mobile-visible { display: flex; }
    .center-column { display: none; }
    .center-column.mobile-visible { display: flex; }
    .mobile-voice-bar {
      display: flex;
      justify-content: center;
      padding: 12px 0;
      background: var(--color-paper);
      border-top: 1px solid var(--color-rule);
    }
    :global(.mobile-hidden) { display: none; }
    .lobby { flex-direction: column; }
    .lobby-sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--color-rule); max-height: 40vh; }
  }
</style>
