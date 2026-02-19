import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SPEECH_PROFILES, SPEECH_PROFILE_MAP, DEFAULT_SPEECH_PROFILE } from '../../src/lib/speech.js';
//
describe('SPEECH_PROFILES', () => {
  it('has 11 profiles', () => {
    assert.equal(SPEECH_PROFILES.length, 11);
  });
  //
  it('every profile has required fields', () => {
    for (const p of SPEECH_PROFILES) {
      assert.ok(p.id, `missing id`);
      assert.ok(p.name, `${p.id} missing name`);
      assert.ok(p.icon, `${p.id} missing icon`);
      assert.ok(p.tts?.provider, `${p.id} missing tts.provider`);
      assert.ok(p.stt?.provider, `${p.id} missing stt.provider`);
      assert.equal(typeof p.costPerHour, 'number', `${p.id} costPerHour not number`);
      assert.ok(p.costPerHour >= 0, `${p.id} costPerHour negative`);
      assert.equal(typeof p.costTier, 'number', `${p.id} costTier not number`);
      assert.ok(p.costTier >= 0 && p.costTier <= 3, `${p.id} costTier out of range`);
      assert.equal(typeof p.available, 'boolean', `${p.id} available not boolean`);
    }
  });
  //
  it('all profiles are available', () => {
    for (const p of SPEECH_PROFILES) {
      assert.equal(p.available, true, `${p.id} should be available`);
    }
  });
  //
  it('sorted cheapest-first by costPerHour', () => {
    for (let i = 1; i < SPEECH_PROFILES.length; i++) {
      assert.ok(
        SPEECH_PROFILES[i - 1].costPerHour <= SPEECH_PROFILES[i].costPerHour,
        `${SPEECH_PROFILES[i - 1].id} ($${SPEECH_PROFILES[i - 1].costPerHour}/hr) should come before ${SPEECH_PROFILES[i].id} ($${SPEECH_PROFILES[i].costPerHour}/hr)`
      );
    }
  });
  //
  it('includes direct single-service profiles', () => {
    assert.ok(SPEECH_PROFILE_MAP['elevenlabs-direct'], 'missing elevenlabs-direct');
    assert.ok(SPEECH_PROFILE_MAP['whisper-direct'], 'missing whisper-direct');
  });
  //
  it('browser-native is free', () => {
    const p = SPEECH_PROFILE_MAP['browser-native'];
    assert.equal(p.costPerHour, 0);
    assert.equal(p.costTier, 0);
  });
  //
  it('includes speech-to-speech (S2S) profiles', () => {
    const s2s = SPEECH_PROFILES.filter(p => p.s2s);
    assert.ok(s2s.length >= 2, 'expected at least 2 S2S profiles');
    assert.ok(SPEECH_PROFILE_MAP['openai-realtime-mini'], 'missing openai-realtime-mini');
    assert.ok(SPEECH_PROFILE_MAP['gemini-live'], 'missing gemini-live');
  });
});
//
describe('SPEECH_PROFILE_MAP', () => {
  it('looks up profiles by id', () => {
    assert.equal(SPEECH_PROFILE_MAP['browser-native'].name, 'Browser Native');
    assert.equal(SPEECH_PROFILE_MAP['elevenlabs-whisper'].name, 'ElevenLabs + Whisper');
    assert.equal(SPEECH_PROFILE_MAP['deepgram'].name, 'Deepgram');
  });
  //
  it('has same count as array', () => {
    assert.equal(Object.keys(SPEECH_PROFILE_MAP).length, SPEECH_PROFILES.length);
  });
});
//
describe('DEFAULT_SPEECH_PROFILE', () => {
  it('is browser-native', () => {
    assert.equal(DEFAULT_SPEECH_PROFILE, 'browser-native');
  });
  //
  it('exists in profile map', () => {
    assert.ok(SPEECH_PROFILE_MAP[DEFAULT_SPEECH_PROFILE]);
  });
});
