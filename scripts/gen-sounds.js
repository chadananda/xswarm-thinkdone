#!/usr/bin/env node
// Generate tiny WAV sound effects for the dashboard
// Run: node scripts/gen-sounds.js
import { writeFileSync } from 'fs';
import { join } from 'path';

const RATE = 22050;
const OUT = join(import.meta.dirname, '..', 'public', 'audio');

function makeWav(samples) {
  const numSamples = samples.length;
  const byteRate = RATE * 2;
  const blockAlign = 2;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 30);
  buffer.writeUInt16LE(16, 32); // bits per sample
  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

// Applause — short burst of crackly noise with resonant peaks
function genApplause() {
  const dur = 0.6;
  const len = Math.floor(RATE * dur);
  const samples = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = Math.exp(-t * 4) * 0.3;
    // Multiple noise sources at different rates for crackle texture
    const noise = Math.random() * 2 - 1;
    // Add some pitched sparkle
    const sparkle = Math.sin(2 * Math.PI * 2200 * t) * 0.15 * Math.exp(-t * 8);
    const sparkle2 = Math.sin(2 * Math.PI * 3300 * t) * 0.1 * Math.exp(-t * 10);
    // Rising chime progression
    const chime1 = Math.sin(2 * Math.PI * 523 * t) * 0.2 * Math.exp(-t * 6);
    const chime2 = Math.sin(2 * Math.PI * 659 * t) * 0.15 * Math.exp(-(t - 0.05) * 6) * (t > 0.05 ? 1 : 0);
    const chime3 = Math.sin(2 * Math.PI * 784 * t) * 0.12 * Math.exp(-(t - 0.1) * 6) * (t > 0.1 ? 1 : 0);
    const chime4 = Math.sin(2 * Math.PI * 1047 * t) * 0.1 * Math.exp(-(t - 0.15) * 6) * (t > 0.15 ? 1 : 0);
    samples[i] = noise * env + sparkle + sparkle2 + chime1 + chime2 + chime3 + chime4;
  }
  return samples;
}

// Click — very short, crisp tick
function genClick() {
  const dur = 0.08;
  const len = Math.floor(RATE * dur);
  const samples = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = Math.exp(-t * 80);
    samples[i] = (Math.sin(2 * Math.PI * 800 * t) * 0.3 + (Math.random() * 2 - 1) * 0.1) * env;
  }
  return samples;
}

// Drop — soft thud with a bit of bounce
function genDrop() {
  const dur = 0.2;
  const len = Math.floor(RATE * dur);
  const samples = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = Math.exp(-t * 20);
    // Low thud
    const thud = Math.sin(2 * Math.PI * 150 * t * Math.exp(-t * 8)) * 0.4;
    // Subtle tap
    const tap = (Math.random() * 2 - 1) * 0.15 * Math.exp(-t * 50);
    samples[i] = (thud + tap) * env;
  }
  return samples;
}

// Poof — breathy whoosh with descending pitch
function genPoof() {
  const dur = 0.35;
  const len = Math.floor(RATE * dur);
  const samples = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = Math.exp(-t * 8) * (t < 0.02 ? t / 0.02 : 1);
    const noise = Math.random() * 2 - 1;
    // Descending filtered effect simulated with amplitude modulation
    const mod = Math.sin(2 * Math.PI * (2000 * Math.exp(-t * 6)) * t);
    const sub = Math.sin(2 * Math.PI * (120 * Math.exp(-t * 4)) * t) * 0.2;
    samples[i] = (noise * 0.3 * mod + sub) * env;
  }
  return samples;
}

writeFileSync(join(OUT, 'applause.wav'), makeWav(genApplause()));
writeFileSync(join(OUT, 'click.wav'), makeWav(genClick()));
writeFileSync(join(OUT, 'drop.wav'), makeWav(genDrop()));
writeFileSync(join(OUT, 'poof.wav'), makeWav(genPoof()));

console.log('Generated: applause.wav, click.wav, drop.wav, poof.wav');
