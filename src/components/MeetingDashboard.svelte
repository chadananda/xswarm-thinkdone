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
  import { createSession, initializeSession, processUserMessage } from '../lib/conversation.js';
  import { calculateCost } from '../lib/usage.js';
  import { generateMorningAgenda, generateOnboardingAgenda } from '../lib/agenda.js';
  import { getRoutinesForMeeting, getHabitAnalytics } from '../lib/routines-engine.js';
  import { getStreak } from '../lib/routines.js';
  import { getProjects } from '../lib/gtd-engine.js';
  import { processExtractions, processOnboardingExtractions, persistConversation, persistOnboardingSummary, carryOverDeferred } from '../lib/extraction.js';
  import { resolveItem, deferItem } from '../lib/agenda.js';
  import { buildProviderChain, PROVIDER_ORDER, SESSION_TIER_MAP } from '../lib/providers.js';

  let tasks = [];
  let voiceActive = false;
  let activeTab = 'chat';
  let mounted = false;
  let loading = true;
  let db = null;
  let session = null;

  // Live data (replaces mock constants)
  let goals = [];
  let agenda = [];
  let messages = [];
  let events = [];
  let habits = [];
  let questions = [];
  let projects = [];
  let scorecard = [];
  let streaming = false;
  let providerChain = [];

  // --- Initialize ---
  async function init() {
    try {
      db = await getDb();
      await ensureSchema(db);
      await seedPersonality(db);

      // Build provider chain from settings + connections
      const enabledJson = await getSetting(db, 'ai_providers_enabled');
      const enabledIds = enabledJson ? JSON.parse(enabledJson) : ['thinkdone'];
      const connections = [];
      for (const id of PROVIDER_ORDER) {
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
      providerChain = buildProviderChain(enabledIds, connections, tier);

      const today = new Date().toISOString().slice(0, 10);
      tasks = await getTasks(db, today);
      syncAgenda();
      await loadDashboardData(today);

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

  // --- Send Message ---
  async function handleSendMessage(event) {
    const text = event.detail?.text;
    if (!text || !session || !db || streaming) return;

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
  });
</script>

{#if loading}
  <div class="loading-state" role="status" aria-label="Loading planning session">
    <div class="loading-spinner" aria-hidden="true"></div>
    <span>Setting up your planning session...</span>
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
      <ChatPanel {messages} {voiceActive} {streaming} {pendingVoiceText} on:click={toggleVoice} on:send={handleSendMessage} />
    </div>

    <div class="column right-column" class:mobile-visible={activeTab === 'agenda' || activeTab === 'dashboard'}>
      <div class="panel" class:mobile-hidden={activeTab === 'dashboard'} id="panel-agenda" role="tabpanel" aria-labelledby="tab-agenda">
        <AgendaPanel {agenda} animated={mounted} />
      </div>
      <div class:mobile-hidden={activeTab === 'agenda'} id="panel-dashboard" role="tabpanel" aria-labelledby="tab-dashboard">
        <DashboardPanels
          {questions}
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
    <VoiceOrb active={voiceActive} mobile on:click={toggleVoice} on:transcript={handleMobileTranscript} />
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
  }
</style>
