// WebSocket speech handler — bidirectional speech streaming
import { resolveMode, resolveTtsProvider, resolveSttProvider, resolveS2sProvider, estimateCost } from './speech-service.js';

const KEY_ENV_MAP = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  whisper: 'OPENAI_API_KEY',
  'google-cloud': 'GOOGLE_CLOUD_API_KEY',
  playht: 'PLAYHT_API_KEY',
  azure: 'AZURE_SPEECH_KEY',
  'aws-polly': 'AWS_ACCESS_KEY_ID',
  'aws-transcribe': 'AWS_ACCESS_KEY_ID',
  deepgram: 'DEEPGRAM_API_KEY',
  'gemini-live': 'GEMINI_API_KEY',
  'openai-realtime': 'OPENAI_API_KEY',
};

export function handleSpeechConnection(ws, deps = {}) {
  console.log('[speech-ws] New connection');
  const providers = deps.providers;
  const getApiKey = deps.getApiKey || defaultGetApiKey;
  const resolvers = deps.resolvers || { resolveMode, resolveTtsProvider, resolveSttProvider, resolveS2sProvider, estimateCost };
  // State
  let session = null;
  let activeTts = null;
  let activeStt = null;
  let activeS2s = null;
  let ttsSeconds = 0;
  let sttSeconds = 0;
  let listenStartTime = null;
  let audioStartTime = null;

  function sendJSON(obj) {
    console.log(`[speech-ws] sendJSON: ${obj.type}`, obj.type === 'error' ? obj.message : '');
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    else console.warn(`[speech-ws] sendJSON skipped — ws not OPEN (readyState=${ws.readyState})`);
  }

  function sendError(code, message) {
    console.error(`[speech-ws] ERROR: ${code} — ${message}`);
    sendJSON({ type: 'error', code, message });
  }

  function sendUsage() {
    sendJSON({
      type: 'usage',
      ttsSeconds,
      sttSeconds,
      estimatedCost: session ? resolvers.estimateCost(session.profileId, ttsSeconds, sttSeconds) : 0,
    });
  }

  ws.on('message', async (data, isBinary) => {
    // Node ws delivers everything as Buffer — convert text frames to string
    // isBinary is true for binary frames, false for text frames (may be undefined in mocks)
    let str = null;
    if (typeof data === 'string') {
      str = data; // Mock WS or plain string
    } else if (isBinary === false || isBinary === undefined) {
      // Text frame delivered as Buffer (real ws library), or mock without isBinary
      str = Buffer.isBuffer(data) ? data.toString() : null;
      // Check if it looks like JSON to distinguish text vs binary
      if (str && str[0] !== '{') str = null;
    }
    // Binary audio frame → route to active STT or S2S
    if (str === null) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      console.log(`[speech-ws] binary frame: ${buf.length} bytes → S2S=${!!activeS2s} STT=${!!activeStt}`);
      if (activeS2s) {
        activeS2s.feed(buf);
        return;
      }
      if (activeStt) {
        activeStt.feed(buf);
        return;
      }
      return;
    }

    let msg;
    try {
      msg = JSON.parse(str);
    } catch {
      return sendError('invalid_json', 'Invalid JSON');
    }
    console.log(`[speech-ws] msg: ${msg.type}`, msg.type === 'session.start' ? `profile=${msg.profile}` : msg.type === 'speak' ? `text="${(msg.text||'').slice(0,50)}..."` : '');

    // session.start
    if (msg.type === 'session.start') {
      const profileId = msg.profile;
      if (!profileId) {
        return sendError('invalid_profile', 'Missing profile');
      }
      let mode;
      try {
        mode = resolvers.resolveMode(profileId);
      } catch (err) {
        return sendError('invalid_profile', 'Unknown speech profile');
      }
      console.log(`[speech-ws] session.start: profile=${profileId} mode=${mode} hasClientKey=${!!msg.api_key}`);
      // Check API key requirement
      if (mode !== 'browser') {
        let ttsProvider, sttProvider, s2sProvider;
        if (mode === 's2s') {
          s2sProvider = resolvers.resolveS2sProvider(profileId);
          const apiKey = await getApiKey(s2sProvider, msg.api_key);
          console.log(`[speech-ws] S2S: provider=${s2sProvider} hasKey=${!!apiKey}`);
          if (!apiKey) {
            return sendError('missing_api_key', `API key required for ${s2sProvider}`);
          }
        } else {
          ttsProvider = resolvers.resolveTtsProvider(profileId);
          sttProvider = resolvers.resolveSttProvider(profileId);
          console.log(`[speech-ws] TTS+STT: tts=${ttsProvider} stt=${sttProvider}`);
          if (ttsProvider !== 'browser') {
            const apiKey = await getApiKey(ttsProvider, msg.api_key);
            console.log(`[speech-ws] TTS key check: provider=${ttsProvider} hasKey=${!!apiKey} (env=${KEY_ENV_MAP[ttsProvider]})`);
            if (!apiKey) {
              return sendError('missing_api_key', `API key required for ${ttsProvider}`);
            }
          }
          if (sttProvider !== 'browser') {
            const apiKey = await getApiKey(sttProvider, msg.api_key || session?.clientApiKey);
            console.log(`[speech-ws] STT key check: provider=${sttProvider} hasKey=${!!apiKey} (env=${KEY_ENV_MAP[sttProvider]})`);
            if (!apiKey) {
              return sendError('missing_api_key', `API key required for ${sttProvider}`);
            }
          }
        }
      }
      session = { profileId, mode, clientApiKey: msg.api_key || null };
      const response = { type: 'session.ready', mode };
      if (mode === 'browser') {
        response.note = 'Browser-only mode. Server operations not available.';
      }
      console.log(`[speech-ws] → session.ready mode=${mode}`);
      sendJSON(response);
      return;
    }

    // All other commands require active session
    if (!session) {
      return sendError('no_session', 'Send session.start first');
    }

    switch (msg.type) {
      case 'speak': {
        // TTS
        console.log(`[speech-ws] speak: mode=${session.mode} text="${(msg.text||'').slice(0,60)}..."`);
        if (session.mode === 's2s') {
          return sendError('wrong_mode', 'Use listen.start for S2S mode');
        }
        if (session.mode === 'browser') {
          return sendError('browser_only', 'TTS not available in browser-only mode');
        }
        const text = msg.text;
        if (!text || text.trim() === '') {
          return sendError('empty_text', 'Text cannot be empty');
        }
        const ttsProvider = resolvers.resolveTtsProvider(session.profileId);
        const apiKey = await getApiKey(ttsProvider, msg.api_key || session.clientApiKey);
        console.log(`[speech-ws] speak: provider=${ttsProvider} hasKey=${!!apiKey}`);
        try {
          audioStartTime = Date.now();
          console.log(`[speech-ws] calling providers.streamTts(${ttsProvider})...`);
          const stream = providers.streamTts(ttsProvider, text, { apiKey });
          activeTts = { aborted: false };
          let started = false;
          let chunkCount = 0;
          let totalBytes = 0;
          for await (const chunk of stream) {
            if (!started) {
              console.log('[speech-ws] first chunk received, sending audio.start');
              sendJSON({ type: 'audio.start', contentType: 'audio/mpeg' });
              started = true;
            }
            if (activeTts?.aborted) { console.log('[speech-ws] TTS aborted'); break; }
            chunkCount++;
            totalBytes += chunk.length || chunk.byteLength || 0;
            ws.send(chunk);
          }
          const durationMs = Date.now() - audioStartTime;
          ttsSeconds += durationMs / 1000;
          console.log(`[speech-ws] TTS complete: ${chunkCount} chunks, ${totalBytes} bytes, ${durationMs}ms`);
          sendJSON({ type: 'audio.end', durationMs });
          sendUsage();
          activeTts = null;
        } catch (err) {
          console.error(`[speech-ws] TTS error:`, err);
          sendError('provider_error', err.message);
          activeTts = null;
        }
        break;
      }

      case 'listen.start': {
        // STT start
        console.log(`[speech-ws] listen.start: mode=${session.mode}`);
        if (activeStt || activeS2s) {
          return sendError('already_listening', 'Already listening');
        }
        if (session.mode === 'browser') {
          return sendError('browser_only', 'STT not available in browser-only mode');
        }
        if (session.mode === 's2s') {
          const s2sProvider = resolvers.resolveS2sProvider(session.profileId);
          const apiKey = await getApiKey(s2sProvider, msg.api_key || session.clientApiKey);
          console.log(`[speech-ws] creating S2S session: provider=${s2sProvider}`);
          activeS2s = providers.createS2sSession(s2sProvider, {
            apiKey,
            onInterim: (text, isFinal) => {
              sendJSON({ type: 'transcript', text, isFinal });
            },
          });
          activeS2s.onAudio((audioChunk) => {
            ws.send(audioChunk);
          });
          activeS2s.onTranscript((text, isFinal) => {
            sendJSON({ type: 'transcript', text, isFinal });
          });
          listenStartTime = Date.now();
        } else {
          const sttProvider = resolvers.resolveSttProvider(session.profileId);
          const apiKey = await getApiKey(sttProvider, msg.api_key || session?.clientApiKey);
          console.log(`[speech-ws] creating STT session: provider=${sttProvider} hasKey=${!!apiKey}`);
          activeStt = providers.createSttSession(sttProvider, {
            apiKey,
            onInterim: (text, isFinal) => {
              sendJSON({ type: 'transcript', text, isFinal });
            },
          });
          listenStartTime = Date.now();
        }
        break;
      }

      case 'listen.stop': {
        // STT stop
        console.log(`[speech-ws] listen.stop: S2S=${!!activeS2s} STT=${!!activeStt}`);
        if (activeS2s) {
          try {
            activeS2s.finish();
            const durationMs = Date.now() - listenStartTime;
            sttSeconds += durationMs / 1000;
            console.log(`[speech-ws] S2S finished: ${durationMs}ms`);
            sendUsage();
            activeS2s.destroy();
            activeS2s = null;
          } catch (err) {
            console.error('[speech-ws] S2S finish error:', err);
            sendError('provider_error', err.message);
          }
        } else if (activeStt) {
          try {
            console.log('[speech-ws] finishing STT...');
            const result = await activeStt.finish();
            const durationMs = result.durationMs || (Date.now() - listenStartTime);
            sttSeconds += durationMs / 1000;
            console.log(`[speech-ws] STT result: "${(result.transcript||'').slice(0,60)}" ${durationMs}ms`);
            sendJSON({ type: 'transcript', text: result.transcript, isFinal: true, durationMs });
            sendUsage();
            activeStt = null;
          } catch (err) {
            console.error('[speech-ws] STT finish error:', err);
            sendError('provider_error', err.message);
            activeStt = null;
          }
        }
        break;
      }

      case 'stop': {
        // Abort current operation
        if (activeTts) {
          activeTts.aborted = true;
          activeTts = null;
        }
        if (activeStt) {
          activeStt = null;
        }
        if (activeS2s) {
          activeS2s.destroy();
          activeS2s = null;
        }
        break;
      }

      default:
        sendError('unknown_command', `Unknown command: ${msg.type}`);
    }
  });

  ws.on('close', (code, reason) => { console.log(`[speech-ws] connection closed: code=${code} reason=${reason}`); cleanup(); });
  ws.on('error', (err) => { console.error('[speech-ws] connection error:', err?.message || err); cleanup(); });

  function cleanup() {
    if (activeTts) {
      activeTts.aborted = true;
      activeTts = null;
    }
    if (activeStt) activeStt = null;
    if (activeS2s) {
      activeS2s.destroy();
      activeS2s = null;
    }
    session = null;
  }
}

function defaultGetApiKey(provider, clientKey) {
  if (clientKey) return clientKey;
  const envKey = KEY_ENV_MAP[provider];
  return envKey ? process.env[envKey] || null : null;
}
