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

## Phase 3: Security & End-to-End Encryption

Zero-knowledge architecture where the server never sees user data in plaintext. Admins cannot access user plans, memories, or decisions — even with full database access.

### Authentication + Encryption Strategy

**Authentication:** Google One-Tap login for identity. Google provides user identity (ID token with stable `sub` claim) but no client-side-only secret — so authentication and encryption are separate concerns.

**Client-side encryption key:**
1. On first login, generate a 256-bit AES key via Web Crypto API
2. Store in IndexedDB for zero-friction daily use (no passphrase to type)
3. All data encrypted/decrypted client-side before touching the server
4. Server only ever stores encrypted blobs

**Recovery key flow:**
1. During onboarding, present recovery key (base64 string or word phrase)
2. User saves to password manager or writes down
3. New device login: paste recovery key once, back to automatic
4. Lost key = unrecoverable data (true zero-knowledge tradeoff)

**XSS considerations:**
- localStorage is readable by any JS on the origin — XSS = key theft
- Prefer IndexedDB with a non-extractable `CryptoKey` — browser allows encrypt/decrypt operations but won't expose raw key bytes to scripts
- Non-extractable keys can't be exported for backup, so store a separate exportable copy or derive both keys from the same recovery key
- Defense in depth: CSP headers, subresource integrity, minimal third-party JS

### Planned
- Client-side AES-256-GCM encryption of all user content
- Web Crypto API key generation and IndexedDB storage
- Recovery key onboarding flow
- Per-project access controls (encrypted key sharing)
- Audit log for all operations (metadata only — content stays encrypted)
- On-premise deployment guide
- SOC 2 compliance path
