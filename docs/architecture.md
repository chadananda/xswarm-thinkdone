# Architecture

## Overview

xswarm-thinkdone is a single-file CLI (`src/memory.js`) that provides semantic memory storage and retrieval for daily planning sessions. It uses local-first SQLite with optional Turso cloud sync.

## Stack

- **Database:** libsql (SQLite fork with vector extensions)
- **Embeddings:** BGE-small-en-v1.5 via `@huggingface/transformers` (384 dimensions, ~33M params)
- **Runtime:** Node.js (ESM)

## Schema

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  project TEXT DEFAULT '',
  type TEXT DEFAULT 'insight',
  created_at TEXT NOT NULL,
  superseded_by INTEGER DEFAULT NULL,
  embedding F32_BLOB(384)
);

CREATE INDEX memories_idx ON memories (
  libsql_vector_idx(embedding, 'compress_neighbors=float8', 'max_neighbors=50')
);
```

## Embedding Model

- **Model:** `Xenova/bge-small-en-v1.5`
- **Dimensions:** 384 (F32)
- **Pooling:** CLS token
- **Normalization:** L2
- **Download size:** ~100MB (cached after first run)
- **Pipeline:** `feature-extraction` via `@huggingface/transformers`

The model is loaded lazily on first use and cached for subsequent calls within the same process.

## Vector Search

Uses libsql's built-in `vector_top_k` function with the HNSW index. Searches retrieve `n*3` candidates (max 100) then filter and slice to `n` results. Superseded memories are excluded by default.

## Memory Type Semantics

| Type | Lifecycle | Use |
|------|-----------|-----|
| `decision` | Permanent (time-stamped) | Choices made — the "why" record |
| `blocker` | Active until superseded | Things preventing progress |
| `status` | Active (latest wins) | Current state — consolidated weekly |
| `pattern` | Active (latest wins) | Recurring observations — consolidated weekly |
| `dependency` | Active until superseded | Cross-project ordering constraints |
| `commitment` | Active until superseded | Promises with deadlines |
| `idea` | Permanent | Future possibilities to revisit |
| `insight` | Permanent | Lessons learned |

## Supersession Model

Memories are never deleted. When a memory becomes outdated, a new memory is stored and the old one's `superseded_by` field points to the replacement. The `recall` command only shows active (non-superseded) memories. `consolidate` auto-supersedes duplicate statuses and patterns per project, keeping only the newest.

## Database Location

The DB file lives in the user's workspace (outside the git repo) and is referenced via `THINKDONE_DB` env var. Default fallback resolves to `../../memory.db` relative to `src/memory.js`, which places it at the ThinkDone workspace root.

## Turso Sync (Optional)

When `THINKDONE_TURSO_URL` and `THINKDONE_TURSO_TOKEN` are set, libsql operates in embedded-replica mode: reads from local SQLite, writes sync to Turso cloud. This enables multi-device access while keeping local-first latency.
