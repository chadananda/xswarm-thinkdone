# ThinkDone.ai

**Your AI-powered todo list with a planning team built in.**

Imagine starting every morning with a personal coach, an executive assistant, a productivity expert, and a strategic planning team — all focused on making sure you progress on every front. That's ThinkDone.

You keep your projects and goals in simple markdown files. Each morning, ThinkDone reads everything, knows your full landscape, and runs a focused planning meeting: surfacing blockers, challenging your priorities, catching things slipping through the cracks, and building a prioritized task list for the day.

Because **done is the engine of more.** Think → Done!

## How It Works

1. Keep your projects and goals in a `plans/` folder (plain markdown)
2. Run your daily morning meeting (~15 min) with AI as your planning team
3. ThinkDone reads all your projects, flags what's stuck, challenges where you're spending time, and builds a prioritized flat task list
4. Pin the interactive dashboard to your monitor — check off tasks, drag to reprioritize, add new ones on the fly
5. Decisions, commitments, and patterns are remembered across sessions — nothing falls through the cracks

### Architecture

- **Astro + Svelte** — Interactive dashboard with server-side API routes
- **Tailwind CSS** — Centralized color variables for easy theming
- **Semantic Memory** — libsql + BGE-small-en-v1.5 embeddings for cross-session context
- **Markdown Source of Truth** — `today.md` is a flat checkbox list that the dashboard reads/writes
- **Project Tagging** — Tasks tagged with `— projectname` for cross-project tracking

### Dashboard Features

Inspired by Basecamp's classic Ta-da list:
- Check/uncheck tasks (celebration sound on completion)
- Add new tasks inline
- Delete tasks
- Double-click to edit inline
- Drag to reorder (position = priority)
- Completed items float to top (grayed, struck through)
- Project tags displayed as subtle badges
- 3-second auto-refresh
- Paper/pencil aesthetic on architect's graph paper

## Using with Claude Code / Cowork

Open the ThinkDone workspace folder in Claude Code or Cowork. Say "let's start a planning meeting" and the AI runs through:

1. **Quick Wins** — clear the 5-minute stuff
2. **Blocker Scan** — what's stuck? who's waiting?
3. **Strategic Pulse** — are priorities right?
4. **Project Review** — rotate through projects each meeting
5. **Today's Tasks** — build the prioritized task list (25-35 items)

The dashboard launches automatically at `http://localhost:3456`.

## Setup

```bash
cd xswarm-thinkdone
npm install
npm run setup    # Downloads embedding model (~100MB, first time only)
npm run dev      # Start dashboard at localhost:3456
```

## Development

```bash
npm run dev       # Astro dev server with hot reload
npm run build     # Production build
npm run preview   # Preview production build
npm test          # Memory CLI integration tests
```

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
| `THINKDONE_DB` | No | Override DB path (defaults to `../.claude/memory.db`) |
| `THINKDONE_TURSO_URL` | No | Turso cloud sync URL for multi-device |
| `THINKDONE_TURSO_TOKEN` | No | Turso auth token |

## Roadmap

**Phase 1 (now):** Daily morning meetings + persistent memory + interactive dashboard via Claude Code/Cowork.

**Phase 2:** MCP integrations — email, calendar, Slack, CRM. Your planning team acts on your behalf.

**Phase 3:** End-to-end encryption, team access controls, audit trails. Enterprise-grade.
