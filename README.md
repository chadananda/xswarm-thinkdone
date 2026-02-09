# ThinkDone.ai

**Your AI-powered todo list with a planning team built in.**

Imagine starting every morning with a personal coach, an executive assistant, a productivity expert, and a strategic planning team — all focused on making sure you progress on every front. That's ThinkDone.

You keep your projects and goals in simple markdown files. Each morning, ThinkDone reads everything, knows your full landscape, and runs a focused planning meeting: surfacing blockers, challenging your priorities, catching things slipping through the cracks, and picking the 3-5 actions that will move the needle most today.

Because **done is the engine of more.** Your planning now has a team of strategic thinkers making sure you get stuff done. Think Done!

## How It Works

1. Keep your projects and goals in a `plans/` folder (plain markdown)
2. Run your daily morning meeting (~15 min) with AI as your planning team
3. ThinkDone reads all your projects, flags what's stuck, challenges where you're spending time, and recommends today's priorities
4. Decisions, commitments, and patterns are remembered across sessions — nothing falls through the cracks

### Your Morning Meeting (~15 min)

1. **Quick Wins** — clear the 5-minute stuff so it stops taking up mental space
2. **Blocker Scan** — what's stuck? what's at risk? who's waiting on you?
3. **Strategic Pulse** — are priorities still right across all projects? are you spreading too thin?
4. **Today's Top 3-5** — specific actions, not vague goals. "Finish Stripe integration," not "work on billing."
5. **Promotion Pulse** — at least one marketing/growth action every single day
6. **Update Plans** — ThinkDone updates your project files and daily log

## Setup

```bash
cd xswarm-thinkdone
npm install
```

Create a `.env` in your workspace root (parent directory):

```
THINKDONE_DB=/path/to/ThinkDone.ai/memory.db
```

First-time setup (downloads the embedding model ~100MB):

```bash
npm run setup
```

## Memory CLI

ThinkDone remembers everything across sessions — decisions, blockers, commitments, patterns — so your planning team never loses context:

```bash
memory recall                          # Morning context — what your planning team needs to know
memory store "Ship v1 this week" \
  --type decision --project thinkdone  # Capture a decision
memory search "shipping timeline"      # Semantic search across all memories
memory recent --days 3                 # What happened recently
memory project thinkdone              # Everything about one project
memory supersede 42 "Ship next week"  # Update an outdated memory
memory consolidate                     # Weekly cleanup — deduplicate stale info
memory stats                           # Health check
```

### Memory Types

| Type | Purpose |
|------|---------|
| `decision` | Choices made (with date context) |
| `blocker` | Things preventing progress |
| `status` | Current state of a project |
| `pattern` | Recurring observations your planning team spots |
| `dependency` | Cross-project dependencies |
| `commitment` | Promises with deadlines |
| `idea` | Future possibilities |
| `insight` | Lessons learned |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `THINKDONE_DB` | Yes | Absolute path to the SQLite database file |
| `THINKDONE_TURSO_URL` | No | Turso cloud sync URL for multi-device |
| `THINKDONE_TURSO_TOKEN` | No | Turso auth token |

## Roadmap

**Phase 1 (now):** Daily morning meetings + persistent memory via Claude Code/Cowork. Your AI planning team learns your world and helps you get more done every day.

**Phase 2:** MCP integrations — email, calendar, Slack, CRM. Your planning team can now act on your behalf, not just advise.

**Phase 3:** End-to-end encryption, team access controls, audit trails. Enterprise-grade trust for organizations that want their own AI planning team.

## Development

```bash
npm test          # Integration tests (temp DB, no model download needed)
npm run setup     # Initialize DB + download embedding model
```
