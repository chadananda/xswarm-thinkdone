<svelte:options runes={false} />

<script>
  import { onMount } from 'svelte';
  import { getDb, ensureSchema, getSetting, setSetting, getAllSettings, getConnection, upsertConnection, removeConnection, clearDatabase } from '../lib/db.js';
  import { PROVIDERS, PROVIDER_ORDER, getAllProviders, parseCustomProviders, formatProviderPricing, getFetchedModels, getCheapestModel } from '../lib/providers.js';
  import { ensureFreshToken } from '../lib/provider.js';
  import { SPEECH_PROFILES, SPEECH_PROFILE_MAP, DEFAULT_SPEECH_PROFILE } from '../lib/speech.js';
  import { resolveTtsProvider, resolveSttProvider, resolveMode, createSpeechService, canDirectConnect, SPEECH_PROVIDER_CONNECTION_MAP } from '../lib/speech-service.js';
  import { CONNECTION_CATEGORIES, getConnectionsByCategory } from '../lib/connections.js';

  let db = null;

  // Settings state
  let enabledProviders = ['thinkdone'];
  let voiceProvider = 'web-speech';
  let speechProfile = DEFAULT_SPEECH_PROFILE;
  let showAllSpeech = false;
  let displayName = 'User';

  // Connections keyed by provider ID
  let connections = {};

  // Add-provider popup state
  let showAddPopup = false;
  let selectedAddId = '';
  let wizardKey = '';
  let wizardLocalUrl = '';
  let wizardLocalKey = '';
  let fetchingModels = false;

  // Custom endpoints
  let customProviders = [];
  let addingCustom = false;
  let customInput = { name: '', baseUrl: '', apiKey: '' };

  // Merged provider catalog (built-in + custom)
  let allProviders = PROVIDERS;

  onMount(() => {
    // Scroll-reveal observer — sections exist immediately, no loading gate
    const sections = document.querySelectorAll('.settings-section');
    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      }
    }, { threshold: 0.1 });
    sections.forEach(s => revealObserver.observe(s));

    // Hydrate data — parallel queries update reactive state as they resolve
    (async () => {
      db = await getDb();
      await ensureSchema(db);

      // Fire all settings reads in parallel
      const [enabledRaw, voice, savedProfile, name, customJson] = await Promise.all([
        getSetting(db, 'ai_providers_enabled'),
        getSetting(db, 'voice_provider'),
        getSetting(db, 'speech_profile'),
        getSetting(db, 'display_name'),
        getSetting(db, 'custom_providers'),
      ]);

      // Apply settings reactively
      if (enabledRaw) {
        try { enabledProviders = JSON.parse(enabledRaw); } catch {}
      } else {
        const oldProvider = await getSetting(db, 'ai_provider');
        if (oldProvider === 'gemini') {
          enabledProviders = ['thinkdone', 'gemini'];
        } else {
          enabledProviders = ['thinkdone'];
        }
        await setSetting(db, 'ai_providers_enabled', JSON.stringify(enabledProviders));
      }

      voiceProvider = voice || 'web-speech';
      if (savedProfile && SPEECH_PROFILE_MAP[savedProfile]) {
        speechProfile = savedProfile;
      } else if (voiceProvider === 'web-speech') {
        speechProfile = 'browser-native';
      }

      displayName = name || 'User';

      if (customJson) {
        try { customProviders = JSON.parse(customJson); } catch {}
      }
      allProviders = getAllProviders(customJson);

      // Load all connections in parallel
      const ids = Object.keys(allProviders);
      const conns = await Promise.all(ids.map(id => getConnection(db, id)));
      for (let i = 0; i < ids.length; i++) {
        if (conns[i]) connections[ids[i]] = conns[i];
      }
      connections = connections;

      // Backfill td_profile for users who connected before profile storage existed
      if (!localStorage.getItem('td_profile') && connections['gemini']) {
        const gc = connections['gemini'];
        if (gc.email || gc.name) {
          localStorage.setItem('td_profile', JSON.stringify({ name: gc.name || '', email: gc.email || '', picture: '' }));
          document.cookie = 'td_user=1; path=/; max-age=31536000; SameSite=Lax';
        }
      }

      // Process Google OAuth tokens passed via URL hash from callback redirect
      if (window.location.hash.includes('google_tokens=')) {
        try {
          const hashStr = window.location.hash.split('google_tokens=')[1];
          const tokens = JSON.parse(decodeURIComponent(hashStr));
          await upsertConnection(db, 'gemini', {
            email: tokens.email,
            name: tokens.name,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: tokens.expires_at,
            scopes: 'generative-language openid email profile',
          });
          connections['gemini'] = await getConnection(db, 'gemini');
          connections = connections;
          // Persist profile for UserMenu and set login cookie
          const profile = { name: tokens.name || '', email: tokens.email || '', picture: tokens.picture || '' };
          localStorage.setItem('td_profile', JSON.stringify(profile));
          document.cookie = 'td_user=1; path=/; max-age=31536000; SameSite=Lax';
          history.replaceState(null, '', '/settings');
          if (!enabledProviders.includes('gemini')) {
            enabledProviders = [...enabledProviders, 'gemini'];
            await setSetting(db, 'ai_providers_enabled', JSON.stringify(enabledProviders));
          }
        } catch (e) {
          console.error('Failed to process Google OAuth tokens:', e);
        }
      }
    })();
  });

  // --- Helpers ---

  function isConnected(id) {
    if (id === 'thinkdone') return true;
    if (allProviders[id]?.auth === 'local' || allProviders[id]?.local) {
      // Local/custom: connected if we have fetched models OR a legacy modelId
      try {
        const meta = JSON.parse(connections[id]?.scopes || '{}');
        return (Array.isArray(meta.models) && meta.models.length > 0) || !!meta.modelId;
      } catch { return false; }
    }
    return !!connections[id]?.access_token;
  }

  function hasOAuth(id) {
    const auth = allProviders[id]?.auth;
    return Array.isArray(auth) && auth.includes('oauth');
  }

  function hasApiKey(id) {
    const auth = allProviders[id]?.auth;
    return auth === 'api_key' || (Array.isArray(auth) && auth.includes('api_key'));
  }

  function isLocal(id) {
    return allProviders[id]?.auth === 'local' || allProviders[id]?.local;
  }

  // Display models for table — hardcoded or fetched
  function getDisplayModels(id) {
    const p = allProviders[id];
    if (!p) return '';
    if (p.models.length > 0) {
      return p.models.slice(0, 3).map(m => m.name).join(', ');
    }
    // Check fetched models in connection scopes
    const fetched = getFetchedModels(connections[id]);
    if (fetched.length > 0) {
      return fetched.slice(0, 3).map(m => m.name || m.id).join(', ');
    }
    return 'Auto-detected';
  }

  // Display pricing for table
  function getDisplayPricing(id) {
    return formatProviderPricing(id, allProviders);
  }

  // Quality rating (1-5) based on provider's best model capability
  function getQualityRating(id) {
    const ratings = {
      anthropic: 5, openai: 5, openrouter: 5,
      thinkdone: 4, gemini: 4, mistral: 4, perplexity: 4, deepseek: 4, grok: 4,
      groq: 3, together: 3, fireworks: 3,
    };
    return ratings[id] || 3;
  }

  // Connected providers sorted by usage order (matches chain: free → cheapest paid)
  // NOTE: `connections` referenced explicitly so Svelte 4 tracks it as a dependency
  $: connectedList = (() => {
    void connections;
    const ids = ['thinkdone']; // always included
    for (const id of enabledProviders) {
      if (id === 'thinkdone') continue;
      if (isConnected(id)) ids.push(id);
    }
    for (const cp of customProviders) {
      if (!ids.includes(cp.id) && isConnected(cp.id)) ids.push(cp.id);
    }
    // Sort: free first, then local, then by cheapest model cost (matches buildProviderChain)
    ids.sort((a, b) => {
      const costRank = (id) => {
        const p = allProviders[id];
        if (!p) return 999;
        if (p.free) return -1;
        if (p.local) return 0;
        const m = getCheapestModel(id);
        return m ? (m.input + m.output) / 2 : 999;
      };
      return costRank(a) - costRank(b);
    });
    return ids;
  })();

  // Available providers for the add dropdown (not yet connected), sorted free-first
  $: availableProviders = (() => {
    void connections;
    const ids = PROVIDER_ORDER.filter(id => id !== 'thinkdone' && !isConnected(id));
    ids.sort((a, b) => {
      const costRank = (id) => {
        const p = allProviders[id];
        if (!p) return 999;
        if (p.free) return -1;
        if (p.local) return 0;
        const m = getCheapestModel(id);
        return m ? (m.input + m.output) / 2 : 999;
      };
      return costRank(a) - costRank(b);
    });
    return ids;
  })();

  // Badge: smartest connected provider (highest quality rating, only if unique)
  $: smartestId = (() => {
    if (connectedList.length < 2) return null;
    let best = null, bestRating = 0;
    for (const id of connectedList) {
      const r = getQualityRating(id);
      if (r > bestRating) { bestRating = r; best = id; }
    }
    return best;
  })();

  // Badge: best value connected provider (free > local > cheapest paid)
  $: bestValueId = (() => {
    if (connectedList.length < 2) return null;
    for (const id of connectedList) {
      if (allProviders[id]?.free) return id;
    }
    for (const id of connectedList) {
      if (allProviders[id]?.local) return id;
    }
    let best = null, bestCost = Infinity;
    for (const id of connectedList) {
      const p = allProviders[id];
      if (!p?.models?.length) continue;
      const cheapest = p.models.reduce((a, b) => (a.input + a.output) < (b.input + b.output) ? a : b);
      const cost = cheapest.input + cheapest.output;
      if (cost < bestCost) { bestCost = cost; best = id; }
    }
    return best;
  })();

  // --- Model fetching ---

  async function fetchAndStoreModels(providerId) {
    const p = allProviders[providerId];
    if (!p) return;
    const conn = connections[providerId];
    const body = {};
    if (providerId === 'gemini') {
      body.provider = 'gemini';
      body.api_key = conn?.access_token || '';
    } else {
      let baseUrl = p.apiBase;
      if (isLocal(providerId) && conn?.scopes) {
        try { const meta = JSON.parse(conn.scopes); if (meta.baseUrl) baseUrl = meta.baseUrl; } catch {}
      }
      body.base_url = baseUrl;
      body.api_key = conn?.access_token || '';
    }
    try {
      fetchingModels = true;
      const res = await fetch('/api/chat/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.models?.length) return;
      // Merge fetched models into connection scopes
      let meta = {};
      try { if (conn?.scopes) meta = JSON.parse(conn.scopes); } catch {}
      meta.models = data.models.slice(0, 20);
      await upsertConnection(db, providerId, {
        ...conn,
        access_token: conn?.access_token || '',
        refresh_token: conn?.refresh_token || '',
        expires_at: conn?.expires_at || 0,
        scopes: JSON.stringify(meta),
      });
      connections[providerId] = await getConnection(db, providerId);
      connections = connections;
    } catch (err) {
      console.error(`Failed to fetch models for ${providerId}:`, err);
    } finally {
      fetchingModels = false;
    }
  }

  // --- Popup actions ---

  function openAddPopup() {
    selectedAddId = '';
    wizardKey = '';
    addingCustom = false;
    customInput = { name: '', baseUrl: '', apiKey: '' };
    showAddPopup = true;
  }

  function closeAddPopup() {
    showAddPopup = false;
    selectedAddId = '';
    addingCustom = false;
  }

  function onSelectProvider(id) {
    selectedAddId = id;
    wizardKey = '';
    wizardLocalUrl = allProviders[id]?.apiBase || '';
    wizardLocalKey = '';
    addingCustom = false;
  }

  $: selectedProvider = selectedAddId ? allProviders[selectedAddId] : null;

  async function wizardSaveKey() {
    const key = wizardKey.trim();
    if (!key || !selectedAddId) return;
    await upsertConnection(db, selectedAddId, {
      access_token: key,
      refresh_token: '',
      expires_at: 0,
    });
    connections[selectedAddId] = await getConnection(db, selectedAddId);
    connections = connections;
    if (!enabledProviders.includes(selectedAddId)) {
      enabledProviders = [...enabledProviders, selectedAddId];
      await setSetting(db, 'ai_providers_enabled', JSON.stringify(enabledProviders));
    }
    // Fetch available models in background
    fetchAndStoreModels(selectedAddId);
    selectedAddId = '';
    wizardKey = '';
    closeAddPopup();
  }

  async function wizardSaveLocal() {
    if (!selectedAddId) return;
    const scopes = JSON.stringify({ baseUrl: wizardLocalUrl.trim() });
    await upsertConnection(db, selectedAddId, {
      access_token: wizardLocalKey.trim() || '',
      refresh_token: '',
      expires_at: 0,
      scopes,
    });
    connections[selectedAddId] = await getConnection(db, selectedAddId);
    connections = connections;
    if (!enabledProviders.includes(selectedAddId)) {
      enabledProviders = [...enabledProviders, selectedAddId];
      await setSetting(db, 'ai_providers_enabled', JSON.stringify(enabledProviders));
    }
    // Fetch models from the local endpoint
    await fetchAndStoreModels(selectedAddId);
    selectedAddId = '';
    closeAddPopup();
  }

  function wizardConnectOAuth() {
    if (selectedProvider?.oauthUrl) {
      window.location.href = selectedProvider.oauthUrl;
    }
  }

  // --- Remove ---

  async function removeProvider(id) {
    await removeConnection(db, id);
    delete connections[id];
    connections = connections;
    enabledProviders = enabledProviders.filter(p => p !== id);
    await setSetting(db, 'ai_providers_enabled', JSON.stringify(enabledProviders));
  }

  // --- Custom endpoint ---

  async function saveCustomEndpoint() {
    if (!customInput.name.trim() || !customInput.baseUrl.trim()) return;
    const entry = {
      id: `custom-${Date.now()}`,
      name: customInput.name.trim(),
      baseUrl: customInput.baseUrl.trim(),
    };
    customProviders = [...customProviders, entry];
    await setSetting(db, 'custom_providers', JSON.stringify(customProviders));
    allProviders = getAllProviders(JSON.stringify(customProviders));

    const scopes = JSON.stringify({ baseUrl: entry.baseUrl });
    await upsertConnection(db, entry.id, {
      access_token: customInput.apiKey?.trim() || '',
      refresh_token: '',
      expires_at: 0,
      scopes,
    });
    connections[entry.id] = await getConnection(db, entry.id);
    connections = connections;
    enabledProviders = [...enabledProviders, entry.id];
    await setSetting(db, 'ai_providers_enabled', JSON.stringify(enabledProviders));

    // Fetch models from the custom endpoint
    await fetchAndStoreModels(entry.id);

    customInput = { name: '', baseUrl: '', apiKey: '' };
    addingCustom = false;
    closeAddPopup();
  }

  async function removeCustomEndpoint(id) {
    customProviders = customProviders.filter(c => c.id !== id);
    await setSetting(db, 'custom_providers', JSON.stringify(customProviders));
    allProviders = getAllProviders(JSON.stringify(customProviders));
    await removeProvider(id);
  }

  // --- Other settings ---

  async function setSpeechProfileFn(id) {
    speechProfile = id;
    await setSetting(db, 'speech_profile', id);
    // Keep voice_provider in sync for backward compatibility
    const profile = SPEECH_PROFILE_MAP[id];
    if (profile) {
      const legacyMap = { 'browser-native': 'web-speech', 'elevenlabs-whisper': 'elevenlabs', 'playht-whisper': 'playht' };
      voiceProvider = legacyMap[id] || 'web-speech';
      await setSetting(db, 'voice_provider', voiceProvider);
    }
  }

  // Speech API key management
  let speechApiKey = '';
  let speechApiKeySaved = false;
  let speechConnIsOAuth = false; // true if token comes from OAuth (AI Providers section)

  // Determine which connection key is needed for the active speech profile
  function getSpeechConnectionKey(profileId) {
    const tts = resolveTtsProvider(profileId);
    const stt = resolveSttProvider(profileId);
    // Prefer TTS provider key; fall back to STT if TTS is browser
    if (tts !== 'browser') return SPEECH_PROVIDER_CONNECTION_MAP[tts] || null;
    if (stt !== 'browser') return SPEECH_PROVIDER_CONNECTION_MAP[stt] || null;
    return null;
  }

  $: activeSpeechConnKey = getSpeechConnectionKey(speechProfile);

  // Load existing key when profile changes
  $: if (activeSpeechConnKey && db) {
    loadSpeechApiKey(activeSpeechConnKey);
  }

  async function loadSpeechApiKey(connKey) {
    speechApiKey = '';
    speechApiKeySaved = false;
    speechConnIsOAuth = false;
    if (!db || !connKey) return;
    const conn = await getConnection(db, connKey);
    if (conn?.access_token) {
      // If this connection key is also an AI provider, the token was set up there — don't show API key input
      const isAiProvider = enabledProviders.includes(connKey) || conn.refresh_token;
      if (isAiProvider) {
        speechConnIsOAuth = true;
        speechApiKeySaved = true;
      } else {
        speechApiKey = conn.access_token;
        speechApiKeySaved = true;
      }
    }
  }

  async function saveSpeechApiKey() {
    if (!db || !activeSpeechConnKey || !speechApiKey.trim()) return;
    await upsertConnection(db, activeSpeechConnKey, {
      access_token: speechApiKey.trim(),
      refresh_token: '',
      expires_at: 0,
    });
    speechApiKeySaved = true;
  }

  // ── Speech test mic — continuous conversation ──
  let testState = 'idle'; // idle | listening | thinking | speaking
  let testTranscript = '';  // current interim/final transcript
  let testMessages = [];    // conversation history [{role, content}]
  let micLevel = 0;         // 0-1 RMS audio level for visual meter
  let testSpeechService = null;

  function buildTestSystemPrompt() {
    const active = SPEECH_PROFILE_MAP[speechProfile];
    const profileSummaries = SPEECH_PROFILES.map(p => {
      const cost = p.costPerHour === 0 ? 'Free' : `~$${p.costPerHour.toFixed(2)}/hr`;
      const status = p.id === speechProfile ? 'ACTIVE (currently testing)' : p.available ? 'available' : 'coming soon';
      return `- ${p.name}: TTS=${p.tts.provider}, STT=${p.stt.provider}, ${cost}, ${status}${p.s2s ? ' [speech-to-speech]' : ''}`;
    }).join('\n');

    return `You are a voice interface test assistant for ThinkDone. The user is testing speech profiles in Settings.

CURRENTLY ACTIVE PROFILE: ${active.name}
- TTS (text-to-speech): ${active.tts.provider} — ${active.tts.description}
- STT (speech-to-text): ${active.stt.provider} — ${active.stt.description}
- Cost: ${active.costPerHour === 0 ? 'Free' : `~$${active.costPerHour.toFixed(2)}/hr`}
${active.s2s ? '- Mode: Speech-to-speech (single model handles both directions)\n' : ''}
ALL AVAILABLE PROFILES:
${profileSummaries}

Your job: Help the user evaluate their current voice profile. Comment on what they're hearing (the TTS quality), discuss tradeoffs between profiles if asked, and suggest alternatives. Keep replies to 2-3 sentences — this is a voice conversation so be concise. Be warm and natural.`;
  }

  async function ensureTestSpeechService() {
    if (testSpeechService) return;
    let apiKey = null;
    const ttsP = resolveTtsProvider(speechProfile);
    const sttP = resolveSttProvider(speechProfile);
    const providerKey = ttsP !== 'browser' ? ttsP : sttP;
    const connKey = SPEECH_PROVIDER_CONNECTION_MAP[providerKey] || providerKey;
    const conn = await getConnection(db, connKey);
    apiKey = conn?.access_token || null;

    // Try browser-direct first
    if (apiKey && canDirectConnect(speechProfile)) {
      const isOAuth = !!(conn?.refresh_token);
      let freshToken = apiKey;
      if (isOAuth) {
        try {
          freshToken = await ensureFreshToken(conn);
          if (conn._refreshed) {
            await upsertConnection(db, connKey, conn);
          }
        } catch (e) {
          console.error('[Settings] token refresh failed:', e);
        }
      }
      testSpeechService = createSpeechService(speechProfile, {
        apiKey: isOAuth ? undefined : freshToken,
        accessToken: isOAuth ? freshToken : undefined,
        systemPrompt: buildTestSystemPrompt(),
      });
      return;
    }

    // Fall back to WS
    const wsUrl = `ws://${location.host}/ws/speech`;
    const wsAvailable = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 3000);
      try {
        const ws = new WebSocket(wsUrl);
        ws.addEventListener('open', () => { clearTimeout(timeout); ws.close(); resolve(true); });
        ws.addEventListener('error', () => { clearTimeout(timeout); resolve(false); });
      } catch { clearTimeout(timeout); resolve(false); }
    });

    if (wsAvailable) {
      testSpeechService = createSpeechService(speechProfile, {
        WebSocket: globalThis.WebSocket,
        wsUrl,
        apiKey,
      });
    }
    // If neither direct nor WS available, service stays null — browser-only mode
    // Create local service for browser-only
    if (!testSpeechService) {
      testSpeechService = createSpeechService(speechProfile);
    }
  }

  async function startSpeechTest() {
    if (testState !== 'idle') { stopSpeechTest(); return; }
    testTranscript = '';
    testMessages = [];

    await ensureTestSpeechService();
    if (!testSpeechService) return;

    const active = SPEECH_PROFILE_MAP[speechProfile];
    const isS2s = active.s2s && testSpeechService?.mode === 's2s';

    // Wire callbacks (same for all modes)
    testSpeechService.onUserTranscript((text, isFinal) => {
      testTranscript = text;
      if (isFinal) {
        if (isS2s) {
          testMessages = [...testMessages, { role: 'user', content: text }];
        } else {
          onFinalTranscript(text);
        }
      }
    });
    testSpeechService.onMicLevel((rms) => { micLevel = rms; });

    if (isS2s) {
      // S2S: Gemini IS the AI
      testSpeechService.onStreamingAudio?.((pcm) => {
        if (testState !== 'speaking') {
          testState = 'speaking';
          testMessages = [...testMessages, { role: 'assistant', content: '...' }];
        }
      });
      testSpeechService.onAiAudio?.((wav, transcript) => {
        if (transcript) {
          const idx = testMessages.findLastIndex(m => m.role === 'assistant');
          if (idx >= 0) {
            testMessages[idx] = { ...testMessages[idx], content: transcript };
            testMessages = [...testMessages];
          }
        }
        testState = 'listening';
      });

      try {
        await testSpeechService.startVoice();
      } catch (err) {
        console.error('[Settings] voice setup failed:', err);
        testState = 'idle';
        return;
      }

      testState = 'speaking';
      testMessages = [{ role: 'assistant', content: 'Connecting...' }];
      testSpeechService.speak('Begin the voice test. Greet me and tell me what voice profile is active.').then(result => {
        if (result?.transcript) {
          testMessages = [{ role: 'assistant', content: result.transcript }];
        }
        testState = 'listening';
      }).catch(err => {
        console.error('[Settings] greeting error:', err);
      });
    } else {
      // TTS+STT mode
      const costNote = active.costPerHour === 0 ? "which is completely free" : `at about $${active.costPerHour.toFixed(2)} per hour`;
      const greeting = `Hey! You're currently testing ${active.name} — that's ${active.tts.provider} for my voice and ${active.stt.provider} for listening to you, ${costNote}. Go ahead and say something so we can try it out!`;
      testMessages = [{ role: 'assistant', content: greeting }];

      try {
        await testSpeechService.startVoice();
      } catch (err) {
        console.error('[Settings] voice setup failed:', err);
        testState = 'idle';
        return;
      }

      testState = 'speaking';
      speakTestResponse(greeting);
    }
  }


  function onFinalTranscript(text) {
    console.log(`[Settings] onFinalTranscript: "${text.slice(0, 60)}"`);
    testMessages = [...testMessages, { role: 'user', content: text }];
    testTranscript = '';
    sendTestToAI();
  }

  async function sendTestToAI() {
    console.log(`[Settings] sendTestToAI() messages=${testMessages.length}`);
    testState = 'thinking';
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: testMessages.map(m => ({ role: m.role, content: m.content })),
          system: buildTestSystemPrompt(),
          model: 'claude-haiku-4-5-20251001',
        }),
      });
      let fullText = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.text) fullText += d.text;
          } catch {}
        }
      }
      const reply = fullText.replace(/<meeting_state>[\s\S]*?<\/meeting_state>/, '').trim();
      console.log(`[Settings] AI reply: "${reply.slice(0, 80)}..."`);
      testMessages = [...testMessages, { role: 'assistant', content: reply }];
      testState = 'speaking';
      speakTestResponse(reply);
    } catch (err) {
      console.error('[Settings] sendTestToAI error:', err);
      if (testState !== 'idle') testState = 'listening';
    }
  }

  function speakTestResponse(text) {
    testState = 'speaking';
    if (!testSpeechService) { testState = 'listening'; return; }
    testSpeechService.speak(text).then(() => {
      if (testState !== 'idle') testState = 'listening';
    }).catch(() => {
      if (testState !== 'idle') testState = 'listening';
    });
  }

  function stopSpeechTest() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    testSpeechService?.stopVoice();
    testSpeechService?.destroy();
    testSpeechService = null;
    testState = 'idle';
    micLevel = 0;
  }

  // Float selected speech profile to top so it's always visible
  $: sortedSpeechProfiles = (() => {
    const idx = SPEECH_PROFILES.findIndex(p => p.id === speechProfile);
    if (idx <= 0) return SPEECH_PROFILES;
    return [SPEECH_PROFILES[idx], ...SPEECH_PROFILES.slice(0, idx), ...SPEECH_PROFILES.slice(idx + 1)];
  })();

  let showAllConnections = false;

  $: connectionsByCategory = getConnectionsByCategory();

  $: totalConnections = connectionsByCategory.reduce((n, g) => n + g.connections.length, 0);

  // Show only first 3 individual connections when collapsed
  $: visibleConnectionsByCategory = (() => {
    if (showAllConnections) return connectionsByCategory;
    let remaining = 3;
    const result = [];
    for (const group of connectionsByCategory) {
      if (remaining <= 0) break;
      const slice = group.connections.slice(0, remaining);
      result.push({ ...group, connections: slice });
      remaining -= slice.length;
    }
    return result;
  })();

  async function saveDisplayName() {
    await setSetting(db, 'display_name', displayName);
  }

  async function exportData() {
    const tables = ['tasks', 'memories', 'routines', 'completions', 'conversations', 'personality', 'api_usage', 'connections', 'settings'];
    const data = {};
    for (const table of tables) {
      data[table] = await db.prepare(`SELECT * FROM ${table}`).all();
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thinkdone-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function clearAllData() {
    if (!confirm('This will delete ALL your data including tasks, memories, routines, and connections. This cannot be undone. Are you sure?')) return;
    await clearDatabase(db);
    await ensureSchema(db);
    window.location.reload();
  }
</script>

  <!-- AI Providers -->
  <section class="settings-section" aria-labelledby="settings-ai">
    <h2 id="settings-ai"><svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 15v2a3 3 0 0 0 6 0v-2"/><path d="M8 9h2l1 2 2-4 1 2h2"/></svg>AI Providers</h2>
    <p class="section-desc">ThinkDone strategizes the best model from your cheapest provider, even utilizing free tiers automatically to minimize your costs.</p>

    <table class="provider-table" aria-label="Active AI providers">
      <thead>
        <tr>
          <th>Provider</th>
          <th class="col-models">Models</th>
          <th class="col-pricing">Pricing</th>
          <th class="col-action"></th>
        </tr>
      </thead>
      <tbody>
        {#each connectedList as id}
          {@const p = allProviders[id]}
          {@const cp = customProviders.find(c => c.id === id)}
          {#if p || cp}
            <tr>
              <td class="cell-provider">
                <span class="p-icon" aria-hidden="true">{p?.icon || '\u2699'}</span>
                <span class="p-info">
                  <span class="p-name">
                    {p?.name || cp?.name}
                    {#if connectedList[0] === id}<span class="tag tag-primary">Primary</span>{/if}
                    {#if id === smartestId}<span class="tag tag-smart">Smartest</span>{/if}
                    {#if id === bestValueId}<span class="tag tag-value">Best value</span>{/if}
                  </span>
                  <span class="p-desc">
                    <span class="quality-dots" title="{getQualityRating(id)}/5 capability"><span class="dot-on">{'●'.repeat(getQualityRating(id))}</span><span class="dot-off">{'●'.repeat(5 - getQualityRating(id))}</span></span>
                    {p?.description || ''}
                  </span>
                </span>
              </td>
              <td class="cell-models">{getDisplayModels(id)}</td>
              <td class="cell-pricing">
                {#if getDisplayPricing(id) === 'Free tier'}
                  <span class="price-badge free">Free tier</span>
                {:else if getDisplayPricing(id) === 'Default'}
                  <span class="price-badge included">Default</span>
                {:else if getDisplayPricing(id) === 'Self-hosted'}
                  <span class="price-badge local">Self-hosted</span>
                {:else}
                  <span class="price-text">{getDisplayPricing(id)}</span>
                {/if}
              </td>
              <td class="cell-action">
                {#if id !== 'thinkdone'}
                  <button class="btn-remove" on:click={() => cp ? removeCustomEndpoint(id) : removeProvider(id)} aria-label="Remove {p?.name || cp?.name}" title="Remove">&times;</button>
                {/if}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>

    <button class="btn-add-provider" on:click={openAddPopup} aria-label="Add provider">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="7" y1="2" x2="7" y2="12"/><line x1="2" y1="7" x2="12" y2="7"/></svg>
      Add Provider
    </button>
  </section>

  <!-- Add Provider Popup -->
  {#if showAddPopup}
    <div class="popup-backdrop" on:click|self={closeAddPopup} on:keydown={(e) => e.key === 'Escape' && closeAddPopup()} role="dialog" aria-modal="true" aria-label="Add AI provider">
      <div class="popup">
        <div class="popup-header">
          <h3>Add Provider</h3>
          <button class="popup-close" on:click={closeAddPopup} aria-label="Close">&times;</button>
        </div>

        {#if !addingCustom}
          <select class="select-input" bind:value={selectedAddId} on:change={(e) => onSelectProvider(e.target.value)} aria-label="Choose a provider">
            <option value="">Choose provider...</option>
            {#each availableProviders as id}
              {@const p = allProviders[id]}
              <option value={id}>{p.icon} {p.name}{p.freeTier ? ` (${p.freeTier})` : ''}</option>
            {/each}
          </select>
        {/if}

        {#if selectedProvider}
          <div class="wizard-form">
            <span class="wizard-desc">{selectedProvider.description}</span>

            {#if isLocal(selectedAddId)}
              <input type="text" class="text-input" bind:value={wizardLocalUrl} placeholder="Base URL" aria-label="Base URL" />
              <input type="password" class="text-input" bind:value={wizardLocalKey} placeholder="API key (optional)" aria-label="API key" />
              <button class="btn btn-primary" on:click={wizardSaveLocal} disabled={fetchingModels}>
                {fetchingModels ? 'Detecting models...' : 'Connect'}
              </button>
            {:else}
              {#if selectedProvider.oauthLabel}
                {#if selectedProvider.oauthUrl}
                  <button class="btn btn-oauth" on:click={wizardConnectOAuth}>
                    {#if selectedAddId === 'gemini'}
                      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    {:else}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    {/if}
                    {selectedProvider.oauthLabel}
                  </button>
                {:else}
                  <button class="btn btn-oauth" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    {selectedProvider.oauthLabel}
                    <span class="badge badge-soon">Coming soon</span>
                  </button>
                {/if}
                {#if hasApiKey(selectedAddId)}
                  <span class="wizard-or">or paste an API key</span>
                {/if}
              {/if}
              {#if hasApiKey(selectedAddId)}
                <div class="key-row">
                  <input
                    type="password"
                    class="text-input"
                    placeholder={selectedProvider.authPlaceholder || 'API key'}
                    bind:value={wizardKey}
                    on:keydown={(e) => e.key === 'Enter' && wizardSaveKey()}
                    aria-label="{selectedProvider.name} API key"
                  />
                  <button class="btn btn-primary" on:click={wizardSaveKey} disabled={!wizardKey.trim()}>Add</button>
                </div>
              {/if}
            {/if}
          </div>
        {/if}

        {#if addingCustom}
          <div class="wizard-form">
            <input type="text" class="text-input" bind:value={customInput.name} placeholder="Name (e.g. My vLLM)" aria-label="Custom endpoint name" />
            <input type="text" class="text-input" bind:value={customInput.baseUrl} placeholder="http://gpu-box:8000/v1" aria-label="Base URL" />
            <input type="password" class="text-input" bind:value={customInput.apiKey} placeholder="API key (optional)" aria-label="API key" />
            <div class="wizard-btns">
              <button class="btn btn-primary" on:click={saveCustomEndpoint} disabled={!customInput.name.trim() || !customInput.baseUrl.trim() || fetchingModels}>
                {fetchingModels ? 'Detecting models...' : 'Add'}
              </button>
              <button class="btn" on:click={() => { addingCustom = false; }}>Back</button>
            </div>
          </div>
        {:else}
          <button class="btn-link" on:click={() => { addingCustom = true; selectedAddId = ''; }}>+ Custom endpoint</button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Speech -->
  <section class="settings-section" aria-labelledby="settings-speech">
    <h2 id="settings-speech"><svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="4"/><path d="M9 13c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z"/><path d="M16 7c.8.8 1.2 1.8 1.2 3s-.4 2.2-1.2 3"/><path d="M19 4c1.6 1.6 2.5 3.8 2.5 6s-.9 4.4-2.5 6"/></svg>Speech</h2>
    <p class="section-desc">Choose a speech model if you wish to communicate with voice.</p>

    <table class="provider-table" aria-label="Speech interaction profiles">
      <thead>
        <tr>
          <th class="col-radio"></th>
          <th>Profile</th>
          <th class="col-cost">Cost</th>
          <th class="col-status">Status</th>
        </tr>
      </thead>
      <tbody>
        {#each showAllSpeech ? sortedSpeechProfiles : sortedSpeechProfiles.slice(0, 3) as profile}
          <tr class={speechProfile === profile.id ? 'row-active' : ''} class:row-dimmed={!profile.available}>
            <td class="cell-radio">
              <input
                type="radio"
                name="speech_profile"
                value={profile.id}
                checked={speechProfile === profile.id}
                disabled={!profile.available}
                on:change={() => setSpeechProfileFn(profile.id)}
                aria-label="Select {profile.name}"
              />
            </td>
            <td class="cell-provider">
              <span class="p-icon" aria-hidden="true">{profile.icon}</span>
              <span class="p-info">
                <span class="p-name">
                  {profile.name}
                  {#if profile.s2s}<span class="tag tag-s2s">S2S</span>{/if}
                </span>
                <span class="p-desc">{#if profile.s2s}Speech-to-speech, single model{:else}{profile.tts.provider} + {profile.stt.provider}{/if}</span>
              </span>
            </td>
            <td class="cell-cost">
              {#if profile.costTier === 0}
                <span class="price-badge free">Free</span>
              {:else}
                <span class="cost-dollars">{'$'.repeat(profile.costTier)}<span class="cost-dollars-dim">{'$'.repeat(3 - profile.costTier)}</span></span>
                <span class="cost-estimate">~${profile.costPerHour.toFixed(2)}/hr</span>
              {/if}
            </td>
            <td class="cell-status">
              {#if profile.available && speechProfile === profile.id}
                {#if activeSpeechConnKey && speechConnIsOAuth}
                  <span class="badge badge-active">Connected</span>
                {:else}
                  <span class="badge badge-active">Active</span>
                {/if}
              {:else if !profile.available}
                <span class="badge badge-soon">Coming soon</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if sortedSpeechProfiles.length > 3}
      <button class="btn-link" on:click={() => showAllSpeech = !showAllSpeech}>
        {showAllSpeech ? 'Show less' : `Show ${sortedSpeechProfiles.length - 3} more`}
      </button>
    {/if}

    {#if activeSpeechConnKey && !speechConnIsOAuth}
      <div class="speech-key-row">
        <label for="speech-api-key">API Key for {SPEECH_PROFILE_MAP[speechProfile]?.name || speechProfile}</label>
        <div class="key-row">
          <input
            id="speech-api-key"
            type="password"
            class="text-input"
            placeholder="Paste API key..."
            bind:value={speechApiKey}
            on:keydown={(e) => e.key === 'Enter' && saveSpeechApiKey()}
          />
          <button class="btn btn-primary" on:click={saveSpeechApiKey} disabled={!speechApiKey.trim()}>
            {speechApiKeySaved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
    {/if}

    <!-- Test mic — continuous conversation -->
    <div class="speech-test-area" class:active={testState !== 'idle'}>
      {#if testMessages.length > 0 || testTranscript || testState === 'thinking'}
        <div class="speech-test-log">
          {#each testMessages as msg}
            <div class="test-bubble {msg.role === 'user' ? 'test-user' : 'test-ai'}">{msg.content}</div>
          {/each}
          {#if testTranscript}
            <div class="test-bubble test-user test-interim">{testTranscript}</div>
          {/if}
          {#if testState === 'thinking'}
            <div class="test-thinking">Thinking...</div>
          {/if}
        </div>
      {/if}
      <div class="speech-test-controls">
        {#if testState === 'idle' && testMessages.length === 0}
          <span class="test-hint">Test your voice setup</span>
        {:else if testState === 'listening'}
          <span class="test-hint listening-hint">
            Listening...
            <span class="mic-level" style="width: {Math.max(4, micLevel * 60)}px" aria-hidden="true"></span>
          </span>
        {:else if testState === 'speaking'}
          <span class="test-hint">Speaking...</span>
        {/if}
        <button
          class="test-mic"
          class:active={testState !== 'idle'}
          class:listening={testState === 'listening'}
          class:speaking={testState === 'speaking'}
          on:click={startSpeechTest}
          aria-label={testState === 'idle' ? 'Test speech' : 'Stop test'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            {#if testState !== 'idle'}
              <rect x="6" y="6" width="12" height="12" rx="2" />
            {:else}
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 10a7 7 0 0014 0" />
              <line x1="12" y1="17" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            {/if}
          </svg>
        </button>
      </div>
    </div>
  </section>

  <!-- Connections -->
  <section class="settings-section" aria-labelledby="settings-connections">
    <h2 id="settings-connections"><svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M7.5 11l9-4M7.5 13l9 4"/></svg>Connections</h2>
    <p class="section-desc">Connect to external apps and services to let ThinkDone pull in information for better planning.</p>

    {#each visibleConnectionsByCategory as group}
      <div class="conn-category">
        <div class="conn-category-header">
          <span class="conn-category-icon" aria-hidden="true">{group.icon}</span>
          <span class="conn-category-label">{group.label}</span>
        </div>
        {#each group.connections as conn}
          <div class="connector row-dimmed" role="listitem" aria-label="{conn.name} — Coming soon">
            <span class="conn-icon" aria-hidden="true">{conn.icon}</span>
            <div class="connector-info">
              <span class="connector-name">{conn.name}</span>
              <span class="connector-desc">{conn.description}</span>
            </div>
            <span class="badge badge-soon">Coming soon</span>
          </div>
        {/each}
      </div>
    {/each}

    {#if totalConnections > 3}
      <button class="btn-link" on:click={() => showAllConnections = !showAllConnections}>
        {showAllConnections ? 'Show less' : `Show ${totalConnections - 3} more connections`}
      </button>
    {/if}
  </section>

  <!-- Billing -->
  <section class="settings-section" aria-labelledby="settings-billing">
    <h2 id="settings-billing"><svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18"/><path d="M7 12h4"/><path d="M7 15h2"/></svg>Billing</h2>
    <div class="billing-row">
      <span class="plan-name">Pay as you go</span>
      <a href="/usage" class="btn btn-small">View usage &#8594;</a>
    </div>
    <p class="section-desc" style="margin-bottom:0.5rem">You pay only for what you use. Free providers (Gemini, Groq) have no cost.</p>
    <div class="provider-info">
      <span class="badge badge-soon">Coming soon</span>
      Subscription plans with included tokens
    </div>
  </section>

  <!-- Account -->
  <section class="settings-section" aria-labelledby="settings-account">
    <h2 id="settings-account"><svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/></svg>Account</h2>

    <div class="field">
      <label for="display-name">Display Name</label>
      <input
        id="display-name"
        type="text"
        class="text-input"
        bind:value={displayName}
        on:blur={saveDisplayName}
      />
    </div>

    <div class="data-actions">
      <button class="btn" on:click={exportData}>Export Data</button>
      <button class="btn btn-danger" on:click={clearAllData}>Clear All Data</button>
    </div>
  </section>

<style>
  .settings-section {
    margin-bottom: 1.25rem;
    padding: 1.25rem 1.5rem;
    background: linear-gradient(135deg, var(--color-paper-bright) 0%,
      color-mix(in srgb, var(--color-warm) 30%, var(--color-paper-bright)) 100%);
    border: 1px solid color-mix(in srgb, var(--color-ink-faint) 60%, transparent);
    border-radius: 12px;
    box-shadow: 0 1px 3px var(--color-card-shadow), 0 4px 12px var(--color-card-shadow),
      inset 0 1px 0 var(--color-card-glow);
    opacity: 0;
    transform: translateY(12px);
    transition: opacity 0.4s ease-out, transform 0.4s ease-out, box-shadow 0.3s ease;
  }
  .settings-section:nth-child(1) { transition-delay: 0.05s; }
  .settings-section:nth-child(2) { transition-delay: 0.10s; }
  .settings-section:nth-child(3) { transition-delay: 0.15s; }
  .settings-section:nth-child(4) { transition-delay: 0.20s; }
  .settings-section:nth-child(5) { transition-delay: 0.25s; }
  .settings-section:global(.visible) {
    opacity: 1;
    transform: translateY(0);
  }

  .settings-section h2 {
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-ink);
    margin-bottom: 0.25rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-ink-faint) 40%, transparent);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .section-icon {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    color: var(--color-accent);
    filter: drop-shadow(1px 1px 1.5px rgba(139,69,19,0.25));
    transition: transform 0.2s ease;
  }
  .settings-section:hover .section-icon { transform: scale(1.08); }

  .section-desc {
    font-family: var(--font-hand);
    font-size: 0.95rem;
    color: var(--color-ink-muted);
    margin-bottom: 1rem;
    line-height: 1.4;
  }

  /* ── Provider table ── */
  .provider-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0.75rem;
    table-layout: fixed;
  }
  .provider-table thead th {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-ink-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    text-align: left;
    padding: 0 8px 6px;
    border-bottom: 1.5px solid var(--color-ink-faint);
  }
  .provider-table tbody tr {
    border-bottom: 1px solid color-mix(in srgb, var(--color-ink-faint) 40%, transparent);
    transition: background 0.15s ease, box-shadow 0.2s ease, transform 0.15s ease;
  }
  .provider-table tbody tr:hover {
    background: color-mix(in srgb, var(--color-gold) 5%, var(--color-paper-bright));
    box-shadow: 0 2px 8px rgba(139,69,19,0.08);
    transform: translateY(-1px);
  }
  .provider-table tbody tr:last-child { border-bottom: none; }
  .provider-table td {
    padding: 12px 8px;
    vertical-align: middle;
  }
  .col-models { width: 35%; }
  .col-pricing { width: 15%; }
  .col-action { width: 32px; }

  .cell-provider {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .p-icon {
    font-size: 16px;
    width: 22px;
    text-align: center;
    color: var(--color-ink-light);
    flex-shrink: 0;
  }
  .p-info {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
  }
  .p-name {
    font-family: var(--font-hand);
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--color-ink);
    line-height: 1.2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
  }
  .p-desc {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--color-ink-light);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell-models {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--color-ink-light);
    line-height: 1.3;
  }

  .cell-pricing {
    white-space: nowrap;
  }
  .price-badge {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 8px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    transition: transform 0.15s ease;
  }
  .price-badge:hover { transform: scale(1.04); }
  .price-badge.free {
    background: var(--color-success-bg); color: var(--color-success-fg);
    border: 1px solid color-mix(in srgb, var(--color-success-fg) 20%, transparent);
  }
  .price-badge.free::before { content: '\2713'; }
  .price-badge.included {
    background: color-mix(in srgb, var(--color-gold) 15%, var(--color-paper-bright)); color: var(--color-accent);
    border: 1px solid color-mix(in srgb, var(--color-gold) 30%, transparent);
  }
  .price-badge.included::before { content: '\2605'; }
  .price-badge.local {
    background: var(--color-warm); color: var(--color-ink-light);
    border: 1px solid color-mix(in srgb, var(--color-ink-faint) 40%, transparent);
  }
  .price-badge.local::before { content: '\2302'; }
  .price-text {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-ink-light);
  }

  .btn-remove {
    background: none;
    border: none;
    color: var(--color-ink-muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 10px;
    opacity: 0.2;
    border-radius: 50%;
    transition: opacity 0.15s, color 0.15s, background 0.15s, transform 0.15s;
  }
  .btn-remove:hover {
    opacity: 1;
    color: var(--color-danger-fg);
    background: var(--color-danger-bg);
    transform: scale(1.15);
  }
  .btn-remove:active { transform: scale(0.95); }

  .btn-add-provider {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 22px;
    font-family: var(--font-ui);
    font-size: 0.8rem;
    font-weight: 600;
    color: white;
    background: var(--color-accent);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
    box-shadow: 0 2px 6px rgba(139,69,19,0.25);
  }
  .btn-add-provider:hover {
    background: color-mix(in srgb, var(--color-accent) 85%, black);
    transform: translateY(-1px);
    box-shadow: 0 3px 10px rgba(139,69,19,0.35);
  }
  .btn-add-provider:active {
    transform: scale(0.98);
    box-shadow: 0 1px 3px rgba(139,69,19,0.15);
  }
  .btn-add-provider svg {
    flex-shrink: 0;
  }

  .quality-dots {
    font-size: 0.55rem;
    letter-spacing: 1.5px;
    margin-right: 4px;
    white-space: nowrap;
  }
  .dot-on { color: var(--color-gold, #b8860b); filter: drop-shadow(0 1px 2px var(--color-gold-glow)); }
  .dot-off { color: var(--color-ink-faint); opacity: 0.25; }

  .tag {
    font-family: var(--font-ui);
    font-size: 0.65rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    vertical-align: middle;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    transition: transform 0.15s ease;
  }
  .tag:hover { transform: scale(1.04); }
  .tag-primary { background: var(--color-warn-bg); color: var(--color-warn-fg); }
  .tag-smart { background: var(--color-info-bg); color: var(--color-info-fg); }
  .tag-value { background: var(--color-success-bg); color: var(--color-success-fg); }
  .tag-s2s { background: var(--color-purple-bg); color: var(--color-purple-fg); }

  @media (max-width: 768px) {
    .col-models, .cell-models { display: none; }
    .p-desc { display: none; }
    .col-pricing { width: auto; }
    .col-cost { width: auto; }
    .col-status { width: auto; }
    .cell-status .badge { font-size: 0; padding: 0; }
    .cell-status .badge::before { font-size: 0.65rem; }
    .cell-status .badge-active::before { content: '\2713'; color: var(--color-success-fg); }
    .cell-status .badge-soon::before { content: '\231B'; }
  }

  @media (max-width: 600px) {
    /* ── AI Provider table ── */
    .col-pricing { width: auto; }
    .col-action { width: 28px; }
    .p-name .tag { font-size: 0.55rem; padding: 1px 4px; }

    /* ── Speech table: collapse Cost + Status into compact form ── */
    .col-cost { width: auto; }
    .col-status { width: auto; }
    .cell-status .badge { font-size: 0; padding: 0; }
    .cell-status .badge::before { font-size: 0.65rem; }
    .cell-status .badge-active::before { content: '\2713'; color: var(--color-success-fg); }
    .cell-status .badge-soon::before { content: '\231B'; }

    /* ── Connections: hide description, shrink badge ── */
    .connector-desc { display: none; }
    .connector .badge { font-size: 0.55rem; padding: 2px 5px; }

    /* ── Section padding ── */
    .settings-section { padding: 1rem; }

    /* ── Buttons: full-width stack ── */
    .data-actions { flex-direction: column; }
    .data-actions .btn { width: 100%; }

    /* ── Billing row ── */
    .billing-row { flex-direction: column; align-items: flex-start; gap: 8px; }
  }

  /* ── Add Provider Popup ── */
  .popup-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(58, 50, 38, 0.3);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: backdrop-fade 0.2s ease-out;
  }
  @keyframes backdrop-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .popup {
    background: linear-gradient(180deg, var(--color-paper-bright) 0%,
      color-mix(in srgb, var(--color-warm) 20%, var(--color-paper-bright)) 100%);
    border: 1px solid var(--color-ink-faint);
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    width: 360px;
    max-width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 4px 12px rgba(139,69,19,0.08), 0 12px 40px rgba(139,69,19,0.12),
      inset 0 1px 0 rgba(255,253,248,0.6);
    animation: popup-enter 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes popup-enter {
    from { opacity: 0; transform: scale(0.95) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
  .popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .popup-header h3 {
    font-family: var(--font-display);
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--color-ink-light);
    margin: 0;
  }
  .popup-close {
    background: none;
    border: none;
    font-size: 20px;
    color: var(--color-ink-muted);
    cursor: pointer;
    padding: 8px;
    line-height: 1;
  }
  .popup-close:hover { color: var(--color-ink); }

  .wizard-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--color-warm);
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.04);
    border: 1px solid color-mix(in srgb, var(--color-ink-faint) 30%, transparent);
  }
  .wizard-desc {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--color-ink-light);
    line-height: 1.3;
  }
  .wizard-or {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-ink-muted);
    text-align: center;
  }
  .wizard-btns {
    display: flex;
    gap: 6px;
  }
  .key-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .key-row .text-input { flex: 1; }

  .btn-link {
    background: none;
    border: none;
    color: var(--color-accent);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    cursor: pointer;
    padding: 4px 0;
    text-align: left;
  }
  .btn-link:hover { text-decoration: underline; }

  /* ── Shared form styles ── */
  .field {
    margin-bottom: 1rem;
  }
  .field label {
    display: block;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-ink-light);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 0.5rem;
  }

  .text-input, .select-input {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 8px 10px;
    border: 1px solid var(--color-ink-faint);
    border-radius: 5px;
    background: var(--color-paper-bright);
    color: var(--color-ink);
    width: 100%;
    box-sizing: border-box;
  }
  .text-input, .select-input {
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .text-input:focus, .select-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px rgba(139,69,19,0.08), 0 2px 6px rgba(139,69,19,0.06);
  }

  .btn:focus-visible,
  .btn-remove:focus-visible,
  .btn-add-provider:focus-visible,
  .btn-link:focus-visible,
  .btn-oauth:focus-visible,
  .btn-danger:focus-visible,
  .popup-close:focus-visible,
  .test-mic:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 1rem;
  }
  .radio-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-hand);
    font-size: 1rem;
    cursor: pointer;
    color: var(--color-ink);
  }
  .radio-label input[type="radio"] {
    accent-color: var(--color-accent);
  }

  .badge {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    transition: transform 0.15s ease;
  }
  .badge:hover { transform: scale(1.04); }
  .badge-free {
    background: var(--color-success-bg); color: var(--color-success-fg);
    border: 1px solid color-mix(in srgb, var(--color-success-fg) 20%, transparent);
  }
  .badge-soon {
    background: var(--color-warm); color: var(--color-ink-light);
    border: 1px solid color-mix(in srgb, var(--color-ink-faint) 40%, transparent);
  }

  .provider-info {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--color-warm);
    border-radius: 6px;
    font-family: var(--font-hand);
    font-size: 0.9rem;
    color: var(--color-ink-light);
    margin-bottom: 1rem;
  }
  .info-icon { font-size: 16px; }

  .btn {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    padding: 8px 16px;
    border: 1px solid var(--color-ink-faint);
    border-radius: 5px;
    background: var(--color-paper-bright);
    color: var(--color-ink-light);
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(139,69,19,0.06);
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.1s;
  }
  .btn:hover {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 5%, transparent);
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(139,69,19,0.1);
  }
  .btn:active {
    transform: translateY(0) scale(0.98);
    box-shadow: 0 0 2px rgba(139,69,19,0.08);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn-small {
    padding: 6px 12px;
    font-size: 0.7rem;
  }
  .btn-primary {
    background: var(--color-accent);
    color: white;
    border-color: var(--color-accent);
    box-shadow: 0 2px 6px rgba(139,69,19,0.25);
  }
  .btn-primary:hover {
    background: color-mix(in srgb, var(--color-accent) 85%, black);
    box-shadow: 0 3px 10px rgba(139,69,19,0.3);
  }
  .btn-danger {
    color: var(--color-danger-fg);
    border-color: var(--color-danger-bg);
  }
  .btn-danger:hover {
    background: var(--color-danger-bg);
    border-color: var(--color-danger-fg);
    box-shadow: 0 2px 8px rgba(187,68,68,0.15);
  }
  .btn-oauth {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    font-family: var(--font-ui);
    font-size: 0.8rem;
    font-weight: 500;
    border: 1px solid var(--color-ink-faint);
    border-radius: 6px;
    background: var(--color-paper-bright);
    color: var(--color-ink);
    cursor: pointer;
    transition: box-shadow 0.15s, opacity 0.15s;
    width: 100%;
    box-sizing: border-box;
  }
  .btn-oauth:hover:not(:disabled) {
    box-shadow: 0 1px 4px rgba(0,0,0,0.12);
  }
  .btn-oauth:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .btn-oauth svg {
    flex-shrink: 0;
  }
  .btn-oauth .badge {
    margin-left: auto;
  }

  /* ── Speech table extras ── */
  .col-radio { width: 32px; }
  .col-cost { width: 120px; }
  .col-status { width: 105px; }
  .cell-radio {
    text-align: center;
    padding: 8px 4px;
  }
  .cell-radio input[type="radio"] {
    accent-color: var(--color-accent);
    cursor: pointer;
  }
  .cell-radio input[type="radio"]:disabled {
    cursor: default;
  }
  .cell-cost {
    white-space: nowrap;
  }
  .cell-status {
    white-space: nowrap;
  }
  .cost-dollars {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-ink-light);
    letter-spacing: -0.5px;
  }
  .cost-dollars-dim {
    color: var(--color-ink-light);
  }
  .cost-estimate {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-ink-light);
    margin-left: 4px;
  }
  .row-active {
    background: color-mix(in srgb, var(--color-gold) 8%, var(--color-paper-bright));
    box-shadow: inset 3px 0 0 var(--color-gold), 0 1px 4px var(--color-gold-glow);
    border-radius: 4px;
  }
  .row-dimmed {
    opacity: 0.8;
  }
  .badge-active {
    background: var(--color-success-bg);
    color: var(--color-success-fg);
  }

  .speech-key-row {
    margin-top: 0.75rem;
    padding: 10px 12px;
    background: var(--color-warm);
    border-radius: 8px;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.04);
    border: 1px solid color-mix(in srgb, var(--color-ink-faint) 30%, transparent);
  }
  /* ── Speech test ── */
  .speech-test-area {
    margin-top: 0.75rem;
  }
  .speech-test-area.active {
    padding: 10px 12px;
    background: var(--color-warm);
    border-radius: 8px;
  }
  .speech-test-log {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 160px;
    overflow-y: auto;
    margin-bottom: 8px;
    scrollbar-width: none;
  }
  .speech-test-log::-webkit-scrollbar { display: none; }
  .test-bubble {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    line-height: 1.4;
    padding: 5px 10px;
    border-radius: 10px;
    max-width: 85%;
    word-break: break-word;
  }
  .test-user {
    align-self: flex-end;
    background: var(--color-warm);
    color: var(--color-ink);
  }
  .test-user.test-interim {
    opacity: 0.5;
  }
  .test-ai {
    align-self: flex-start;
    background: var(--color-paper-bright);
    color: var(--color-ink);
    border: 1px solid var(--color-ink-faint);
  }
  .test-thinking {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-ink-muted);
    align-self: flex-start;
    padding: 2px 0;
  }
  .speech-test-controls {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
  }
  .test-hint {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-ink-light);
  }
  .listening-hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    animation: hint-fade 1.5s ease-in-out infinite;
  }
  .mic-level {
    display: inline-block;
    height: 6px;
    min-width: 4px;
    border-radius: 3px;
    background: var(--color-sage, #5a9a70);
    transition: width 0.08s ease-out;
  }
  @keyframes hint-fade {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .test-mic {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1.5px solid var(--color-ink-faint);
    background: var(--color-paper-bright);
    color: var(--color-ink-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    transition: all 0.2s;
  }
  .test-mic svg {
    width: 16px;
    height: 16px;
  }
  .test-mic:hover {
    border-color: var(--color-gold);
    color: var(--color-gold);
  }
  .test-mic.active {
    background: var(--color-gold);
    border-color: var(--color-gold);
    color: white;
  }
  .test-mic.listening {
    animation: test-pulse 1.5s ease-in-out infinite;
  }
  .test-mic.speaking {
    animation: test-speak 1.2s ease-in-out infinite;
  }
  @keyframes test-pulse {
    0%, 100% { box-shadow: 0 0 0 0 transparent; }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-gold) 20%, transparent); }
  }
  @keyframes test-speak {
    0%, 100% { box-shadow: 0 0 0 0 transparent; }
    50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-gold) 15%, transparent); }
  }

  .speech-key-row label {
    display: block;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-ink-light);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 6px;
  }

  /* ── Connections catalog ── */
  .conn-category {
    margin-bottom: 0.75rem;
  }
  .conn-category:last-child {
    margin-bottom: 0;
  }
  .conn-category-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--color-ink-faint);
  }
  .conn-category-icon {
    font-size: 12px;
    color: var(--color-ink-light);
  }
  .conn-category-label {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-ink-light);
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  .connector {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.2s, transform 0.15s;
  }
  .connector:hover {
    background: color-mix(in srgb, var(--color-gold) 4%, var(--color-warm));
    border-color: color-mix(in srgb, var(--color-ink-faint) 40%, transparent);
    box-shadow: 0 2px 6px rgba(139,69,19,0.06);
    transform: translateY(-1px);
  }
  .conn-icon {
    font-size: 14px;
    width: 22px;
    text-align: center;
    color: var(--color-ink-light);
    flex-shrink: 0;
  }
  .connector-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .connector-name {
    font-family: var(--font-hand);
    font-size: 0.9rem;
    color: var(--color-ink);
    line-height: 1.2;
  }
  .connector-desc {
    font-family: var(--font-ui);
    font-size: 0.65rem;
    color: var(--color-ink-light);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .billing-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--color-gold) 5%, var(--color-paper-bright));
    border: 1px solid color-mix(in srgb, var(--color-gold) 15%, transparent);
    border-radius: 8px;
  }
  .plan-name {
    font-family: var(--font-hand);
    font-size: 1.1rem;
    color: var(--color-ink);
  }

  .data-actions {
    display: flex;
    gap: 10px;
    margin-top: 1rem;
  }
</style>
