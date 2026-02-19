// Browser-direct speech provider tests — Uint8Array / atob / btoa / addEventListener API
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_DIRECT_TTS, BROWSER_DIRECT_STT, BROWSER_DIRECT_S2S,
  streamTts, createSttSession, createS2sSession, speakViaS2s, pcmToWav,
  TTS_DEFAULTS, STT_DEFAULTS,
} from '../../src/lib/speech-providers-browser.js';

// --- Helpers ---

// mockFetch — returns Uint8Array body chunks (not Buffer)
function mockFetch(status, body, opts = {}) {
  return async (url, init) => ({
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
            const data = typeof body === 'string'
              ? new Uint8Array(Buffer.from(body))
              : (body instanceof Uint8Array ? body : new Uint8Array(body));
            return Promise.resolve({ done: false, value: data });
          },
          cancel() {},
        };
      },
    },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

// mockBrowserWs — uses addEventListener API (browser WebSocket style)
function mockBrowserWs(messageSequences = {}) {
  const listeners = {};
  const ws = {
    addEventListener(event, cb) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    send(data) {
      const str = typeof data === 'string' ? data : '';
      for (const [trigger, msgs] of Object.entries(messageSequences)) {
        if (str.includes(trigger)) {
          for (const msg of msgs) {
            setImmediate(() => {
              const event = { data: JSON.stringify(msg) };
              for (const cb of (listeners.message || [])) cb(event);
            });
          }
        }
      }
    },
    close() {
      setImmediate(() => {
        for (const cb of (listeners.close || [])) cb({});
      });
    },
    _emit(event, data) {
      setImmediate(() => {
        for (const cb of (listeners[event] || [])) cb(data);
      });
    },
  };
  return ws;
}

// --- Set membership tests ---
describe('BROWSER_DIRECT sets', () => {
  test('BROWSER_DIRECT_TTS contains correct providers', () => {
    assert.ok(BROWSER_DIRECT_TTS.has('elevenlabs'));
    assert.ok(BROWSER_DIRECT_TTS.has('google-cloud'));
    assert.ok(BROWSER_DIRECT_TTS.has('playht'));
    assert.ok(BROWSER_DIRECT_TTS.has('azure'));
    assert.ok(!BROWSER_DIRECT_TTS.has('aws-polly'));
    assert.ok(!BROWSER_DIRECT_TTS.has('browser'));
  });

  test('BROWSER_DIRECT_STT contains correct providers', () => {
    assert.ok(BROWSER_DIRECT_STT.has('whisper'));
    assert.ok(BROWSER_DIRECT_STT.has('deepgram'));
    assert.ok(BROWSER_DIRECT_STT.has('google-cloud'));
    assert.ok(BROWSER_DIRECT_STT.has('azure'));
    assert.ok(!BROWSER_DIRECT_STT.has('aws-transcribe'));
    assert.ok(!BROWSER_DIRECT_STT.has('browser'));
  });

  test('BROWSER_DIRECT_S2S contains correct providers', () => {
    assert.ok(BROWSER_DIRECT_S2S.has('gemini-live'));
    assert.ok(!BROWSER_DIRECT_S2S.has('openai-realtime'));
  });
});

// --- TTS tests ---
describe('Browser TTS - streamTts', () => {
  describe('elevenlabs', () => {
    test('happy path: yields Uint8Array chunks', async () => {
      const fetchFn = mockFetch(200, new Uint8Array([1, 2, 3, 4]));
      const chunks = [];
      for await (const chunk of streamTts('elevenlabs', 'Hello', { apiKey: 'key123' }, fetchFn)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0] instanceof Uint8Array);
    });

    test('upstream error: throws', async () => {
      const fetchFn = mockFetch(401, 'unauthorized');
      await assert.rejects(
        async () => { for await (const c of streamTts('elevenlabs', 'Hi', { apiKey: 'bad' }, fetchFn)) {} },
        /Provider error/
      );
    });

    test('missing key: throws', async () => {
      await assert.rejects(
        async () => { for await (const c of streamTts('elevenlabs', 'Hi', {}, mockFetch(200, ''))) {} },
        /apiKey required/
      );
    });
  });

  describe('google-cloud', () => {
    test('happy path: decodes base64 audioContent via atob', async () => {
      // btoa('audiodata') = 'YXVkaW9kYXRh'
      const audioBase64 = Buffer.from('audiodata').toString('base64');
      const fetchFn = mockFetch(200, JSON.stringify({ audioContent: audioBase64 }));
      const chunks = [];
      for await (const chunk of streamTts('google-cloud', 'Hello', { apiKey: 'key123' }, fetchFn)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0] instanceof Uint8Array);
      // Verify decoded content matches
      assert.deepEqual(Array.from(chunks[0]), Array.from(Buffer.from('audiodata')));
    });

    test('upstream error: throws', async () => {
      const fetchFn = mockFetch(403, 'forbidden');
      await assert.rejects(
        async () => { for await (const c of streamTts('google-cloud', 'Hi', { apiKey: 'bad' }, fetchFn)) {} },
        /Provider error/
      );
    });

    test('missing key: throws', async () => {
      await assert.rejects(
        async () => { for await (const c of streamTts('google-cloud', 'Hi', {}, mockFetch(200, ''))) {} },
        /apiKey or accessToken required/
      );
    });
  });

  describe('playht', () => {
    test('happy path: yields Uint8Array chunks', async () => {
      const fetchFn = mockFetch(200, new Uint8Array([10, 20, 30]));
      const chunks = [];
      for await (const chunk of streamTts('playht', 'Hello', { apiKey: 'key123', userId: 'u1' }, fetchFn)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0] instanceof Uint8Array);
    });

    test('upstream error: throws', async () => {
      const fetchFn = mockFetch(500, 'internal error');
      await assert.rejects(
        async () => { for await (const c of streamTts('playht', 'Hi', { apiKey: 'k', userId: 'u' }, fetchFn)) {} },
        /Provider error/
      );
    });

    test('missing key: throws', async () => {
      await assert.rejects(
        async () => { for await (const c of streamTts('playht', 'Hi', { userId: 'u' }, mockFetch(200, ''))) {} },
        /apiKey required/
      );
    });
  });

  describe('azure', () => {
    test('happy path: yields Uint8Array chunks', async () => {
      const fetchFn = mockFetch(200, new Uint8Array([5, 6, 7]));
      const chunks = [];
      for await (const chunk of streamTts('azure', 'Hello', { apiKey: 'key123' }, fetchFn)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0] instanceof Uint8Array);
    });

    test('upstream error: throws', async () => {
      const fetchFn = mockFetch(400, 'bad request');
      await assert.rejects(
        async () => { for await (const c of streamTts('azure', 'Hi', { apiKey: 'bad' }, fetchFn)) {} },
        /Provider error/
      );
    });

    test('missing key: throws', async () => {
      await assert.rejects(
        async () => { for await (const c of streamTts('azure', 'Hi', {}, mockFetch(200, ''))) {} },
        /apiKey required/
      );
    });
  });

  describe('aws-polly (server-only)', () => {
    test('throws: use server proxy', async () => {
      await assert.rejects(
        async () => { for await (const c of streamTts('aws-polly', 'Hi', { apiKey: 'k' }, mockFetch(200, ''))) {} },
        /server proxy/
      );
    });
  });

  test('unknown provider throws', async () => {
    await assert.rejects(
      async () => { for await (const c of streamTts('nonexistent', 'Hi', {}, mockFetch(200, ''))) {} },
      /Unknown TTS provider/
    );
  });
});

// --- STT tests ---
describe('Browser STT - createSttSession', () => {
  describe('whisper', () => {
    test('happy path: returns transcript + durationMs', async () => {
      const fetchFn = mockFetch(200, JSON.stringify({ text: 'Hello world', duration: 2.5, language: 'en' }));
      const session = createSttSession('whisper', { apiKey: 'key123' }, fetchFn);
      session.feed(new Uint8Array([1, 2, 3]));
      session.feed(new Uint8Array([4, 5, 6]));
      const result = await session.finish();
      assert.equal(result.transcript, 'Hello world');
      assert.equal(result.durationMs, 2500);
    });

    test('upstream error: rejects', async () => {
      const fetchFn = mockFetch(401, 'unauthorized');
      const session = createSttSession('whisper', { apiKey: 'bad' }, fetchFn);
      session.feed(new Uint8Array([1]));
      await assert.rejects(session.finish(), /Provider error/);
    });
  });

  describe('deepgram', () => {
    test('happy path: returns transcript + durationMs', async () => {
      const fetchFn = mockFetch(200, JSON.stringify({
        results: { channels: [{ alternatives: [{ transcript: 'Hi there' }] }] },
        metadata: { duration: 1.8 },
      }));
      const session = createSttSession('deepgram', { apiKey: 'key123' }, fetchFn);
      session.feed(new Uint8Array([1]));
      const result = await session.finish();
      assert.equal(result.transcript, 'Hi there');
      assert.equal(result.durationMs, 1800);
    });

    test('upstream error: rejects', async () => {
      const fetchFn = mockFetch(500, 'server error');
      const session = createSttSession('deepgram', { apiKey: 'bad' }, fetchFn);
      session.feed(new Uint8Array([1]));
      await assert.rejects(session.finish(), /Provider error/);
    });
  });

  describe('google-cloud', () => {
    test('happy path: returns transcript', async () => {
      const fetchFn = mockFetch(200, JSON.stringify({
        results: [{ alternatives: [{ transcript: 'Testing' }] }],
      }));
      const session = createSttSession('google-cloud', { apiKey: 'key123' }, fetchFn);
      session.feed(new Uint8Array([1]));
      const result = await session.finish();
      assert.equal(result.transcript, 'Testing');
    });

    test('upstream error: rejects', async () => {
      const fetchFn = mockFetch(400, 'bad request');
      const session = createSttSession('google-cloud', { apiKey: 'bad' }, fetchFn);
      session.feed(new Uint8Array([1]));
      await assert.rejects(session.finish(), /Provider error/);
    });
  });

  describe('azure', () => {
    test('happy path: returns transcript + durationMs', async () => {
      const fetchFn = mockFetch(200, JSON.stringify({ DisplayText: 'Azure test', Duration: 15000000 }));
      const session = createSttSession('azure', { apiKey: 'key123' }, fetchFn);
      session.feed(new Uint8Array([1]));
      const result = await session.finish();
      assert.equal(result.transcript, 'Azure test');
      assert.equal(result.durationMs, 1500);
    });

    test('upstream error: rejects', async () => {
      const fetchFn = mockFetch(403, 'forbidden');
      const session = createSttSession('azure', { apiKey: 'bad' }, fetchFn);
      session.feed(new Uint8Array([1]));
      await assert.rejects(session.finish(), /Provider error/);
    });
  });

  describe('aws-transcribe (server-only)', () => {
    test('throws 501', async () => {
      const session = createSttSession('aws-transcribe', { apiKey: 'k' }, mockFetch(200, ''));
      session.feed(new Uint8Array([1]));
      await assert.rejects(session.finish(), /server proxy/);
    });
  });

  test('unknown provider throws', () => {
    assert.throws(
      () => createSttSession('nonexistent', {}, mockFetch(200, '')),
      /Unknown STT provider/
    );
  });
});

// --- S2S tests ---
describe('Browser S2S - createS2sSession', () => {
  describe('gemini-live', () => {
    test('happy path: receives audio and transcript via addEventListener', async () => {
      const messages = {
        setup: [{ setupComplete: true }],
        realtimeInput: [
          { serverContent: { modelTurn: { parts: [{ text: 'Hello' }] } } },
          { serverContent: { modelTurn: { parts: [{ inlineData: { data: 'YXVkaW8=' } }] } } },
          { serverContent: { turnComplete: true } },
        ],
      };

      const createWs = (url) => {
        const ws = mockBrowserWs(messages);
        // Fire open after construction
        setImmediate(() => ws._emit('open', {}));
        return ws;
      };

      const session = createS2sSession('gemini-live', { apiKey: 'key123' }, createWs);
      const audioChunks = [];
      const transcripts = [];
      session.onAudio((chunk) => audioChunks.push(chunk));
      session.onTranscript((text) => transcripts.push(text));
      session.feed(new Uint8Array([1, 2, 3]));
      await session.finish();
      assert.equal(transcripts.join(''), 'Hello');
      assert.equal(audioChunks.length, 1);
    });

    test('timeout: rejects', async () => {
      const createWs = (url) => {
        const ws = mockBrowserWs({});
        setImmediate(() => ws._emit('open', {}));
        return ws;
      };

      const session = createS2sSession('gemini-live', { apiKey: 'key' }, createWs);
      session.feed(new Uint8Array([1]));
      session._timeout = 10;
      await assert.rejects(session.finish(), /timeout/);
    });

    test('connection error: rejects', async () => {
      const createWs = (url) => {
        const ws = mockBrowserWs({});
        setImmediate(() => ws._emit('error', { message: 'connection failed' }));
        return ws;
      };

      const session = createS2sSession('gemini-live', { apiKey: 'key' }, createWs);
      session.feed(new Uint8Array([1]));
      await assert.rejects(session.finish(), /connection failed|error/);
    });
  });

  describe('openai-realtime (server-only)', () => {
    test('throws: use server proxy', () => {
      assert.throws(
        () => createS2sSession('openai-realtime', { apiKey: 'key' }, () => {}),
        /server proxy/
      );
    });
  });

  test('unknown provider throws', () => {
    assert.throws(
      () => createS2sSession('nonexistent', {}, () => {}),
      /Unknown S2S provider/
    );
  });
});

// --- pcmToWav tests ---
describe('pcmToWav', () => {
  test('produces valid WAV header for empty PCM', () => {
    const wav = pcmToWav(new Uint8Array(0));
    assert.ok(wav instanceof Uint8Array);
    assert.equal(wav.length, 44); // header only
    // RIFF magic
    const riff = String.fromCharCode(...wav.slice(0, 4));
    assert.equal(riff, 'RIFF');
    // WAVE magic
    const wave = String.fromCharCode(...wav.slice(8, 12));
    assert.equal(wave, 'WAVE');
    // fmt chunk
    const fmt = String.fromCharCode(...wav.slice(12, 16));
    assert.equal(fmt, 'fmt ');
  });

  test('header encodes correct sample rate and channels', () => {
    const pcm = new Uint8Array(100);
    const wav = pcmToWav(pcm, 24000, 1, 16);
    assert.equal(wav.length, 44 + 100);
    // Sample rate at offset 24 (little-endian uint32)
    const view = new DataView(wav.buffer);
    assert.equal(view.getUint32(24, true), 24000);
    // Channels at offset 22 (little-endian uint16)
    assert.equal(view.getUint16(22, true), 1);
    // Bits per sample at offset 34
    assert.equal(view.getUint16(34, true), 16);
  });

  test('PCM data follows header exactly', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5]);
    const wav = pcmToWav(pcm);
    assert.equal(wav.length, 44 + 5);
    assert.deepEqual(Array.from(wav.slice(44)), [1, 2, 3, 4, 5]);
  });

  test('RIFF file size field is correct', () => {
    const pcm = new Uint8Array(1000);
    const wav = pcmToWav(pcm);
    const view = new DataView(wav.buffer);
    // RIFF chunk size = file size - 8
    assert.equal(view.getUint32(4, true), 44 + 1000 - 8);
    // data chunk size at offset 40
    assert.equal(view.getUint32(40, true), 1000);
  });
});

// --- speakViaS2s tests ---
describe('speakViaS2s', () => {
  test('gemini-live returns WAV-wrapped audio (starts with RIFF header)', async () => {
    // Fake PCM audio data as base64
    const fakePcm = new Uint8Array([0, 1, 0, 2, 0, 3, 0, 4]);
    const fakePcmBase64 = Buffer.from(fakePcm).toString('base64');

    const messages = {
      setup: [{ setupComplete: true }],
      clientContent: [
        { serverContent: { modelTurn: { parts: [{ inlineData: { data: fakePcmBase64 } }] } } },
        { serverContent: { turnComplete: true } },
      ],
    };

    const createWs = (url) => {
      const ws = mockBrowserWs(messages);
      setImmediate(() => ws._emit('open', {}));
      return ws;
    };

    const result = await speakViaS2s('gemini-live', 'Hello', { apiKey: 'key123' }, createWs);
    // Should return a single WAV Uint8Array (not an array of PCM chunks)
    assert.ok(result instanceof Uint8Array);
    // Check RIFF header
    const riff = String.fromCharCode(...result.slice(0, 4));
    assert.equal(riff, 'RIFF');
    // PCM data should be embedded after header
    assert.ok(result.length > 44);
  });

  test('unsupported provider throws', () => {
    assert.throws(
      () => speakViaS2s('nonexistent', 'Hi', {}, () => {}),
      /S2S speak not supported/
    );
  });
});
