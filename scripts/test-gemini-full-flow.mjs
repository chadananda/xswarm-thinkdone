// Full bidirectional test matching the browser S2S flow:
// 1. Setup with system prompt
// 2. Text turn (greeting trigger) → get audio response
// 3. Stream that audio back via realtimeInput.audio → get audio response
// This mirrors SettingsPanel.svelte's S2S flow

import WebSocket from 'ws';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';

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

function resample24to16(pcm24) {
  const numSamples24 = pcm24.length / 2;
  const numSamples16 = Math.floor(numSamples24 * 16000 / 24000);
  const output = new Uint8Array(numSamples16 * 2);
  const viewIn = new DataView(pcm24.buffer, pcm24.byteOffset, pcm24.byteLength);
  const viewOut = new DataView(output.buffer);
  for (let i = 0; i < numSamples16; i++) {
    const srcIdx = Math.min(Math.floor(i * 1.5), numSamples24 - 1);
    viewOut.setInt16(i * 2, viewIn.getInt16(srcIdx * 2, true), true);
  }
  return output;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

mkdirSync('test-results', { recursive: true });

const systemPrompt = `You are a voice test assistant for ThinkDone. The user is testing the Gemini Live speech profile.
Keep replies to 2-3 sentences. Be warm and natural.`;

async function runFullFlow() {
  console.log('=== Full Bidirectional Flow Test ===');
  console.log('(Mirrors SettingsPanel.svelte S2S flow)\n');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let phase = 'setup';
    let audioChunks = [];
    let transcript = '';
    let turnCount = 0;
    const results = {};

    const timeout = setTimeout(() => {
      console.error(`\nTIMEOUT (90s) in phase: ${phase}`);
      ws.close();
      reject(new Error(`timeout in ${phase}`));
    }, 90000);

    function resetTurn() { audioChunks = []; transcript = ''; }

    ws.on('open', () => {
      console.log('Step 1: Setup with system prompt');
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-2.5-flash-native-audio-latest',
          generationConfig: { responseModalities: ['AUDIO'] },
          systemInstruction: { parts: [{ text: systemPrompt }] },
        },
      }));
    });

    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.setupComplete) {
        console.log('Step 2: Send text greeting trigger (like SettingsPanel.speak())');
        phase = 'greeting';
        resetTurn();
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
          if (part.inlineData?.data) audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
          if (part.text) transcript += part.text;
        }
      }

      if (sc.turnComplete) {
        turnCount++;
        const totalBytes = audioChunks.reduce((s, c) => s + c.length, 0);
        const durSec = (totalBytes / 2 / 24000).toFixed(1);

        if (phase === 'greeting') {
          console.log(`\n  Greeting response: ${audioChunks.length} chunks, ${totalBytes} bytes (${durSec}s)`);
          console.log(`  Thinking text: "${transcript.slice(0, 100)}"`);
          results.greeting = { chunks: audioChunks.length, bytes: totalBytes };

          if (totalBytes > 0) {
            const wav = pcmToWav(Buffer.concat(audioChunks));
            writeFileSync('test-results/flow-greeting.wav', wav);
            console.log('  Saved: test-results/flow-greeting.wav');
          }

          // Step 3: Feed greeting audio back (simulating user speaking)
          console.log('\nStep 3: Send greeting audio back via realtimeInput.audio');
          console.log('  (Simulates user speaking — Gemini hears its own greeting)');
          phase = 'user-audio';
          const greetingPcm = Buffer.concat(audioChunks);
          resetTurn();

          // Only send first 5 seconds to keep it quick
          const pcm16Full = resample24to16(new Uint8Array(greetingPcm));
          const maxBytes = 16000 * 2 * 5;
          const pcm16 = pcm16Full.slice(0, Math.min(pcm16Full.length, maxBytes));
          console.log(`  Resampled: ${greetingPcm.length} → ${pcm16.length} bytes (${(pcm16.length/2/16000).toFixed(1)}s)`);

          const chunkSize = 4096;
          let sent = 0;
          while (sent < pcm16.length) {
            if (ws.readyState !== 1) break;
            const chunk = pcm16.slice(sent, Math.min(sent + chunkSize, pcm16.length));
            ws.send(JSON.stringify({
              realtimeInput: { audio: { data: Buffer.from(chunk).toString('base64'), mimeType: 'audio/pcm;rate=16000' } },
            }));
            sent += chunk.length;
            await sleep(100);
          }
          console.log(`  Sent ${sent} bytes. Streaming 5s silence for VAD...`);

          const silenceBuf = new Uint8Array(chunkSize);
          for (let i = 0; i < 40; i++) {
            if (ws.readyState !== 1) break;
            ws.send(JSON.stringify({
              realtimeInput: { audio: { data: Buffer.from(silenceBuf).toString('base64'), mimeType: 'audio/pcm;rate=16000' } },
            }));
            await sleep(128);
          }
          console.log('  Silence sent. Waiting for Gemini response...');
          return;
        }

        if (phase === 'user-audio') {
          console.log(`\n  Audio response: ${audioChunks.length} chunks, ${totalBytes} bytes (${durSec}s)`);
          console.log(`  Thinking text: "${transcript.slice(0, 100)}"`);
          results.audioResponse = { chunks: audioChunks.length, bytes: totalBytes };

          if (totalBytes > 0) {
            const wav = pcmToWav(Buffer.concat(audioChunks));
            writeFileSync('test-results/flow-response.wav', wav);
            console.log('  Saved: test-results/flow-response.wav');
          }

          console.log('\n=== RESULTS ===');
          const g = results.greeting;
          const r = results.audioResponse;
          console.log(`Greeting (text→audio):      ${g.bytes > 0 ? 'PASS' : 'FAIL'} — ${g.chunks} chunks, ${g.bytes} bytes`);
          console.log(`Audio response (audio→audio): ${r.bytes > 0 ? 'PASS' : 'FAIL'} — ${r.chunks} chunks, ${r.bytes} bytes`);
          console.log(`WS stayed open: ${ws.readyState === 1 ? 'YES' : 'NO'}`);
          console.log(`Total turns: ${turnCount}`);

          clearTimeout(timeout);
          ws.close();
          resolve(results);
        }
      }
    });

    ws.on('error', (err) => { console.error('WS error:', err.message); clearTimeout(timeout); reject(err); });
    ws.on('close', (code, reason) => {
      console.log(`\nWS closed: ${code} "${reason?.toString() || ''}"`);
      clearTimeout(timeout);
    });
  });
}

runFullFlow().then((r) => {
  const ok = r?.greeting?.bytes > 0 && r?.audioResponse?.bytes > 0;
  console.log(`\n${ok ? 'SUCCESS: Full bidirectional flow works!' : 'PARTIAL: Some phases failed'}`);
  process.exit(ok ? 0 : 1);
}).catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
