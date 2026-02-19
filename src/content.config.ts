import { z, defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
//
const authors = defineCollection({
  loader: glob({ pattern: '*.yaml', base: 'src/content/authors' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    bio: z.string(),
    longBio: z.string(),
    avatar: z.string(),
    expertise: z.array(z.string()),
    personality: z.string(),
    social: z.object({
      twitter: z.string().optional(),
      linkedin: z.string().optional(),
      website: z.string().optional(),
    }),
    featured: z.boolean().default(false),
    sales: z.object({
      tagline: z.string(),
      accentColor: z.string(),
      heroQuote: z.string(),
      problem: z.object({
        headline: z.string(),
        description: z.string(),
        painPoints: z.array(z.object({
          icon: z.string(),
          text: z.string(),
        })),
      }),
      philosophy: z.object({
        headline: z.string(),
        description: z.string(),
        principles: z.array(z.object({
          title: z.string(),
          description: z.string(),
        })),
      }),
      insights: z.array(z.object({
        title: z.string(),
        description: z.string(),
        icon: z.string(),
      })),
      thinkdonePitch: z.object({
        headline: z.string(),
        description: z.string(),
        points: z.array(z.string()),
      }),
      faq: z.array(z.object({
        q: z.string(),
        a: z.string(),
      })),
    }).optional(),
  }),
});
//
const strategies = defineCollection({
  loader: glob({ pattern: '*.mdx', base: 'src/content/strategies' }),
  schema: z.object({
    name: z.string(),
    type: z.enum(['app', 'methodology', 'technique']),
    tagline: z.string(),
    description: z.string(),
    author: z.string().optional(),
    icon: z.string().optional(),
    screenshots: z.array(z.string()).optional(),
    website: z.string().url().optional(),
    pricing: z.string().optional(),
    platforms: z.array(z.string()).optional(),
    yearFounded: z.number().optional(),
    verdict: z.object({
      score: z.number(),
      summary: z.string(),
      bestFor: z.string(),
      notFor: z.string(),
    }),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
    relatedStrategies: z.array(z.string()).optional(),
    publishedAt: z.date(),
    updatedAt: z.date().optional(),
  }),
});
//
// Articles use folder convention: YYYY-MM-DD_slug/en.mdx
// Images and translations go in the same folder
const articles = defineCollection({
  loader: glob({ pattern: '*/en.mdx', base: 'src/content/articles', generateId: ({ entry }) => {
    // entry is e.g. "2025-03-15_todoist-deep-dive/en" — extract slug part after date
    const folder = entry.split('/')[0];
    const slug = folder.replace(/^\d{4}-\d{2}-\d{2}_/, '');
    return slug;
  }}),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    description: z.string(),
    type: z.enum([
      'deep-dive', 'roundup', 'comparison', 'methodology-guide',
      'problem-solution', 'listicle', 'thought-leadership', 'how-to',
    ]),
    author: z.string(),
    heroImage: z.string().optional(),
    heroCaption: z.string().optional(),
    heroCredit: z.string().optional(),
    publishedAt: z.date(),
    updatedAt: z.date().optional(),
    strategies: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    readingTime: z.string().optional(),
    audio: z.string().optional(),
    audioDuration: z.string().optional(),
    customBio: z.string().optional(),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
    locale: z.string().default('en'),
    translations: z.array(z.object({ locale: z.string(), slug: z.string() })).optional(),
    youtubeId: z.string().optional(),
  }),
});
//
export const collections = { authors, strategies, articles };
