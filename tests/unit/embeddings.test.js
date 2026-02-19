import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity } from '../../src/lib/embeddings.js';
//
describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const a = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    // Normalize
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const an = a.map(v => v / norm);
    assert.ok(Math.abs(cosineSimilarity(an, an) - 1.0) < 0.001);
  });
  //
  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([0, 1, 0, 0]);
    assert.ok(Math.abs(cosineSimilarity(a, b)) < 0.001);
  });
  //
  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([-1, 0, 0, 0]);
    assert.ok(Math.abs(cosineSimilarity(a, b) + 1.0) < 0.001);
  });
  //
  it('returns intermediate value for partially similar vectors', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([0.707, 0.707, 0, 0]);
    const sim = cosineSimilarity(a, b);
    assert.ok(sim > 0.5 && sim < 0.9, `Expected ~0.707, got ${sim}`);
  });
});
