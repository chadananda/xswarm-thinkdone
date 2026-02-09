# Technical Roadmap

## Phase 1: CLI + Morning Meetings (Current)

Single-file semantic memory CLI powering daily planning sessions via Claude Code/Cowork.

### Delivered
- Store/search/recall memories with BGE-small embeddings
- 8 memory types with supersession model
- Morning context loader (`recall`) surfaces blockers, commitments, decisions, patterns
- Project-scoped memory queries
- Weekly consolidation to prevent memory bloat
- Local libsql with optional Turso cloud sync

### Remaining
- `--format json` output for programmatic consumption
- `resolve <id>` command (mark blocker as resolved without replacement)
- `review` command (weekly review helper — stale projects, overdue commitments)
- Shell completion script
- `npx` support (publish to npm)

## Phase 2: MCP Integrations

Expose memory operations as MCP tools so Claude can read/write memories during conversations without CLI invocation.

### Planned
- MCP server wrapping existing CLI commands
- `memory_store` / `memory_search` / `memory_recall` tools
- Email MCP integration — surface relevant memories when drafting emails
- Calendar MCP — connect commitments to calendar events
- Slack MCP — capture decisions from Slack threads

## Phase 3: Security & Encryption

Enterprise-grade memory storage for sensitive planning data.

### Planned
- At-rest encryption for local DB (SQLCipher or application-layer)
- Per-project access controls
- Audit log for all memory operations
- On-premise deployment guide
- SOC 2 compliance documentation
