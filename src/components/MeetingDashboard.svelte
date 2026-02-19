<svelte:options runes={false} />

<script>
  import { onMount, onDestroy } from 'svelte';
  import MeetingBar from './meeting/MeetingBar.svelte';
  import MeetingTaskList from './meeting/MeetingTaskList.svelte';
  import ChatPanel from './meeting/ChatPanel.svelte';
  import AgendaPanel from './meeting/AgendaPanel.svelte';
  import DashboardPanels from './meeting/DashboardPanels.svelte';
  import VoiceOrb from './meeting/VoiceOrb.svelte';

  // Engine imports
  import { getDb, ensureSchema, getTasks, toggleTask as dbToggleTask, deleteTask as dbDeleteTask, seedPersonality, clearDatabase, getSetting, getActiveSession } from '../lib/db.js';
  import { createSession, initializeSession, processUserMessage, deliverOpeningTurn, transitionState, assembleS2sSystemPrompt } from '../lib/conversation.js';
  import { generateMorningAgenda, generateOnboardingAgenda, applyAgendaUpdates, createAgendaItem } from '../lib/agenda.js';
  import { getRoutinesForMeeting, getHabitAnalytics } from '../lib/routines-engine.js';
  import { getStreak } from '../lib/routines.js';
  import { getProjects } from '../lib/gtd-engine.js';
  import { processExtractions, extractFromTranscript, processOnboardingExtractions, persistConversation, persistOnboardingSummary, carryOverDeferred, snapshotConversation, ensureExtractions, persistResolutions } from '../lib/extraction.js';
  import { detectDataGaps, filterNewGaps, HEARTBEAT_INTERVALS } from '../lib/heartbeat.js';
  import { SESSION_TIER_MAP } from '../lib/providers.js';
  import { createProviderManager } from '../lib/provider-manager.js';
  import { createSpeechService, resolveMode, resolveTtsProvider, canDirectConnect, SPEECH_PROVIDER_CONNECTION_MAP } from '../lib/speech-service.js';
  import { playApplause, playClick } from '../lib/sounds.js';

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

  // Pre-populate agenda immediately — onboarding items need no DB
  const TYPE_TO_PHASE = {
    'REFLECT': 'reflect', 'DECIDE': 'decide', 'COMMIT': 'commit',
    'INFORM': 'orient', 'RESEARCH': 'create', 'PLAN': 'decide', 'FOLLOW-UP': 'commit',
  };
  let agenda = generateOnboardingAgenda().map(item => ({
    id: item.id, text: item.content, question: item.question,
    phase: TYPE_TO_PHASE[item.type] || 'orient', status: item.status, priority: item.priority,
  }));
  let messages = [];
  let events = [];
  let habits = [];
  let projects = [];
  let scorecard = [];
  let streaming = false;
  let streamingTimer = null;
  let pm = null;
  let speechService = null;

  // S2S state
  let s2sMode = false;
  let liveAiTranscript = '';
  let liveUserTranscript = '';

  // Safety valve: reset streaming after 90s to prevent stuck UI
  function setStreaming(value) {
    streaming = value;
    clearTimeout(streamingTimer);
    if (value) {
      streamingTimer = setTimeout(() => {
        if (streaming) {
          console.error('[Dashboard] Streaming timeout after 90s — forcing reset');
          streaming = false;
          messages = [...messages, { role: 'ai', text: 'Response timed out. Please try again.' }];
          notifyStatusBar();
        }
      }, 90_000);
    }
  }

  function notifyStatusBar() {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('statusbar-refresh'));
  }

  function extractionOpts() {
    return pm ? pm.extractionOpts({ agenda: session?.agenda, meetingType: session?.type }) : {};
  }

  function toDisplayMessages(sessionMessages) {
    return sessionMessages.map(m => ({
      role: m.role === 'user' ? 'user' : 'ai',
      text: m.content,
    }));
  }

  async function trackUsage(result) {
    if (pm) await pm.trackUsage(result, session?.type);
  }

  // Build a transcript of recent messages for extraction context.
  // Includes recent history so extraction model understands the planning thread.
  function buildExtractionTranscript(msgs, maxTurns = 6) {
    const recent = msgs.slice(-maxTurns);
    return recent.map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      return `${role}: ${m.content}`;
    }).join('\n\n');
  }

  // --- Session Persistence (DB-backed) ---

  function saveSession() {
    if (!session || !db) return;
    snapshotConversation(db, session).catch(err =>
      console.error('[Dashboard] saveSession failed:', err)
    );
  }

  async function handleTaskToggle(task) {
    const result = await dbToggleTask(db, task.id);
    if (result === 'checked') playApplause();
    else if (result === 'unchecked') playClick();
    tasks = await getTasks(db, new Date().toISOString().slice(0, 10));
    notifyStatusBar();
  }

  async function handleTaskDelete(task) {
    await dbDeleteTask(db, task.id);
    tasks = await getTasks(db, new Date().toISOString().slice(0, 10));
    // Add a system note to the conversation so the AI knows
    if (session) {
      session.messages.push({ role: 'user', content: `[Removed task: "${task.text}"]` });
      messages = toDisplayMessages(session.messages.filter(m => m.content?.trim()));
    }
    notifyStatusBar();
  }

  // --- Initialize ---
  async function initDb() {
    db = await getDb();
    await ensureSchema(db);
    await seedPersonality(db);
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('reset')) {
      await clearDatabase(db);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  async function initProviders() {
    pm = await createProviderManager(db);
    await pm.init();
  }

  async function needsOnboarding() {
    // User has completed onboarding if personality has their name
    const row = await db.prepare('SELECT disposition FROM personality WHERE id = 1').get();
    if (row?.disposition) {
      try {
        const disp = JSON.parse(row.disposition);
        if (disp.user_name) return false;
      } catch {}
    }
    return true;
  }

  async function initSession() {
    // Try to restore active session from DB
    const active = await getActiveSession(db);
    if (active?.messages && active.messages !== '[]') {
      const onboarding = await needsOnboarding();
      if (active.session_type === 'onboarding' && !onboarding) {
        // Stale onboarding — end it and start fresh morning meeting
        await db.prepare('UPDATE conversations SET ended_at = ? WHERE id = ?')
          .run(new Date().toISOString(), active.id);
        session = createSession('morning_meeting');
        await initializeSession(session, db, generateMorningAgenda);
      } else {
        // Restore active session
        session = createSession(active.session_type);
        session.messages = JSON.parse(active.messages || '[]');
        session.agenda = JSON.parse(active.agenda || '[]');
        session.state = active.state || 'OPENING';
        session.startedAt = active.started_at;
        session._convId = active.id;
        meetingStarted = session.messages.length > 0;
      }
    } else {
      // No active session — create new one
      if (await needsOnboarding()) {
        session = createSession('onboarding');
        await initializeSession(session, db, () => generateOnboardingAgenda());
      } else {
        session = createSession('morning_meeting');
        await initializeSession(session, db, generateMorningAgenda);
      }
    }
    const tier = SESSION_TIER_MAP[session.type] || 'standard';
    const p = pm.primary;
    console.log(`[Dashboard] init: session=${session.type} tier=${tier} provider=${p?.id}:${p?.model}`);
    const today = new Date().toISOString().slice(0, 10);
    tasks = await getTasks(db, today);
    syncAgenda();
    if (session.messages.length) {
      messages = toDisplayMessages(session.messages);
    }
    await loadDashboardData(today);
  }

  async function initSpeechService() {
    try {
      const profileId = await getSetting(db, 'speech_profile') || 'browser-native';
      const mode = resolveMode(profileId);
      console.log(`[Dashboard] speech init: profile=${profileId} mode=${mode}`);
      let apiKey = null;
      let isOAuth = false;
      if (mode !== 'browser') {
        const ttsP = resolveTtsProvider(profileId);
        const connKey = SPEECH_PROVIDER_CONNECTION_MAP[ttsP] || ttsP;
        const creds = await pm.getSpeechCredentials(connKey);
        if (creds) {
          apiKey = creds.apiKey;
          isOAuth = creds.isOAuth;
        }
        console.log(`[Dashboard] speech: ttsProvider=${ttsP} connKey=${connKey} hasApiKey=${!!apiKey} isOAuth=${isOAuth}`);
      }
      if (mode === 's2s' && apiKey && canDirectConnect(profileId)) {
        console.log('[Dashboard] → S2S mode: assembling system prompt for Gemini Live');
        const { flat } = await assembleS2sSystemPrompt(session, db);
        speechService = createSpeechService(profileId, {
          apiKey: isOAuth ? undefined : apiKey,
          accessToken: isOAuth ? apiKey : undefined,
          systemPrompt: flat,
        });
        s2sMode = true;
        console.log('[Dashboard] S2S mode enabled');
      } else if (apiKey && canDirectConnect(profileId)) {
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
  }

  async function init() {
    try {
      await initDb();
      await initProviders();
      await initSession();
      await initSpeechService();
      loading = false;
      startHeartbeat();
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
    saveSession();
  }

  function typeToPhase(type) {
    return TYPE_TO_PHASE[type] || 'orient';
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
    console.log('[Dashboard] startMeeting: s2sMode=%s provider=%s', s2sMode, pm?.primary?.id);
    meetingStarted = true;
    saveSession();
    if (s2sMode) {
      try {
        await initS2sConversation();
        return;
      } catch (err) {
        // S2S failed — fall back to text mode gracefully
        console.error('[Dashboard] S2S failed, falling back to text mode:', err.message);
        messages = [{ role: 'ai', text: `Voice connection failed — switching to text mode. (${err.message})` }];
        s2sMode = false;
        speechService?.stopVoice();
        speechService?.destroy();
        speechService = null;
        // Continue to text mode below
      }
    }
    // Text mode: AI delivers opening turn
    setStreaming(true);
    messages = []; // Clear ghost messages, typing indicator shows instead
    let streamedText = '';
    try {
      console.log('[Dashboard] calling deliverOpeningTurn...');
      const result = await deliverOpeningTurn(session, db, (chunk) => {
        streamedText += chunk;
        const display = streamedText.replace(/<meeting_state>[\s\S]*?<\/meeting_state>/, '').trim();
        if (display) {
          messages = [{ role: 'ai', text: display }];
        }
      }, { callAI: (opts) => pm.callAI({ ...opts, tier: SESSION_TIER_MAP[session.type] || 'standard' }) });
      console.log('[Dashboard] deliverOpeningTurn complete, displayText=%d chars', result.displayText?.length || 0);

      // Ensure extractions — inline XML or fallback
      const ensuredOpen = await ensureExtractions(result, extractionOpts());
      if (ensuredOpen.extractions) {
        await processExtractions(db, ensuredOpen.extractions);
      }
      applyAgendaUpdates(session.agenda, ensuredOpen.agendaUpdates);
      await persistResolutions(db, session.agenda, ensuredOpen.agendaUpdates, session.type);
      await trackUsage(result);

      // Refresh tasks (extractions may have added new ones)
      const today = new Date().toISOString().slice(0, 10);
      tasks = await getTasks(db, today);

      // Finalize messages and agenda — filter out empty content
      messages = toDisplayMessages(session.messages.filter(m => m.content?.trim()));
      syncAgenda();
    } catch (err) {
      console.error('[Dashboard] startMeeting error:', err);
      messages = [{ role: 'ai', text: `Failed to start meeting: ${err.message}. Check the browser console for details.` }];
    } finally {
      setStreaming(false);
      notifyStatusBar();
    }
  }

  // --- S2S Conversation ---

  async function initS2sConversation() {
    if (!speechService || !s2sMode) return;
    console.log('[Dashboard] initS2sConversation: wiring S2S callbacks');

    // Wire user transcript events (voice STT → messages)
    speechService.onUserTranscript((text, isFinal) => {
      if (!isFinal) { liveUserTranscript = text; return; }
      // Final: clear composing, add to messages, extract
      liveUserTranscript = '';
      if (text.trim() && session && db) {
        session.messages.push({ role: 'user', content: text.trim() });
        messages = toDisplayMessages(session.messages);
        saveSession();
        runS2sExtraction();
      }
    });

    // Wire AI transcript stream
    if (speechService.onStreamingTranscript) {
      speechService.onStreamingTranscript((text) => { liveAiTranscript += text; });
    }

    // Wire AI turn complete (unsolicited — user spoke, Gemini responded)
    speechService.onAiAudio((wav, transcript) => {
      liveAiTranscript = '';
      handleS2sTurnComplete(transcript);
    });

    // Start voice: mic + playback + browser STT (all managed by speech service)
    await speechService.startVoice();
    voiceActive = true;

    // Send opening greeting
    messages = [{ role: 'ai', text: 'Connecting...' }];
    const openingText = buildOpeningText();
    console.log(`[Dashboard] S2S sending opening: "${openingText.slice(0, 80)}..."`);
    try {
      const result = await speechService.speak(openingText);
      // speak() resolved — push opening transcript (onAiAudio doesn't fire for speak() calls)
      const transcript = result?.transcript?.trim();
      if (transcript) {
        session.messages.push({ role: 'assistant', content: transcript });
      }
    } catch (err) {
      console.error('[Dashboard] S2S opening speak failed:', err);
      messages = [{ role: 'ai', text: `Voice greeting failed: ${err.message}. You can still type messages.` }];
    }
    messages = session.messages.length ? toDisplayMessages(session.messages) : [];
    saveSession();
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

  // Shared S2S extraction — called by both voice turns and typed messages
  async function runS2sExtraction() {
    if (!session || !db || !session.messages.length) return;
    try {
      const conversationTranscript = buildExtractionTranscript(session.messages);
      console.log(`[Dashboard] S2S extraction: ${conversationTranscript.length} chars of context`);
      console.log(`[Dashboard] S2S extraction transcript:\n${conversationTranscript.slice(0, 400)}`);
      const result = await extractFromTranscript(conversationTranscript, extractionOpts());

      // Process extractions
      if (result.extractions) {
        const taskCount = result.extractions.tasks?.length || 0;
        const decCount = result.extractions.decisions?.length || 0;
        console.log(`[Dashboard] S2S extraction result: ${taskCount} tasks, ${decCount} decisions`);
        if (taskCount) console.log(`[Dashboard] S2S tasks:`, result.extractions.tasks.map(t => t.text));
        const created = await processExtractions(db, result.extractions);
        if (created.tasks.length) console.log(`[Dashboard] S2S created task IDs:`, created.tasks);
      }

      // Apply agenda updates
      applyAgendaUpdates(session.agenda, result.agendaUpdates);
      await persistResolutions(db, session.agenda, result.agendaUpdates, session.type);
      if (result.agendaUpdates?.adds?.length && session.state === 'OPEN_FLOOR') {
        transitionState(session, 'new_items');
      }

      // Refresh tasks after extraction
      const today = new Date().toISOString().slice(0, 10);
      tasks = await getTasks(db, today);
      syncAgenda();
      notifyStatusBar();
    } catch (err) {
      console.error('[Dashboard] S2S extraction failed:', err);
    }
  }

  async function handleS2sTurnComplete(transcript) {
    if (!session || !db) return;
    console.log(`[Dashboard] S2S turn complete: ai="${(transcript || '').slice(0, 60)}"`);

    if (transcript?.trim()) {
      session.messages.push({ role: 'assistant', content: transcript.trim() });
      messages = toDisplayMessages(session.messages);
      saveSession();
      await runS2sExtraction();
    }

    if (session.state === 'OPENING') transitionState(session, 'user_message');
    transitionState(session, 'turn_complete');
    liveAiTranscript = '';
  }

  // --- Send Message ---
  async function handleSendMessage(event) {
    const text = event.detail?.text;
    if (!text) return;
    if (!session || !db) {
      console.error('[Dashboard] handleSendMessage: session or db not ready');
      messages = [...messages, { role: 'ai', text: 'Still initializing — please wait a moment and try again.' }];
      return;
    }
    if (streaming) {
      console.warn('[Dashboard] handleSendMessage: already streaming, ignoring');
      return;
    }

    // S2S mode: send text to Gemini, it speaks back
    if (s2sMode && speechService) {
      session.messages.push({ role: 'user', content: text });
      messages = toDisplayMessages(session.messages);
      // Run extraction immediately on user message (don't wait for AI)
      runS2sExtraction();
      // Also capture AI transcript when speak completes
      speechService.speak(text).then(result => {
        if (result?.transcript?.trim()) {
          session.messages.push({ role: 'assistant', content: result.transcript.trim() });
          messages = toDisplayMessages(session.messages);
          saveSession();
        }
      }).catch(err => console.error('[Dashboard] S2S speak error:', err));
      return;
    }

    // Show user message immediately
    messages = [...messages, { role: 'user', text }];
    setStreaming(true);
    let streamedText = '';

    try {
      console.log(`[Dashboard] sending message: "${text.slice(0, 60)}..." provider=${pm?.primary?.id}`);
      const result = await processUserMessage(session, text, db, (chunk) => {
        streamedText += chunk;
        const current = toDisplayMessages(session.messages);
        const display = streamedText.replace(/<meeting_state>[\s\S]*?<\/meeting_state>/, '').trim();
        if (display) current.push({ role: 'ai', text: display });
        messages = current;
      }, {
        callAI: (opts) => pm.callAI({ ...opts, tier: SESSION_TIER_MAP[session.type] || 'standard' }),
      });

      // Ensure extractions — inline XML or fallback post-hoc extraction
      // Include recent conversation so extraction model has planning context
      const opts = extractionOpts();
      opts.transcript = buildExtractionTranscript(session.messages);
      const ensured = await ensureExtractions(result, opts);

      if (ensured.extractions) {
        const taskCount = ensured.extractions.tasks?.length || 0;
        if (taskCount) console.log(`[Dashboard] Processing ${taskCount} extracted tasks:`, ensured.extractions.tasks.map(t => t.text));
        if (session.type === 'onboarding') {
          await processOnboardingExtractions(db, ensured.extractions);
        } else {
          const created = await processExtractions(db, ensured.extractions);
          if (created.tasks.length) console.log(`[Dashboard] Created task IDs:`, created.tasks);
        }
      }

      // Apply agenda updates and persist answers as memories
      applyAgendaUpdates(session.agenda, ensured.agendaUpdates);
      await persistResolutions(db, session.agenda, ensured.agendaUpdates, session.type);
      if (ensured.agendaUpdates?.adds?.length && session.state === 'OPEN_FLOOR') {
        transitionState(session, 'new_items');
      }

      await trackUsage(result);

      // Refresh tasks (extractions may have added new ones)
      const today = new Date().toISOString().slice(0, 10);
      tasks = await getTasks(db, today);

      // Sync messages and agenda
      messages = toDisplayMessages(session.messages);
      syncAgenda(); // also calls saveSession()

      // Auto-transition from onboarding to first morning meeting
      if (session.type === 'onboarding' && session.state === 'OPEN_FLOOR') {
        await transitionToFirstMeeting();
      }
    } catch (err) {
      console.error('[Dashboard] handleSendMessage error:', err);
      // Show error as AI message so user knows what happened
      messages = [...messages, { role: 'ai', text: `Something went wrong: ${err.message}. Check the browser console for details.` }];
    } finally {
      setStreaming(false);
      notifyStatusBar();
    }
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

  // --- Stop Meeting (user-initiated) ---
  async function stopMeeting() {
    console.log('[Dashboard] stopMeeting');
    voiceActive = false;

    if (s2sMode && speechService) {
      try {
        speechService.speak('End the meeting. Thank the user warmly and say goodbye.').catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 8000));
      } catch {}
    }

    speechService?.stopVoice();
    speechService?.destroy();
    speechService = null;
    stopHeartbeat();
    await closeMeeting();
    meetingStarted = false;
    setStreaming(false);
    notifyStatusBar();
  }

  let pendingVoiceText = '';
  let heartbeatTimer = null;

  // --- Heartbeat ---
  async function runHeartbeat() {
    if (!db || !session) return;
    try {
      const gaps = await detectDataGaps(db);
      const newGaps = filterNewGaps(gaps, session.agenda);
      for (const gap of newGaps) {
        const item = createAgendaItem(gap.type, gap.priority, gap.content, gap.question);
        item.heartbeatId = gap.id;
        session.agenda.push(item);
      }
      if (newGaps.length) syncAgenda();
      // Periodic conversation snapshot
      await snapshotConversation(db, session);
    } catch (err) {
      console.error('[Heartbeat] tick failed:', err);
    }
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    const interval = HEARTBEAT_INTERVALS.free;
    // Run immediately on start, then on interval
    runHeartbeat();
    heartbeatTimer = setInterval(runHeartbeat, interval);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function toggleVoice() {
    voiceActive = !voiceActive;
    if (s2sMode && speechService) {
      voiceActive ? speechService.startVoice() : speechService.stopVoice();
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
    clearTimeout(streamingTimer);
    stopHeartbeat();
    speechService?.destroy(); // calls stopVoice internally
  });
</script>

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
    <MeetingTaskList {tasks} onToggle={handleTaskToggle} onDelete={handleTaskDelete} />
  </div>

  <div class="column center-column" class:mobile-visible={activeTab === 'chat'} id="panel-chat" role="tabpanel" aria-labelledby="tab-chat">
    <ChatPanel {messages} {voiceActive} {streaming} {pendingVoiceText} {speechService} {s2sMode} {liveAiTranscript} {liveUserTranscript} on:click={toggleVoice} on:send={handleSendMessage} />
  </div>

  <div class="column right-column" class:mobile-visible={activeTab === 'agenda' || activeTab === 'dashboard'}>
    <div class="panel" class:mobile-hidden={activeTab === 'dashboard'} id="panel-agenda" role="tabpanel" aria-labelledby="tab-agenda">
      <AgendaPanel {agenda} animated={mounted} />
      {#if !meetingStarted && !loading}
        <button class="meeting-trigger" on:click={startMeeting} aria-label="Start meeting to work through agenda">
          Start Meeting
        </button>
      {:else if meetingStarted}
        <button class="meeting-trigger meeting-stop" on:click={stopMeeting} aria-label="Stop meeting and save progress">
          Stop Meeting
        </button>
      {/if}
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
{#if meetingStarted}
  <div class="mobile-voice-bar">
    <VoiceOrb active={voiceActive} mobile {speechService} {s2sMode} on:click={toggleVoice} on:transcript={handleMobileTranscript} />
  </div>
{/if}

<style>
  /* ── Meeting trigger (in agenda panel) ── */
  .meeting-trigger {
    display: block;
    width: 50%;
    margin: 10px auto 12px;
    padding: 5px;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 700;
    color: #fff;
    background: var(--color-accent);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 1px 6px color-mix(in srgb, var(--color-accent) 30%, transparent);
    transition: transform 0.15s, box-shadow 0.2s;
  }
  .meeting-trigger:hover {
    transform: scale(1.02);
    box-shadow: 0 2px 10px color-mix(in srgb, var(--color-accent) 40%, transparent);
  }
  .meeting-stop {
    background: #b44;
    box-shadow: 0 1px 4px rgba(180, 68, 68, 0.25);
  }
  .meeting-stop:hover {
    background: #a33;
    box-shadow: 0 2px 8px rgba(180, 68, 68, 0.35);
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
    padding: 12px 20px 20px;
    scrollbar-width: none;
  }
  .column::-webkit-scrollbar { display: none; }
  .left-column {
    width: 220px;
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
  }
</style>
