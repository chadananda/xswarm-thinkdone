// Browser-direct speech provider implementations.
// Uses fetch(), Uint8Array, Blob, atob()/btoa(), browser WebSocket.
// No Buffer, no node:crypto. Mirrors speech-providers.js API surface.
// IMPORTANT: Do NOT import from speech-providers.js — it pulls in aws-sign.js → node:crypto.

// Pure data duplicated here to avoid server-only dependency chain.
export const TTS_DEFAULTS = {
  elevenlabs: { voice: '21m00Tcm4TlvDq8ikWAM', model: 'eleven_multilingual_v2' },
  'google-cloud': { voice: 'en-US-Neural2-C', lang: 'en-US' },
  playht: { voice: 's3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414f/female-cs/manifest.json', quality: 'medium' },
  azure: { voice: 'en-US-JennyNeural', region: 'eastus', format: 'audio-16khz-32kbitrate-mono-mp3' },
  'aws-polly': { voice: 'Joanna', engine: 'neural', region: 'us-east-1', format: 'mp3' },
};
export const STT_DEFAULTS = {
  whisper: { model: 'whisper-1' },
  deepgram: { model: 'nova-2' },
  'google-cloud': { encoding: 'WEBM_OPUS', sampleRateHertz: 48000 },
  azure: { region: 'eastus' },
};

// Build Gemini WS URL — uses ?key= for API keys, ?access_token= for OAuth
function geminiWsUrl(config) {
  const base = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  if (config.accessToken) return `${base}?access_token=${config.accessToken}`;
  return `${base}?key=${config.apiKey}`;
}

// Which providers can run directly from the browser
export const BROWSER_DIRECT_TTS = new Set(['elevenlabs', 'google-cloud', 'playht', 'azure']);
export const BROWSER_DIRECT_STT = new Set(['whisper', 'deepgram', 'google-cloud', 'azure']);
export const BROWSER_DIRECT_S2S = new Set(['gemini-live']);

// --- Helpers ---

function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUint8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Wrap raw PCM bytes in a WAV container so decodeAudioData() can play it.
// Gemini Live returns PCM 16-bit signed LE at 24kHz mono.
export function pcmToWav(pcmData, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const dataLen = pcmData.length;
  const blockAlign = numChannels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const headerLen = 44;
  const wav = new Uint8Array(headerLen + dataLen);
  const view = new DataView(wav.buffer);

  // RIFF header
  writeString(wav, 0, 'RIFF');
  view.setUint32(4, headerLen + dataLen - 8, true); // file size - 8
  writeString(wav, 8, 'WAVE');

  // fmt sub-chunk
  writeString(wav, 12, 'fmt ');
  view.setUint32(16, 16, true);          // sub-chunk size (PCM = 16)
  view.setUint16(20, 1, true);           // audio format (PCM = 1)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(wav, 36, 'data');
  view.setUint32(40, dataLen, true);
  wav.set(pcmData, headerLen);

  return wav;
}

function writeString(buf, offset, str) {
  for (let i = 0; i < str.length; i++) buf[offset + i] = str.charCodeAt(i);
}

function concatUint8Arrays(arrays) {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// --- TTS: async generators yielding Uint8Array chunks ---

export async function* streamTts(provider, text, config, fetchFn = fetch) {
  if (provider === 'elevenlabs') yield* streamTtsElevenlabs(text, config, fetchFn);
  else if (provider === 'google-cloud') yield* streamTtsGoogleCloud(text, config, fetchFn);
  else if (provider === 'playht') yield* streamTtsPlayht(text, config, fetchFn);
  else if (provider === 'azure') yield* streamTtsAzure(text, config, fetchFn);
  else if (provider === 'aws-polly') throw new Error('aws-polly requires server proxy (SigV4 signing)');
  else throw new Error(`Unknown TTS provider: ${provider}`);
}

async function* streamTtsElevenlabs(text, config, fetchFn) {
  if (!config.apiKey) throw new Error('apiKey required for ElevenLabs');
  const voice = config.voice || TTS_DEFAULTS.elevenlabs.voice;
  const res = await fetchFn(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: { 'xi-api-key': config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: TTS_DEFAULTS.elevenlabs.model }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => 'unknown error');
    throw new Error(`Provider error (${res.status}): ${detail}`);
  }
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield value instanceof Uint8Array ? value : new Uint8Array(value);
  }
}

async function* streamTtsGoogleCloud(text, config, fetchFn) {
  if (!config.apiKey && !config.accessToken) throw new Error('apiKey or accessToken required for Google Cloud');
  const url = config.accessToken
    ? 'https://texttospeech.googleapis.com/v1/text:synthesize'
    : `https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.apiKey}`;
  const headers = { 'Content-Type': 'application/json' };
  if (config.accessToken) headers['Authorization'] = `Bearer ${config.accessToken}`;
  const d = TTS_DEFAULTS['google-cloud'];
  const voice = config.voice || d.voice;
  const res = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: d.lang, name: voice },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => 'unknown error');
    throw new Error(`Provider error (${res.status}): ${detail}`);
  }
  const json = await res.json();
  yield base64ToUint8(json.audioContent);
}

async function* streamTtsPlayht(text, config, fetchFn) {
  if (!config.apiKey) throw new Error('apiKey required for PlayHT');
  const d = TTS_DEFAULTS.playht;
  const voice = config.voice || d.voice;
  const res = await fetchFn('https://api.play.ht/api/v2/tts/stream', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'X-USER-ID': config.userId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, voice, quality: d.quality }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => 'unknown error');
    throw new Error(`Provider error (${res.status}): ${detail}`);
  }
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield value instanceof Uint8Array ? value : new Uint8Array(value);
  }
}

async function* streamTtsAzure(text, config, fetchFn) {
  if (!config.apiKey) throw new Error('apiKey required for Azure');
  const d = TTS_DEFAULTS.azure;
  const region = config.region || d.region;
  const voice = config.voice || d.voice;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${voice}">${text}</voice></speak>`;
  const res = await fetchFn(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': config.apiKey,
      'X-Microsoft-OutputFormat': d.format,
      'Content-Type': 'application/ssml+xml',
    },
    body: ssml,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => 'unknown error');
    throw new Error(`Provider error (${res.status}): ${detail}`);
  }
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield value instanceof Uint8Array ? value : new Uint8Array(value);
  }
}

// --- STT: { feed(chunk), finish() → Promise<{transcript, durationMs}> } ---

export function createSttSession(provider, config, fetchFn = fetch) {
  const chunks = [];
  const feed = (chunk) => chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));

  if (provider === 'whisper') return { feed, finish: () => sttWhisper(chunks, config, fetchFn) };
  if (provider === 'deepgram') return { feed, finish: () => sttDeepgram(chunks, config, fetchFn) };
  if (provider === 'google-cloud') return { feed, finish: () => sttGoogleCloud(chunks, config, fetchFn) };
  if (provider === 'azure') return { feed, finish: () => sttAzure(chunks, config, fetchFn) };
  if (provider === 'aws-transcribe') return { feed, finish: () => sttAwsTranscribe() };
  throw new Error(`Unknown STT provider: ${provider}`);
}

async function sttWhisper(chunks, config, fetchFn) {
  const audioBytes = concatUint8Arrays(chunks);
  const formData = new FormData();
  formData.append('file', new Blob([audioBytes], { type: 'audio/webm' }), 'audio.webm');
  formData.append('model', STT_DEFAULTS.whisper.model);
  formData.append('response_format', 'verbose_json');
  const res = await fetchFn('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: formData,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => 'unknown error');
    throw new Error(`Provider error (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return { transcript: data.text, durationMs: data.duration * 1000, language: data.language };
}

async function sttDeepgram(chunks, config, fetchFn) {
  const audioBytes = concatUint8Arrays(chunks);
  const lang = config.language || 'en';
  const res = await fetchFn(
    `https://api.deepgram.com/v1/listen?model=${STT_DEFAULTS.deepgram.model}&punctuate=true&language=${lang}`,
    {
      method: 'POST',
      headers: { Authorization: `Token ${config.apiKey}`, 'Content-Type': 'audio/webm' },
      body: new Blob([audioBytes], { type: 'audio/webm' }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => 'unknown error');
    throw new Error(`Provider error (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return {
    transcript: data.results.channels[0].alternatives[0].transcript,
    durationMs: data.metadata.duration * 1000,
  };
}

async function sttGoogleCloud(chunks, config, fetchFn) {
  const audioBytes = concatUint8Arrays(chunks);
  const base64Audio = uint8ToBase64(audioBytes);
  const url = config.accessToken
    ? 'https://speech.googleapis.com/v1/speech:recognize'
    : `https://speech.googleapis.com/v1/speech:recognize?key=${config.apiKey}`;
  const headers = { 'Content-Type': 'application/json' };
  if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
  const d = STT_DEFAULTS['google-cloud'];
  const res = await fetchFn(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      config: {
        encoding: d.encoding,
        sampleRateHertz: d.sampleRateHertz,
        languageCode: config.language || 'en-US',
      },
      audio: { content: base64Audio },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => 'unknown error');
    throw new Error(`Provider error (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return {
    transcript: data.results?.[0]?.alternatives?.[0]?.transcript || '',
    durationMs: 0,
  };
}

async function sttAzure(chunks, config, fetchFn) {
  const audioBytes = concatUint8Arrays(chunks);
  const region = config.region || STT_DEFAULTS.azure.region;
  const lang = config.language || 'en-US';
  const res = await fetchFn(
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${lang}`,
    {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': config.apiKey, 'Content-Type': 'audio/wav' },
      body: new Blob([audioBytes], { type: 'audio/wav' }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => 'unknown error');
    throw new Error(`Provider error (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return { transcript: data.DisplayText, durationMs: data.Duration / 10000 };
}

async function sttAwsTranscribe() {
  const err = new Error('aws-transcribe requires server proxy (SigV4 signing)');
  err.status = 501;
  throw err;
}

// --- Persistent Gemini Live session ---
// One WebSocket for the entire conversation. Handles both text→audio (speak)
// and audio→audio (S2S) in a single persistent connection.

export function openGeminiLiveSession(config) {
  const wsUrl = geminiWsUrl(config);
  const ws = new WebSocket(wsUrl);

  let setupDone = false;
  let destroyed = false;
  let speakResolve = null;
  let speakTimeout = null;
  let currentAudioChunks = [];
  let transcriptBuffer = '';

  // Callbacks
  let onReadyCb = null;
  let onTurnAudioCb = null;    // (wavData, transcript) — full turn audio + text
  let onTranscriptCb = null;   // (text) — streaming text chunks
  let onAudioChunkCb = null;   // (pcmUint8Array) — per-chunk streaming audio
  let onErrorCb = null;

  ws.addEventListener('open', () => {
    const setup = {
      setup: {
        model: 'models/gemini-2.5-flash-native-audio-latest',
        generationConfig: { responseModalities: ['AUDIO'] },
        outputAudioTranscription: {},
      },
    };
    if (config.systemPrompt) {
      setup.setup.systemInstruction = { parts: [{ text: config.systemPrompt }] };
    }
    console.log('[gemini-live] sending setup:', JSON.stringify(setup).slice(0, 200));
    ws.send(JSON.stringify(setup));
  });

  ws.addEventListener('message', async (event) => {
    if (destroyed) return;
    try {
      const raw = typeof event.data === 'string' ? event.data
        : (event.data instanceof Blob ? await event.data.text() : event.data.toString());
      const msg = JSON.parse(raw);

      if (msg.setupComplete) {
        setupDone = true;
        if (onReadyCb) onReadyCb();
        return;
      }

      const sc = msg.serverContent;
      if (!sc) return;

      // outputAudioTranscription → real speech transcript (streamed chunks)
      if (sc.outputTranscription?.text) {
        transcriptBuffer += sc.outputTranscription.text;
        if (onTranscriptCb) onTranscriptCb(sc.outputTranscription.text);
      }

      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.text && !part.thought) {
            // Non-thought text (fallback if outputAudioTranscription disabled)
            transcriptBuffer += part.text;
            if (onTranscriptCb) onTranscriptCb(part.text);
          }
          if (part.inlineData?.data) {
            const pcm = base64ToUint8(part.inlineData.data);
            currentAudioChunks.push(pcm);
            if (onAudioChunkCb) onAudioChunkCb(pcm);
          }
        }
      }

      if (sc.turnComplete) {
        const totalAudioBytes = currentAudioChunks.reduce((s, c) => s + c.length, 0);
        const wav = currentAudioChunks.length > 0
          ? pcmToWav(concatUint8Arrays(currentAudioChunks))
          : null;
        const transcript = transcriptBuffer;
        console.log(`[gemini-live] turnComplete: ${currentAudioChunks.length} audio chunks (${totalAudioBytes}B), transcript=${transcript.length > 0 ? transcript.slice(0, 40) + '...' : '(none)'}, speakResolve=${!!speakResolve}`);

        if (speakResolve) {
          // speak() is waiting for this turn
          if (speakTimeout) clearTimeout(speakTimeout);
          speakResolve({ audioChunks: wav ? [wav] : [], transcript });
          speakResolve = null;
          speakTimeout = null;
        } else if (onTurnAudioCb) {
          // Unsolicited response (user spoke → Gemini replied)
          console.log(`[gemini-live] firing onTurnAudio: wav=${wav ? wav.byteLength + 'B' : 'null'}`);
          onTurnAudioCb(wav, transcript);
        }

        currentAudioChunks = [];
        transcriptBuffer = '';
      }
    } catch (err) {
      console.error('[gemini-live] message parse error:', err);
    }
  });

  ws.addEventListener('error', (evt) => {
    console.error('[gemini-live] WS error:', evt);
    if (onErrorCb) onErrorCb(new Error('Gemini Live connection error'));
    if (speakResolve) {
      if (speakTimeout) clearTimeout(speakTimeout);
      speakResolve({ audioChunks: [], transcript: '' });
      speakResolve = null;
      speakTimeout = null;
    }
  });

  ws.addEventListener('close', (event) => {
    console.log(`[gemini-live] WS closed: code=${event?.code} reason="${event?.reason || ''}"`);
    // If WS closed before setup completed, fire error so speak() doesn't hang forever
    if (!setupDone && onErrorCb) {
      onErrorCb(new Error(`Gemini WS closed before setup (code=${event?.code})`));
    }
    if (speakResolve) {
      if (speakTimeout) clearTimeout(speakTimeout);
      const wav = currentAudioChunks.length > 0
        ? pcmToWav(concatUint8Arrays(currentAudioChunks))
        : null;
      speakResolve({ audioChunks: wav ? [wav] : [], transcript: transcriptBuffer });
      speakResolve = null;
      speakTimeout = null;
    }
  });

  return {
    get ready() { return setupDone; },

    onReady(cb) { onReadyCb = cb; if (setupDone) setTimeout(cb, 0); },
    onTurnAudio(cb) { onTurnAudioCb = cb; },
    onAudioChunk(cb) { onAudioChunkCb = cb; },
    onTranscript(cb) { onTranscriptCb = cb; },
    onError(cb) { onErrorCb = cb; },

    // Send text for Gemini to respond to. Returns {audioChunks, transcript}.
    sendText(text) {
      currentAudioChunks = [];
      transcriptBuffer = '';
      return new Promise((resolve) => {
        speakResolve = resolve;
        speakTimeout = setTimeout(() => {
          if (speakResolve) {
            const wav = currentAudioChunks.length > 0
              ? pcmToWav(concatUint8Arrays(currentAudioChunks))
              : null;
            speakResolve({ audioChunks: wav ? [wav] : [], transcript: transcriptBuffer });
            speakResolve = null;
            currentAudioChunks = [];
            transcriptBuffer = '';
          }
        }, 30000);

        ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          },
        }));
      });
    },

    // Stream mic audio to Gemini (PCM 16-bit LE, 16kHz mono)
    sendAudio(chunk) {
      if (destroyed) { console.warn('[gemini-live] sendAudio: session destroyed'); return; }
      if (ws.readyState !== 1) { console.warn(`[gemini-live] sendAudio: WS not open (readyState=${ws.readyState})`); return; }
      const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const base64 = uint8ToBase64(data);
      ws.send(JSON.stringify({
        realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: base64 } },
      }));
    },

    destroy() {
      destroyed = true;
      if (speakTimeout) clearTimeout(speakTimeout);
      try { ws.close(); } catch {}
    },
  };
}

// Legacy exports for backward compatibility with tests
export function speakViaS2s(provider, text, config, createWs) {
  if (provider === 'gemini-live') {
    return new Promise((resolve, reject) => {
      const wsUrl = geminiWsUrl(config);
      const ws = createWs(wsUrl);
      const audioChunks = [];
      let resolved = false;
      const timeoutId = setTimeout(() => {
        if (!resolved) { resolved = true; ws.close(); reject(new Error('timeout')); }
      }, 30000);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          setup: {
            model: 'models/gemini-2.5-flash-native-audio-latest',
            generationConfig: { responseModalities: ['AUDIO'] },
            systemInstruction: { parts: [{ text: config.systemPrompt || 'Read the following text aloud.' }] },
          },
        }));
      });

      ws.addEventListener('message', async (event) => {
        const raw = typeof event.data === 'string' ? event.data
          : (event.data instanceof Blob ? await event.data.text() : event.data.toString());
        const msg = JSON.parse(raw);
        if (msg.setupComplete) {
          ws.send(JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text }] }],
              turnComplete: true,
            },
          }));
          return;
        }
        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.modelTurn?.parts) {
          for (const part of sc.modelTurn.parts) {
            if (part.inlineData?.data) audioChunks.push(base64ToUint8(part.inlineData.data));
          }
        }
        if (sc.turnComplete) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            ws.close();
            resolve(pcmToWav(concatUint8Arrays(audioChunks)));
          }
        }
      });

      ws.addEventListener('error', (evt) => {
        if (!resolved) { resolved = true; clearTimeout(timeoutId); reject(new Error(evt?.message || 'S2S connection failed')); }
      });

      ws.addEventListener('close', () => {
        if (!resolved) { resolved = true; clearTimeout(timeoutId); resolve(pcmToWav(concatUint8Arrays(audioChunks))); }
      });
    });
  }
  throw new Error(`S2S speak not supported for: ${provider}`);
}

export function createS2sSession(provider, config, createWs) {
  if (provider === 'gemini-live') {
    const wsUrl = geminiWsUrl(config);
    const ws = createWs(wsUrl);
    const audioChunks = [];
    let audioCb = null, transcriptCb = null, resolveFinish = null, rejectFinish = null;
    let resolved = false, timeoutId = null;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-2.5-flash-native-audio-latest',
          generationConfig: { responseModalities: ['AUDIO'] },
        },
      }));
    });

    ws.addEventListener('message', async (event) => {
      const raw = typeof event.data === 'string' ? event.data
        : (event.data instanceof Blob ? await event.data.text() : event.data.toString());
      const msg = JSON.parse(raw);
      if (msg.setupComplete) return;
      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.text && transcriptCb) transcriptCb(part.text);
          if (part.inlineData?.data && audioCb) audioCb(part.inlineData.data);
        }
      }
      if (sc.turnComplete) {
        if (!resolved) { resolved = true; if (timeoutId) clearTimeout(timeoutId); ws.close(); if (resolveFinish) resolveFinish(); }
      }
    });

    ws.addEventListener('error', (evt) => {
      if (!resolved && rejectFinish) { resolved = true; if (timeoutId) clearTimeout(timeoutId); rejectFinish(new Error(evt?.message || 'connection failed')); }
    });

    ws.addEventListener('close', () => {
      if (!resolved) { resolved = true; if (timeoutId) clearTimeout(timeoutId); if (resolveFinish) resolveFinish(); }
    });

    const session = {
      feed(chunk) { audioChunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)); },
      finish() {
        return new Promise((resolve, reject) => {
          resolveFinish = resolve;
          rejectFinish = reject;
          timeoutId = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, session._timeout || 30000);
          const merged = concatUint8Arrays(audioChunks);
          ws.send(JSON.stringify({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: uint8ToBase64(merged) } } }));
        });
      },
      onAudio(cb) { audioCb = cb; },
      onTranscript(cb) { transcriptCb = cb; },
      destroy() { ws.close(); },
      _timeout: 30000,
    };
    return session;
  }
  if (provider === 'openai-realtime') throw new Error('openai-realtime requires server proxy (WS auth headers)');
  throw new Error(`Unknown S2S provider: ${provider}`);
}
