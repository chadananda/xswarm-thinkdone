# ![icon](public/favicon.png) Think->Done from xSwarm.ai

**Your AI-powered todo list with a planning team built in.**

Imagine starting every morning with a personal coach, executive assistant, productivity expert, and strategic planning team — all focused on making sure you progress on every front. That's ThinkDone.

You keep your projects and goals in simple markdown files. Each morning, ThinkDone reads everything, knows your full landscape, and runs a focused planning meeting: surfacing blockers, challenging your priorities, catching things slipping through the cracks, and building a prioritized task list for the day.

Because **done is the engine of more.** Think -> Done!

## How It Works

1. Keep your projects and goals in a `plans/` folder (plain markdown)
2. Run your daily morning meeting (~15 min) with AI as your planning team
3. ThinkDone reads all your projects, flags what's stuck, challenges where you're spending time, and builds a prioritized flat task list
4. Pin the interactive dashboard to your monitor — check off tasks, drag to reprioritize, add new ones on the fly
5. Decisions, commitments, and patterns are remembered across sessions — nothing falls through the cracks

## Dashboard

A hand-drawn notebook aesthetic on architect's graph paper. Inspired by Basecamp's Ta-da list but with personality.

- **SSR-first** — Tasks pre-rendered server-side, no loading flash
- **Check/uncheck** with applause sound on completion
- **Add tasks** inline with slide-in animation
- **Delete tasks** with exploding poof animation
- **Edit** via double-click or hamburger menu (text, time estimate, project)
- **Drag to reorder** with live displacement of other items
- **Time estimates** — `~15m` or `~1h` suffix, 8-hour day-end cutoff line
- **Info button** — Per-task popup showing project, estimate, status
- **Reminders** — Pin upcoming or recurring reminders with on-screen notifications
- **Project tags** displayed as subtle badges
- **Motivational quotes** rotating in the header
- **Live clock** in the header
- **Audio feedback** — Howler.js sounds for check, uncheck, drop, poof
- **PWA** — Installable with service worker
- **No scrollbar** — Clean notebook look, scroll still works

## Planning Meetings

Open the ThinkDone workspace folder in Claude Code. Say "let's start a planning meeting" and the AI runs through:

1. **Quick Wins** — clear the 5-minute stuff first to build momentum
2. **Blocker Scan** — what's stuck? who's waiting?
3. **Strategic Pulse** — are priorities right across all projects?
4. **Project Review** — rotate through 2-3 projects each meeting
5. **Today's Tasks** — build a prioritized flat list (25-35 items)

The dashboard launches automatically at `http://localhost:3456`. The meeting opens in its own window alongside the task list.

## Architecture

- **Astro SSR + Svelte islands** — Server-rendered pages, interactive components hydrated client-side
- **Tailwind v4** — Utility-first CSS with custom paper/pencil theme
- **Semantic Memory** — libsql + BGE-small-en-v1.5 (384-dim vectors), local-first with optional Turso sync
- **Markdown source of truth** — `today.md` is a flat checkbox list the dashboard reads/writes
- **Howler.js** — Audio sprites for interaction feedback
- **Cloudflare Pages** — Static home + boilerplate pages, SSR user pages behind auth

## Setup

```bash
cd xswarm-thinkdone
npm install
npm run setup    # Downloads embedding model (~100MB, first time only)
npm run dev      # Start dashboard at localhost:3456
```

## Scripts

| Command | Description | Time |
|---------|-------------|------|
| `npm run dev` | Astro dev server (port 3456) | — |
| `npm run build` | Production build | ~15s |
| `npm test` | TDD unit/integration tests | ~5s |
| `npm run test:e2e` | BDD/E2E tests (Playwright) | ~20s |
| `npm run lint` | ESLint + security rules | ~10s |
| `npm run security` | Secrets + deps + retire.js scan | ~15s |
| `npm run predeploy` | Full 8-step deploy pipeline | ~2min |
| `npm run deploy` | Deploy to Cloudflare Pages (Wrangler) | ~30s |

## Pre-Deploy Pipeline

`npm run predeploy` runs an automated 8-step pipeline:

1. **Version bump** (semver patch/minor/major)
2. **Lint** (eslint + eslint-plugin-security)
3. **Build** (astro build)
4. **SEO audit** (seo-analyzer on dist/ HTML)
5. **Security audit** — 5 scans:
   - Secrets detection (gitleaks)
   - Dependency vulnerabilities (npm audit)
   - Static analysis (eslint-plugin-security)
   - Known-vulnerable JS libraries (retire.js)
   - Frontend web vulnerability scan (is-website-vulnerable)
6. **Tests** (TDD unit + BDD/E2E)
7. **Commit & push** with semver tag
8. **Deploy** via Wrangler to Cloudflare Pages

## Memory CLI

ThinkDone remembers everything across sessions — decisions, blockers, commitments, patterns:

```bash
memory recall                          # Morning context
memory store "Ship v1 this week" \
  --type decision --project thinkdone  # Capture a decision
memory search "shipping timeline"      # Semantic search
memory recent --days 3                 # What happened recently
memory project thinkdone              # Everything about one project
memory supersede 42 "Ship next week"  # Update an outdated memory
memory consolidate                     # Weekly cleanup
memory stats                           # Health check
```

### Memory Types

| Type | Purpose |
|------|---------|
| `decision` | Choices made (with date context) |
| `blocker` | Things preventing progress |
| `status` | Current state of a project |
| `pattern` | Recurring observations |
| `dependency` | Cross-project dependencies |
| `commitment` | Promises with deadlines |
| `idea` | Future possibilities |
| `insight` | Lessons learned |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `THINKDONE_USER` | No | User ID (defaults to `default`) |
| `THINKDONE_USER_NAME` | No | Display name (defaults to `User`) |
| `THINKDONE_WORKSPACE` | No | Workspace path (defaults to parent dir) |
| `THINKDONE_DB` | No | Override DB path (defaults to `../.claude/memory.db`) |
| `THINKDONE_TURSO_URL` | No | Turso cloud sync URL for multi-device |
| `THINKDONE_TURSO_TOKEN` | No | Turso auth token |

## Roadmap

**Phase 1 (now):** Daily morning meetings + persistent memory + interactive dashboard + reminders + audio feedback + pre-deploy pipeline. Works via Claude Code/Cowork.

**Phase 2:** Browser-based planning meeting — task list on left, discussion on right. Realtime speech (S2S). Project icons for visual navigation. Shrink to pinned list after meeting.

**Phase 3:** MCP integrations — email, calendar, Slack, CRM. Your planning team acts on your behalf.

**Phase 4:** Multi-user with one-click auth, end-to-end encryption, team access controls, audit trails.

## License

MIT
