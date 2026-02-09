# xswarm-thinkdone

Semantic memory CLI for [ThinkDone.ai](https://thinkdone.ai) — a strategic planning assistant that runs daily morning meetings via markdown files and persistent project memory.

## Install

```bash
npm install
```

Create a `.env` in your ThinkDone.ai workspace root (the parent directory):

```
THINKDONE_DB=/path/to/ThinkDone.ai/memory.db
```

First-time setup (downloads the embedding model ~100MB):

```bash
npm run setup
```

## Usage

```bash
# Morning context loader — surfaces blockers, commitments, decisions, patterns
memory recall

# Store a memory
memory store "Decided to ship v1 this week" --type decision --project thinkdone

# Semantic search
memory search "shipping timeline" -n 5

# Recent memories
memory recent --days 3

# Project-specific memories
memory project thinkdone

# Supersede an outdated memory
memory supersede 42 "Updated: shipping next week instead" --type decision

# Weekly compression — consolidates duplicate statuses/patterns
memory consolidate

# Health check
memory stats
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
| `THINKDONE_TURSO_URL` | No | Turso cloud sync URL |
| `THINKDONE_TURSO_TOKEN` | No | Turso auth token |

## Morning Meeting Workflow

1. Run `memory recall` to load context
2. Review blockers and commitments
3. Claude reads project files from `plans/`
4. Discuss priorities, make decisions
5. Store new decisions/statuses: `memory store "..." --type decision`
6. Update daily log

See `plans/meta/MORNING-MEETING.md` for the full protocol.

## Development

```bash
npm test          # Run integration tests (uses temp DB, no model required)
npm run setup     # Initialize DB + download embedding model
```
