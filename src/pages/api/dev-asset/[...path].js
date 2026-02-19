// Dev-only endpoint: serves article assets with imgix-first, local fallback
// In dev mode, imgUrl() points here. We try imgix first (in case the asset is uploaded),
// then fall back to co-located files in the content directory.
import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ARTICLES_DIR = join(process.cwd(), 'src', 'content', 'articles');
const AUTHORS_DIR = join(process.cwd(), 'src', 'content', 'authors');
const IMGIX_DOMAIN = process.env.IMGIX_DOMAIN || '18441963.imgix.net';

const MIME_TYPES = {
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

export async function GET({ params }) {
  if (!import.meta.env.DEV) {
    return new Response('Not found', { status: 404 });
  }
  const rawPath = params.path;

  // 2a. Author images — always serve from local content dir (local images are canonical)

  if (rawPath.startsWith('authors/')) {
    const fileName = rawPath.replace(/^authors\//, '');
    const filePath = join(AUTHORS_DIR, fileName);
    try {
      const data = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      return new Response(data, {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
      });
    } catch { return new Response(`Author image not found: ${fileName}`, { status: 404 }); }
  }

  // Try imgix first for articles (asset may already be uploaded)
  try {
    const imgixUrl = `https://${IMGIX_DOMAIN}/thinkdone/${rawPath}?auto=format,compress&q=80`;
    const res = await fetch(imgixUrl, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const contentType = res.headers.get('content-type') || 'image/webp';
      return new Response(res.body, {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=300' },
      });
    }
  } catch { /* imgix unavailable or timeout — fall through to local */ }

  // Fall back to local content directory for articles
  const parts = rawPath.replace(/^articles\//, '').split('/');
  if (parts.length < 2) return new Response('Not found', { status: 404 });

  const [slug, ...fileParts] = parts;
  const fileName = fileParts.join('/');

  // Find the matching date-prefixed folder (YYYY-MM-DD_slug)
  let folder;
  try {
    const entries = await readdir(ARTICLES_DIR);
    folder = entries.find(e => e.endsWith(`_${slug}`) || e === slug);
  } catch { return new Response('Not found', { status: 404 }); }
  if (!folder) return new Response(`Folder not found for slug: ${slug}`, { status: 404 });

  const folderPath = join(ARTICLES_DIR, folder);

  // Try exact file, then placeholder variants
  const candidates = [
    join(folderPath, fileName),
    join(folderPath, fileName.replace(/\.[^.]+$/, '-placeholder.svg')),
    join(folderPath, fileName.replace(/\.[^.]+$/, '-placeholder.png')),
  ];

  for (const candidate of candidates) {
    try {
      const data = await readFile(candidate);
      const candidateExt = extname(candidate).toLowerCase();
      const contentType = MIME_TYPES[candidateExt] || 'application/octet-stream';
      return new Response(data, {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
      });
    } catch { /* try next */ }
  }
  return new Response(`File not found: ${fileName} (looked in ${folder}/)`, { status: 404 });
}
