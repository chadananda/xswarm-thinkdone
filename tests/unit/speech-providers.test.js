// TTS, STT, S2S provider tests using dependency injection (fetchFn, createWs)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { streamTts, createSttSession, createS2sSession, TTS_DEFAULTS, STT_DEFAULTS } from '../../src/lib/speech-providers.js';
// mockFetch helper — returns async function matching fetch signature
function mockFetch(status, body, opts = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(opts.headers || {}),
    body: {
      getReader() {
        let done = false;
        return {
          read() {
            if (done) return Promise.resolve({ done: true });
            done = true;
            const data = typeof body === 'string' ? Buffer.from(body) : body;
            return Promise.resolve({ done: false, value: data });
          },
          cancel() {},
        };
      },
    },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => (typeof body === 'string' ? Buffer.from(body).buffer : body.buffer || body),
  });
}
// mockWs helper — returns mock WebSocket with programmable message sequences
function mockWs(messages = []) {
  const handlers = {};
  let idx = 0;
  const ws = {
    on(event, cb) { handlers[event] = cb; },
    send(data) {
      if (handlers.message && messages[idx]) {
        setImmediate(() => handlers.message(Buffer.from(JSON.stringify(messages[idx++]))));
      }
    },
    close() {
      if (handlers.close) setImmediate(() => handlers.close());
    },
  };
  if (handlers.open && messages.length > 0) setImmediate(() => handlers.open());
  return ws;
}
// TTS TESTS
describe('TTS - streamTts', () => {
  describe('elevenlabs', () => {
    test('happy path: yields audio chunks', async () => {
      const fetch = mockFetch(200, Buffer.from('audiodata'));
      const chunks = [];
      for await (const chunk of streamTts('elevenlabs', 'Hello', { apiKey: 'key123' }, fetch)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 1);
      assert.ok(Buffer.isBuffer(chunks[0]));
    });
    test('upstream error: throws', async () => {
      const fetch = mockFetch(401, 'unauthorized');
      await assert.rejects(
        async () => {
          for await (const chunk of streamTts('elevenlabs', 'Hi', { apiKey: 'bad' }, fetch)) {}
        },
        /Provider error/
      );
    });
    test('missing key: throws', async () => {
      await assert.rejects(
        async () => {
          for await (const chunk of streamTts('elevenlabs', 'Hi', {}, fetch)) {}
        },
        /apiKey required/
      );
    });
  });
  describe('google-cloud', () => {
    test('happy path: decodes base64 audioContent', async () => {
      const audioBase64 = Buffer.from('audiodata').toString('base64');
      const fetch = mockFetch(200, JSON.stringify({ audioContent: audioBase64 }));
      const chunks = [];
      for await (const chunk of streamTts('google-cloud', 'Hello', { apiKey: 'key123' }, fetch)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 1);
      assert.deepEqual(chunks[0], Buffer.from('audiodata'));
    });
    test('upstream error: throws', async () => {
      const fetch = mockFetch(403, 'forbidden');
      await assert.rejects(
        async () => {
          for await (const chunk of streamTts('google-cloud', 'Hi', { apiKey: 'bad' }, fetch)) {}
        },
        /Provider error/
      );
    });
    test('missing key: throws', async () => {
      await assert.rejects(
        async () => {
          for await (const chunk of streamTts('google-cloud', 'Hi', {}, fetch)) {}
        },
        /apiKey or accessToken required/
      );
    });
  });
  describe('playht', () => {
    test('happy path: yields audio chunks', async () => {
      const fetch = mockFetch(200, Buffer.from('audiodata'));
      const chunks = [];
      for await (const chunk of streamTts('playht', 'Hello', { apiKey: 'key123', userId: 'user1' }, fetch)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 1);
    });
    test('upstream error: throws', async () => {
      const fetch = mockFetch(500, 'internal error');
      await assert.rejects(
        async () => {
          for await (const chunk of streamTts('playht', 'Hi', { apiKey: 'key', userId: 'u' }, fetch)) {}
        },
        /Provider error/
      );
    });
    test('missing key: throws', async () => {
      await assert.rejects(
        async () => {
          for await (const chunk of streamTts('playht', 'Hi', { userId: 'u' }, fetch)) {}
        },
        /apiKey required/
      );
    });
  });
  describe('azure', () => {
    test('happy path: yields audio chunks', async () => {
      const fetch = mockFetch(200, Buffer.from('audiodata'));
      const chunks = [];
      for await (const chunk of streamTts('azure', 'Hello', { apiKey: 'key123' }, fetch)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 1);
    });
    test('upstream error: throws', async () => {
      const fetch = mockFetch(400, 'bad request');
      await assert.rejects(
        async () => {
          for await (const chunk of streamTts('azure', 'Hi', { apiKey: 'bad' }, fetch)) {}
        },
        /Provider error/
      );
    });
    test('missing key: throws', async () => {
      await assert.rejects(
        async () => {
          for await (const chunk of streamTts('azure', 'Hi', {}, fetch)) {}
        },
        /apiKey required/
      );
    });
  });
  describe('aws-polly', () => {
    test('happy path: yields audio chunks', async () => {
      const fetch = mockFetch(200, Buffer.from('audiodata'));
      const chunks = [];
      for await (const chunk of streamTts('aws-polly', 'Hello', { awsAccessKey: 'key', awsSecretKey: 'secret' }, fetch)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 1);
    });
    test('upstream error: throws', async () => {
      const fetch = mockFetch(403, 'forbidden');
      await assert.rejects(
        async () => {
          for await (const chunk of streamTts('aws-polly', 'Hi', { awsAccessKey: 'k', awsSecretKey: 's' }, fetch)) {}
        },
        /Provider error/
      );
    });
    test('missing keys: throws', async () => {
      await assert.rejects(
        async () => {
          for await (const chunk of streamTts('aws-polly', 'Hi', {}, fetch)) {}
        },
        /awsAccessKey and awsSecretKey required/
      );
    });
  });
  test('TTS_DEFAULTS match expected', () => {
    assert.equal(TTS_DEFAULTS.elevenlabs.voice, '21m00Tcm4TlvDq8ikWAM');
    assert.equal(TTS_DEFAULTS['google-cloud'].voice, 'en-US-Neural2-C');
    assert.equal(TTS_DEFAULTS.playht.quality, 'medium');
    assert.equal(TTS_DEFAULTS.azure.voice, 'en-US-JennyNeural');
    assert.equal(TTS_DEFAULTS['aws-polly'].voice, 'Joanna');
  });
});
// STT TESTS
describe('STT - createSttSession', () => {
  describe('whisper', () => {
    test('happy path: returns transcript + durationMs', async () => {
      const fetch = mockFetch(200, JSON.stringify({ text: 'Hello world', duration: 2.5, language: 'en' }));
      const session = createSttSession('whisper', { apiKey: 'key123' }, fetch);
      session.feed(Buffer.from('chunk1'));
      session.feed(Buffer.from('chunk2'));
      const result = await session.finish();
      assert.equal(result.transcript, 'Hello world');
      assert.equal(result.durationMs, 2500);
    });
    test('upstream error: rejects', async () => {
      const fetch = mockFetch(401, 'unauthorized');
      const session = createSttSession('whisper', { apiKey: 'bad' }, fetch);
      session.feed(Buffer.from('data'));
      await assert.rejects(session.finish(), /Provider error/);
    });
  });
  describe('deepgram', () => {
    test('happy path: returns transcript + durationMs', async () => {
      const fetch = mockFetch(200, JSON.stringify({
        results: { channels: [{ alternatives: [{ transcript: 'Hi there' }] }] },
        metadata: { duration: 1.8 },
      }));
      const session = createSttSession('deepgram', { apiKey: 'key123' }, fetch);
      session.feed(Buffer.from('audio'));
      const result = await session.finish();
      assert.equal(result.transcript, 'Hi there');
      assert.equal(result.durationMs, 1800);
    });
    test('upstream error: rejects', async () => {
      const fetch = mockFetch(500, 'server error');
      const session = createSttSession('deepgram', { apiKey: 'bad' }, fetch);
      session.feed(Buffer.from('data'));
      await assert.rejects(session.finish(), /Provider error/);
    });
  });
  describe('google-cloud', () => {
    test('happy path: returns transcript', async () => {
      const fetch = mockFetch(200, JSON.stringify({
        results: [{ alternatives: [{ transcript: 'Testing' }] }],
      }));
      const session = createSttSession('google-cloud', { apiKey: 'key123' }, fetch);
      session.feed(Buffer.from('audio'));
      const result = await session.finish();
      assert.equal(result.transcript, 'Testing');
    });
    test('upstream error: rejects', async () => {
      const fetch = mockFetch(400, 'bad request');
      const session = createSttSession('google-cloud', { apiKey: 'bad' }, fetch);
      session.feed(Buffer.from('data'));
      await assert.rejects(session.finish(), /Provider error/);
    });
  });
  describe('azure', () => {
    test('happy path: returns transcript + durationMs', async () => {
      const fetch = mockFetch(200, JSON.stringify({ DisplayText: 'Azure test', Duration: 15000000 }));
      const session = createSttSession('azure', { apiKey: 'key123' }, fetch);
      session.feed(Buffer.from('audio'));
      const result = await session.finish();
      assert.equal(result.transcript, 'Azure test');
      assert.equal(result.durationMs, 1500);
    });
    test('upstream error: rejects', async () => {
      const fetch = mockFetch(403, 'forbidden');
      const session = createSttSession('azure', { apiKey: 'bad' }, fetch);
      session.feed(Buffer.from('data'));
      await assert.rejects(session.finish(), /Provider error/);
    });
  });
  describe('aws-transcribe', () => {
    test('throws 501 error', async () => {
      const session = createSttSession('aws-transcribe', { apiKey: 'key' }, fetch);
      session.feed(Buffer.from('data'));
      await assert.rejects(session.finish(), /AWS Transcribe requires S3/);
    });
  });
});
// S2S TESTS
describe('S2S - createS2sSession', () => {
  describe('gemini-live', () => {
    test('happy path: receives audio and transcript', async (t) => {
      const messages = [
        { setupComplete: true },
        { serverContent: { modelTurn: { parts: [{ text: 'Hello' }] } } },
        { serverContent: { modelTurn: { parts: [{ inlineData: { data: 'YXVkaW8=' } }] } } },
        { serverContent: { turnComplete: true } },
      ];
      const createWs = () => {
        const handlers = {};
        const ws = {
          on(event, cb) { handlers[event] = cb; },
          send(data) {
            if (handlers.message) {
              if (data.includes('setup')) {
                setImmediate(() => handlers.message(Buffer.from(JSON.stringify(messages[0]))));
              } else if (data.includes('realtimeInput')) {
                setImmediate(() => handlers.message(Buffer.from(JSON.stringify(messages[1]))));
                setImmediate(() => handlers.message(Buffer.from(JSON.stringify(messages[2]))));
                setImmediate(() => handlers.message(Buffer.from(JSON.stringify(messages[3]))));
              }
            }
          },
          close() { if (handlers.close) setImmediate(() => handlers.close()); },
        };
        setImmediate(() => { if (handlers.open) handlers.open(); });
        return ws;
      };
      const session = createS2sSession('gemini-live', { apiKey: 'key123' }, createWs);
      const audioChunks = [];
      const transcripts = [];
      session.onAudio((chunk) => audioChunks.push(chunk));
      session.onTranscript((text) => transcripts.push(text));
      session.feed(Buffer.from('audio'));
      await session.finish();
      assert.equal(transcripts.join(''), 'Hello');
      assert.equal(audioChunks.length, 1);
    });
    test('timeout: rejects after 30s', async () => {
      const createWs = () => {
        const handlers = {};
        const ws = {
          on(event, cb) { handlers[event] = cb; },
          send() {},
          close() { if (handlers.close) setImmediate(() => handlers.close()); },
        };
        setImmediate(() => { if (handlers.open) handlers.open(); });
        return ws;
      };
      const session = createS2sSession('gemini-live', { apiKey: 'key' }, createWs);
      session.feed(Buffer.from('audio'));
      // Override timeout for test speed (10ms instead of 30s)
      session._timeout = 10;
      await assert.rejects(session.finish(), /timeout/);
    });
    test('connection error: rejects', async () => {
      const createWs = () => {
        const handlers = {};
        const ws = {
          on(event, cb) { handlers[event] = cb; },
          send() {},
          close() {},
        };
        setImmediate(() => { if (handlers.error) handlers.error(new Error('connection failed')); });
        return ws;
      };
      const session = createS2sSession('gemini-live', { apiKey: 'key' }, createWs);
      session.feed(Buffer.from('audio'));
      await assert.rejects(session.finish(), /connection failed/);
    });
  });
  describe('openai-realtime', () => {
    test('happy path: receives audio and transcript', async () => {
      const messages = [
        { type: 'response.audio.delta', delta: 'YXVkaW8=' },
        { type: 'response.audio_transcript.delta', delta: 'Hi' },
        { type: 'response.done' },
      ];
      const createWs = () => {
        const handlers = {};
        const ws = {
          on(event, cb) { handlers[event] = cb; },
          send(data) {
            if (handlers.message && data.includes('response.create')) {
              for (const msg of messages) {
                setImmediate(() => handlers.message(Buffer.from(JSON.stringify(msg))));
              }
            }
          },
          close() { if (handlers.close) setImmediate(() => handlers.close()); },
        };
        setImmediate(() => { if (handlers.open) handlers.open(); });
        return ws;
      };
      const session = createS2sSession('openai-realtime', { apiKey: 'key123' }, createWs);
      const audioChunks = [];
      const transcripts = [];
      session.onAudio((chunk) => audioChunks.push(chunk));
      session.onTranscript((text) => transcripts.push(text));
      session.feed(Buffer.from('audio'));
      await session.finish();
      assert.equal(transcripts.join(''), 'Hi');
      assert.equal(audioChunks.length, 1);
    });
    test('timeout: rejects after 30s', async () => {
      const createWs = () => {
        const handlers = {};
        const ws = {
          on(event, cb) { handlers[event] = cb; },
          send() {},
          close() { if (handlers.close) setImmediate(() => handlers.close()); },
        };
        setImmediate(() => { if (handlers.open) handlers.open(); });
        return ws;
      };
      const session = createS2sSession('openai-realtime', { apiKey: 'key' }, createWs);
      session.feed(Buffer.from('audio'));
      session._timeout = 10;
      await assert.rejects(session.finish(), /timeout/);
    });
    test('connection error: rejects', async () => {
      const createWs = () => {
        const handlers = {};
        const ws = {
          on(event, cb) { handlers[event] = cb; },
          send() {},
          close() {},
        };
        setImmediate(() => { if (handlers.error) handlers.error(new Error('connection failed')); });
        return ws;
      };
      const session = createS2sSession('openai-realtime', { apiKey: 'key' }, createWs);
      session.feed(Buffer.from('audio'));
      await assert.rejects(session.finish(), /connection failed/);
    });
  });
});
