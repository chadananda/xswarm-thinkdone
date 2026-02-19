// End-to-end test: Gemini Live as conversational AI with system prompt
// Tests the new persistent session approach: Gemini gets context, generates its own greeting
import WebSocket from 'ws';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';

// Read .env
const envFile = readFileSync('.env', 'utf8');
const envVars = {};
for (const line of envFile.split('\n')) {
  const idx = line.indexOf('=');
  if (idx < 0) continue;
  const key = line.slice(0, idx).trim();
  let val = line.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
    val = val.slice(1, -1);
  envVars[key] = val;
}
const API_KEY = envVars.GEMINI_API_KEY;
if (!API_KEY) { console.error('No GEMINI_API_KEY in .env'); process.exit(1); }

const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

function pcmToWav(pcmData, sampleRate = 24000) {
  const headerLen = 44;
  const wav = new Uint8Array(headerLen + pcmData.length);
  const view = new DataView(wav.buffer);
  const w = (off, str) => { for (let i = 0; i < str.length; i++) wav[off + i] = str.charCodeAt(i); };
  w(0, 'RIFF'); view.setUint32(4, headerLen + pcmData.length - 8, true); w(8, 'WAVE');
  w(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, pcmData.length, true);
  wav.set(pcmData, headerLen);
  return wav;
}

// System prompt matching what SettingsPanel.svelte sends
const systemPrompt = `You are a voice interface test assistant for ThinkDone. The user is testing speech profiles in Settings.

CURRENTLY ACTIVE PROFILE: Gemini Live
- TTS (text-to-speech): Gemini Live — Speech-to-speech, native multimodal
- STT (speech-to-text): Gemini Live — Speech-to-speech, native multimodal
- Cost: ~$0.20/hr
- Mode: Speech-to-speech (single model handles both directions)

Your job: Help the user evaluate their current voice profile. Comment on what they're hearing (the TTS quality), discuss tradeoffs between profiles if asked, and suggest alternatives. Keep replies to 2-3 sentences — this is a voice conversation so be concise. Be warm and natural.`;

console.log('Connecting to Gemini Live...');
const ws = new WebSocket(WS_URL);
const audioChunks = [];
let transcript = '';

const timeout = setTimeout(() => { console.error('TIMEOUT'); ws.close(); process.exit(1); }, 30000);

ws.on('open', () => {
  console.log('WS open → setup with system prompt');
  ws.send(JSON.stringify({
    setup: {
      model: 'models/gemini-2.5-flash-native-audio-latest',
      generationConfig: { responseModalities: ['AUDIO'] },
      systemInstruction: { parts: [{ text: systemPrompt }] },
    },
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.setupComplete) {
    console.log('Setup complete → sending trigger');
    ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: 'Begin the voice test. Greet me and tell me what voice profile is active.' }] }],
        turnComplete: true,
      },
    }));
    return;
  }

  const sc = msg.serverContent;
  if (!sc) return;

  if (sc.modelTurn?.parts) {
    for (const part of sc.modelTurn.parts) {
      if (part.inlineData?.data) {
        const pcm = Buffer.from(part.inlineData.data, 'base64');
        audioChunks.push(pcm);
      }
      if (part.text) {
        transcript += part.text;
        process.stdout.write(part.text);
      }
    }
  }

  if (sc.turnComplete) {
    clearTimeout(timeout);
    const totalLen = audioChunks.reduce((s, c) => s + c.length, 0);
    const pcm = new Uint8Array(totalLen);
    let off = 0;
    for (const c of audioChunks) { pcm.set(new Uint8Array(c), off); off += c.length; }
    const wav = pcmToWav(pcm);
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/gemini-output.wav', wav);
    console.log(`\n\nDone! ${audioChunks.length} chunks, ${wav.length} bytes WAV`);
    console.log(`Transcript: "${transcript}"`);
    console.log('Saved: test-results/gemini-output.wav');
    ws.close();
  }
});

ws.on('error', (err) => { console.error('WS error:', err.message); clearTimeout(timeout); process.exit(1); });
ws.on('close', (code, reason) => { console.log(`Closed: ${code} ${reason?.toString() || ''}`); clearTimeout(timeout); });
