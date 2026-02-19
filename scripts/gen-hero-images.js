#!/usr/bin/env node
// Generate zen ink sketch hero images for blog articles using gpt-image-1
// Images are saved co-located with article MDX files in src/content/articles/
//
// Usage: node scripts/gen-hero-images.js [--force] [slug-filter]
//   --force    Regenerate even if image exists
//   slug-filter  Only process articles whose slug contains this string
//
// Requires: OPENAI_API_KEY environment variable
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const ARTICLES_DIR = 'src/content/articles';
const forceAll = process.argv.includes('--force');
const slugFilter = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);

if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

// Style prompt from articlemarketingplan.md Part 14
const STYLE = `Minimalist zen ink sketch with sparse impressionist watercolor accents. Fine pen line drawing, loose and sketch-like, not polished. Visible imperfection is the point. One or two watercolor washes bleeding softly at edges. Large areas of white/cream negative space. Off-center composition. Low fidelity, impressionistic — shapes suggested, not rendered. Warm cream background (#f4efe6). Calm, meditative mood. No photorealism, no busy detail, no text, no words, no letters, no labels, no watermarks.`;

// Per-article subject descriptions and color choices
// Key = article folder name (without date prefix), Value = { subject, colors }
const HERO_SUBJECTS = {
  'why-your-todo-list-doesnt-work': {
    subject: 'a crumpled piece of paper with faint crossed-out lines next to a simple pen, resting on a bare desk with soft morning light from the left',
    colors: 'warm amber and muted brown',
    mood: 'slightly melancholy, contemplative — the quiet frustration of good intentions gone stale',
  },
  'todoist-review': {
    subject: 'a clean minimal desk with a single open laptop showing faint checkmarks, a small red circle accent floating above, a cup of coffee to the side',
    colors: 'muted red and warm brown',
    mood: 'focused and reliable — the quiet satisfaction of a well-organized system',
  },
  'things-3-review': {
    subject: 'a single elegant pen resting on a pristine white surface next to a subtle blue circle, with a faint Apple device silhouette in the background, cherry blossom petals drifting',
    colors: 'soft blue and pale rose',
    mood: 'serene craftsmanship — the beauty of restraint and intentional design',
  },
  'thinkdone-vs-todoist': {
    subject: 'two paths diverging from a single point, one path organic and flowing with a warm glow, the other structured and grid-like, a small figure standing at the fork',
    colors: 'warm gold and muted red',
    mood: 'contemplative choice — two valid philosophies meeting at a crossroads',
  },
  'asana-review': {
    subject: 'a birds-eye view of interconnected nodes and lines forming a project network, with small figures collaborating around a central hub, architectural in feel',
    colors: 'coral orange and slate blue',
    mood: 'organized ambition — the controlled complexity of enterprise coordination',
  },
  'trello-review': {
    subject: 'three vertical columns of floating rectangular cards casting soft shadows, some cards drifting between columns, minimal and airy with generous whitespace',
    colors: 'ocean blue and warm sand',
    mood: 'visual clarity — the simple elegance of cards on a board',
  },
  'best-ai-productivity-apps': {
    subject: 'a constellation of small glowing circles connected by thin lines forming a neural network pattern, with a single bright node at center radiating warmth',
    colors: 'electric violet and warm gold',
    mood: 'emerging intelligence — the quiet hum of AI reshaping how we work',
  },
  'getting-things-done-guide': {
    subject: 'five smooth stones arranged in a gentle spiral on a zen garden surface with raked sand lines, each stone slightly different in size, from large to small',
    colors: 'sage green and warm grey',
    mood: 'meditative clarity — the ancient simplicity of a well-ordered mind',
  },
  'notion-review': {
    subject: 'scattered building blocks of different shapes partially assembled into a structure, some blocks floating mid-air, suggesting infinite possibility and play',
    colors: 'warm ivory and charcoal with a single red accent',
    mood: 'creative potential — the joy and overwhelm of a blank canvas with infinite tools',
  },
  'best-daily-planning-apps': {
    subject: 'a window with soft morning light streaming in onto a desk with a single open notebook, a steaming cup, and a sunrise visible through the glass',
    colors: 'golden amber and soft peach',
    mood: 'fresh morning ritual — the quiet power of starting the day with intention',
  },
  'todoist-vs-things-3': {
    subject: 'two minimalist objects side by side — a Swiss Army knife with many tools extended on the left, and a single perfectly balanced Japanese knife on the right, both resting on a wooden surface',
    colors: 'muted red and soft blue',
    mood: 'respectful contrast — two masterful tools with opposing philosophies',
  },
  'clickup-review': {
    subject: 'a vast interconnected machine with many gears, levers and dials of different sizes, some turning smoothly, others still, viewed from a slight distance showing the impressive scale',
    colors: 'deep purple and electric green accents',
    mood: 'impressive complexity — the awe and slight vertigo of a tool that does everything',
  },
  'monday-com-review': {
    subject: 'a colorful mosaic of rounded rectangles in a grid pattern, each a different warm color, with small human silhouettes standing on some of the blocks, looking across the landscape',
    colors: 'rainbow pastels with warm undertones',
    mood: 'vibrant accessibility — making enterprise work feel human and approachable',
  },
};

// Extract frontmatter from MDX file (simple parser)
function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const obj = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"([^"]*)"/);
    if (m) obj[m[1]] = m[2];
    const m2 = line.match(/^(\w+):\s*([^"[\n]+)/);
    if (!m && m2) obj[m2[1]] = m2[2].trim();
  }
  return obj;
}

// Discover articles that need hero images
function discoverArticles() {
  const dirs = readdirSync(ARTICLES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const articles = [];
  for (const dir of dirs) {
    const mdxPath = join(ARTICLES_DIR, dir, 'en.mdx');
    if (!existsSync(mdxPath)) continue;

    const frontmatter = parseFrontmatter(readFileSync(mdxPath, 'utf8'));
    const heroImage = frontmatter.heroImage;
    if (!heroImage) continue;

    // Extract slug from dir name (strip date prefix like 2025-02-09_)
    const slug = dir.replace(/^\d{4}-\d{2}-\d{2}_/, '');
    if (slugFilter && !slug.includes(slugFilter)) continue;

    // Hero image path is relative to src/content/ — resolve to filesystem path
    const imgPath = join(ARTICLES_DIR, dir, 'hero.webp');

    articles.push({
      dir,
      slug,
      mdxPath,
      imgPath,
      heroImage,
      title: frontmatter.title || slug,
      heroCaption: frontmatter.heroCaption || '',
    });
  }
  return articles;
}

async function generateHero(article) {
  if (!forceAll && existsSync(article.imgPath)) {
    console.log(`  skip ${article.slug} (exists, use --force to regenerate)`);
    return;
  }

  const entry = HERO_SUBJECTS[article.slug];
  if (!entry) {
    console.log(`  skip ${article.slug} (no subject defined in HERO_SUBJECTS — add one to gen-hero-images.js)`);
    return;
  }

  const prompt = [
    STYLE,
    `\nSubject: ${entry.subject}.`,
    `Watercolor accents in ${entry.colors}.`,
    entry.mood ? `Mood: ${entry.mood}.` : '',
    `Wide landscape composition, approximately 7:3 aspect ratio.`,
  ].filter(Boolean).join('\n');

  console.log(`  generating ${article.slug}...`);
  console.log(`    prompt: ${prompt.slice(0, 120)}...`);

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
      size: '1536x1024',
      output_format: 'webp',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`  FAIL ${article.slug}: ${res.status} ${err.slice(0, 300)}`);
    return;
  }

  const data = await res.json();
  const b64 = data.data[0].b64_json;
  writeFileSync(article.imgPath, Buffer.from(b64, 'base64'));
  console.log(`  saved ${article.imgPath} (${(Buffer.from(b64, 'base64').length / 1024).toFixed(0)} KB)`);
}

// Main
const articles = discoverArticles();
if (articles.length === 0) {
  console.log('No articles found' + (slugFilter ? ` matching "${slugFilter}"` : '') + '.');
  process.exit(0);
}

console.log(`Generating hero images for ${articles.length} article(s)...\n`);
for (const article of articles) {
  await generateHero(article);
}
console.log('\nDone.');
