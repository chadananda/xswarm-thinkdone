#!/usr/bin/env node
// Upload assets to R2 bucket: languagelab-covers/thinkdone/
//
// Assets live co-located with their content files in src/content/:
//   src/content/authors/maya-chen.jpg  → thinkdone/authors/maya-chen.jpg
//   src/content/strategies/todoist-icon.png → thinkdone/strategies/todoist-icon.png
//   src/content/articles/2025-03-15_slug/hero.jpg → thinkdone/articles/2025-03-15_slug/hero.jpg
//   src/content/articles/2025-03-15_slug/narration.mp3 → thinkdone/articles/2025-03-15_slug/narration.mp3
//
// Uploads ALL non-content files (skips .md, .mdx, .yaml, .yml, .json)
// Tracks file hashes in .upload-manifest.json to skip unchanged files.
// Uploads up to 8 files in parallel.
//
// Usage:
//   node scripts/upload-assets.js              # upload changed content assets
//   node scripts/upload-assets.js --branding   # also upload public/ brand assets
//   node scripts/upload-assets.js --all        # upload everything
//   node scripts/upload-assets.js --force      # re-upload all, ignore manifest
import { exec } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
//
const BUCKET = 'languagelab-covers';
const PREFIX = 'thinkdone';
const MANIFEST_PATH = '.upload-manifest.json';
const CONCURRENCY = 8;
const CONTENT_EXTS = new Set(['.md', '.mdx', '.yaml', '.yml', '.json']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.avif']);
const args = process.argv.slice(2);
const uploadBranding = args.includes('--branding') || args.includes('--all');
const forceAll = args.includes('--force');
//
const manifest = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  : {};
//
function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
//
function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const f of readdirSync(dir)) {
    if (f.startsWith('.')) continue;
    const path = join(dir, f);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}
//
// MIME types — sets content-type for proper serving and streaming
const MIME_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};
// Long cache for immutable content assets (1 year), short for everything else
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
//
function uploadOne(localPath, r2Key) {
  const ext = extname(localPath).toLowerCase();
  const ct = MIME_TYPES[ext] || 'application/octet-stream';
  let flags = `--content-type "${ct}" --cache-control "${CACHE_IMMUTABLE}"`;
  return new Promise((resolve, reject) => {
    exec(`wrangler r2 object put "${BUCKET}/${r2Key}" --file "${localPath}" --remote ${flags}`, (err, stdout, stderr) => {
      if (err) {
        console.error(`  FAIL ${r2Key}: ${stderr.trim()}`);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
//
// Run tasks with concurrency limit
async function pool(tasks, limit) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = task().then(r => { executing.delete(p); return r; });
    executing.add(p);
    results.push(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  return Promise.allSettled(results);
}
//
// Collect all files to process
const jobs = [];
//
const contentDir = 'src/content';
const contentAssets = walk(contentDir).filter(f => !CONTENT_EXTS.has(extname(f).toLowerCase()));
for (const file of contentAssets) {
  jobs.push({ localPath: file, r2Key: `${PREFIX}/${relative(contentDir, file)}` });
}
//
if (uploadBranding) {
  const brandFiles = walk('public').filter(f => IMAGE_EXTS.has(extname(f).toLowerCase()));
  for (const file of brandFiles) {
    jobs.push({ localPath: file, r2Key: `${PREFIX}/branding/${relative('public', file)}` });
  }
}
//
// Filter to only changed files
const pending = [];
let skipped = 0;
for (const job of jobs) {
  const hash = fileHash(job.localPath);
  if (!forceAll && manifest[job.r2Key] === hash) {
    skipped++;
  } else {
    pending.push({ ...job, hash });
  }
}
//
if (pending.length === 0 && skipped === 0) {
  console.log('No asset files found. Add images/audio next to content files in src/content/');
  process.exit(0);
}
if (pending.length === 0) {
  console.log(`All ${skipped} files unchanged — nothing to upload.`);
  process.exit(0);
}
//
console.log(`Uploading ${pending.length} files (${skipped} unchanged, skipped)...`);
//
const tasks = pending.map(job => () => {
  console.log(`  ${job.localPath} → ${job.r2Key}`);
  return uploadOne(job.localPath, job.r2Key).then(() => {
    manifest[job.r2Key] = job.hash;
  });
});
//
const results = await pool(tasks, CONCURRENCY);
const failed = results.filter(r => r.status === 'rejected').length;
//
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
//
console.log(`\nDone — ${pending.length - failed} uploaded, ${skipped} skipped${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
