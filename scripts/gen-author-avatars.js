#!/usr/bin/env node
// Generate hand-drawn style author avatar images using DALL-E
// Images are saved co-located with author YAML files in src/content/authors/
//
// Usage: node scripts/gen-author-avatars.js [--force]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
//
const AUTHORS_DIR = 'src/content/authors';
const forceAll = process.argv.includes('--force');
//
// Parse YAML fields we need (simple single-line parser — no dep needed)
function parseYaml(text) {
  const obj = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
    if (m) obj[m[1]] = m[2];
  }
  return obj;
}
//
const STYLE = `Authentic candid photograph of a real person, shot on a Canon 5D Mark IV with an 85mm f/1.4 lens. Natural golden-hour sunlight, shallow depth of field. The person has natural skin texture, pores, subtle imperfections — NOT airbrushed or smoothed. Looks like a photo taken by a friend on a weekend outdoor adventure in the San Francisco Bay Area. Warm, authentic, editorial quality. No studio lighting. No filters. IMPORTANT: absolutely no text, words, letters, labels, watermarks, or writing anywhere in the image.`;
//
const authors = readdirSync(AUTHORS_DIR)
  .filter(f => f.endsWith('.yaml'))
  .map(f => {
    const yaml = parseYaml(readFileSync(join(AUTHORS_DIR, f), 'utf8'));
    const slug = basename(f, '.yaml');
    const imgPath = join(AUTHORS_DIR, `${slug}.jpg`);
    return { slug, imgPath, ...yaml };
  });
//
async function generate(author) {
  if (!forceAll && existsSync(author.imgPath)) {
    console.log(`  skip ${author.slug} (exists, use --force to regenerate)`);
    return;
  }
  //
  // Keep prompt minimal — feeding role/personality text causes DALL-E to render it as visible text
  const appearance = {
    'maya-chen': 'East Asian woman in her mid-30s, shoulder-length dark hair, trail running on a coastal path above the Pacific Ocean, wearing a lightweight running vest, wind in her hair, Marin Headlands in the background, confident smile mid-stride',
    'david-park': 'Korean American man in his early 40s, slightly wavy dark hair, road cycling on a scenic coastal highway, wearing a cycling jersey, leaning on handlebars at a viewpoint overlooking the ocean, thoughtful relaxed expression',
    'rachel-torres': 'Latina woman in her mid-30s, medium-length brown hair, hiking at the top of a ridge trail, backpack on, leaning against a trail marker post with arms crossed, golden hills and oak trees behind her, confident direct gaze',
    'james-whitfield': 'White man in his late 40s, short brown hair with hints of gray, sailing a small boat on San Francisco Bay, hand on the tiller, wearing a fleece pullover, Golden Gate Bridge faintly visible in the misty background, calm authoritative expression',
    'kai-nakamura': 'Japanese American man in his late 20s, short beard, mountain biking on a redwood forest trail in Santa Cruz mountains, straddling the bike at a rest stop, helmet tilted back, friendly energetic grin, dappled sunlight through trees',
  }[author.slug] || 'professional person outdoors, friendly expression';
  const prompt = `${STYLE}\n\nSubject: ${appearance}.`;
  console.log(`  generating ${author.slug}...`);
  //
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1024',
      output_format: 'jpeg',
    }),
  });
  //
  if (!res.ok) {
    const err = await res.text();
    console.error(`  FAIL ${author.slug}: ${res.status} ${err.slice(0, 200)}`);
    return;
  }
  //
  const data = await res.json();
  const b64 = data.data[0].b64_json;
  writeFileSync(author.imgPath, Buffer.from(b64, 'base64'));
  console.log(`  saved ${author.imgPath}`);
}
//
console.log(`Generating avatars for ${authors.length} authors...\n`);
for (const author of authors) {
  await generate(author);
}
console.log('\nDone.');
