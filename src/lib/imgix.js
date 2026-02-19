const IMGIX_DOMAIN = import.meta.env.IMGIX_DOMAIN || '18441963.imgix.net';
const R2_BASE = 'https://pub-b750d0f7242bbc76f115f72840453083.r2.dev';
// R2 bucket: languagelab-covers, all ThinkDone assets under thinkdone/ prefix
// imgix has no path prefix — full R2 key goes in the URL
//
// Default imgix params applied to all image requests
const DEFAULTS = { auto: 'format,compress', q: 80 };
//
// Brighten small author avatars — golden hour photos are too dark at thumbnail size
const AUTHOR_AVATAR_BOOST = { bri: 12, exp: 8, sharp: 25, fit: 'facearea', facepad: 1.8 };
// Sharpen + boost contrast on hero thumbnails — thin pencil lines wash out when downscaled
const HERO_THUMBNAIL_BOOST = { sharp: 20, con: 15 };

export function imgUrl(path, params) {
  if (!path) return '/favicon.png';
  // Auto-enhance small images
  const isSmallAuthor = path.startsWith('authors/') && params?.w && Number(params.w) <= 200;
  const isHeroThumb = path.includes('hero') && params?.w && Number(params.w) <= 800;
  let effectiveParams = params;
  if (isSmallAuthor) effectiveParams = { ...AUTHOR_AVATAR_BOOST, ...params };
  else if (isHeroThumb) effectiveParams = { ...HERO_THUMBNAIL_BOOST, ...params };
  // All images on R2 — imgix crops to exact size
  const r2Key = `thinkdone/${path}`;
  if (!IMGIX_DOMAIN) return `${R2_BASE}/${r2Key}`;
  const qs = new URLSearchParams();
  const merged = { ...DEFAULTS, ...effectiveParams };
  for (const [k, v] of Object.entries(merged)) qs.set(k, String(v));
  return `https://${IMGIX_DOMAIN}/${r2Key}?${qs}`;
}

// Generate srcset for responsive images — mobile gets small, desktop gets large
// widths: array of pixel widths to generate (e.g. [400, 800, 1200, 1600])
// params: base imgix params (w/h will be overridden per breakpoint, aspect preserved)
export function imgSrcset(path, params, widths) {
  if (!path || !widths?.length) return '';
  const baseW = params?.w || widths[widths.length - 1];
  const baseH = params?.h;
  const ratio = baseH ? baseH / baseW : null;
  return widths
    .map(w => {
      const p = { ...params, w };
      if (ratio) p.h = Math.round(w * ratio);
      return `${imgUrl(path, p)} ${w}w`;
    })
    .join(', ');
}
