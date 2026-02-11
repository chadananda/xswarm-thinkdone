import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  translateToGeminiFormat, parseGeminiSSEChunk,
  translateToOpenAIFormat, parseOpenAISSEChunk,
} from '../../src/lib/provider.js';
//
describe('translateToGeminiFormat', () => {
  it('translates system prompt to systemInstruction', () => {
    const result = translateToGeminiFormat('You are helpful', []);
    assert.deepEqual(result.systemInstruction, { parts: [{ text: 'You are helpful' }] });
    assert.deepEqual(result.contents, []);
  });
  //
  it('extracts flat string from { blocks, flat } object', () => {
    const system = {
      blocks: [{ type: 'text', text: 'SOUL', cache_control: { type: 'ephemeral' } }],
      flat: 'SOUL\n\n---\n\nRules',
    };
    const result = translateToGeminiFormat(system, []);
    assert.deepEqual(result.systemInstruction, { parts: [{ text: 'SOUL\n\n---\n\nRules' }] });
  });
  //
  it('maps assistant role to model', () => {
    const messages = [{ role: 'assistant', content: 'Hello' }];
    const result = translateToGeminiFormat('', messages);
    assert.equal(result.contents[0].role, 'model');
    assert.deepEqual(result.contents[0].parts, [{ text: 'Hello' }]);
  });
  //
  it('keeps user role as user', () => {
    const messages = [{ role: 'user', content: 'Hi there' }];
    const result = translateToGeminiFormat('', messages);
    assert.equal(result.contents[0].role, 'user');
    assert.deepEqual(result.contents[0].parts, [{ text: 'Hi there' }]);
  });
  //
  it('translates a full conversation', () => {
    const messages = [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
      { role: 'user', content: 'Thanks' },
    ];
    const result = translateToGeminiFormat('Be concise', messages);
    assert.deepEqual(result.systemInstruction, { parts: [{ text: 'Be concise' }] });
    assert.equal(result.contents.length, 3);
    assert.equal(result.contents[0].role, 'user');
    assert.equal(result.contents[1].role, 'model');
    assert.equal(result.contents[2].role, 'user');
    assert.deepEqual(result.contents[1].parts, [{ text: '4' }]);
  });
  //
  it('handles empty system prompt', () => {
    const result = translateToGeminiFormat('', [{ role: 'user', content: 'Hi' }]);
    assert.deepEqual(result.systemInstruction, { parts: [{ text: '' }] });
    assert.equal(result.contents.length, 1);
  });
  //
  it('handles null/undefined system prompt', () => {
    const result = translateToGeminiFormat(null, [{ role: 'user', content: 'Hi' }]);
    assert.deepEqual(result.systemInstruction, { parts: [{ text: '' }] });
  });
  //
  it('handles empty messages array', () => {
    const result = translateToGeminiFormat('System', []);
    assert.deepEqual(result.contents, []);
  });
});
//
describe('parseGeminiSSEChunk', () => {
  it('extracts text from candidates', () => {
    const data = {
      candidates: [{ content: { parts: [{ text: 'Hello world' }] } }],
    };
    const result = parseGeminiSSEChunk(data);
    assert.deepEqual(result, { text: 'Hello world' });
  });
  //
  it('extracts usage metadata', () => {
    const data = {
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
      },
    };
    const result = parseGeminiSSEChunk(data, 'gemini-2.0-flash');
    assert.deepEqual(result, {
      usage: { input_tokens: 100, output_tokens: 50, model: 'gemini-2.0-flash' },
    });
  });
  //
  it('returns null for unrecognized format', () => {
    assert.equal(parseGeminiSSEChunk({}), null);
    assert.equal(parseGeminiSSEChunk({ something: 'else' }), null);
  });
  //
  it('returns null for null/undefined input', () => {
    assert.equal(parseGeminiSSEChunk(null), null);
    assert.equal(parseGeminiSSEChunk(undefined), null);
  });
  //
  it('handles candidates without text gracefully', () => {
    const data = { candidates: [{ content: { parts: [] } }] };
    assert.equal(parseGeminiSSEChunk(data), null);
  });
  //
  it('handles candidates with empty text', () => {
    const data = { candidates: [{ content: { parts: [{ text: '' }] } }] };
    const result = parseGeminiSSEChunk(data);
    assert.deepEqual(result, { text: '' });
  });
  //
  it('prefers text over usage when both present', () => {
    const data = {
      candidates: [{ content: { parts: [{ text: 'chunk' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    };
    const result = parseGeminiSSEChunk(data);
    assert.deepEqual(result, { text: 'chunk' });
  });
});
//
describe('translateToOpenAIFormat', () => {
  it('prepends system as system message', () => {
    const result = translateToOpenAIFormat('You are helpful', []);
    assert.deepEqual(result, [{ role: 'system', content: 'You are helpful' }]);
  });
  //
  it('extracts flat string from { blocks, flat } object', () => {
    const system = {
      blocks: [{ type: 'text', text: 'SOUL', cache_control: { type: 'ephemeral' } }],
      flat: 'SOUL\n\n---\n\nRules',
    };
    const result = translateToOpenAIFormat(system, [{ role: 'user', content: 'Hi' }]);
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'system');
    assert.equal(result[0].content, 'SOUL\n\n---\n\nRules');
  });
  //
  it('keeps user and assistant roles', () => {
    const msgs = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ];
    const result = translateToOpenAIFormat('', msgs);
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'user');
    assert.equal(result[1].role, 'assistant');
  });
  //
  it('omits system message when null/empty', () => {
    const result = translateToOpenAIFormat(null, [{ role: 'user', content: 'Hi' }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].role, 'user');
  });
  //
  it('handles full conversation with system', () => {
    const msgs = [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
    ];
    const result = translateToOpenAIFormat('Be concise', msgs);
    assert.equal(result.length, 3);
    assert.equal(result[0].role, 'system');
    assert.equal(result[0].content, 'Be concise');
    assert.equal(result[1].content, 'What is 2+2?');
    assert.equal(result[2].content, '4');
  });
});
//
describe('parseOpenAISSEChunk', () => {
  it('extracts text from delta content', () => {
    const data = { choices: [{ delta: { content: 'Hello' } }] };
    assert.deepEqual(parseOpenAISSEChunk(data), { text: 'Hello' });
  });
  //
  it('extracts usage data', () => {
    const data = {
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      model: 'gpt-4o',
    };
    const result = parseOpenAISSEChunk(data);
    assert.deepEqual(result, {
      usage: { input_tokens: 100, output_tokens: 50, model: 'gpt-4o' },
    });
  });
  //
  it('uses fallback model when data.model is missing', () => {
    const data = { usage: { prompt_tokens: 10, completion_tokens: 5 } };
    const result = parseOpenAISSEChunk(data, 'llama-3.3-70b-versatile');
    assert.equal(result.usage.model, 'llama-3.3-70b-versatile');
  });
  //
  it('returns null for null/undefined input', () => {
    assert.equal(parseOpenAISSEChunk(null), null);
    assert.equal(parseOpenAISSEChunk(undefined), null);
  });
  //
  it('returns null for empty delta (role-only chunk)', () => {
    const data = { choices: [{ delta: { role: 'assistant' } }] };
    assert.equal(parseOpenAISSEChunk(data), null);
  });
  //
  it('returns null for empty object', () => {
    assert.equal(parseOpenAISSEChunk({}), null);
  });
});
