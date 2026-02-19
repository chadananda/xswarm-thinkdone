# Image Styles

## Hero Images (Article Illustrations)

Hand-drawn sketch illustrations on warm cream/parchment paper background (#f4efe6).

- **Medium**: Charcoal/graphite pencil sketch with loose, architectural line work
- **Color**: Predominantly monochrome (black ink/charcoal lines) with sparse, subtle watercolor washes — one or two muted accent colors per image (soft blue, warm peach/salmon, sage green, dusty gold). Color is used sparingly as a highlight, never as fill
- **Subject**: Conceptual/metaphorical representations of the article topic — not literal screenshots or UI mockups. Examples: interlocking gears for ClickUp (complexity/machinery), kanban columns for Trello, building blocks for Notion
- **Composition**: Objects float or are loosely arranged on the page with breathing room. Slight drop shadows ground objects. Nothing touches the edges — generous negative space on all sides
- **Line quality**: Slightly imperfect, hand-drawn feel. Cross-hatching for shading. Lines vary in weight. Some construction lines left visible for an "in-progress" sketch feel
- **Background**: Matches site background (#f4efe6 warm cream). No borders, no frames — the illustration bleeds naturally into the page
- **Aspect ratio**: 3:2 landscape (roughly 1200x800)
- **Format**: WebP, ~100-200KB
- **Generation prompt style**: "Hand-drawn charcoal pencil sketch on cream parchment paper, [subject description], minimal watercolor wash accents in [1-2 colors], architectural sketch style with loose construction lines, generous negative space, warm cream background #f4efe6"

## Author Portrait Photos (v2 — Current)

Photorealistic outdoor portraits with golden hour lighting. These replaced the old v1 sepia/vintage illustrated portraits.

- **Style**: Photorealistic, natural-looking candid portraits (AI-generated but indistinguishable from real photography)
- **Lighting**: Golden hour / magic hour — warm, directional sunlight from the side or behind. Sun is low, creating rich skin tones and atmospheric depth
- **Setting**: Each author has a distinct outdoor California/West Coast environment that reflects their personality:
  - Rachel Torres — hiking trail, dry golden hills, backpack, arms crossed (confident, direct)
  - Kai Nakamura — mountain bike on forest trail, helmet, laughing (energetic, approachable)
  - Maya Chen — trail running on coastal ridge, wind in hair (dynamic, driven)
  - David Park — road cycling on coastal highway, leaning on handlebars, pensive (thoughtful, focused)
  - James Whitfield — sailing/rowing on bay with bridge in background, fleece pullover (steady, experienced)
- **Wardrobe**: Casual outdoor athletic wear — earth tones (olive, charcoal, navy). No logos, no tech-bro aesthetic. Feels like someone on their weekend, not posing for a headshot
- **Framing**: Upper body / medium close-up. Subject fills ~60-70% of frame. Shallow depth of field (f/1.8-2.8 look) with background beautifully blurred
- **Expression**: Natural, unposed. Smiling or focused, never stiff. Feels like a friend caught in a genuine moment
- **Color grading**: Warm, slightly desaturated. Rich skin tones. No heavy filters or color casts
- **Dimensions**: 1024x1024 square
- **Format**: JPEG, ~150-200KB
- **Generation prompt style**: "Photorealistic portrait photograph, [name] a [age/ethnicity description], [activity] in [outdoor California setting], golden hour sunlight, shallow depth of field, natural candid expression, warm earth-tone clothing, shot on 85mm lens f/1.8"

### v1 Author Portraits (Deprecated — DO NOT USE)

The old style used sepia-toned, vintage-illustrated portraits with an antique/daguerreotype aesthetic. These looked fake and clashed with the modern site design. They have been replaced on imgix but may still exist in caches. All new author images must follow the v2 photorealistic style above.

## Usage in Code

All images route through `imgUrl()` in `src/lib/imgix.ts`:
- **Production**: Served from imgix CDN with auto-format, compression, and resize params
- **Dev mode**: Article assets (`articles/`) try imgix first, fall back to local `src/content/articles/`. Author images (`authors/`) always serve from local `src/content/authors/` (canonical source for v2 photos)
- **Card thumbnails**: `imgUrl(path, { w: 800, h: 500, fit: 'crop' })`
- **Author avatars**: `imgUrl(path, { w: 64, h: 64, fit: 'crop', facepad: 2 })`
- **Author bios**: `imgUrl(path, { w: 160, h: 160, fit: 'crop' })`
