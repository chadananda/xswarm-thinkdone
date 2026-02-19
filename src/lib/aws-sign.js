// Minimal AWS SigV4 request signer — no deps, uses node:crypto
import { createHmac, createHash } from 'node:crypto';

function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function hmac(key, data) { return createHmac('sha256', key).update(data).digest(); }

export function signAWS({ method, url, headers, body, accessKey, secretKey, region, service }) {
  const u = new URL(url);
  const now = new Date();
  const date = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');
  const dateStamp = date.slice(0, 8);

  // Add required headers
  headers['x-amz-date'] = date;
  headers['host'] = u.host;

  // Build canonical headers (lowercase keys, sorted)
  const entries = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalHeaders = entries.map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
  const signedHeaders = entries.map(([k]) => k).join(';');
  const payloadHash = sha256(body || '');

  const canonical = [
    method, u.pathname, u.searchParams.toString(),
    canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  // String to sign
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha256(canonical)}`;

  // Derive signing key
  let key = hmac(`AWS4${secretKey}`, dateStamp);
  key = hmac(key, region);
  key = hmac(key, service);
  key = hmac(key, 'aws4_request');

  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}
