# ThinkDone.ai

Your AI strategic planning assistant. Like GTD but with an expert personal assistant helping manage it.

ThinkDone runs daily morning meetings, manages priorities across your projects, flags blockers, tracks commitments, and helps you make smarter decisions about where to spend your time. It doesn't just manage tasks — it brings strategic perspective to your planning.

## How It Works

1. Keep project files in a `plans/` folder (markdown)
2. Run a daily morning meeting with Claude as your AI chief of staff
3. Claude reads all your projects, surfaces blockers, challenges your priorities, and recommends today's top 3-5 actions
4. Decisions, commitments, and patterns are stored in semantic memory so nothing gets lost between sessions

### Morning Meeting Agenda (~15 min)

1. **Quick Wins** — 5-minute tasks to clear the deck
2. **Blocker Scan** — what's stuck, what's at risk
3. **Strategic Pulse** — are priorities still right across all projects?
4. **Today's Top 3-5** — specific, actionable priorities
5. **Promotion Pulse** — at least one marketing/growth action daily
6. **Update Plans** — Claude updates project files and daily log

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

The `memory` command gives ThinkDone persistent recall across sessions:

```bash
memory recall                          # Morning context — blockers, commitments, decisions, patterns
memory store "Ship v1 this week" \
  --type decision --project thinkdone  # Store a decision
memory search "shipping timeline"      # Semantic search across all memories
memory recent --days 3                 # What happened recently
memory project thinkdone              # Everything about one project
memory supersede 42 "Ship next week"  # Update an outdated memory
memory consolidate                     # Weekly cleanup — deduplicate statuses/patterns
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
| `insight` | Learned lessons |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `THINKDONE_DB` | Yes | Absolute path to the SQLite database file |
| `THINKDONE_TURSO_URL` | No | Turso cloud sync URL for multi-device |
| `THINKDONE_TURSO_TOKEN` | No | Turso auth token |

## Roadmap

**Phase 1 (now):** Morning meetings + semantic memory via Claude Code/Cowork
**Phase 2:** MCP integrations — email, calendar, Slack, CRM. ThinkDone becomes an AI chief of staff that can act, not just plan.
**Phase 3:** End-to-end encryption, team access controls, audit trails. Enterprise-grade trust.

## Development

```bash
npm test          # Integration tests (temp DB, no model download needed)
npm run setup     # Initialize DB + download embedding model
```
