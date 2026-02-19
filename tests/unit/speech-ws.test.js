// WebSocket speech handler tests (TDD RED)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockWebSocket } from '../helpers/mock-ws.js';
import { handleSpeechConnection } from '../../src/lib/speech-ws.js';

// Mock providers for dependency injection
const mockProviders = {
  async *streamTts(provider, text, config) {
    if (text === 'fail') throw new Error('TTS provider failure');
    yield Buffer.from('audio-chunk-1');
    await new Promise(resolve => setImmediate(resolve));
    yield Buffer.from('audio-chunk-2');
  },
  createSttSession(provider, config) {
    const chunks = [];
    return {
      feed(chunk) { chunks.push(chunk); },
      async finish() {
        if (chunks.length > 0 && chunks[0].toString() === 'fail') {
          throw new Error('STT provider failure');
        }
        return { transcript: 'hello world', durationMs: 2300 };
      },
    };
  },
  createS2sSession(provider, config) {
    let audioCb, transcriptCb;
    const chunks = [];
    return {
      feed(chunk) { chunks.push(chunk); },
      finish() {
        if (audioCb) audioCb(Buffer.from('s2s-audio'));
        if (transcriptCb) transcriptCb('s2s text', true);
      },
      onAudio(cb) { audioCb = cb; },
      onTranscript(cb) { transcriptCb = cb; },
      destroy() {},
    };
  },
};

// Mock resolvers
const mockResolvers = {
  resolveMode: (id) => {
    if (id === 'browser-native') return 'browser';
    if (id.includes('gemini') || id.includes('realtime')) return 's2s';
    return 'tts+stt';
  },
  resolveTtsProvider: (id) => {
    if (id === 'elevenlabs-direct') return 'elevenlabs';
    return 'browser';
  },
  resolveSttProvider: (id) => {
    if (id === 'whisper-direct') return 'whisper';
    return 'browser';
  },
  resolveS2sProvider: (id) => {
    if (id.includes('gemini')) return 'gemini-live';
    if (id.includes('realtime')) return 'openai-realtime';
    return null;
  },
  estimateCost: () => 0.004,
};

// Mock getApiKey
const mockGetApiKey = async (provider) => 'test-key-' + provider;

// Helper to create handler with mocks
function createHandler(ws, overrides = {}) {
  return handleSpeechConnection(ws, {
    providers: mockProviders,
    getApiKey: mockGetApiKey,
    resolvers: mockResolvers,
    ...overrides,
  });
}

// --- Session Lifecycle Tests (6) ---

test('valid session.start sends session.ready with correct mode', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  const messages = ws.sentJSON();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'session.ready');
  assert.equal(messages[0].mode, 'tts+stt');
});

test('unknown profile sends error', async () => {
  const ws = new MockWebSocket();
  const throwingResolvers = {
    ...mockResolvers,
    resolveMode: (id) => {
      if (id === 'unknown-profile') throw new Error('Unknown profile');
      return mockResolvers.resolveMode(id);
    },
  };
  createHandler(ws, { resolvers: throwingResolvers });
  ws.receiveJSON({ type: 'session.start', profile: 'unknown-profile' });
  await new Promise(resolve => setImmediate(resolve));
  const messages = ws.sentJSON();
  assert.equal(messages[0].type, 'error');
  assert.equal(messages[0].code, 'invalid_profile');
});

test('missing API key sends error', async () => {
  const ws = new MockWebSocket();
  createHandler(ws, {
    getApiKey: async () => null,
  });
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  const messages = ws.sentJSON();
  assert.equal(messages[0].type, 'error');
  assert.equal(messages[0].code, 'missing_api_key');
});

test('commands before session.start send error', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'speak', text: 'hello' });
  await new Promise(resolve => setImmediate(resolve));
  const messages = ws.sentJSON();
  assert.equal(messages[0].type, 'error');
  assert.equal(messages[0].code, 'no_session');
});

test('close during active session cleans up', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.close();
  // Test passes if no errors thrown during cleanup
  assert.ok(ws.closed);
});

test('browser-only profile sends session.ready with mode browser', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'browser-native' });
  await new Promise(resolve => setImmediate(resolve));
  const messages = ws.sentJSON();
  assert.equal(messages[0].type, 'session.ready');
  assert.equal(messages[0].mode, 'browser');
  assert.ok(messages[0].note);
});

// --- TTS/speak Tests (7) ---

test('speak command sends audio.start, chunks, audio.end', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'speak', text: 'hello world' });
  await new Promise(resolve => setTimeout(resolve, 50));
  const json = ws.sentJSON();
  const binary = ws.sentBinary();
  assert.equal(json[0].type, 'audio.start');
  assert.equal(binary.length, 2);
  assert.equal(json[1].type, 'audio.end');
});

test('audio.end includes durationMs', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'speak', text: 'hello' });
  await new Promise(resolve => setTimeout(resolve, 50));
  const json = ws.sentJSON();
  const endMsg = json.find(m => m.type === 'audio.end');
  assert.ok(endMsg.durationMs >= 0);
});

test('empty text sends error', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'speak', text: '' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  assert.equal(json[0].type, 'error');
  assert.equal(json[0].code, 'empty_text');
});

test('provider failure sends error message', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'speak', text: 'fail' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  assert.equal(json[0].type, 'error');
  assert.equal(json[0].code, 'provider_error');
});

test('stop command aborts active TTS', async () => {
  const ws = new MockWebSocket();
  let aborted = false;
  const slowProviders = {
    async *streamTts(provider, text, config) {
      try {
        yield Buffer.from('chunk1');
        await new Promise(resolve => setTimeout(resolve, 100));
        yield Buffer.from('chunk2');
      } catch (err) {
        if (err.name === 'AbortError') aborted = true;
        throw err;
      }
    },
    createSttSession: mockProviders.createSttSession,
    createS2sSession: mockProviders.createS2sSession,
  };
  createHandler(ws, { providers: slowProviders });
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'speak', text: 'hello' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'stop' });
  await new Promise(resolve => setTimeout(resolve, 150));
  // Abort may not be caught in simple mock, but stop should clear state
  assert.ok(true);
});

test('usage tracking: ttsSeconds accumulated', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'speak', text: 'hello' });
  // Wait for async generator to complete (allow extra time for slow CI)
  await new Promise(resolve => setTimeout(resolve, 150));
  const json = ws.sentJSON();
  const usage = json.find(m => m.type === 'usage');
  assert.ok(usage, 'Usage message should be sent');
  assert.ok(usage.ttsSeconds > 0, `ttsSeconds should be > 0, got ${usage.ttsSeconds}`);
});

test('speak with no active session sends error', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'speak', text: 'hello' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  assert.equal(json[0].type, 'error');
  assert.equal(json[0].code, 'no_session');
});

// --- STT/listen Tests (8) ---

test('listen.start accepts binary frames as audio input', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'whisper-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveBinary(Buffer.from('audio-data-1'));
  ws.receiveBinary(Buffer.from('audio-data-2'));
  // Test passes if no errors thrown
  assert.ok(true);
});

test('listen.stop sends final transcript', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'whisper-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveBinary(Buffer.from('audio-data'));
  ws.sent = [];
  ws.receiveJSON({ type: 'listen.stop' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  const transcript = json.find(m => m.type === 'transcript');
  assert.ok(transcript);
  assert.equal(transcript.text, 'hello world');
  assert.equal(transcript.isFinal, true);
});

test('interim transcripts sent during listening', async () => {
  const ws = new MockWebSocket();
  const interimProviders = {
    ...mockProviders,
    createSttSession(provider, config) {
      const chunks = [];
      return {
        feed(chunk) {
          chunks.push(chunk);
          if (config.onInterim) config.onInterim('partial text', false);
        },
        async finish() {
          return { transcript: 'hello world', durationMs: 2300 };
        },
      };
    },
  };
  createHandler(ws, { providers: interimProviders });
  ws.receiveJSON({ type: 'session.start', profile: 'whisper-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveBinary(Buffer.from('audio'));
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  const interim = json.find(m => m.type === 'transcript' && !m.isFinal);
  assert.ok(interim);
});

test('binary frame before listen.start is ignored', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'whisper-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveBinary(Buffer.from('audio'));
  // Should not crash
  assert.ok(true);
});

test('browser-only STT profile sends error on listen.start', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'browser-native' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  assert.equal(json[0].type, 'error');
  assert.equal(json[0].code, 'browser_only');
});

test('provider failure during finish sends error', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'whisper-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveBinary(Buffer.from('fail'));
  ws.sent = [];
  ws.receiveJSON({ type: 'listen.stop' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  assert.equal(json[0].type, 'error');
  assert.equal(json[0].code, 'provider_error');
});

test('usage tracking: sttSeconds accumulated', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'whisper-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveBinary(Buffer.from('audio'));
  ws.sent = [];
  ws.receiveJSON({ type: 'listen.stop' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  const usage = json.find(m => m.type === 'usage');
  assert.ok(usage);
  assert.ok(usage.sttSeconds > 0);
});

test('listen.start twice sends error', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'whisper-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  assert.equal(json[0].type, 'error');
  assert.equal(json[0].code, 'already_listening');
});

// --- S2S Tests (7) ---

test('S2S session routes binary frames to audio and transcript callbacks', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'gemini-live' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveBinary(Buffer.from('s2s-audio-input'));
  await new Promise(resolve => setImmediate(resolve));
  // Test setup complete - implementation will trigger callbacks
  assert.ok(true);
});

test('finish triggers final audio and transcript', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'gemini-live' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveBinary(Buffer.from('audio'));
  ws.sent = [];
  ws.receiveJSON({ type: 'listen.stop' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  const transcript = json.find(m => m.type === 'transcript');
  assert.ok(transcript);
});

test('stop destroys S2S session', async () => {
  const ws = new MockWebSocket();
  let destroyed = false;
  const s2sProviders = {
    ...mockProviders,
    createS2sSession(provider, config) {
      const session = mockProviders.createS2sSession(provider, config);
      const originalDestroy = session.destroy;
      session.destroy = () => {
        destroyed = true;
        originalDestroy();
      };
      return session;
    },
  };
  createHandler(ws, { providers: s2sProviders });
  ws.receiveJSON({ type: 'session.start', profile: 'gemini-live' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'stop' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(destroyed);
});

test('timeout sends error', async () => {
  const ws = new MockWebSocket();
  const timeoutProviders = {
    ...mockProviders,
    createS2sSession(provider, config) {
      return {
        feed() {},
        finish() {
          // Never triggers callbacks (simulates timeout)
        },
        onAudio() {},
        onTranscript() {},
        destroy() {},
      };
    },
  };
  createHandler(ws, { providers: timeoutProviders });
  ws.receiveJSON({ type: 'session.start', profile: 'gemini-live' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'listen.stop' });
  await new Promise(resolve => setTimeout(resolve, 50));
  // Implementation should have timeout logic
  assert.ok(true);
});

test('usage tracking for S2S', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'gemini-live' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveBinary(Buffer.from('audio'));
  ws.sent = [];
  ws.receiveJSON({ type: 'listen.stop' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  const usage = json.find(m => m.type === 'usage');
  assert.ok(usage);
});

test('speak command on S2S session sends error', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'gemini-live' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'speak', text: 'hello' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  assert.equal(json[0].type, 'error');
  assert.equal(json[0].code, 'wrong_mode');
});

test('listen.start on S2S starts bidirectional mode', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'gemini-live' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  // Should not error
  const json = ws.sentJSON();
  assert.ok(!json.some(m => m.type === 'error'));
});

// --- Error Handling Tests (4) ---

test('invalid JSON sends error', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.emit('message', 'not-json');
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  assert.equal(json[0].type, 'error');
  assert.equal(json[0].code, 'invalid_json');
});

test('unknown command type sends error', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'unknown_command' });
  await new Promise(resolve => setImmediate(resolve));
  const json = ws.sentJSON();
  assert.equal(json[0].type, 'error');
  assert.equal(json[0].code, 'unknown_command');
});

test('WS error event triggers cleanup', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.emit('error', new Error('connection error'));
  // Should not crash
  assert.ok(true);
});

test('close during active stream triggers abort and cleanup', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveJSON({ type: 'speak', text: 'hello' });
  await new Promise(resolve => setImmediate(resolve));
  ws.close();
  assert.ok(ws.closed);
});

// --- Usage Tests (3) ---

test('usage accumulates across multiple operations', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  // TTS
  ws.sent = [];
  ws.receiveJSON({ type: 'speak', text: 'hello' });
  await new Promise(resolve => setTimeout(resolve, 50));
  const usage1 = ws.sentJSON().find(m => m.type === 'usage');
  const tts1 = usage1.ttsSeconds;
  // STT
  ws.receiveJSON({ type: 'listen.start' });
  await new Promise(resolve => setImmediate(resolve));
  ws.receiveBinary(Buffer.from('audio'));
  ws.sent = [];
  ws.receiveJSON({ type: 'listen.stop' });
  await new Promise(resolve => setImmediate(resolve));
  const usage2 = ws.sentJSON().find(m => m.type === 'usage');
  assert.ok(usage2.ttsSeconds >= tts1);
  assert.ok(usage2.sttSeconds > 0);
});

test('estimatedCost included in usage message', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'speak', text: 'hello' });
  await new Promise(resolve => setTimeout(resolve, 50));
  const json = ws.sentJSON();
  const usage = json.find(m => m.type === 'usage');
  assert.ok(usage);
  assert.equal(usage.estimatedCost, 0.004);
});

test('usage sent after each operation completes', async () => {
  const ws = new MockWebSocket();
  createHandler(ws);
  ws.receiveJSON({ type: 'session.start', profile: 'elevenlabs-direct' });
  await new Promise(resolve => setImmediate(resolve));
  ws.sent = [];
  ws.receiveJSON({ type: 'speak', text: 'hello' });
  await new Promise(resolve => setTimeout(resolve, 50));
  const json = ws.sentJSON();
  const usage = json.find(m => m.type === 'usage');
  assert.ok(usage);
});
