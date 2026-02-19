import { pipeline } from '@huggingface/transformers';
//
let _embedder = null;
export async function getEmbedder() {
  if (!_embedder) {
    _embedder = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'fp32' });
  }
  return _embedder;
}
//
export async function embed(text) {
  const embedder = await getEmbedder();
  const result = await embedder(text, { pooling: 'cls', normalize: true });
  return new Float32Array(result.data);
}
//
export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
//
export async function semanticSearch(db, queryEmbedding, opts = {}) {
  const { limit = 10, threshold = 0.3 } = opts;
  const rows = await db.prepare(
    'SELECT id, content, compressed, project, person, type, priority, created_at, embedding FROM memories WHERE superseded_by IS NULL AND embedding IS NOT NULL'
  ).all();
  const results = [];
  for (const row of rows) {
    if (!row.embedding) continue;
    const memEmb = new Float32Array(row.embedding.buffer || row.embedding);
    const sim = cosineSimilarity(queryEmbedding, memEmb);
    if (sim >= threshold) results.push({ ...row, similarity: sim });
  }
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}
//
export async function batchEmbed(texts, chunkSize = 10) {
  const embedder = await getEmbedder();
  const results = [];
  for (let i = 0; i < texts.length; i += chunkSize) {
    const chunk = texts.slice(i, i + chunkSize);
    for (const text of chunk) {
      const result = await embedder(text, { pooling: 'cls', normalize: true });
      results.push(new Float32Array(result.data));
    }
  }
  return results;
}
