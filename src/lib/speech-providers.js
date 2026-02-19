// Speech providers with dependency injection for testing
import { signAWS } from './aws-sign.js';
// TTS DEFAULTS
export const TTS_DEFAULTS = {
  elevenlabs: { voice: '21m00Tcm4TlvDq8ikWAM', model: 'eleven_multilingual_v2' },
  'google-cloud': { voice: 'en-US-Neural2-C', lang: 'en-US' },
  playht: { voice: 's3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414f/female-cs/manifest.json', quality: 'medium' },
  azure: { voice: 'en-US-JennyNeural', region: 'eastus', format: 'audio-16khz-32kbitrate-mono-mp3' },
  'aws-polly': { voice: 'Joanna', engine: 'neural', region: 'us-east-1', format: 'mp3' },
};
// STT DEFAULTS
export const STT_DEFAULTS = {
  whisper: { model: 'whisper-1' },
  deepgram: { model: 'nova-2' },
  'google-cloud': { encoding: 'WEBM_OPUS', sampleRateHertz: 48000 },
  azure: { region: 'eastus' },
};
// streamTts — async generator yielding Buffer chunks
export async function* streamTts(provider, text, config, fetchFn = fetch) {
  console.log(`[speech-providers] streamTts: provider=${provider} text="${text.slice(0,50)}..." hasApiKey=${!!config.apiKey}`);
  if (provider === 'elevenlabs') {
    yield* streamTtsElevenlabs(text, config, fetchFn);
  } else if (provider === 'google-cloud') {
    yield* streamTtsGoogleCloud(text, config, fetchFn);
  } else if (provider === 'playht') {
    yield* streamTtsPlayht(text, config, fetchFn);
  } else if (provider === 'azure') {
    yield* streamTtsAzure(text, config, fetchFn);
  } else if (provider === 'aws-polly') {
    yield* streamTtsAwsPolly(text, config, fetchFn);
  } else {
    throw new Error(`Unknown TTS provider: ${provider}`);
  }
}
// TTS provider implementations
async function* streamTtsElevenlabs(text, config, fetchFn) {
  if (!config.apiKey) throw new Error('apiKey required for ElevenLabs');
  const voice = config.voice || TTS_DEFAULTS.elevenlabs.voice;
  console.log(`[speech-providers] ElevenLabs TTS: voice=${voice} textLen=${text.length}`);
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
    yield value;
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
  const buf = Buffer.from(json.audioContent, 'base64');
  yield buf;
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
    yield value;
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
    yield value;
  }
}
async function* streamTtsAwsPolly(text, config, fetchFn) {
  if (!config.awsAccessKey || !config.awsSecretKey) throw new Error('awsAccessKey and awsSecretKey required for AWS Polly');
  const d = TTS_DEFAULTS['aws-polly'];
  const region = config.region || d.region;
  const voice = config.voice || d.voice;
  const url = `https://polly.${region}.amazonaws.com/v1/speech`;
  const payload = JSON.stringify({
    Text: text,
    VoiceId: voice,
    Engine: d.engine,
    OutputFormat: d.format,
  });
  const headers = signAWS({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    accessKey: config.awsAccessKey,
    secretKey: config.awsSecretKey,
    region,
    service: 'polly',
  });
  const res = await fetchFn(url, { method: 'POST', headers, body: payload });
  if (!res.ok) {
    const detail = await res.text().catch(() => 'unknown error');
    throw new Error(`Provider error (${res.status}): ${detail}`);
  }
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield value;
  }
}
// createSttSession — returns { feed(chunk), finish() → Promise<{transcript, durationMs}> }
export function createSttSession(provider, config, fetchFn = fetch) {
  console.log(`[speech-providers] createSttSession: provider=${provider} hasApiKey=${!!config.apiKey}`);
  const chunks = [];
  const feed = (chunk) => chunks.push(chunk);
  if (provider === 'whisper') {
    const finish = () => sttWhisper(chunks, config, fetchFn);
    return { feed, finish };
  } else if (provider === 'deepgram') {
    const finish = () => sttDeepgram(chunks, config, fetchFn);
    return { feed, finish };
  } else if (provider === 'google-cloud') {
    const finish = () => sttGoogleCloud(chunks, config, fetchFn);
    return { feed, finish };
  } else if (provider === 'azure') {
    const finish = () => sttAzure(chunks, config, fetchFn);
    return { feed, finish };
  } else if (provider === 'aws-transcribe') {
    const finish = () => sttAwsTranscribe();
    return { feed, finish };
  } else {
    throw new Error(`Unknown STT provider: ${provider}`);
  }
}
// STT provider implementations
async function sttWhisper(chunks, config, fetchFn) {
  const audioBytes = Buffer.concat(chunks);
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
  const audioBytes = Buffer.concat(chunks);
  const lang = config.language || 'en';
  const res = await fetchFn(
    `https://api.deepgram.com/v1/listen?model=${STT_DEFAULTS.deepgram.model}&punctuate=true&language=${lang}`,
    {
      method: 'POST',
      headers: { Authorization: `Token ${config.apiKey}`, 'Content-Type': 'audio/webm' },
      body: audioBytes,
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
  const audioBytes = Buffer.concat(chunks);
  const base64Audio = audioBytes.toString('base64');
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
  const audioBytes = Buffer.concat(chunks);
  const region = config.region || STT_DEFAULTS.azure.region;
  const lang = config.language || 'en-US';
  const res = await fetchFn(
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${lang}`,
    {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': config.apiKey, 'Content-Type': 'audio/wav' },
      body: audioBytes,
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
  const err = new Error('AWS Transcribe requires S3 integration. Use OpenAI Whisper for STT with AWS Polly TTS.');
  err.status = 501;
  throw err;
}
// createS2sSession — returns { feed(chunk), finish(), onAudio(cb), onTranscript(cb), destroy() }
export function createS2sSession(provider, config, createWs) {
  if (provider === 'gemini-live') {
    return s2sGeminiLive(config, createWs);
  } else if (provider === 'openai-realtime') {
    return s2sOpenaiRealtime(config, createWs);
  } else {
    throw new Error(`Unknown S2S provider: ${provider}`);
  }
}
// S2S provider implementations
function s2sGeminiLive(config, createWs) {
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${config.apiKey}`;
  const ws = createWs(wsUrl);
  const audioChunks = [];
  let audioCb = null;
  let transcriptCb = null;
  let resolveFinish = null;
  let rejectFinish = null;
  let resolved = false;
  let timeoutId = null;
  const done = () => {
    if (resolved) return;
    resolved = true;
    if (timeoutId) clearTimeout(timeoutId);
  };
  ws.on('open', () => {
    const setup = {
      setup: {
        model: 'models/gemini-2.5-flash-native-audio-latest',
        generationConfig: { responseModalities: ['AUDIO'] },
      },
    };
    if (config.systemPrompt) setup.setup.systemInstruction = { parts: [{ text: config.systemPrompt }] };
    ws.send(JSON.stringify(setup));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.setupComplete) {
      return;
    }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.modelTurn?.parts) {
      for (const part of sc.modelTurn.parts) {
        if (part.text && transcriptCb) transcriptCb(part.text);
        if (part.inlineData?.data && audioCb) audioCb(part.inlineData.data);
      }
    }
    if (sc.turnComplete) {
      ws.close();
      done();
      if (resolveFinish) resolveFinish();
    }
  });
  ws.on('error', (err) => {
    if (timeoutId) clearTimeout(timeoutId);
    if (!resolved && rejectFinish) rejectFinish(err);
  });
  ws.on('close', () => {
    done();
    if (resolveFinish) resolveFinish();
  });
  const feed = (chunk) => {
    audioChunks.push(chunk);
  };
  const finish = () => {
    return new Promise((resolve, reject) => {
      resolveFinish = resolve;
      rejectFinish = reject;
      timeoutId = setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
      }, session._timeout || 30000);
      const audioBytes = Buffer.concat(audioChunks);
      const base64Input = audioBytes.toString('base64');
      ws.send(JSON.stringify({
        realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: base64Input } },
      }));
    });
  };
  const session = {
    feed,
    finish,
    onAudio: (cb) => { audioCb = cb; },
    onTranscript: (cb) => { transcriptCb = cb; },
    destroy: () => ws.close(),
    _timeout: 30000,
  };
  return session;
}
function s2sOpenaiRealtime(config, createWs) {
  const wsUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview';
  const wsOpts = {
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  };
  const ws = createWs(wsUrl, wsOpts);
  const audioChunks = [];
  let audioCb = null;
  let transcriptCb = null;
  let resolveFinish = null;
  let rejectFinish = null;
  let resolved = false;
  let timeoutId = null;
  const done = () => {
    if (resolved) return;
    resolved = true;
    if (timeoutId) clearTimeout(timeoutId);
  };
  ws.on('open', () => {
    const sessionUpdate = {
      modalities: ['text', 'audio'],
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
    };
    if (config.systemPrompt) sessionUpdate.instructions = config.systemPrompt;
    ws.send(JSON.stringify({ type: 'session.update', session: sessionUpdate }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'response.audio.delta' && audioCb) audioCb(msg.delta);
    else if (msg.type === 'response.audio_transcript.delta' && transcriptCb) transcriptCb(msg.delta);
    else if (msg.type === 'response.done') {
      ws.close();
      done();
      if (resolveFinish) resolveFinish();
    }
  });
  ws.on('error', (err) => {
    if (timeoutId) clearTimeout(timeoutId);
    if (!resolved && rejectFinish) rejectFinish(err);
  });
  ws.on('close', () => {
    done();
    if (resolveFinish) resolveFinish();
  });
  const feed = (chunk) => {
    audioChunks.push(chunk);
  };
  const finish = () => {
    return new Promise((resolve, reject) => {
      resolveFinish = resolve;
      rejectFinish = reject;
      timeoutId = setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
      }, session._timeout || 30000);
      const audioBytes = Buffer.concat(audioChunks);
      const base64Input = audioBytes.toString('base64');
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Input }));
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      ws.send(JSON.stringify({ type: 'response.create' }));
    });
  };
  const session = {
    feed,
    finish,
    onAudio: (cb) => { audioCb = cb; },
    onTranscript: (cb) => { transcriptCb = cb; },
    destroy: () => ws.close(),
    _timeout: 30000,
  };
  return session;
}
