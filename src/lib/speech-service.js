// Speech service abstraction — pluggable TTS+STT and S2S providers
// Resolver functions + factory. Voice session management (mic, playback, STT) lives here too.
import { SPEECH_PROFILE_MAP } from './speech.js';
import {
  BROWSER_DIRECT_TTS, BROWSER_DIRECT_STT, BROWSER_DIRECT_S2S,
  streamTts as browserStreamTts, createSttSession as browserSttSession,
  openGeminiLiveSession,
} from './speech-providers-browser.js';

// Map speech provider keys → connection table keys (for API key lookup)
export const SPEECH_PROVIDER_CONNECTION_MAP = {
  elevenlabs: 'elevenlabs',
  whisper: 'openai',
  'google-cloud': 'google-cloud-speech',
  playht: 'playht',
  azure: 'azure-speech',
  'aws-polly': 'amazon-polly',
  'aws-transcribe': 'amazon-polly',
  deepgram: 'deepgram',
  'gemini-live': 'gemini',
  'openai-realtime': 'openai',
};

// Map provider display names → internal provider keys
const TTS_PROVIDER_MAP = {
  'Web Speech API': 'browser',
  'Browser TTS': 'browser',
  'ElevenLabs': 'elevenlabs',
  'PlayHT': 'playht',
  'Google Cloud TTS': 'google-cloud',
  'Azure TTS': 'azure',
  'AWS Polly': 'aws-polly',
  'Gemini Live': 'gemini-live',
  'OpenAI Realtime': 'openai-realtime',
};

const STT_PROVIDER_MAP = {
  'Web Speech API': 'browser',
  'OpenAI Whisper': 'whisper',
  'Deepgram Nova-2': 'deepgram',
  'Google Cloud STT': 'google-cloud',
  'Azure STT': 'azure',
  'AWS Transcribe': 'aws-transcribe',
  'Gemini Live': 'gemini-live',
  'OpenAI Realtime': 'openai-realtime',
};

function getProfile(profileId) {
  const p = SPEECH_PROFILE_MAP[profileId];
  if (!p) throw new Error('Unknown speech profile');
  return p;
}

export function resolveMode(profileId) {
  const p = getProfile(profileId);
  if (p.s2s) return 's2s';
  const tts = TTS_PROVIDER_MAP[p.tts.provider];
  const stt = STT_PROVIDER_MAP[p.stt.provider];
  if (tts === 'browser' && stt === 'browser') return 'browser';
  return 'tts+stt';
}

export function resolveTtsProvider(profileId) {
  const p = getProfile(profileId);
  return TTS_PROVIDER_MAP[p.tts.provider] || 'browser';
}

export function resolveSttProvider(profileId) {
  const p = getProfile(profileId);
  return STT_PROVIDER_MAP[p.stt.provider] || 'browser';
}

export function resolveS2sProvider(profileId) {
  const p = getProfile(profileId);
  if (!p.s2s) return null;
  // S2S profiles use same provider for both TTS and STT
  return TTS_PROVIDER_MAP[p.tts.provider] || null;
}

export function canDirectConnect(profileId) {
  const mode = resolveMode(profileId);
  if (mode === 'browser') return false;
  if (mode === 's2s') return BROWSER_DIRECT_S2S.has(resolveS2sProvider(profileId));
  const tts = resolveTtsProvider(profileId);
  const stt = resolveSttProvider(profileId);
  return (tts === 'browser' || BROWSER_DIRECT_TTS.has(tts))
      && (stt === 'browser' || BROWSER_DIRECT_STT.has(stt));
}

export function estimateCost(profileId, ttsSeconds, sttSeconds) {
  const p = getProfile(profileId);
  if (p.costPerHour === 0) return 0;
  const totalSeconds = ttsSeconds + sttSeconds;
  if (totalSeconds === 0) return 0;
  return p.costPerHour * totalSeconds / 3600;
}

export function createSpeechService(profileId, options = {}) {
  const mode = resolveMode(profileId);
  console.log(`[speech-svc] createSpeechService profile=${profileId} mode=${mode} hasWS=${!!options.WebSocket} wsUrl=${options.wsUrl || 'none'} hasApiKey=${!!options.apiKey} hasAccessToken=${!!options.accessToken}`);
  // Browser mode: local-only service, no WS
  if (mode === 'browser' && !options.WebSocket) {
    console.log('[speech-svc] → creating LOCAL service (browser mode, no WS)');
    return createLocalService(profileId, mode, options);
  }
  // Browser-direct mode: API key or access token + direct-capable → no WS needed
  if ((options.apiKey || options.accessToken) && options.direct !== false && canDirectConnect(profileId)) {
    console.log('[speech-svc] → creating DIRECT service (browser → provider)');
    return createDirectService(profileId, mode, options);
  }
  // Server-proxied mode: WS-backed client
  if (options.WebSocket) {
    console.log('[speech-svc] → creating WS service');
    return createWsSpeechService(profileId, mode, options);
  }
  // Default: local stub service (backwards compat)
  console.log('[speech-svc] → creating LOCAL stub service (fallback)');
  return createLocalService(profileId, mode, options);
}

function createLocalService(profileId, mode, options = {}) {
  console.log(`[speech-svc] createLocalService profile=${profileId} mode=${mode}`);
  let ttsSeconds = 0;
  let sttSeconds = 0;
  let voiceState = null;
  let userTranscriptCb = null;
  let aiAudioCb = null;
  // Injectable browser deps (production defaults → real browser APIs; tests → mocks)
  const deps = {
    SpeechRecognition: options.SpeechRecognition || globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
    SpeechSynthesis: options.SpeechSynthesis || globalThis.speechSynthesis,
    SpeechSynthesisUtterance: options.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance,
  };
  return {
    profileId,
    mode,
    async speak(text) {
      // If voice session active AND SpeechSynthesis available, use it
      if (voiceState && deps.SpeechSynthesis && deps.SpeechSynthesisUtterance) {
        await new Promise((resolve) => {
          const utt = new deps.SpeechSynthesisUtterance(text);
          utt.rate = 1.05;
          utt.onend = () => resolve();
          utt.onerror = () => resolve();
          deps.SpeechSynthesis.speak(utt);
        });
        if (aiAudioCb) aiAudioCb(null, text);
      }
      return { durationMs: 0 };
    },
    stopSpeaking() {},
    listen(_onResult) {},
    stopListening() {},
    sendAudio(_buf) {},
    async converse(_audioBlob) { return { audioBlob: null, transcript: '', durationMs: 0 }; },
    get speaking() { return false; },
    get listening() { return false; },
    onUserTranscript(cb) { userTranscriptCb = cb; },
    onMicLevel(_cb) {}, // no-op for local service (no mic pipeline)
    onAiAudio(cb) { aiAudioCb = cb; },
    get voiceActive() { return !!voiceState; },
    async startVoice() {
      if (voiceState) return; // idempotent
      // Create SpeechRecognition if available
      let sttRecog = null;
      const SR = deps.SpeechRecognition;
      if (SR) {
        sttRecog = new SR();
        sttRecog.continuous = true;
        sttRecog.interimResults = true;
        sttRecog.lang = 'en-US';
        sttRecog.onresult = (event) => {
          let transcript = '';
          let hasFinal = false;
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
            if (event.results[i].isFinal) hasFinal = true;
          }
          if (userTranscriptCb) userTranscriptCb(transcript, hasFinal);
        };
        sttRecog.onend = () => {
          if (voiceState?.sttRecog) {
            try { sttRecog.start(); } catch {}
          }
        };
        sttRecog.start();
      }
      voiceState = { sttRecog };
    },
    stopVoice() {
      if (!voiceState) return;
      if (voiceState.sttRecog) { voiceState.sttRecog.abort(); }
      voiceState = null;
    },
    getUsage() {
      return { ttsSeconds, sttSeconds, estimatedCost: estimateCost(profileId, ttsSeconds, sttSeconds) };
    },
    resetUsage() { ttsSeconds = 0; sttSeconds = 0; },
    _addUsage(tts, stt) { ttsSeconds += tts; sttSeconds += stt; },
    destroy() {
      this.stopVoice();
      this.stopSpeaking();
      this.stopListening();
    },
  };
}

// --- PCM conversion helpers ---
export function pcm16ToFloat32(pcmData) {
  const samples = pcmData.length / 2;
  const float32 = new Float32Array(samples);
  const view = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
  for (let i = 0; i < samples; i++) float32[i] = view.getInt16(i * 2, true) / 32768;
  return float32;
}

export function float32ToPcm16(float32) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.floor(float32[i] * 32768)));
  }
  return pcm;
}

function createDirectService(profileId, mode, options) {
  let ttsSeconds = 0;
  let sttSeconds = 0;
  let _speaking = false;
  let _listening = false;
  let activeStt = null;
  let geminiSession = null; // persistent S2S session
  let listenCallback = null;
  let aiAudioCallback = null;
  let streamingAudioCb = null;
  let streamingTranscriptCb = null;
  let ttsAbort = null;

  // --- Voice session state ---
  let voiceState = null;   // { micCtx, processor, micStream, playbackCtx, playhead, sttRecog }
  let userTranscriptCb = null;
  let micLevelCb = null;
  let speakingState = false;

  // Injectable browser deps (production defaults → real browser APIs; tests → mocks)
  const deps = {
    getUserMedia: options.getUserMedia || (c => navigator.mediaDevices.getUserMedia(c)),
    AudioContext: options.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext,
    SpeechRecognition: options.SpeechRecognition || globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
    SpeechSynthesis: options.SpeechSynthesis || globalThis.speechSynthesis,
    SpeechSynthesisUtterance: options.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance,
  };

  const config = {
    apiKey: options.apiKey,
    accessToken: options.accessToken,
    userId: options.userId,
    region: options.region,
    voice: options.voice,
    systemPrompt: options.systemPrompt,
    language: options.language,
  };

  // For S2S: lazy-init persistent Gemini Live session
  function ensureGeminiSession() {
    if (geminiSession) return geminiSession;
    geminiSession = openGeminiLiveSession(config);
    // Wire up callbacks for unsolicited responses (Gemini responding to audio input)
    geminiSession.onTurnAudio((wav, transcript) => {
      _speaking = false;
      if (listenCallback && transcript) listenCallback(transcript, true);
      if (aiAudioCallback) aiAudioCallback(wav, transcript);
    });
    // Streaming: fire per-chunk for immediate playback
    geminiSession.onAudioChunk((pcm) => {
      if (streamingAudioCb) streamingAudioCb(pcm);
    });
    geminiSession.onTranscript((text) => {
      if (streamingTranscriptCb) streamingTranscriptCb(text);
    });
    return geminiSession;
  }

  return {
    profileId,
    mode,
    async speak(text) {
      _speaking = true;
      const startTime = Date.now();
      try {
        // S2S mode: send text to persistent Gemini session, get audio back
        if (mode === 's2s') {
          const session = ensureGeminiSession();
          // Wait for WS setup with timeout — rejects if connection fails or closes early
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Gemini connection timeout (10s)')), 10000);
            session.onError((err) => { clearTimeout(timeout); reject(err); });
            session.onReady(() => { clearTimeout(timeout); resolve(); });
          });
          const result = await session.sendText(text);
          const elapsed = Date.now() - startTime;
          ttsSeconds += elapsed / 1000;
          _speaking = false;
          return { durationMs: elapsed, audioChunks: result.audioChunks, transcript: result.transcript };
        }
        // TTS+STT mode: stream TTS
        ttsAbort = new AbortController();
        const ttsProvider = resolveTtsProvider(profileId);
        // Browser TTS: if voice active, play via SpeechSynthesis
        if (ttsProvider === 'browser') {
          if (voiceState && deps.SpeechSynthesis && deps.SpeechSynthesisUtterance) {
            speakingState = true;
            _speaking = false; // not "speaking" in the TTS streaming sense
            await new Promise((resolve) => {
              const utt = new deps.SpeechSynthesisUtterance(text);
              utt.rate = 1.05;
              utt.onend = () => { speakingState = false; resolve(); };
              utt.onerror = () => { speakingState = false; resolve(); };
              deps.SpeechSynthesis.speak(utt);
            });
            if (aiAudioCallback) aiAudioCallback(null, text);
          }
          return { durationMs: 0, audioChunks: [] };
        }
        const chunks = [];
        for await (const chunk of browserStreamTts(ttsProvider, text, config, (url, init) => {
          return fetch(url, { ...init, signal: ttsAbort.signal });
        })) {
          if (!_speaking) break;
          chunks.push(chunk);
        }
        const elapsed = Date.now() - startTime;
        ttsSeconds += elapsed / 1000;
        _speaking = false;
        return { durationMs: elapsed, audioChunks: chunks };
      } catch (err) {
        _speaking = false;
        if (err.name === 'AbortError') return { durationMs: 0, audioChunks: [] };
        throw err;
      }
    },
    stopSpeaking() {
      _speaking = false;
      if (ttsAbort) { ttsAbort.abort(); ttsAbort = null; }
    },
    listen(onResult) {
      listenCallback = onResult;
      _listening = true;
      if (mode === 's2s') {
        // S2S: persistent session already wired up via ensureGeminiSession
        ensureGeminiSession();
        return;
      }
      const sttProvider = resolveSttProvider(profileId);
      if (sttProvider === 'browser') return;
      activeStt = browserSttSession(sttProvider, config);
    },
    stopListening() {
      _listening = false;
      // S2S: session stays open, just stop streaming audio
      if (activeStt) {
        const startTime = Date.now();
        activeStt.finish().then(result => {
          sttSeconds += (Date.now() - startTime) / 1000;
          if (listenCallback) listenCallback(result.transcript, true);
        }).catch(() => {});
        activeStt = null;
      }
    },
    sendAudio(buf) {
      const chunk = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      // S2S: stream PCM to persistent Gemini session
      if (mode === 's2s' && geminiSession) { geminiSession.sendAudio(chunk); return; }
      if (activeStt) activeStt.feed(chunk);
    },
    // Register callback for AI audio during S2S listen mode
    onAiAudio(cb) { aiAudioCallback = cb; },
    // Streaming: raw PCM chunks as they arrive (before turnComplete)
    onStreamingAudio(cb) { streamingAudioCb = cb; },
    // Streaming: AI transcript text as it arrives
    onStreamingTranscript(cb) { streamingTranscriptCb = cb; },
    async converse(_audioBlob) {
      return { audioBlob: null, transcript: '', durationMs: 0 };
    },
    get speaking() { return _speaking; },
    get listening() { return _listening; },
    get isSpeaking() { return speakingState; },
    get voiceActive() { return !!voiceState; },
    onUserTranscript(cb) { userTranscriptCb = cb; },
    onMicLevel(cb) { micLevelCb = cb; },
    async startVoice(overrideDeps) {
      if (voiceState) return; // already active

      if (mode === 's2s') {
        // S2S mode: playback + mic pipeline + STT
        // 1. Create playback AudioContext (24kHz for Gemini output)
        const playbackCtx = new deps.AudioContext({ sampleRate: 24000 });
        let playhead = playbackCtx.currentTime;

        // 2. Wire streaming audio → gapless playback + speaking state
        streamingAudioCb = (pcm) => {
          if (!speakingState) { speakingState = true; }
          const float32 = pcm16ToFloat32(pcm);
          const buffer = playbackCtx.createBuffer(1, float32.length, 24000);
          buffer.copyToChannel(float32, 0);
          const source = playbackCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(playbackCtx.destination);
          const startAt = Math.max(playbackCtx.currentTime, playhead);
          source.start(startAt);
          playhead = startAt + buffer.duration;
        };

        // 3. Wire turn complete → schedule unmute after playback drains
        const origTurnCb = aiAudioCallback;
        aiAudioCallback = (wav, transcript) => {
          const remaining = Math.max(0, playhead - (playbackCtx?.currentTime || 0));
          setTimeout(() => { speakingState = false; }, remaining * 1000);
          if (origTurnCb) origTurnCb(wav, transcript);
        };

        // 4. Request mic with echo cancellation (injectable)
        const micStream = await deps.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        const micCtx = new deps.AudioContext({ sampleRate: 16000 });
        if (micCtx.state === 'suspended') await micCtx.resume();
        const micSource = micCtx.createMediaStreamSource(micStream);
        const processor = micCtx.createScriptProcessor(4096, 1, 1);
        const svc = this; // capture for closure
        processor.onaudioprocess = (e) => {
          const float32 = e.inputBuffer.getChannelData(0);
          // Fire mic level regardless of mute state
          if (micLevelCb) {
            let sum = 0;
            for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
            micLevelCb(Math.min(1, Math.sqrt(sum / float32.length) * 10));
          }
          if (speakingState) return; // auto-mute while AI speaks
          const pcm = float32ToPcm16(float32);
          svc.sendAudio(new Uint8Array(pcm.buffer));
        };
        micSource.connect(processor);
        processor.connect(micCtx.destination);

        // 5. Start browser SpeechRecognition for user transcript (injectable)
        let sttRecog = null;
        if (deps.SpeechRecognition) {
          sttRecog = new deps.SpeechRecognition();
          sttRecog.continuous = true;
          sttRecog.interimResults = true;
          sttRecog.lang = 'en-US';
          sttRecog.onresult = (event) => {
            let transcript = '';
            let hasFinal = false;
            for (let i = event.resultIndex; i < event.results.length; i++) {
              transcript += event.results[i][0].transcript;
              if (event.results[i].isFinal) hasFinal = true;
            }
            if (userTranscriptCb) userTranscriptCb(transcript, hasFinal);
          };
          sttRecog.onend = () => {
            if (voiceState?.sttRecog) {
              try { sttRecog.start(); } catch {}
            }
          };
          sttRecog.start();
        }

        voiceState = { micCtx, processor, micStream, playbackCtx, playhead, sttRecog };
      } else {
        // TTS+STT mode
        const sttProvider = resolveSttProvider(profileId);
        let micCtx = null, processor = null, micStream = null, sttRecog = null;

        if (sttProvider === 'browser') {
          // Browser STT: just SpeechRecognition, no mic AudioContext needed
          if (deps.SpeechRecognition) {
            sttRecog = new deps.SpeechRecognition();
            sttRecog.continuous = true;
            sttRecog.interimResults = true;
            sttRecog.lang = 'en-US';
            sttRecog.onresult = (event) => {
              let transcript = '';
              let hasFinal = false;
              for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
                if (event.results[i].isFinal) hasFinal = true;
              }
              if (userTranscriptCb) userTranscriptCb(transcript, hasFinal);
            };
            sttRecog.onend = () => {
              if (voiceState?.sttRecog) {
                try { sttRecog.start(); } catch {}
              }
            };
            sttRecog.start();
          }
        } else {
          // Premium STT: need mic pipeline
          micStream = await deps.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          });
          micCtx = new deps.AudioContext({ sampleRate: 16000 });
          if (micCtx.state === 'suspended') await micCtx.resume();
          const micSource = micCtx.createMediaStreamSource(micStream);
          processor = micCtx.createScriptProcessor(4096, 1, 1);
          const svc = this;
          processor.onaudioprocess = (e) => {
            const float32 = e.inputBuffer.getChannelData(0);
            // RMS for mic level
            if (micLevelCb) {
              let sum = 0;
              for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
              micLevelCb(Math.min(1, Math.sqrt(sum / float32.length) * 10));
            }
            if (speakingState) return; // auto-mute
            const pcm = float32ToPcm16(float32);
            svc.sendAudio(new Uint8Array(pcm.buffer));
          };
          micSource.connect(processor);
          processor.connect(micCtx.destination);

          // Also start browser STT for transcripts if available
          if (deps.SpeechRecognition) {
            sttRecog = new deps.SpeechRecognition();
            sttRecog.continuous = true;
            sttRecog.interimResults = true;
            sttRecog.lang = 'en-US';
            sttRecog.onresult = (event) => {
              let transcript = '';
              let hasFinal = false;
              for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
                if (event.results[i].isFinal) hasFinal = true;
              }
              if (userTranscriptCb) userTranscriptCb(transcript, hasFinal);
            };
            sttRecog.onend = () => {
              if (voiceState?.sttRecog) try { sttRecog.start(); } catch {}
            };
            sttRecog.start();
          }
        }

        voiceState = { micCtx, processor, micStream, sttRecog };
      }
    },
    stopVoice() {
      if (!voiceState) return;
      speakingState = false;
      voiceState.processor?.disconnect();
      voiceState.micStream?.getTracks().forEach(t => t.stop());
      voiceState.micCtx?.close().catch(() => {});
      voiceState.playbackCtx?.close().catch(() => {});
      if (voiceState.sttRecog) { voiceState.sttRecog.abort(); }
      voiceState = null;
    },
    getUsage() {
      return { ttsSeconds, sttSeconds, estimatedCost: estimateCost(profileId, ttsSeconds, sttSeconds) };
    },
    resetUsage() { ttsSeconds = 0; sttSeconds = 0; },
    _addUsage(tts, stt) { ttsSeconds += tts; sttSeconds += stt; },
    destroy() {
      this.stopVoice();
      this.stopSpeaking();
      this.stopListening();
      if (geminiSession) { geminiSession.destroy(); geminiSession = null; }
    },
  };
}

// Bind WS events — works with both Node.js ws (.on) and browser WebSocket (.addEventListener)
function wsOn(ws, event, handler) {
  if (typeof ws.on === 'function') {
    ws.on(event, handler);
  } else {
    ws.addEventListener(event, handler);
  }
}

function createWsSpeechService(profileId, mode, options) {
  const WS = options.WebSocket;
  const wsUrl = options.wsUrl || `ws://${typeof location !== 'undefined' ? location.host : 'localhost:3456'}/ws/speech`;
  console.log(`[speech-svc] createWsSpeechService profile=${profileId} mode=${mode} url=${wsUrl}`);
  let ws = new WS(wsUrl);
  let ready = false;
  let readyResolve = null;
  let readyReject = null;
  const readyPromise = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Prevent unhandled rejection if no one awaits
  readyPromise.catch(() => {});
  let ttsSeconds = 0;
  let sttSeconds = 0;
  let estCost = 0;
  let speakResolve = null;
  let speakReject = null;
  let speakChunks = [];
  let listenCallback = null;
  let _speaking = false;
  let _listening = false;

  // Open → send session.start
  wsOn(ws, 'open', () => {
    console.log(`[speech-svc] WS open → sending session.start profile=${profileId}`);
    const startMsg = { type: 'session.start', profile: profileId };
    if (options.apiKey) startMsg.api_key = options.apiKey;
    ws.send(JSON.stringify(startMsg));
  });

  wsOn(ws, 'close', (e) => {
    const code = e?.code || e;
    const reason = e?.reason || '';
    console.log(`[speech-svc] WS closed code=${code} reason="${reason}"`);
    if (!ready && readyReject) { readyReject(new Error('WS closed before ready')); readyReject = null; }
  });

  wsOn(ws, 'error', (e) => {
    console.error('[speech-svc] WS error:', e?.message || e);
    if (!ready && readyReject) { readyReject(new Error('WS error before ready')); readyReject = null; }
  });

  // Handle incoming messages
  wsOn(ws, 'message', (event) => {
    // Node ws passes data directly; browser WebSocket wraps in MessageEvent
    const data = event.data !== undefined ? event.data : event;
    // Binary frame: audio chunk during TTS
    if (typeof data !== 'string') {
      const size = data.byteLength || data.size || '?';
      console.log(`[speech-svc] WS binary frame: ${size} bytes, speaking=${_speaking}`);
      if (_speaking && speakChunks) speakChunks.push(data);
      return;
    }
    let msg;
    try { msg = JSON.parse(data); } catch { console.warn('[speech-svc] WS non-JSON text:', data.slice(0, 100)); return; }
    console.log(`[speech-svc] WS msg: ${msg.type}`, msg.type === 'transcript' ? `"${msg.text}" final=${msg.isFinal}` : msg.type === 'error' ? msg.message : '');
    switch (msg.type) {
      case 'session.ready':
        ready = true;
        console.log('[speech-svc] session.ready — service is now operational');
        if (readyResolve) readyResolve();
        break;
      case 'audio.start':
        _speaking = true;
        speakChunks = [];
        break;
      case 'audio.end':
        _speaking = false;
        console.log(`[speech-svc] audio.end durationMs=${msg.durationMs} chunks=${speakChunks.length}`);
        if (speakResolve) {
          speakResolve({ durationMs: msg.durationMs, audioChunks: speakChunks });
          speakResolve = null; speakReject = null; speakChunks = [];
        }
        break;
      case 'transcript':
        if (listenCallback) listenCallback(msg.text, msg.isFinal);
        break;
      case 'usage':
        ttsSeconds = msg.ttsSeconds;
        sttSeconds = msg.sttSeconds;
        estCost = msg.estimatedCost;
        break;
      case 'error':
        console.error(`[speech-svc] server error: ${msg.message}`);
        if (speakReject) {
          speakReject(new Error(msg.message));
          speakResolve = null; speakReject = null;
        }
        break;
    }
  });

  function wsSend(data) {
    if (ws && ws.readyState === 1) {
      const label = typeof data === 'string' ? data.slice(0, 80) : `[binary ${data.byteLength || '?'} bytes]`;
      console.log(`[speech-svc] wsSend: ${label}`);
      ws.send(data);
    } else {
      console.warn(`[speech-svc] wsSend SKIPPED — readyState=${ws?.readyState}`);
    }
  }

  return {
    profileId,
    mode,
    async speak(text) {
      console.log(`[speech-svc] speak() text="${text.slice(0, 60)}..." readyState=${ws?.readyState} ready=${ready}`);
      // Wait for session.ready with 5s timeout
      await Promise.race([
        readyPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for session.ready (5s)')), 5000)),
      ]);
      console.log(`[speech-svc] speak() ready — sending to server`);
      return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== 1) { console.error('[speech-svc] speak() WS not connected after ready'); reject(new Error('WebSocket not connected')); return; }
        speakResolve = resolve;
        speakReject = reject;
        wsSend(JSON.stringify({ type: 'speak', text }));
      });
    },
    stopSpeaking() {
      console.log('[speech-svc] stopSpeaking()');
      _speaking = false;
      wsSend(JSON.stringify({ type: 'stop' }));
    },
    async listen(onResult) {
      console.log(`[speech-svc] listen() — awaiting ready (ready=${ready})`);
      await Promise.race([
        readyPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for session.ready (5s)')), 5000)),
      ]);
      console.log('[speech-svc] listen() ready — registering callback and sending listen.start');
      listenCallback = onResult;
      _listening = true;
      wsSend(JSON.stringify({ type: 'listen.start' }));
    },
    stopListening() {
      console.log('[speech-svc] stopListening()');
      _listening = false;
      wsSend(JSON.stringify({ type: 'listen.stop' }));
    },
    sendAudio(buf) {
      console.log(`[speech-svc] sendAudio ${buf.byteLength} bytes`);
      wsSend(buf);
    },
    async converse(_audioBlob) {
      return { audioBlob: null, transcript: '', durationMs: 0 };
    },
    get speaking() { return _speaking; },
    get listening() { return _listening; },
    getUsage() {
      return { ttsSeconds, sttSeconds, estimatedCost: estCost };
    },
    resetUsage() { ttsSeconds = 0; sttSeconds = 0; estCost = 0; },
    _addUsage(tts, stt) { ttsSeconds += tts; sttSeconds += stt; },
    destroy() {
      console.log(`[speech-svc] destroy() readyState=${ws?.readyState}`);
      this.stopSpeaking();
      this.stopListening();
      if (ws && ws.readyState !== 3) ws.close();
    },
  };
}
