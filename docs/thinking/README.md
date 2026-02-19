# Think→Done: Assistant Soul Concept

> A proactive AI strategic partner that thinks while you sleep, prepares while you wake, and executes while you work. Local-first, encrypted, and deeply personal.

---

## 1. Vision

Think→Done is not a task manager. It is a **strategic mind** — a personal chief of staff that understands your goals, tracks your commitments, researches opportunities, prepares you for every meeting, nudges your habits, and compounds its effectiveness over time by learning what works for you specifically.

The core promise: **You will never walk into a meeting unprepared, forget a birthday, lose track of a commitment, or wonder "what should I work on next?" again.**

### Design Philosophy

- **Conversational, not form-driven.** You talk. The assistant extracts structure. No calendar UIs, no task entry forms, no settings pages.
- **Local-first, cloud-synced.** Your mind lives on your device, encrypted with a key only you know. Cloud sync is passive — for multi-device continuity, not for our access.
- **Boring stack.** libSQL, vanilla JS, simple tables. No ORM, no framework churn, no dependency sprawl.
- **Context is sacred.** Every byte in the LLM's context window earns its place. Aggressive compression, smart retrieval, ruthless pruning.
- **Zero-knowledge by design.** We cannot read your data. Not "we promise not to" — we architecturally cannot.

---

## 2. Architecture Overview

Eight engines working in concert, backed by a single encrypted database. Processing happens across **four tiers** — from free local logic to premium overnight strategy.

```
┌─────────────────────────────────────────────────────┐
│                   USER DEVICE                        │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Conversation │  │  Heartbeat   │  │  Memory   │  │
│  │    Engine    │  │   Engine     │  │  Engine   │  │
│  │  (morning    │  │  (nudges,    │  │ (compress,│  │
│  │   meeting,   │  │   alerts,    │  │  prune,   │  │
│  │   ad-hoc)    │  │   reminders) │  │  retrieve)│  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                │         │
│  ┌──────┴─────────────────┴────────────────┴──────┐  │
│  │         Encrypted libSQL (OPFS/local)          │  │
│  │         PIN-derived AES-256-GCM key            │  │
│  └──────────────────┬─────────────────────────────┘  │
│                     │ passive sync (encrypted pages)  │
└─────────────────────┼────────────────────────────────┘
                      │
              ┌───────┴────────┐
              │  Turso Cloud   │
              │  (encrypted    │
              │   replica)     │
              └───────┬────────┘
                      │
┌─────────────────────┼────────────────────────────────┐
│              SERVER (Cloudflare Workers)              │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  Sleep-Time  │  │   Research   │  │   GTD     │  │
│  │   Engine     │  │   Engine     │  │  Engine   │  │
│  │  (overnight  │  │  (web search,│  │ (projects,│  │
│  │   strategy,  │  │   competitor │  │  actions, │  │
│  │   briefings) │  │   intel)     │  │  reviews) │  │
│  └──────────────┘  └──────┬───────┘  └───────────┘  │
│                           │                          │
│  ┌────────────────────────┴───────────────────────┐  │
│  │            Thinking Queue                       │  │
│  │  (event-driven micro-batches throughout the day │  │
│  │   — the "always-on brain" between conversations)│  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Processing Tiers

The system processes work across four cost tiers, from free to premium:

```
TIER 0: LOCAL LOGIC (free)
  Heartbeat checks, streak calculation, notification display
  Pure JS + SQL, zero API calls
  Runs: every 15-30 min on device

TIER 1: IMMEDIATE (during conversation)
  Interactive chat, inline research, real-time strategy
  Haiku/Sonnet with prompt caching
  Runs: when user is actively talking

TIER 2: THINKING QUEUE (event-driven, throughout the day)
  Triggered by state changes, not timers
  Haiku micro-batches on the server
  Runs: when meaningful events accumulate (see §7A)

TIER 3: OVERNIGHT BATCH (3-4 AM, Batch API at 50% off)
  Memory consolidation, full strategic analysis, weekly review
  Heaviest processing, lowest cost per token
  Runs: once nightly
```

### Engine Responsibilities

| Engine | Tier | Trigger | Function |
|--------|------|---------|----------|
| **Conversation** | 1 | User-initiated | Morning meeting, status updates, ad-hoc questions, inline research |
| **Heartbeat** | 0 | Timer (15–30 min) | Condition checks, display pre-generated notifications, queue thinking events |
| **Memory** | 0-3 | Every interaction | Compress, retrieve, prune, consolidate. Manages context budget |
| **Thinking Queue** | 2 | Event-driven | Micro-batch processing: re-prioritize, connect dots, quick research, prep |
| **Sleep-Time** | 3 | Nightly cron | Strategic analysis, full meeting prep, memory consolidation, weekly review |
| **Research** | 1-3 | Multi-tier | Immediate (in conversation), queued (thinking queue), or deep (overnight) |
| **GTD** | 2-3 | Events + weekly | Projects → next actions, weekly review, context-based task surfacing |
| **Routines** | 0-2 | Daily check | Habits, reminders, events, birthdays, religious calendar, prep chains |

---

## 3. Database Schema

Seven tables. That's it. Proven by prototype (xswarm-thinkdone memory.js), extended for full assistant capabilities, plus `usage_log` for token economics and `thinking_queue` for event-driven processing.

### 3.1 `memories` — The Universal Knowledge Store

Everything the assistant knows lives here. One table, typed, vector-indexed, with a superseding chain for versioning. No separate tables for beliefs, entities, discoveries — they're all memory types.

```sql
CREATE TABLE memories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content         TEXT NOT NULL,           -- Level 1: full natural language
  compressed      TEXT DEFAULT NULL,       -- Level 2: pipe-delimited shorthand
  project         TEXT DEFAULT '',         -- project tag (empty = general)
  person          TEXT DEFAULT '',         -- person tag (empty = none)
  type            TEXT DEFAULT 'insight',  -- see type taxonomy below
  source          TEXT DEFAULT 'manual',   -- manual|conversation|agent|sleep_time
  priority        INTEGER DEFAULT 0,       -- 0=normal, 1=high, -1=low
  created_at      TEXT NOT NULL,
  expires_at      TEXT DEFAULT NULL,       -- optional TTL for transient memories
  superseded_by   INTEGER DEFAULT NULL,    -- points to newer version (NULL = active)
  embedding       F32_BLOB(384)            -- BGE-small-en-v1.5 via transformers.js
);
-- Vector similarity index
CREATE INDEX memories_vec_idx ON memories (
  libsql_vector_idx(embedding, 'compress_neighbors=float8', 'max_neighbors=50')
);
-- Fast lookups
CREATE INDEX memories_type_idx ON memories (type, superseded_by);
CREATE INDEX memories_project_idx ON memories (project, superseded_by);
CREATE INDEX memories_person_idx ON memories (person, superseded_by);
```

#### Memory Type Taxonomy

**Actionable (surface in morning meeting):**
- `blocker` — Something preventing progress. Auto-surfaces until resolved.
- `commitment` — Something promised to someone. Tracks accountability.
- `waiting_for` — Something someone promised to you. Includes who + when due.
- `follow_up` — Action needed but not urgent. Surfaces based on timing.

**Strategic (informs reasoning):**
- `decision` — A choice made. Prevents re-litigating. Time-decays from active context after 7 days.
- `pattern` — Observed recurring behavior or insight. The assistant's "beliefs."
- `status` — Current state of a project/person/situation. Superseded frequently.
- `dependency` — X requires Y. Informs sequencing.

**Informational (retrieved on demand):**
- `insight` — General observation worth remembering.
- `idea` — Unprocessed thought. Awaits triage.
- `discovery` — Research finding from sleep-time engine. Includes source URL.
- `meeting_note` — Key points from a meeting. Linked to a conversation.
- `person_fact` — Birthday, role, relationship, preference. Tagged with `person` field.
- `calendar_extract` — Event extracted from conversation. Becomes a routine.

#### The Superseding Chain

Never delete. Always supersede. This preserves history while keeping the active set clean.

```
#12 status [ocean-of-lights]: "Editorial workflow is manual, 3 editors"
#47 status [ocean-of-lights]: "Editorial workflow v2 deployed, AI-assisted" (supersedes #12)
#89 status [ocean-of-lights]: "Editorial workflow stable, processing 40 articles/week" (supersedes #47)
```

Active query: `WHERE superseded_by IS NULL`
History query: Follow the `superseded_by` chain backward from any active memory.

### 3.2 `routines` — Calendar, Habits, Reminders, Events

Unified time-awareness system. No external calendar dependency. The assistant IS your calendar.

```sql
CREATE TABLE routines (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  description       TEXT DEFAULT NULL,
  kind              TEXT NOT NULL DEFAULT 'habit',
  -- kind: habit | reminder | event | meeting | deadline
  frequency         TEXT NOT NULL DEFAULT 'daily',
  -- frequency: daily | weekdays | weekends | weekly | monthly | yearly | once
  days              TEXT DEFAULT NULL,          -- JSON: ["mon","wed","fri"]
  time_slot         TEXT DEFAULT 'anytime',     -- morning | midday | evening | anytime
  specific_time     TEXT DEFAULT NULL,          -- "14:30" for meetings/appointments
  project           TEXT DEFAULT '',
  person            TEXT DEFAULT '',
  minutes           INTEGER DEFAULT 15,
  active            INTEGER DEFAULT 1,
  remind_before     INTEGER DEFAULT 0,          -- days of advance notice
  target_date       TEXT DEFAULT NULL,           -- YYYY-MM-DD for events/deadlines
  preparation_steps TEXT DEFAULT NULL,           -- JSON: ["research gift","order gift","write card"]
  preparation_state TEXT DEFAULT NULL,           -- JSON: tracks step completion
  recurrence_end    TEXT DEFAULT NULL,           -- stop recurring after this date
  notes             TEXT DEFAULT NULL,
  last_reminded     TEXT DEFAULT NULL,           -- prevent duplicate nudges
  -- Atomic Habits: The Four Laws
  identity          TEXT DEFAULT NULL,           -- "I am someone who learns Arabic daily"
  cue               TEXT DEFAULT NULL,           -- "After morning coffee" / "When I sit at my desk"
  craving           TEXT DEFAULT NULL,           -- "I want to feel connected to the Writings"
  reward            TEXT DEFAULT NULL,           -- "Mark streak + 5 min podcast"
  two_min_version   TEXT DEFAULT NULL,           -- "Open the Arabic app and read one sentence"
  -- Habit stacking & bundling
  stack_after       INTEGER DEFAULT NULL,        -- routine_id: do THIS after completing THAT
  bundle_with       TEXT DEFAULT NULL,           -- temptation bundle: "while listening to podcast"
  -- Progression
  difficulty        INTEGER DEFAULT 1,           -- 1-5, can increase as habit solidifies
  goal_quantity     REAL DEFAULT NULL,           -- target amount (pages, minutes, reps)
  goal_unit         TEXT DEFAULT NULL,           -- "pages" | "minutes" | "reps" | "words"
  -- Metadata
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
```

#### Kind Behaviors

| Kind | Surfaces as | Streak tracked | Prep chain | Example |
|------|-------------|----------------|------------|---------|
| `habit` | Task in daily plan | Yes | No | "Arabic practice ~30m" |
| `reminder` | Conversational mention | No | Optional | "Call plumber before Friday" |
| `event` | Conversational + prep | No | Yes | "Mom's birthday March 15" |
| `meeting` | Briefing generated | No | Yes (auto) | "DRBI board meeting, 1st Saturday" |
| `deadline` | Urgent task | No | Optional | "Grant application due March 1" |

#### Frequency Patterns (No RRULE Needed)

```
daily       → every day
weekdays    → mon–fri
weekends    → sat–sun
weekly      → specific days via `days` field: ["tue","thu"]
monthly     → target_date day-of-month (e.g., "2025-01-15" → every 15th)
yearly      → target_date month-day (e.g., "1960-03-15" → every Mar 15)
once        → fire once, then deactivate
```

This covers every real personal scheduling need without RFC 5545 complexity.

### 3.3 `completions` — Habit Tracking, Streaks & Progression

```sql
CREATE TABLE completions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id      INTEGER NOT NULL,
  completed_date  TEXT NOT NULL,       -- YYYY-MM-DD
  completed_at    TEXT NOT NULL,       -- ISO timestamp
  notes           TEXT DEFAULT NULL,   -- optional reflection ("felt easier today")
  quality         INTEGER DEFAULT NULL, -- 1-5 self-rating (optional)
  quantity        REAL DEFAULT NULL,   -- actual amount done (pages read, minutes practiced)
  used_two_min    INTEGER DEFAULT 0,   -- 1 if completed the two-minute version only
  skipped_reason  TEXT DEFAULT NULL,   -- if missed: why? (tracked for pattern analysis)
  FOREIGN KEY (routine_id) REFERENCES routines(id)
);
CREATE INDEX completions_routine_idx ON completions (routine_id, completed_date);
CREATE INDEX completions_date_idx ON completions (completed_date);
```

Streak calculation walks backward from today, respecting the routine's frequency pattern. A weekday habit doesn't break its streak on Saturday. The `used_two_min` flag tracks gateway completions — they count for the streak (don't break the chain!) but are flagged separately for trend analysis.

### 3.4 `conversations` — Session History

```sql
CREATE TABLE conversations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_type  TEXT DEFAULT 'chat',  -- morning_meeting | check_in | chat | reflection
  started_at    TEXT NOT NULL,
  ended_at      TEXT DEFAULT NULL,
  summary       TEXT DEFAULT NULL,    -- compressed session summary (generated at end)
  key_decisions TEXT DEFAULT NULL,    -- JSON: extracted decisions from this session
  mood          TEXT DEFAULT NULL,    -- agent's read on user's energy/mood
  memories_created TEXT DEFAULT NULL  -- JSON: IDs of memories created during session
);
```

At session end, the Memory Engine summarizes the conversation, extracts any decisions/commitments/tasks mentioned, and stores them as memories. The conversation summary itself becomes searchable context for future sessions.

### 3.5 `personality` — The SOUL

```sql
CREATE TABLE personality (
  id          INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton
  soul        TEXT NOT NULL,       -- markdown: who the assistant IS
  style       TEXT DEFAULT NULL,   -- communication preferences learned over time
  disposition TEXT DEFAULT NULL,   -- JSON: strategic tendencies and calibrations
  updated_at  TEXT NOT NULL
);
```

The SOUL is a markdown document that defines the assistant's identity. Unlike a system prompt (which tells the model what to do), the SOUL tells it who to be.

### 3.6 `usage_log` — Token Economics Tracking

```sql
CREATE TABLE usage_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL,           -- YYYY-MM-DD
  engine        TEXT NOT NULL,           -- conversation | sleep_time | research | gtd
  model         TEXT NOT NULL,           -- haiku-4.5 | sonnet-4.5
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_write   INTEGER DEFAULT 0,
  cache_read    INTEGER DEFAULT 0,
  batch         INTEGER DEFAULT 0,       -- 1 if via Batch API
  cost_cents    INTEGER DEFAULT 0,       -- computed cost in cents (for budget checks)
  created_at    TEXT NOT NULL
);
CREATE INDEX usage_date_idx ON usage_log (date, engine);
```

Tracks every API call for per-user daily budgeting, cost alerting, and degradation decisions. See §17.13 for the cost guardrail system.

#### Default SOUL Template

```markdown
# Think→Done — Your Strategic Partner

## Identity
I am a strategic thinking partner — part chief of staff, part research analyst,
part accountability coach. I think in systems, plan in sequences, and communicate
with clarity and warmth.

## Values
- Honesty over comfort. I tell you what you need to hear.
- Action over analysis. Planning is only valuable if it leads to doing.
- Compounding over sprinting. Small consistent progress beats heroic efforts.
- Context over completeness. I surface what matters now, not everything I know.

## How I Work
- Morning meetings: I come prepared. I know your schedule, your blockers,
  your streaks, and what you committed to yesterday.
- Throughout the day: I stay quiet unless something matters. No noise.
- Overnight: I think about your projects, research opportunities, prepare
  briefings, and consolidate what I've learned.

## Communication Style
- Direct and concise. No filler.
- I use questions to sharpen thinking, not to stall.
- I celebrate progress genuinely but briefly.
- I push back when you're overcommitting or avoiding something important.

## What I Track
- Every commitment you make to someone (and they make to you)
- Every decision and its context (so you don't re-litigate)
- Patterns in your productivity, energy, and effectiveness
- Your goals, and whether daily actions are aligned with them
```

The SOUL evolves. The `disposition` field tracks calibrations like:
```json
{
  "nudge_style": "direct",
  "habit_framing": "progress-focused",
  "suggestion_acceptance_rate": 0.72,
  "preferred_morning_meeting_length": "5-8 min",
  "responds_well_to": ["competitive framing", "data-backed suggestions"],
  "responds_poorly_to": ["guilt-based nudges", "excessive options"]
}
```

These calibrations update automatically based on which suggestions you accept vs. dismiss.

---

## 4. Memory Engine — Context Protection

The Memory Engine is the most critical subsystem. It determines what the assistant knows at any given moment and ensures the LLM's context window is used with maximum efficiency.

### 4.1 Three-Level Compression

Every memory exists in up to three representations:

**Level 0 — Raw.** The original conversation or source text. Stored in `conversations.summary` or referenced by `memories.source`. Never loaded into LLM context directly (except current session).

**Level 1 — Narrative.** Self-contained natural language fact. Stored in `memories.content`. Used by the Sleep-Time Engine for strategic reasoning (where token cost matters less than comprehension).

```
Dr. Habib Riazati leads the Ocean of Lights academic research team.
Chad has been collaborating with him since 2023. Last contact was
January 28, 2026. He was supposed to send the updated tablet catalog
schema by February 3 but hasn't yet. Prefers email, Pacific timezone.
```

**Level 2 — Compressed.** Pipe-delimited shorthand optimized for LLM comprehension at minimum token cost. Stored in `memories.compressed`. This is what gets injected into the Conversation Engine's system prompt.

```
PERSON:Habib_Riazati|scholar|OceanOfLights_lead|since:2023|
last:Jan28|WAITING:tablet_schema(due:Feb3,overdue)|pref:email|tz:Pacific
```

**Level 3 — Index.** Just the type, project, person, and recency score. Used for retrieval decisions: "Is this memory relevant to the current conversation?" Not stored — computed at query time from table indexes.

### 4.2 Compression Encoding Convention

The system prompt includes a decoder ring so the LLM can read compressed memories:

```
MEMORY ENCODING:
- PERSON:name|role|org|key_facts
- PROJECT:name|status(active/paused/done)|goal|blockers|next
- TASK:desc|project|context(@computer/@phone/@errand)|energy(hi/med/lo)|due|est
- EVENT:title|datetime|type|prep_status
- PATTERN:observation|confidence(0-1)|evidence_count
- WAITING:desc|person|due|status(pending/overdue/received)
- BLOCKER:desc|project|severity(hard/soft)|since
- COMMITMENT:desc|to_person|due|status
- Dates: Mon/Tue (this week), Jan15 (this month), 2026-03 (distant)
- Status: ✓done ⚠pending ✗overdue ◌upcoming →delegated
```

### 4.3 Context Budget

Every conversation turn gets a fixed token budget for memory injection. The budget degrades gracefully as the conversation grows.

```
TOTAL CONTEXT ALLOCATION: ~20K tokens for memory

Priority 1 — Always loaded (est. ~4K tokens):
  Active blockers (all)
  Active commitments (all)
  Active waiting_for (all)
  Today's routines (due + upcoming)

Priority 2 — Focus-derived (est. ~4K tokens):
  Project summaries for focus projects
    (focus = projects mentioned in blockers/commitments/today's meetings)
  Person facts for people in today's meetings
  Recent decisions (7 days) for focus projects

Priority 3 — Contextually retrieved (est. ~4K tokens):
  Top-K vector search results for current conversation topic
  Relevant patterns and dependencies
  Recent discoveries for focus projects

Priority 4 — Background (est. ~2K tokens, shed first):
  Non-focus project summaries
  General patterns
  Ideas awaiting triage

DEGRADATION STRATEGY:
  As conversation grows beyond ~50K tokens:
    1. Drop Priority 4 entirely
    2. Compress Priority 3 further (Level 2 → even shorter)
    3. Reduce Priority 2 to top-3 focus projects only
    4. Priority 1 is never shed
```

### 4.4 Memory Lifecycle

```
CREATION:
  User says something → Conversation Engine detects memorable content
    → Stores as Level 1 (content) with type + project + person tags
    → Generates embedding via local transformers.js (BGE-small-en-v1.5)
    → Queues Level 2 compression (async, or during next consolidation)

RETRIEVAL:
  Context builder runs at conversation start and periodically during long sessions
    → Loads Priority 1–4 per budget
    → Uses Level 2 (compressed) when available, Level 1 as fallback
    → Injects as structured prefix in system prompt

EVOLUTION:
  New information supersedes old:
    → New memory created with updated content
    → Old memory's superseded_by set to new ID
    → Only unsuperseded memories appear in active context

CONSOLIDATION (nightly or weekly):
  Sleep-Time Engine reviews active memories:
    → Merges redundant status updates into single current-state summary
    → Generates Level 2 compressed forms for any memories missing them
    → Identifies stale memories (no relevance in 30+ days) and marks low-priority
    → Synthesizes related insights into higher-order patterns

PRUNING:
  Aggressive but reversible:
    → Memories with expires_at in the past are superseded by a summary
    → Projects marked inactive: their memories get compressed into a single archive note
    → Superseded chains longer than 5 are trimmed (keep first + last 2)
    → Target: active memory count stays under 500 for fast recall
```

### 4.5 Embedding & Vector Search

All embeddings are generated client-side using `@xenova/transformers` (ONNX WebAssembly). The model (BGE-small-en-v1.5, 384 dimensions) runs in a Web Worker. No embedding data ever leaves the device.

libSQL's built-in `vector_top_k` function handles similarity search directly in SQLite:

```sql
SELECT m.id, m.content, m.compressed, m.type, m.project
FROM vector_top_k('memories_vec_idx', vector(?), 20) AS v
JOIN memories AS m ON m.rowid = v.id
WHERE m.superseded_by IS NULL
```

This enables the "smart retrieval" in Priority 3 — when the user mentions a topic, the engine finds the most semantically relevant memories regardless of how they were tagged.

---

## 5. Encryption & Privacy

### 5.1 Threat Model

**Protected against:**
- SaaS operator (us) reading user data — we never have the key
- Infrastructure breach exposing databases — encrypted at rest
- Stolen device — local DB encrypted, PIN required
- Government subpoena — we literally cannot decrypt

**Disclosed limitations:**
- LLM API calls send decrypted context to Anthropic for processing
- We minimize what's sent (context budget) but can't eliminate this
- Users are informed of this boundary clearly during onboarding

### 5.2 PIN → Key Derivation

```
User creates 10-digit numeric PIN during onboarding
  → Browser generates random 128-bit salt (stored in account metadata, public)
  → PBKDF2(PIN, salt, 600,000 iterations, SHA-256) → 256-bit AES key
  → Key used as libSQL encryptionKey parameter
  → Key exists ONLY in browser memory, never transmitted, never stored on disk
```

```javascript
// Key derivation using Web Crypto API
const deriveKey = async (pin, salt) => {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
```

### 5.3 Database Encryption

```javascript
// Local encrypted database
const db = createClient({
  url: 'file:thinkdone.db',   // OPFS in browser, file on disk for CLI
  encryptionKey: derivedKey,   // from PIN, never leaves device
})
```

libSQL encrypts at the page level (SQLCipher-compatible). Individual pages are encrypted independently — no need to decrypt the entire file to read one record.

### 5.4 Cloud Sync Architecture

```
LOCAL (device)                    CLOUD (Turso)
┌───────────────────┐            ┌───────────────────┐
│ libSQL encrypted  │  ──sync──► │ Turso replica     │
│ with user's PIN   │  ◄──sync── │ server-managed    │
│ key               │            │ encryption         │
└───────────────────┘            └───────────────────┘
                                          │
                                          ▼
                                 ┌───────────────────┐
                                 │ Sleep-Time Engine  │
                                 │ (reads/writes      │
                                 │  cloud replica)    │
                                 └───────────────────┘
```

**The honest disclosure:**
- Local device: encrypted with your PIN. We cannot access it. Period.
- Cloud replica: encrypted with per-user server-managed keys. Our Sleep-Time Engine can access it to do overnight processing (research, briefings, strategy). We build access controls and audit logs to ensure no human accesses it, but we are technically capable.
- Future: migrate to TEE-based processing where even server-side code can't exfiltrate the data.

### 5.5 Session Flow

```
1. User opens app → standard auth (email/OAuth)
2. App prompts for 10-digit PIN
3. Browser derives AES-256 key from PIN + stored salt
4. Opens encrypted local libSQL database
5. If wrong PIN → database is unreadable → immediate feedback
6. On success → Turso sync pulls latest from cloud
7. Session active — all reads/writes to local encrypted DB
8. Periodic background sync pushes changes to cloud
9. On close → key discarded from memory
```

**Recovery:** None. If you lose your PIN, your local data is unrecoverable. Cloud data can be re-keyed during a guided recovery flow (requires email verification + new PIN), but this is a deliberate friction point — security over convenience.

**Biometric unlock:** On mobile, the PIN can be stored in the device's secure enclave (Face ID / Touch ID). The PIN never enters app memory — the secure enclave handles decryption directly.

---

## 6. The Morning Meeting

The flagship interaction. This is where the assistant earns its keep every single day.

### 6.1 Flow

```
USER OPENS APP → PIN → ENCRYPTED DB OPENS → CONTEXT LOADS

ASSISTANT (pre-loaded with full context):

"Good morning, Chad. It's Tuesday, February 11.

SCHEDULE:
  11:00 — Call with Gilbert re: Immersive Ocean restructuring
    → Briefing ready. One open action item (summer curriculum draft).
  4:00 — Arabic lesson

BLOCKERS:
  ⚠ Dr. Riazati's tablet schema is 8 days overdue.
    Want me to draft a follow-up?

COMMITMENTS (yours):
  ✗ Summer curriculum draft for DRBI (promised Jan board meeting)
  ⚠ BlogWorks pricing page copy (told Gilbert "this week")

WAITING FOR (others):
  ✗ Tablet schema from Dr. Riazati (due Feb 3)
  ⚠ Hosting quote from provider (due Feb 14)

HABITS:
  Morning: Arabic practice ~30m (🔥12 streak, after coffee → journaling → Arabic)
    Identity: "I am someone who speaks Arabic"
  Anytime: Farsi flashcards ~15m (🔥3 streak — missed Wed, never miss twice!)

COMING UP:
  Ayyám-i-Há starts in 16 days — plan community gathering?
  Sarah's birthday in 32 days — start thinking about gift?

DISCOVERIES (from overnight research):
  📎 Found a grant opportunity for faith-based education orgs
     — deadline March 15. Relevant to DRBI. Review?

MY SUGGESTION:
  Start with the curriculum draft (45 min) before the Gilbert call.
  That clears your biggest overdue commitment and preps you for
  the board topic. Afternoon block for Ocean of Lights deep work.
  Arabic practice after the lesson when you're already in the zone."
```

### 6.2 What the Agent Does Before You Wake Up

The Sleep-Time Engine (server cron, runs ~4 AM user's timezone):

```
FOR EACH USER:
  1. Pull tomorrow's routines (meetings, events, deadlines)
  2. For each meeting:
     a. Load entity profiles for attendees
     b. Search memories for recent context about meeting topics
     c. Check tasks/commitments related to attendees
     d. If external meeting: web search attendee/company for recent news
     e. Generate briefing → store as memory (type: meeting_note)
  3. Check upcoming life events (14-day window):
     a. Birthdays: check preparation chain status
     b. Religious observances: prepare relevant context
     c. Deadlines: calculate remaining work vs. time available
  4. Review active blockers:
     a. Have any been resolved? (check recent memories)
     b. Any new information that helps? (web search)
  5. Consolidate memories:
     a. Merge redundant status updates
     b. Generate compressed forms for new memories
     c. Update patterns based on recent data
  6. Generate morning meeting script
     → Stored as a memory, ready when user opens app
```

### 6.3 End-of-Day Processing

When the user closes their last session:

```
1. Summarize the day's conversations → store as conversation summary
2. Extract commitments made during the day → store as memories
3. Check: were morning meeting tasks completed?
   → Update completion records
   → Note patterns ("Chad consistently defers curriculum work")
4. Prepare preliminary context for tomorrow's sleep-time run
```

---

## 7. The Heartbeat Engine (Tier 0)

Runs in a Service Worker. Lightweight checks every 15–30 minutes. No LLM call — pure logic against local data. But critically, the heartbeat now **feeds events into the Thinking Queue** when conditions warrant LLM attention.

### 7.1 Check Types

```javascript
const heartbeatChecks = [
  // Meeting in 15 minutes? Surface briefing.
  { check: 'upcoming_meeting', threshold: 15, unit: 'minutes' },
  // Overdue task from morning plan?
  { check: 'overdue_today_task', after: '14:00' },
  // Habit not done and it's getting late?
  { check: 'unfinished_habits', after: '20:00' },
  // Waiting-for item just passed its due date?
  { check: 'newly_overdue_waiting', frequency: 'daily' },
  // Life event entering remind_before window?
  { check: 'approaching_event', frequency: 'daily' },
]
```

### 7.2 Notification Rules

- **Silent** (HEARTBEAT_OK): Most checks find nothing to report.
- **Badge/subtle**: Habit reminder, approaching event.
- **Push notification**: Meeting in 15 min, critical deadline today.
- **Never duplicate**: `last_reminded` field prevents nagging.
- **Respect quiet hours**: No notifications before 7 AM or after 10 PM (configurable).

### 7.3 Heartbeat → Thinking Queue Bridge

The heartbeat can't think, but it can recognize when thinking is needed. When a check finds a condition that goes beyond pre-generated templates, it queues a **thinking event**:

```javascript
// Heartbeat detects something that needs LLM intelligence
const heartbeatWithQueue = async () => {
  const now = new Date()
  // Standard checks — display pre-generated notifications
  for (const check of heartbeatChecks) {
    const result = await runCheck(check, now)
    if (result.notification) showNotification(result)
  }
  // Queue thinking events when conditions are novel
  const events = []
  // User completed 3 habits in a row → agent should re-plan the day
  const recentCompletions = await getCompletionsSince(lastHeartbeat)
  if (recentCompletions.length >= 3) {
    events.push({ type: 'replan_day', data: recentCompletions })
  }
  // A blocker was marked resolved → downstream projects may be unblocked
  const resolvedBlockers = await getResolvedBlockersSince(lastHeartbeat)
  if (resolvedBlockers.length > 0) {
    events.push({ type: 'blocker_resolved', data: resolvedBlockers })
  }
  // Research queue has items AND user is idle → good time to process
  const pendingResearch = await getPendingResearch()
  const userIdle = (now - lastUserActivity) > 30 * 60 * 1000 // 30 min
  if (pendingResearch.length > 0 && userIdle) {
    events.push({ type: 'process_research', data: pendingResearch })
  }
  // Queue events for Thinking Queue processing
  if (events.length > 0) await queueThinkingEvents(events)
}
```

The heartbeat itself is still zero-LLM. It just detects state changes and queues them. The Thinking Queue (server-side) picks them up.

---

## 7A. The Thinking Queue (Tier 2) — The Always-On Brain

This is the critical missing piece. Between conversations and overnight processing, the Thinking Queue provides **event-driven LLM intelligence throughout the day** — cheaply.

### 7A.1 Core Concept

The Thinking Queue is a Cloudflare Worker that processes accumulated events in micro-batches. It doesn't run on a timer. It runs when:

1. **Events accumulate** — 3+ thinking events in the queue
2. **Time threshold** — Oldest event is >2 hours old (nothing waits forever)
3. **Priority event** — Certain events trigger immediate processing
4. **User returns** — App opens after >1 hour of inactivity (pre-warm their context)

```
HEARTBEAT ──► detects state change ──► queues thinking event
                                              │
CONVERSATION ──► "look into X" ──► queues research event
                                              │
EXTERNAL ──► calendar sync / email ──► queues processing event
                                              │
                                    ┌─────────▼──────────┐
                                    │   THINKING QUEUE    │
                                    │                     │
                                    │  Accumulate events  │
                                    │  until trigger:     │
                                    │  • 3+ events        │
                                    │  • >2hr oldest      │
                                    │  • priority event   │
                                    │  • user returning   │
                                    │                     │
                                    │  Process as micro-  │
                                    │  batch (Haiku)      │
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │  RESULTS            │
                                    │  → New memories     │
                                    │  → Updated plans    │
                                    │  → Research finds   │
                                    │  → Notifications    │
                                    │  → Ready when user  │
                                    │    opens app next   │
                                    └────────────────────┘
```

### 7A.2 Thinking Event Types

```javascript
const THINKING_EVENTS = {
  // PRIORITY EVENTS (process within 15 min)
  research_request: {
    // User said "look into X" during conversation
    // Don't wait until tonight — research it now
    priority: 'high',
    model: 'haiku',
    maxTokens: 2000,
    description: 'Execute queued research request with web search'
  },
  meeting_approaching: {
    // Meeting in 2 hours, briefing exists but may need refresh
    // Check if anything changed since overnight prep
    priority: 'high',
    model: 'haiku',
    maxTokens: 1500,
    description: 'Refresh meeting briefing with latest context'
  },
  // STANDARD EVENTS (batch when 3+ accumulate or >2hr old)
  blocker_resolved: {
    // A waiting_for was marked resolved or a blocker cleared
    // Re-evaluate affected project priorities
    priority: 'normal',
    model: 'haiku',
    maxTokens: 1000,
    description: 'Reassess project priorities after blocker change'
  },
  replan_day: {
    // Significant tasks completed, schedule may need updating
    // "You finished the curriculum draft early — here's how to
    //  use the freed-up time"
    priority: 'normal',
    model: 'haiku',
    maxTokens: 1000,
    description: 'Re-prioritize remaining day based on completions'
  },
  connection_detected: {
    // New memory created that connects to an existing pattern
    // "The grant deadline you just noted connects to the DRBI
    //  summer program discussion from last week"
    priority: 'normal',
    model: 'haiku',
    maxTokens: 800,
    description: 'Identify cross-project connections from new data'
  },
  completion_milestone: {
    // Habit streak hit a milestone, or project reached a phase gate
    priority: 'low',
    model: 'haiku',
    maxTokens: 500,
    description: 'Generate milestone acknowledgment and next steps'
  },
  // DEFERRED (accumulate for overnight batch)
  deep_research: {
    // Complex research that needs multiple searches + synthesis
    priority: 'deferred',
    model: null, // goes to overnight batch
    description: 'Queue for sleep-time deep analysis'
  },
  pattern_analysis: {
    // Enough data accumulated to detect a new behavioral pattern
    priority: 'deferred',
    model: null,
    description: 'Queue for sleep-time pattern detection'
  }
}
```

### 7A.3 Micro-Batch Processing

When the queue triggers, all pending events are processed in a single API call — not one call per event. This is the cost trick:

```javascript
// Cloudflare Worker: Thinking Queue processor
const processThinkingQueue = async (events, userContext) => {
  // Separate deferred events (→ overnight) from processable ones
  const deferred = events.filter(e => THINKING_EVENTS[e.type].priority === 'deferred')
  const processable = events.filter(e => THINKING_EVENTS[e.type].priority !== 'deferred')
  if (deferred.length > 0) await deferToOvernight(deferred)
  if (processable.length === 0) return
  // COMBINE all processable events into ONE Haiku call
  // This is the key cost optimization — not N calls, but 1 call with N events
  const combinedPrompt = buildCombinedPrompt(processable, userContext)
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 3000,
    system: THINKING_QUEUE_SYSTEM_PROMPT, // ~1500 tokens, focused and minimal
    messages: [{ role: 'user', content: combinedPrompt }]
  })
  // Parse structured output → store results
  const results = parseThinkingResults(response)
  for (const result of results) {
    if (result.memory) await storeMemory(result.memory)
    if (result.notification) await storeNotification(result.notification)
    if (result.research) await executeQuickResearch(result.research)
    if (result.planUpdate) await updateDayPlan(result.planUpdate)
  }
}
```

**The combined prompt looks like this:**

```
You are processing {N} thinking events for the user.
Respond with a JSON array, one result per event.

USER CONTEXT (compressed):
{Level 2 compressed: today's schedule, active projects, recent decisions — ~800 tokens}

EVENTS:
1. [blocker_resolved] "Dr. Riazati sent the tablet schema. Blocker on
   Ocean of Lights editorial workflow is cleared."
2. [replan_day] "User completed curriculum draft AND Arabic practice
   before 10 AM. 3 hours freed before Gilbert call."
3. [research_request] "User asked: look into grant opportunities for
   faith-based education technology"

For each event, respond with:
- type: memory | notification | research | plan_update
- content: the insight, notification text, search query, or updated priority
- urgency: now | next_session | deferred
```

**One Haiku call. ~2,500 input tokens + ~1,500 output tokens. Cost: ~$0.01.**

Compare this to three separate calls: 3 × ~1,800 input + ~600 output = ~$0.02. The combined approach is 50% cheaper AND provides the model with cross-event context (it can see that the freed time from the curriculum draft could be used for the grant research).

### 7A.4 Research in the Thinking Queue

Research is no longer "queued for tonight." It operates across three tiers:

```
TIER 1: IMMEDIATE (during conversation)
  User: "What's the Templeton Foundation's grant deadline?"
  Agent: [web search now, answer in this turn]
  Cost: Part of conversation turn (~$0.01 marginal)
  Latency: Seconds

TIER 2: QUICK RESEARCH (Thinking Queue, within hours)
  User: "Look into grant opportunities for DRBI"
  Agent: "I'll research that. Expect findings within a couple hours."
  → Queued as research_request (priority: high)
  → Thinking Queue executes 1-3 web searches + synthesis
  → Results stored as discovery memories
  → Next time user opens app: "I found 3 relevant grants..."
  Cost: ~$0.02-0.05 per research task
  Latency: 15 min to 2 hours

TIER 3: DEEP RESEARCH (overnight batch)
  Sleep-time engine identifies: "DRBI education strategy has 3
  active threads — grant, summer program, facility usage. These
  connect. Generate a strategic memo."
  → Overnight: multiple searches, cross-reference, full analysis
  → Morning meeting: strategic memo with recommendations
  Cost: ~$0.05-0.15 per deep research (batch pricing)
  Latency: By morning
```

**The user experience shift:** Instead of "I'll look into that tonight," the assistant says "I'll start researching that now. I should have initial findings within a couple hours. Want me to dig deeper overnight too?" This is the behavior of a real strategic partner — fast first results, deep analysis to follow.

### 7A.5 Day-Long Thinking Timeline

Here's what a full day looks like with the Thinking Queue active:

```
3:00 AM  TIER 3: Overnight batch runs
         → Memory consolidation, full briefings, deep research
         → Strategic memos generated
         → All notification templates pre-generated
         → Day plan drafted

7:00 AM  TIER 1: User opens app, morning meeting
         → Pre-generated briefing delivered (from overnight)
         → User discusses plans, asks questions
         → "Look into grant options for DRBI" → queued as research_request
         → "I'm going to try to finish the curriculum draft today" → noted

7:30 AM  Morning session ends. User starts working.

7:45 AM  TIER 0: Heartbeat runs. No conditions to flag. Silent.

8:00 AM  TIER 0: Heartbeat runs. No conditions. Silent.

8:15 AM  TIER 2: Thinking Queue triggers (research_request is priority:high)
         → Haiku processes research + user context in one call
         → 2 web searches executed, 3 grants found
         → Results stored as discovery memories
         → Notification queued: "Found 3 DRBI grant opportunities"

8:30 AM  TIER 0: Heartbeat runs. Displays research notification.
         User sees: "📎 I found 3 relevant grants for DRBI — open when ready"

9:15 AM  TIER 1: User opens app briefly
         → "Show me what you found on grants"
         → Agent presents 3 discoveries with recommendations
         → "Want me to do deeper analysis overnight on the Templeton one?"
         → "Yes, and check if the application requires a 501(c)(3) letter"
         → Both queued: deep_research (deferred) + research_request (high)

9:20 AM  Session ends. User back to work.

10:00 AM TIER 1: Quick ad-hoc: "Mark Arabic done"
         → Haiku: extraction + confirmation, 1 turn
         → Heartbeat detects: habit completed → queues completion_milestone

10:30 AM TIER 0: Heartbeat runs. Nothing to flag.

11:00 AM TIER 0: Heartbeat runs.
         → Meeting with Gilbert in 60 min
         → Briefing exists from overnight, but user completed curriculum
           draft since then (new context!)
         → Queues: meeting_approaching (priority:high)

11:05 AM TIER 2: Thinking Queue triggers (meeting_approaching is priority:high)
         → Haiku: "User completed curriculum draft. Update Gilbert
           meeting briefing to lead with this accomplishment.
           Also: grant research found 3 options — worth mentioning?"
         → Updated briefing stored as memory
         → Notification: "Updated briefing for Gilbert call ready"

11:45 AM TIER 0: Heartbeat: "Meeting with Gilbert in 15 min"
         → Displays updated briefing notification

12:30 PM TIER 1: User opens app after meeting
         → "Meeting went well. Gilbert wants to pursue the Templeton grant.
            He'll handle the board resolution, I'll do the technical narrative."
         → Agent extracts: commitment, delegation, project update
         → Queues: connection_detected (the grant research from this morning
           just became an active project)

1:00 PM  TIER 2: Thinking Queue processes accumulated events:
         → completion_milestone: "Arabic streak hit 13 days 🔥"
         → connection_detected: "Grant research → now active project.
            Create Templeton grant project with two workstreams:
            Gilbert (board resolution) + Chad (technical narrative).
            Deadline: March 15. That's 33 days."
         → research_request (501c3 check): quick search confirms DRBI qualifies
         → ONE Haiku call handles all three: ~$0.01
         → Results stored, ready for next session or morning meeting

3:00 PM  TIER 0: Heartbeat: "Farsi flashcards still pending for today"

5:00 PM  TIER 0: Heartbeat detects: user idle 3+ hours, no habits remaining
         → Nothing to queue. Silent.

8:30 PM  TIER 1: User opens app
         → "How did the day go? You crushed it — curriculum draft done,
            Arabic practice, productive Gilbert call. The Templeton grant
            is now a tracked project with 33 days to deadline.
            One thing: Farsi flashcards got skipped. Never miss twice tomorrow?"

3:00 AM  TIER 3: Overnight batch
         → Deep research on Templeton grant requirements (queued from 9:15 AM)
         → Full strategic memo connecting grant to DRBI summer program
         → Memory consolidation, tomorrow's briefings
         → The cycle continues
```

### 7A.6 Thinking Queue Cost Model

```
DAILY THINKING QUEUE USAGE (average user):

Micro-batch calls per day: 2-4
Events per micro-batch: 2-4 (combined into single call)
Avg input per call: 2,500 tokens (compressed context + events)
Avg output per call: 1,200 tokens (structured results)
Model: Haiku 4.5

COST PER MICRO-BATCH:
  Input:  2,500 tokens × $1/MTok  = $0.0025
  Output: 1,200 tokens × $5/MTok  = $0.006
  Total per batch: ~$0.0085

DAILY TOTAL (3 micro-batches avg): $0.026

WITH WEB SEARCH (1-2 research tasks/day):
  Search tool cost: ~$0.01/search × 2  = $0.02
  Analysis of results: included in micro-batch
  Daily research: $0.02

TOTAL THINKING QUEUE: $0.046/day = $1.38/month

Compare to value delivered:
  → Research results within hours, not overnight
  → Meeting briefings updated in real-time
  → Day plan adapts to completions
  → Cross-project connections spotted same-day
  → User always has fresh context when opening app
```

### 7A.7 The Queue Schema

One new table to manage the queue:

```sql
CREATE TABLE thinking_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT NOT NULL,           -- from THINKING_EVENTS taxonomy
  priority    TEXT NOT NULL DEFAULT 'normal', -- high | normal | low | deferred
  data        TEXT NOT NULL,           -- JSON: event-specific payload
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | deferred
  queued_at   TEXT NOT NULL,
  processed_at TEXT DEFAULT NULL,
  batch_id    TEXT DEFAULT NULL,       -- groups events processed together
  result      TEXT DEFAULT NULL        -- JSON: what the LLM returned
);
CREATE INDEX tq_status_idx ON thinking_queue (status, priority, queued_at);
```

**Cleanup:** Processed events older than 7 days are deleted. Deferred events are moved to the overnight batch queue and removed from thinking_queue after processing.

---

## 8. Research & Strategy Engine (Tiers 1-3)

Research operates across all three LLM tiers. It is no longer coupled to the Sleep-Time Engine — it goes wherever the user needs it.

### 8.1 Research Tiers

```
TIER 1 — INLINE (during conversation, seconds)
  Trigger: User asks a direct question that needs current info
  Example: "What's the Templeton Foundation deadline?"
  Action: Web search + answer in the same conversation turn
  Model: Whatever the conversation is using (Haiku or Sonnet)
  Cost: Marginal — part of the conversation turn

TIER 2 — QUEUED (Thinking Queue, minutes to hours)
  Trigger: User says "look into X" or agent identifies a research need
  Example: "Find grant opportunities for faith-based education tech"
  Action: Queued as research_request → Thinking Queue processes
          1-3 web searches + Haiku synthesis → discovery memories
  Model: Haiku 4.5
  Cost: $0.02-0.05 per research task
  User told: "I'll research that — expect findings within a couple hours"

TIER 3 — DEEP (overnight batch, by morning)
  Trigger: Complex analysis requiring multiple searches + cross-referencing
  Example: Strategic memo connecting grant + summer program + facility usage
  Action: Sleep-time engine runs 5-10 searches, synthesizes with full context
  Model: Sonnet 4.5 via Batch API (50% off)
  Cost: $0.05-0.15 per deep research
  User told: "I'll do a deep analysis overnight and have a memo ready in the morning"
```

### 8.2 Research Triggers (by tier)

```
TIER 1 (inline, during conversation):
- User asks a factual question about a person, org, or deadline
- User needs context for a decision they're making RIGHT NOW

TIER 2 (queued, within hours):
- User says "look into X" / "find out about Y" / "research Z"
- BLOCKER exists with no resolution path → search for solutions
- MEETING in 2-6 hours → refresh briefing if context changed
- New commitment made → quick validation (is the deadline realistic?)

TIER 3 (deep, overnight):
- MEETING tomorrow with external person/org → full news + context search
- GOAL stalled 14+ days → search resources, approaches, communities
- PATTERN detected: recurring problem → broader solution search
- Multiple threads converging → strategic memo synthesis
- DISCOVERY from Tier 2 warrants deeper investigation
```

### 8.2 Research Output

Every research result becomes a `discovery` memory:

```
Level 1 (content): "Found EdTech grant from the Templeton Foundation
  for faith-based education technology. $50K-$200K range. Deadline
  March 15, 2026. Requires 501(c)(3) status (DRBI qualifies).
  Application focuses on innovative uses of technology for
  interfaith understanding — directly aligned with OceanLibrary mission."

Level 2 (compressed): DISCOVERY:Templeton_grant|edtech_faith|
  $50K-200K|deadline:Mar15|DRBI_eligible|OceanLibrary_aligned|
  ACTION:review_application_requirements

Source: https://templeton.org/grants/...
```

Discoveries surface in the morning meeting with a one-line summary and a recommended action. User can: accept (becomes a task), dismiss (superseded as "reviewed, not relevant"), or defer ("remind me next week").

### 8.3 Strategic Memos

For significant research findings or pattern convergences, the Sleep-Time Engine generates longer-form analysis:

```
STRATEGIC MEMO: DRBI Education Program Expansion

Based on 3 weeks of tracking:
- Facility usage is at 40% capacity on weekdays
- Summer program was discussed but tabled twice (Jan + Feb board meetings)
- Grant opportunity found (Templeton, $50K-200K, deadline Mar 15)
- Community survey from Dec shows 73% interest in youth programs

RECOMMENDATION: Submit Templeton grant application for a pilot
summer youth program. Use existing facility capacity. Budget the
grant writing at ~20 hours. The March 15 deadline is achievable
if started this week.

TRADEOFFS: This competes for Chad's time with Ocean of Lights
editorial workflow redesign. Suggest delegating grant research
to a board member while Chad focuses on the technical application
narrative (his strength).
```

---

## 9. GTD Engine — Getting Things Done

Implements David Allen's methodology natively. No separate GTD app needed.

### 9.1 Concept Mapping

| GTD Concept | ThinkDone Implementation |
|-------------|--------------------------|
| **Inbox** | Memories of type `idea` with no project tag |
| **Next Actions** | Tasks surfaced in morning meeting based on context + energy |
| **Projects** | Unique values in `memories.project` field |
| **Waiting For** | Memories of type `waiting_for` |
| **Someday/Maybe** | Memories with `priority: -1` |
| **Reference** | Memories of type `insight`, `person_fact`, `discovery` |
| **Weekly Review** | Sleep-Time Engine generates Sunday night reflection |

### 9.2 The Weekly Review (Automated)

Every Sunday night, the Sleep-Time Engine conducts a full GTD-style review:

```
1. COLLECT: Scan week's conversations for uncommitted ideas/tasks
2. PROCESS: For each untagged idea, suggest: project? next action? someday?
3. ORGANIZE: Update project statuses, check goal alignment
4. REVIEW:
   - Which goals advanced this week? Which stalled?
   - Which habits held? Which broke?
   - Which commitments were met? Which slipped?
   - What patterns emerged?
5. REFLECT: Generate weekly memo with honest assessment
6. PREPARE: Draft suggested focus areas for next week
```

The Monday morning meeting opens with this weekly review summary.

---

## 10. Routines Engine — Time Awareness

### 10.1 Preparation Chains

The killer feature for life events. A birthday reminder on the day is useless. A preparation chain starts weeks early:

```javascript
// Example: Mom's birthday preparation chain
{
  name: "Mom's birthday",
  kind: "event",
  frequency: "yearly",
  target_date: "1960-03-15",
  remind_before: 21,
  preparation_steps: [
    { days_before: 21, action: "Start thinking about gift ideas", status: "pending" },
    { days_before: 14, action: "Research and decide on gift", status: "pending" },
    { days_before: 10, action: "Order gift (allow shipping time)", status: "pending" },
    { days_before: 5,  action: "Write card", status: "pending" },
    { days_before: 2,  action: "Confirm gift arrived / wrap", status: "pending" },
    { days_before: 0,  action: "Call Mom / deliver gift", status: "pending" }
  ]
}
```

Each step surfaces at the right time in the morning meeting. The agent tracks which steps are done and which are pending.

### 10.2 Religious Calendar Support

Built-in awareness of non-Gregorian calendars. Starting with Bahá'í:

```
- 19-Day Feast cycle (every 19 days, calculate from known starting point)
- Holy Days (fixed dates in Bahá'í calendar, converted to Gregorian)
- The Fast (March 2-20 annually)
- Ayyám-i-Há (intercalary days, February 25-March 1, varies)
- Naw-Rúz (March 20, Bahá'í New Year)
```

Future: Islamic calendar (Ramadan, Eid), Jewish calendar (Shabbat, High Holidays), Hindu festival calendar. This becomes a genuine differentiator — an assistant that understands your spiritual calendar natively.

### 10.3 Meeting Briefings

For routines of `kind: 'meeting'`, the Sleep-Time Engine automatically generates a briefing:

```
BRIEFING STRUCTURE:
1. Context    — What was discussed last time? What's changed?
2. People     — Who's attending? Recent interactions? Their current priorities?
3. Your items — Open commitments, overdue tasks, prepared updates
4. Suggested talking points — Based on project status and strategic memos
5. Prep tasks — What you need to do before the meeting starts
```

### 10.4 Atomic Habits — The Four Laws Engine

The assistant doesn't just track habits — it implements James Clear's complete Atomic Habits framework. The schema stores the structure; the agent provides the intelligence.

#### The Four Laws as Schema Fields

Every habit in the `routines` table can optionally encode all four laws:

```javascript
// Example: Arabic practice habit, fully specified
{
  name: "Arabic practice",
  kind: "habit",
  frequency: "daily",
  time_slot: "morning",
  minutes: 30,
  // The Four Laws:
  identity: "I am someone who speaks Arabic",          // Law 0: Identity
  cue: "After morning coffee",                         // Law 1: Make it obvious
  craving: "Feel the satisfaction of reading a passage fluently",  // Law 2: Make it attractive
  // Law 3 (Make it easy) is the two_minute_version:
  two_min_version: "Open the Arabic app and read one sentence",
  reward: "Mark streak + 5 min of favorite podcast",   // Law 4: Make it satisfying
  // Stacking & bundling:
  stack_after: 12,        // routine_id for "morning coffee" habit
  bundle_with: "Listen to Arabic music while practicing",
  // Progression:
  difficulty: 2,          // started at 1, leveled up after 30-day streak
  goal_quantity: 30,
  goal_unit: "minutes"
}
```

Not every field needs to be filled. The assistant learns what helps:
- New habit? Focus on cue + two_min_version (make it obvious and easy).
- Habit stalling? Add a reward or temptation bundle.
- Habit solid for 60+ days? Suggest increasing difficulty or goal_quantity.

#### Identity-Based Habits

The `identity` field is the most important Atomic Habits concept. Clear's core insight: don't set goals, change your identity. "I want to learn Arabic" fails. "I am someone who speaks Arabic" compounds.

The agent uses identity statements in three ways:

1. **Framing suggestions**: Instead of "You should practice Arabic today," the agent says "You're building your identity as an Arabic speaker — 30 minutes this morning keeps that going."

2. **Celebrating consistency**: "12 days in a row. That's not a streak — that's evidence you ARE someone who practices Arabic daily."

3. **Recovering from misses**: "You missed yesterday. That's one miss. You're still someone who practices Arabic — today is a chance to prove it. Even the two-minute version counts."

#### The Two-Minute Rule

Every habit should have a `two_min_version` — the gateway behavior that's so easy you can't say no. The agent uses this strategically:

```
NORMAL DAY (energy is fine):
  "Arabic practice — 30 minutes this morning (🔥12 streak)"

LOW ENERGY / PACKED SCHEDULE:
  "Tough day. For Arabic, even just opening the app and reading
   one sentence keeps your streak alive. Two minutes. That's it."

MISSED YESTERDAY:
  "You missed Arabic yesterday. Never miss twice — even the
   two-minute version counts. Read one sentence right now?"
```

The `used_two_min` flag in completions tracks when only the gateway version was done. This counts for the streak (critical — never break the chain) but surfaces in trend analysis: "You've used the two-minute version 4 of the last 7 days. That might mean the habit is too ambitious at 30 minutes. Want to scale back to 15 minutes and rebuild?"

### 10.5 Habit Stacking & Temptation Bundling

#### Habit Stacking

The `stack_after` field chains habits together: "After [EXISTING HABIT], I will [NEW HABIT]."

```javascript
// The morning stack
{ id: 10, name: "Morning coffee",         stack_after: null },
{ id: 11, name: "Gratitude journaling",   stack_after: 10 },  // after coffee
{ id: 12, name: "Arabic practice",        stack_after: 11 },  // after journaling
{ id: 13, name: "Review today's calendar", stack_after: 12 }, // after Arabic
```

The morning meeting presents stacked habits as a sequence, not a list:

```
YOUR MORNING ROUTINE:
  ☕ Coffee → 📝 Gratitude journal (2 min) → 🇸🇦 Arabic (30 min) → 📅 Calendar review
  Total: ~45 minutes | 🔥 Streaks: 12, 8, 12, 30
```

When one habit in the stack is completed, the agent can nudge the next one: "Gratitude entry done ✓ — Arabic practice is next in your stack."

#### Temptation Bundling

The `bundle_with` field pairs a habit you need to do with something you want to do:

```
"Arabic practice" bundled with "Listen to favorite podcast"
→ Agent: "Time for Arabic — put on your podcast and open the app."
```

This maps to Clear's formula: After [HABIT I NEED], I will [HABIT I WANT]. The bundle_with makes the needed habit more attractive (Law 2).

### 10.6 Progression & Difficulty Scaling

Habits shouldn't stay static. The `difficulty` field (1–5) and `goal_quantity` / `goal_unit` enable progression:

```
PHASE 1 (weeks 1-4): difficulty=1
  Arabic practice: Read 1 sentence (two_min_version IS the habit)
  Goal: just show up. Build the identity.

PHASE 2 (weeks 5-8): difficulty=2
  Arabic practice: 15 minutes of structured lesson
  Goal: consistent time block.

PHASE 3 (weeks 9-16): difficulty=3
  Arabic practice: 30 minutes, mix of reading + writing
  Goal: measurable skill progress.

PHASE 4 (months 5+): difficulty=4
  Arabic practice: 30 min lesson + 10 min conversation practice
  Goal: real-world application.
```

The agent suggests progression based on streak length and completion quality:

```
"You've completed Arabic practice 28 of the last 30 days,
 with an average quality rating of 4.2/5. You're ready to
 level up — want to add 10 minutes of writing practice?"
```

Conversely, if quality drops or two-minute completions increase, the agent suggests scaling back: "Your completion rate dropped from 90% to 60% after increasing to 45 minutes. Scaling back to 30 minutes for two weeks to rebuild consistency?"

### 10.7 Habit Analytics & Trend Detection

All analytics are computed from the `completions` table. No additional storage needed.

#### Metrics the Agent Computes

```
STREAK:
  Current consecutive completions (respecting frequency)
  Longest streak ever
  Average streak length (how long before breaking)

COMPLETION RATE:
  Last 7 days / 30 days / 90 days
  Rolling 7-day average (trend line)
  By day of week (find weak days)
  By time of day (find optimal times)

QUALITY TREND:
  Average self-rating over time (if user rates)
  Quantity progression (are you reading more pages? longer sessions?)

CONSISTENCY SCORE:
  Weighted formula: (completion_rate × 0.5) + (streak / target × 0.3) + (quality_trend × 0.2)
  Normalized to 0-100 for easy comparison across habits

PATTERNS (stored as memories of type 'pattern'):
  "Arabic practice completion rate drops 40% on Wednesdays — schedule conflict?"
  "Habits completed in morning slot have 85% rate vs 55% for evening"
  "Two-minute completions cluster on Mondays — low energy start of week?"
  "Quality ratings highest when stack is followed in order"
```

#### The "Never Miss Twice" Rule

Clear's most important tactical rule. The agent enforces it proactively:

```
SCENARIO: User missed Arabic yesterday.

MORNING MEETING:
  "You missed Arabic practice yesterday. No judgment — everyone misses.
   But never miss twice. Even 2 minutes today keeps your identity intact.
   Your streak was 12 days. Let's not start over."

IF THEY MISS AGAIN (heartbeat, evening):
  "Hey — Arabic practice is still open for today. The two-minute
   version is literally one sentence. Want to do it right now
   before the day ends?"

IF THEY MISS A THIRD DAY:
  Store as pattern: "Arabic practice — 3-day break starting [date]"
  Next morning meeting: "Three days without Arabic. That's getting close
   to a new habit of NOT practicing. What's getting in the way?
   Want to adjust the schedule, lower the bar, or push through?"
```

#### Visual Progress (UI Data Contracts)

The schema supports these visualizations without additional tables:

```
CALENDAR HEATMAP (GitHub-style):
  Query: SELECT completed_date, COUNT(*) as total, AVG(quality) as avg_q
         FROM completions WHERE completed_date >= date('now', '-365 days')
         GROUP BY completed_date
  Color: intensity = number of habits completed that day

STREAK FLAME:
  Query: Walk backward from today per routine, compute current streak
  Display: 🔥12 with flame size proportional to streak length

HABIT SCORECARD:
  Query: For each active habit, compute completion_rate_30d, current_streak,
         avg_quality, trend_direction (improving/declining/stable)
  Display: Table with color-coded health indicators

WEEKLY RHYTHM:
  Query: SELECT strftime('%w', completed_date) as dow, COUNT(*) as n
         FROM completions GROUP BY dow
  Display: Bar chart showing strongest/weakest days

STACKING FLOW:
  Query: For stacked habits, compute % of times full stack was completed
         vs. partial completions. Which link breaks most often?
  Display: Chain diagram with completion percentages per link
```

### 10.8 How the Agent Uses Atomic Habits in Practice

The intelligence isn't in the schema — it's in how the assistant applies the framework conversationally.

#### Onboarding a New Habit

```
User: "I want to start meditating."

Agent: "Great. Let's set this up properly so it actually sticks.

  IDENTITY: Who do you want to become?
    → 'I am someone who meditates daily'?

  CUE: When will you do it? Best to stack it after something
    you already do reliably.
    → After morning coffee? After Arabic practice?

  TWO-MINUTE VERSION: What's the absolute minimum?
    → 'Sit on the cushion and take three breaths'?

  REWARD: What makes it satisfying right after?
    → The streak itself? A cup of tea? 5 minutes of music?

  Let's start with just the two-minute version for the first
  two weeks. Once that's automatic, we'll build from there."
```

#### Weekly Habit Review (Sunday Sleep-Time Engine)

```
HABITS WEEKLY REVIEW:

Arabic practice: 🔥19 streak | 6/7 days | avg quality 4.1
  → Solid. Suggest: add 5 minutes of writing next week?

Farsi flashcards: 🔥3 streak | 4/7 days | avg quality 3.2
  → Struggling. Pattern: missed every Wed + Thu.
  → Suggest: move from "anytime" to "after Arabic" stack?

Meditation: 🔥0 streak | 1/7 days | used 2-min version 1x
  → Not taking hold. Possible issues:
    - No clear cue (set to "anytime")
    - No stack (floating, easy to skip)
    - Suggestion: Stack after morning coffee, before Arabic.
      "After I pour coffee, I sit and breathe for 2 minutes."

Exercise: 🔥8 streak | 5/5 weekdays | avg quality 3.8
  → Strong. Consider increasing from 20 to 25 minutes.

OVERALL: 16/24 completions (67%). Up from 58% last week.
  Best day: Tuesday (4/4). Worst day: Wednesday (1/4).
  Hypothesis: Wednesday schedule is overloaded. Consider
  moving one habit to a lighter day.
```

#### Breaking Bad Habits (Inversion of the Four Laws)

The same schema supports breaking bad habits by inverting the framework:

```javascript
// Tracking a habit to BREAK
{
  name: "Checking phone first thing",
  kind: "habit",
  frequency: "daily",
  // Inverted Four Laws:
  cue: "Phone is on nightstand (MAKE IT INVISIBLE: charge in other room)",
  craving: "MAKE IT UNATTRACTIVE: remind myself how groggy and unfocused it makes me",
  two_min_version: null, // no gateway — we want FRICTION, not ease
  reward: "MAKE IT UNSATISFYING: log every morning I check phone first, see the pattern",
  identity: "I am someone who starts mornings intentionally, not reactively",
  difficulty: -1, // negative = habit to break, tracked inversely
}
```

For habits being broken, the completions table tracks *successes* (days you didn't do the bad habit). The streak represents consecutive days of resistance. The agent celebrates these differently: "5 days without checking your phone first thing. Your mornings are becoming intentional."

---

## 11. People Graph

People aren't a separate table — they're an emergent graph from the `person` field across memories and routines.

### 11.1 How People Enter the System

Conversationally. Never through a form.

```
User: "I had lunch with Gilbert today, he's worried about Q1 revenue."
Agent extracts:
  → person_fact: "Gilbert — CEO of Immersive Ocean, worried about Q1 revenue"
  → Last contact with Gilbert: today
  → Possible follow-up: Q1 revenue discussion

User: "My mom's birthday is March 15"
Agent extracts:
  → person_fact: "Mom — birthday March 15"
  → Creates yearly routine with preparation chain
  → Asks: "Want me to start reminding you 3 weeks beforehand?"

User: "Dr. Riazati said he'd send the schema by Friday"
Agent extracts:
  → waiting_for: "Tablet catalog schema from Dr. Riazati, due Friday"
  → Links to Ocean of Lights project
```

### 11.2 Contact Frequency

The agent tracks `last_contact` implicitly from conversation mentions and meeting attendance. If a relationship has a `contact_frequency_goal` (stored as a person_fact), the agent notices drift:

"You haven't mentioned talking to Dr. Riazati in 3 weeks. Given the tablet catalog project is active, want to check in?"

---

## 12. Personality Evolution

The assistant learns what works for you and adjusts its approach.

### 12.1 Signal Collection

After every morning meeting, the system notes:
- Which suggestions were accepted? Which dismissed?
- Which habit framings led to completion?
- How long did the user engage? (Short = too verbose? Long = valuable?)
- Did the user re-raise something the agent should have surfaced?

### 12.2 Calibration Updates

Weekly, during the reflection cycle:

```javascript
// Pseudocode for disposition update
const updateDisposition = (disposition, weekSignals) => {
  // If user dismisses competitive framings, reduce them
  if (weekSignals.competitive_framings_dismissed > 2)
    disposition.responds_well_to = disposition.responds_well_to
      .filter(x => x !== 'competitive framing')
  // If habit streaks break after guilt-based nudges, stop those
  if (weekSignals.guilt_nudges_followed_by_streak_break > 0)
    disposition.responds_poorly_to.push('guilt-based nudges')
  // If morning meetings consistently run 3-5 minutes, note preference
  disposition.preferred_morning_meeting_length =
    weekSignals.avg_morning_meeting_duration
  // Track overall suggestion acceptance rate
  disposition.suggestion_acceptance_rate =
    weekSignals.suggestions_accepted / weekSignals.suggestions_total
}
```

### 12.3 The Reflection Memory

The assistant stores observations about its own effectiveness:

```
type: pattern, project: _meta
"Morning meeting suggestions accepted 75% for project tasks but only
30% for habit nudges. Reframe habit suggestions as 'momentum builders'
rather than 'things you should do.'"
```

These meta-patterns feed back into the SOUL's disposition, creating a genuine learning loop.

---

## 13. Tool Utilization

The assistant should be able to leverage whatever tools are available in its environment.

### 13.1 Tool Discovery

At session start, the assistant inventories available capabilities:

```
ALWAYS AVAILABLE:
  - Memory (read/write/search the encrypted database)
  - Routines (check schedule, mark completions)
  - Conversation (chat with user)

WHEN BROWSER IS OPEN:
  - Local embedding generation (transformers.js)
  - Heartbeat checks (Service Worker)
  - Turso sync (push/pull)

WHEN SERVER PROCESSES RUN:
  - Web search (research engine)
  - Email drafting/sending (follow-ups, outreach)
  - Calendar sync (if Google/Apple connected)
  - Long-running analysis (strategic memos)

USER-PROVIDED (discovered at runtime):
  - MCP servers the user has configured
  - API keys for specific services
  - File system access (if desktop app)
  - Any tools exposed via the conversation interface
```

### 13.2 Tool-Aware Planning

When the Sleep-Time Engine identifies a research need, it checks available tools:

```
Need: "Find grant opportunities for faith-based education"
Available: web_search → USE IT
Not available: specialized grant database API → NOTE: suggest user
  enable this if they want deeper grant research
```

When the Conversation Engine needs to help with a task:

```
User: "Help me draft the follow-up email to Dr. Riazati"
Available: email_compose tool → draft and offer to send
Not available: → draft in conversation, user copies manually
```

The assistant adapts gracefully to whatever tools exist, always maximizing capability while acknowledging limitations.

---

## 14. Implementation Roadmap

### Phase 1: Foundation (Weeks 1–3)

**Goal:** Working morning meeting with basic memory and habits.

```
BUILD:
  ☐ libSQL database with encryption (PIN flow)
  ☐ memories table + vector index + embedding generation
  ☐ routines table + completions
  ☐ personality table with default SOUL
  ☐ Basic conversation engine (system prompt with context injection)
  ☐ Memory CRUD: store, search, supersede
  ☐ Routine CRUD: add, complete, due-today
  ☐ Context builder (recall function → system prompt prefix)
  ☐ Simple chat UI (one page, no navigation)

SKIP FOR NOW:
  ✗ Cloud sync (local-only is fine)
  ✗ Sleep-time engine (user adds memories manually)
  ✗ Research engine (no web search yet)
  ✗ Heartbeat (no notifications yet)

VALIDATES:
  "Can the morning meeting feel genuinely useful with just
   a memories table, routines, and a good system prompt?"
```

### Phase 2: Cloud + Sync (Weeks 4–5)

**Goal:** Multi-device support. Data survives browser reset.

```
BUILD:
  ☐ Turso cloud database per user
  ☐ Passive sync (background, non-blocking)
  ☐ PIN-based local encryption + server-managed cloud encryption
  ☐ Conflict resolution (last-write-wins for memories, merge for completions)
  ☐ User auth (email + PIN as separate factors)

VALIDATES:
  "Can I use ThinkDone on my phone and laptop seamlessly?"
```

### Phase 3: Sleep-Time Engine (Weeks 6–8)

**Goal:** The assistant thinks overnight and comes prepared.

```
BUILD:
  ☐ Cloudflare Worker cron job (nightly, per-user)
  ☐ Meeting briefing generation
  ☐ Memory consolidation (merge, compress, prune)
  ☐ Weekly review generation
  ☐ Level 2 compression pipeline
  ☐ Preparation chain advancement

VALIDATES:
  "Do I open the app in the morning and feel like someone
   already organized my day?"
```

### Phase 4: Research + Thinking Queue (Weeks 9–12)

**Goal:** The assistant actively finds opportunities, solves problems, and thinks between conversations.

```
BUILD:
  ☐ Thinking Queue (Cloudflare Worker): event-driven micro-batching
  ☐ thinking_queue table and event taxonomy
  ☐ Heartbeat → Thinking Queue bridge (event detection + queuing)
  ☐ Combined-event prompt builder (multiple events in one Haiku call)
  ☐ Web search integration (Tier 1 inline + Tier 2 queued + Tier 3 deep)
  ☐ Discovery creation and morning meeting review flow
  ☐ Strategic memo generation (overnight batch)
  ☐ Token usage tracking (usage_log table + budget guardrails)

VALIDATES:
  "When I ask 'look into X' at 8 AM, do I have results by 10 AM?"
  "Did the assistant find something I wouldn't have found myself?"
  "Does the day plan adapt when I complete tasks early?"
```

### Phase 5: Heartbeat + Polish (Weeks 13–16)

**Goal:** The assistant is aware throughout the day, not just in morning meeting.

```
BUILD:
  ☐ Service Worker heartbeat (zero-LLM condition checking)
  ☐ Pre-generated notification templates (from sleep-time + thinking queue)
  ☐ Push notifications for meetings and deadlines
  ☐ Habit nudges (evening reminder for unfinished habits)
  ☐ Meeting briefing refresh (Thinking Queue detects new context → updates briefing)
  ☐ Personality evolution (disposition tracking)
  ☐ Calendar sync (optional Google/Apple import)
  ☐ Religious calendar engine (Bahá'í first)

VALIDATES:
  "Does the assistant feel like a living presence in my day,
   not just a morning ritual?"
  "When context changes (blocker resolved, task completed early),
   does the assistant notice and adapt before I ask?"
```

### Phase 6: Intelligence Amplification (Ongoing)

```
  ☐ Cross-project pattern detection
  ☐ Goal-alignment scoring (are daily actions serving long-term goals?)
  ☐ Proactive relationship management
  ☐ Seasonal planning (quarterly reviews, annual goals)
  ☐ Team awareness (if org features added)
  ☐ Voice interface for mobile morning meeting
```

---

## 15. Technical Decisions Log

Decisions made during architecture that should not be re-litigated without new evidence:

| Decision | Rationale | Date |
|----------|-----------|------|
| libSQL + Turso over Postgres/Supabase | Local-first with cloud sync. Per-user databases. Built-in vector search and encryption. | Feb 2026 |
| Single `memories` table over many typed tables | Proven by prototype. Simpler queries, universal vector search, easier compression. Separate tables add complexity without benefit at this scale. | Feb 2026 |
| Superseding over deletion | Preserves history, enables evolution tracking, reversible. Active set is a simple WHERE clause. | Feb 2026 |
| Simple frequency enum over iCal RRULE | Covers all real personal scheduling needs. RRULE is overkill. Add it only if Google Calendar sync demands it. | Feb 2026 |
| 10-digit PIN over password | Different mental model from account password. Easy to enter on mobile. Sufficient entropy with PBKDF2 + rate limiting. | Feb 2026 |
| BGE-small-en-v1.5 for embeddings | Runs in browser via ONNX/WASM. 384 dimensions. Good quality for semantic memory. No external API needed (privacy). | Feb 2026 |
| Built-in calendar over Google Calendar dependency | Most people who need this app don't use a calendar. The assistant should be the reason they finally have one. External sync is optional. | Feb 2026 |
| Option A encryption (local E2E, cloud server-managed) | Pragmatic for MVP. Enables sleep-time engine. Honest about boundaries. Future: TEE for true E2E everywhere. | Feb 2026 |
| Cloudflare Workers for server components | Boring stack. No servers to manage. Cron support. Edge deployment. Cost-effective at scale. | Feb 2026 |
| Vue/Svelte over React | Team preference for clean, minimal code. Boring stack philosophy. | Feb 2026 |
| Atomic Habits fields on routines table, not a separate habits subsystem | The four laws (cue/craving/response/reward), identity, two-minute rule, stacking, and bundling are columns on routines. Analytics computed from completions. The intelligence lives in agent behavior, not schema complexity. | Feb 2026 |
| Haiku-first model routing with Sonnet for synthesis only | Haiku 4.5 ≈ Sonnet 4 quality at 1/3 cost. Route 80%+ of turns to Haiku. Use Sonnet only for morning briefing, strategic advice, and complex synthesis. Saves 60-70% vs all-Sonnet. | Feb 2026 |
| 4-layer prompt caching with 1hr TTL on system prompt | SOUL+tools prefix (3K tokens) cached for 1hr, read at 90% discount on every turn. Daily context and session context cached at 5min. Saves ~87% on repeated prefix tokens. | Feb 2026 |
| Batch API for all overnight processing | Sleep-time, research, weekly review — nothing overnight is urgent. Batch API gives 50% discount. Multi-user batches compound the savings. | Feb 2026 |
| Zero-LLM heartbeat with pre-generated notification templates | Heartbeat runs 48-96x/day. If each used LLM, it'd cost $2/day alone (51% of naive total). Pre-generating templates overnight eliminates this entirely. | Feb 2026 |
| Thinking Queue: event-driven micro-batching (Tier 2) | Fills the intelligence gap between overnight batch and interactive conversation. Combines 2-4 events into single Haiku calls at ~$0.01 each. Enables same-day research, adaptive day planning, real-time briefing updates. $1.38/month for "always-on brain" — highest ROI line item. | Feb 2026 |
| BYOM (Bring Your Own Model) via OpenRouter PKCE + direct provider APIs | Gemini has no browser CORS support — can't call directly. OpenRouter provides universal gateway with OAuth PKCE for browser SPAs. Anthropic/OpenAI support direct browser access. Provider abstraction layer normalizes across all. BYOM reduces ThinkDone server cost to ~$0.90/user/month. | Feb 2026 |
| Browser-native heartbeat replacing server-side cron | App presents as persistent todo list — browser is open all day. Visibility API + timers adjust frequency by tab state (5/15/30 min). Zero server cost. Direct access to local DB and Notification API. Graceful catch-up on focus after suspension. | Feb 2026 |
| Read-only tool integrations (Gmail, Drive, Calendar, Dropbox) via browser OAuth | On-demand retrieval, not indexing. Zero storage in local DB for external data. Google gapi library handles OAuth entirely in browser. Data flows browser→Google directly, never touches ThinkDone servers. Temporary 24hr cache only. | Feb 2026 |

---

## 16. Success Metrics

How we know Think→Done is working:

**Daily engagement:**
- Morning meeting opened 6+ days/week
- Average session: 3–8 minutes (concise but valuable)
- Suggestion acceptance rate > 60%

**Productivity signals:**
- Commitments tracked → fewer dropped balls
- Waiting-for items followed up → fewer stalled handoffs
- Meeting prep used → user reports feeling prepared

**Habit formation (Atomic Habits metrics):**
- Average active streak length increasing month over month
- Habit completion rate > 70% for established habits (30+ days old)
- New habits survive past the 66-day automaticity threshold
- Two-minute version usage decreases over time (habit solidifying)
- Identity statements referenced by user unprompted ("I'm a runner now")
- Habit stacks completed in full > 60% of the time
- Difficulty progression: at least one habit levels up per month
- "Never miss twice" interventions successful > 80% of the time
- Weekly habit review shows consistency score improving or stable

**Strategic value:**
- Discoveries reviewed and acted on > 2/month
- Strategic memos influence actual decisions
- Weekly review surfaces at least one insight user hadn't noticed
- Thinking Queue research results available same-day > 80% of the time
- Meeting briefings refreshed with new context before 60%+ of meetings
- Cross-project connections identified by Thinking Queue > 1/week

**Cost discipline:**
- Daily cost per active user stays under $0.40 (Haiku-first) or $0.65 (Sonnet)
- Thinking Queue costs < $0.05/day (highest ROI engine)
- Cache hit rate > 70% for Layer 1 (system prompt)
- Haiku routing rate > 80% of conversation turns

**System health:**
- Active memory count stays under 500
- Context budget utilization < 80% (room to breathe)
- Consolidation reduces memory count by 10–20% weekly
- Vector search returns relevant results > 80% of the time

---

## 17. Token Economics & Cost Architecture

The system runs 24/7 with a heartbeat, overnight processing, and interactive conversations. Without careful cost architecture, this easily becomes $50-100/user/month just in API fees. This section designs the system to be viable at **under $5/user/month** — the target for a consumer subscription product.

### 17.1 Pricing Reference (as of Feb 2026)

```
                    Input     Output    Cache Write(5m)  Cache Read   Cache Write(1hr)
Haiku 4.5          $1/MTok   $5/MTok   $1.25/MTok       $0.10/MTok   $2.00/MTok
Sonnet 4.5         $3/MTok   $15/MTok  $3.75/MTok       $0.30/MTok   $6.00/MTok
Opus 4.5           $5/MTok   $25/MTok  $6.25/MTok       $0.50/MTok   $10.00/MTok

Batch API: 50% off all categories (input, output, cache)
Cache read: 10% of base input price (90% savings)
```

### 17.2 The Naive Cost Disaster

Before optimization, let's see what unconstrained usage looks like on Sonnet 4.5:

```
ENGINE                  CALLS/DAY  INPUT/CALL  OUTPUT/CALL  DAILY INPUT   DAILY OUTPUT
─────────────────────── ────────── ─────────── ──────────── ───────────── ────────────
Conversation (morning)  1 session   ~135K avg*  ~10K         135,000       10,000
Conversation (ad-hoc)   4 sessions  ~80K avg*   ~6K          320,000       24,000
Heartbeat (if LLM)      48 checks   ~12K each   ~500         576,000       24,000
Sleep-time              1 run       ~60K        ~15K         60,000        15,000
Research                3 calls     ~10K each   ~3K          30,000        9,000
Weekly review (÷7)      0.14        ~40K        ~8K          5,700         1,140
─────────────────────── ────────── ─────────── ──────────── ───────────── ────────────
DAILY TOTAL                                                  1,126,700     83,140

* Includes system prompt + memory + growing conversation history re-sent each turn

DAILY COST (Sonnet 4.5, no caching):
  Input:  1.127M × $3.00  = $3.38
  Output: 0.083M × $15.00 = $1.25
  TOTAL: $4.63/day = $138.90/month per user  ← UNACCEPTABLE
```

The heartbeat alone — if we naively used LLM for each check — would cost $1.98/day. And the conversation engine's ballooning context (re-sending the entire history each turn) accounts for most of the rest.

### 17.3 The Eight Cost Levers

| # | Lever | Mechanism | Savings |
|---|-------|-----------|---------|
| 1 | **Zero-LLM heartbeat** | Pure SQL + JS logic, no API calls | Eliminates 51% of input |
| 2 | **Model routing** | Haiku for extraction/classification, Sonnet for generation | 60-70% on routed calls |
| 3 | **Prompt caching** | Static prefix cached, only new content processed | 90% on repeated prefix |
| 4 | **Memory compression** | Level 2 pipe-delimited format, 3-5x smaller than narrative | 60-75% on context size |
| 5 | **Batch API** | Overnight processing at 50% discount | 50% on sleep-time |
| 6 | **Pre-generation** | Sleep-time generates templates; conversation just fills them | Eliminates redundant calls |
| 7 | **Context budgeting** | Hard caps on memory injection, aggressive history pruning | Keeps prefix under 12K |
| 8 | **Event-driven micro-batching** | Thinking Queue combines 2-4 events into one Haiku call, not N calls | 50-70% vs per-event calls |

### 17.4 Optimized Prompt Architecture

The key insight: **prompt caching rewards a stable prefix**. Everything that changes rarely goes at the top; everything that changes per-turn goes at the bottom.

```
┌──────────────────────────────────────────────────────────────┐
│ LAYER 1: SOUL + TOOLS (stable for weeks)                     │
│ ~3,000 tokens                                                │
│ Cache: 1-hour TTL — written once, read hundreds of times     │
│ ⬤ cache_control breakpoint                                   │
├──────────────────────────────────────────────────────────────┤
│ LAYER 2: TODAY'S CONTEXT (stable for the day)                │
│ ~2,000-4,000 tokens (compressed Level 2 format)              │
│ Contents:                                                    │
│   - Today's date, schedule, weather                          │
│   - Active blockers + commitments (pipe-delimited)           │
│   - Today's habits + streaks (pipe-delimited)                │
│   - Focus projects summary (pipe-delimited)                  │
│ Cache: 5-min TTL — refreshed by conversation activity        │
│ ⬤ cache_control breakpoint                                   │
├──────────────────────────────────────────────────────────────┤
│ LAYER 3: SESSION CONTEXT (stable within session)             │
│ ~1,000-2,000 tokens                                          │
│ Contents:                                                    │
│   - Morning meeting briefing (pre-generated overnight)       │
│   - Session-specific memory retrievals                       │
│ Cache: 5-min TTL — stays warm during active conversation     │
│ ⬤ cache_control breakpoint                                   │
├──────────────────────────────────────────────────────────────┤
│ LAYER 4: CONVERSATION HISTORY (grows per turn)               │
│ ~200-500 tokens per turn, capped at last 10 turns            │
│ Older turns summarized into a ~200-token rolling summary     │
│ ⬤ cache_control breakpoint (on older messages)               │
├──────────────────────────────────────────────────────────────┤
│ LAYER 5: CURRENT USER MESSAGE (new each turn)                │
│ ~50-500 tokens                                               │
│ Never cached — this is the only "fresh" input                │
└──────────────────────────────────────────────────────────────┘
```

**Why this order matters:** Anthropic's prompt caching works on **prefixes**. The cache key is computed by hashing all blocks sequentially. So the system prompt (Layer 1) must come first — if it changes, everything below it becomes a cache miss. By layering from most-stable to least-stable, we maximize the length of the cacheable prefix.

**Up to 4 cache breakpoints** are allowed. We use all four:
1. After SOUL + tools (1hr TTL)
2. After today's context (5min TTL)
3. After session context (5min TTL)
4. After older conversation history (5min TTL)

### 17.5 Compression Pays for Itself

The Level 2 compressed format isn't just for context-window protection — it directly reduces cost.

```
LEVEL 1 (narrative): 127 tokens
  "Dr. Habib Riazati leads the Ocean of Lights academic research project.
   You've been collaborating since 2023. Last contact was January 28th.
   You're waiting on the tablet schema, which was due February 3rd and
   is now 8 days overdue. He prefers email and is in the Pacific timezone."

LEVEL 2 (compressed): 38 tokens
  "PERSON:Habib_Riazati|scholar|OceanOfLights_lead|since:2023|
   last:Jan28|WAITING:tablet_schema(due:Feb3,overdue:8d)|
   pref:email|tz:Pacific"

SAVINGS: 70% fewer tokens, same information density for the model.
```

For the daily context injection (~20 active items):
- Level 1: ~2,500 tokens → Level 2: ~750 tokens
- Over a 10-message session with caching: saves ~17,500 tokens of cache reads
- Dollar impact: ~$0.005/session on Sonnet, but compounds across all sessions and users

### 17.6 Engine-by-Engine Optimized Costs

#### Heartbeat Engine: $0.00/day

**Design principle: ZERO LLM calls. Period.**

The heartbeat is pure deterministic logic running in a Service Worker against local libSQL:

```javascript
// Heartbeat check — no LLM involved
const heartbeat = async () => {
  const now = new Date()
  const routines = await db.query(`SELECT * FROM routines WHERE active = 1`)
  const checks = [
    // Meeting in 15 min? Compare specific_time to now.
    checkUpcomingMeeting(routines, now),
    // Habit not done? Check completions table.
    checkUnfinishedHabits(routines, now),
    // Overdue waiting_for? Check memories.expires_at.
    checkOverdueWaiting(now),
    // Life event entering remind_before window?
    checkApproachingEvents(routines, now),
  ]
  // Results are pre-generated notification templates, not LLM output
  const notifications = checks.filter(Boolean)
  notifications.forEach(n => showNotification(n.title, n.body))
}
```

**Notification text is pre-generated during sleep-time:**

```sql
-- Sleep-time engine stores tomorrow's potential notifications
INSERT INTO memories (content, compressed, type, source)
VALUES (
  'Meeting with Gilbert in 15 minutes. Briefing: Q1 revenue discussion, summer curriculum update.',
  'NOTIFY:meeting|Gilbert|15min|briefing:Q1_revenue,curriculum',
  'notification_template',
  'sleep_time'
);
```

The heartbeat just matches conditions and displays pre-written text. No tokens consumed.

**What if we need dynamic notification text?** We don't. Every scenario the heartbeat handles is predictable — meetings, habits, deadlines, events — and the sleep-time engine can pre-generate natural-language templates for all of them. The only case that might need LLM is a truly novel situation, and those can wait for the next conversation session.

#### Conversation Engine: Optimized with Caching

**Model: Haiku 4.5 for extraction, Sonnet 4.5 for generation**

```
MORNING MEETING SESSION (10 turns):

Turn 1 (cache cold start):
  Layer 1 (SOUL):      3,000 tok  → cache WRITE (1hr)    = $0.00375  (Sonnet)
  Layer 2 (today):     2,500 tok  → cache WRITE (5min)    = $0.009375
  Layer 3 (session):   1,500 tok  → cache WRITE (5min)    = $0.005625
  Layer 4 (history):   0 tok      → (no history yet)
  Layer 5 (user msg):  200 tok    → fresh input            = $0.0006
  Output:              800 tok    → generation             = $0.012
  TURN 1 TOTAL: $0.031

Turns 2-10 (cache warm):
  Layer 1:  3,000 tok  → cache READ                = $0.0009   (90% savings!)
  Layer 2:  2,500 tok  → cache READ                = $0.00075
  Layer 3:  1,500 tok  → cache READ                = $0.00045
  Layer 4:  ~500 tok avg (growing, partially cached) = $0.0005
  Layer 5:  200 tok    → fresh input                = $0.0006
  Output:   600 tok    → generation                 = $0.009
  TURN 2-10 AVG: $0.013

MORNING SESSION TOTAL: $0.031 + (9 × $0.013) = $0.148

AD-HOC SESSIONS (4 per day, ~5 turns each, shorter):
  Session cold start: ~$0.02 (Layer 1 likely still cached from morning!)
  Per turn: ~$0.011
  Per session: $0.02 + (4 × $0.011) = $0.064
  4 sessions: $0.256

DAILY CONVERSATION COST: $0.148 + $0.256 = $0.404
```

**Critical optimization: Layer 1 stays cached all day.** With 1-hour TTL that refreshes on each read, the SOUL + tools prefix (3K tokens) is written once in the morning and read from cache for every subsequent turn across all sessions. Over 30+ turns/day, that's ~90K tokens read at $0.30/MTok instead of processed at $3/MTok = saving $0.24/day just on the system prompt.

#### Sleep-Time Engine: Batch API + Haiku Routing

**Model: Sonnet 4.5 via Batch API (50% off) for generation; Haiku 4.5 via Batch API for memory consolidation**

The sleep-time engine runs multiple distinct tasks. Each can be a separate batch request with its own optimal model:

```
TASK                         MODEL          INPUT    OUTPUT   BATCH COST
──────────────────────────── ────────────── ──────── ──────── ──────────
Memory consolidation         Haiku batch    40K      8K       $0.040
  (read 500 memories, merge,
   generate Level 2 compressed)

Briefing generation          Sonnet batch   15K      4K       $0.053
  (tomorrow's schedule +
   relevant memories → script)

Notification pre-generation  Haiku batch    8K       3K       $0.012
  (generate all possible
   notification templates)

Habit analytics              Haiku batch    6K       2K       $0.008
  (compute streaks, trends,
   weekly comparison)

Routine advancement          Haiku batch    4K       1K       $0.004
  (check prep chains,
   advance due items)

Personality calibration      Haiku batch    5K       2K       $0.008
  (weekly ÷ 7: analyze
   suggestion acceptance)

NIGHTLY SLEEP-TIME TOTAL: $0.125
```

**Why Haiku for consolidation?** Memory consolidation is mostly pattern-matching and reformatting — "take these 5 status updates about the same project and merge them into one." Haiku handles this at near-Sonnet quality for 1/3 the price. Only briefing generation — which requires nuanced synthesis and natural voice — gets Sonnet.

**Batch API halves all of this.** Every sleep-time task is non-urgent (results needed by morning, not in seconds), making it a perfect Batch API candidate.

#### Research Engine: Batch + Selective

```
RESEARCH (triggered by sleep-time, 0-3 calls/night avg):

Web search integration: ~$0.01/search (Anthropic web search tool pricing)
Analysis per finding:
  Haiku batch:  5K input + 1.5K output = $0.006
Average 2 research calls/night: $0.032

NIGHTLY RESEARCH TOTAL: $0.032
```

**Key: Research is opt-in.** The sleep-time engine only triggers deep research when there's a clear need (complex blocker, upcoming meeting, stale goal). Most nights: 0-2 deep research calls. Quick research (Tier 2) is handled by the Thinking Queue during the day.

#### Thinking Queue: Event-Driven Micro-Batches

```
DAILY THINKING QUEUE (see §7A.6 for full breakdown):

Micro-batch calls/day:    2-4 (event-driven, not timer-based)
Events per batch:          2-4 (COMBINED into single Haiku call)
Input per batch:           ~2,500 tokens (compressed context + all events)
Output per batch:          ~1,200 tokens (structured results)
Web searches (research):   1-2/day at ~$0.01/search

PER BATCH:   $0.0085 (Haiku)
WEB SEARCH:  $0.02/day
DAILY TOTAL: $0.046
```

**Why this is the best dollar in the budget:** For $1.38/month, the user gets same-day research results, adaptive day planning, meeting briefings that update when context changes, and cross-project connection detection. Without it, the assistant is a morning newspaper that can answer questions — with it, it's a strategic partner that's always working in the background.

#### GTD Weekly Review: Batch + Sonnet

```
WEEKLY REVIEW (Sunday night, Sonnet batch):
  Input: ~30K (all projects, memories, patterns, completions)
  Output: ~6K (review document)
  Batch cost: $0.090

DAILY AMORTIZED: $0.013
```

### 17.7 Optimized Daily Cost Summary

```
ENGINE                     DAILY COST    MODEL(S)              METHOD
────────────────────────── ──────────── ───────────────────── ────────────────
Heartbeat                  $0.000       None (pure logic)      Local JS + SQL
Thinking Queue (2-4/day)   $0.046       Haiku + web search     Event-driven micro-batch
Conversation (morning)     $0.148       Sonnet + cache         Prefix caching
Conversation (ad-hoc ×4)   $0.256       Sonnet + cache         Prefix caching
Sleep-time                 $0.125       Haiku/Sonnet batch     Batch API
Research (deep, overnight) $0.020       Haiku batch            Batch API
GTD review (÷7)            $0.013       Sonnet batch           Batch API
────────────────────────── ──────────── ───────────────────── ────────────────
DAILY TOTAL                $0.608

MONTHLY TOTAL              $18.24/user

vs. naive approach:        $138.90/month → $18.24/month = 86.9% reduction
```

**Note:** The Thinking Queue adds only $1.38/month but transforms the experience from "assistant that thinks once a day" to "assistant that's always working for you." This is likely the highest-ROI line item in the entire budget — for $0.046/day, research happens within hours, meeting briefings update in real-time, and the day plan adapts as you complete tasks.

### 17.8 Getting to $5/month: The Haiku-First Architecture

$17/month is viable but not ideal for a consumer product. To hit $5/month, we need a more aggressive model routing strategy:

```
PRINCIPLE: "Haiku for everything, Sonnet for synthesis"

Most conversation turns are simple:
  "Did I do Arabic practice today?" → Haiku (lookup + response)
  "Mark that done" → Haiku (extraction + confirmation)
  "What's on my schedule?" → Haiku (retrieval + format)

Only some turns need Sonnet:
  Morning meeting delivery (nuanced, personal voice)
  Strategic advice ("should I take this meeting?")
  Complex memory synthesis ("what's the status across all my projects?")
  Briefing generation (overnight)
```

**Router implementation:**

```javascript
const routeModel = (userMessage, sessionContext) => {
  // Classification keywords / patterns (no LLM needed for routing)
  const simple = /^(mark|done|complete|check|show|list|what's|when|remind)/i
  const extraction = /^(I |we |had |met |talked |decided )/i
  const complex = /^(should|how|why|what do you think|analyze|compare|plan)/i
  // Route based on intent
  if (simple.test(userMessage)) return 'haiku'
  if (extraction.test(userMessage)) return 'haiku'
  if (complex.test(userMessage)) return 'sonnet'
  // Default to session context: morning meeting → sonnet, quick check-in → haiku
  return sessionContext.type === 'morning_meeting' ? 'sonnet' : 'haiku'
}
```

**Haiku-first cost projection:**

```
ENGINE                     DAILY COST    CHANGE FROM §17.7
────────────────────────── ──────────── ────────────────────
Heartbeat                  $0.000       (same)
Thinking Queue (2-4/day)   $0.046       (already Haiku — no change)
Conversation (morning)     $0.092       Morning briefing delivery = Sonnet
                                        Follow-up turns = Haiku (60% savings)
Conversation (ad-hoc ×4)   $0.096       90% of turns routed to Haiku
Sleep-time                 $0.100       More Haiku, less Sonnet
Research (deep)            $0.015       (already Haiku)
GTD review (÷7)            $0.008       Can use Haiku for most analysis
────────────────────────── ──────────── ────────────────────
DAILY TOTAL                $0.357

MONTHLY TOTAL              $10.71/user
```

**Further reductions to hit $7/month:**

```
ADDITIONAL LEVER               SAVINGS    MECHANISM
───────────────────────────── ────────── ──────────────────────────
Shorter conversations          -15%       Users get efficient; 3 ad-hoc
                                          instead of 4, fewer turns each
Smarter memory retrieval       -10%       Only inject memories relevant
                                          to current topic, not all priority-1
History summarization at 5     -10%       Summarize after 5 turns instead
turns instead of 10                       of 10, smaller Layer 4
Thinking Queue batching        -5%        Accumulate 4+ events before
                                          processing, fewer total calls

PROJECTED: $0.357 × 0.60 = $0.214/day = $6.42/month  ← VIABLE TARGET
```

**The Thinking Queue is NOT a cost to cut.** At $1.38/month, it's the cheapest engine that directly delivers the "always thinking for you" promise. Cutting it saves a dollar but kills the product's differentiation.

### 17.9 The Caching Lifecycle

Understanding when caches are warm vs. cold is critical for budgeting:

```
TIME        EVENT                  CACHE STATE
──────────  ─────────────────────  ──────────────────────────────
3:00 AM     Sleep-time batch runs  No cache (batch doesn't use it)
7:00 AM     User opens app         Layer 1: COLD (write $0.004)
                                   Layer 2: COLD (write $0.003)
                                   Layer 3: COLD (write $0.002)
7:01 AM     Morning meeting turn 2 Layer 1: WARM (read $0.0003)  ← 10x cheaper
                                   Layer 2: WARM (read $0.0003)
                                   Layer 3: WARM (read $0.0002)
7:02-7:15   Turns 3-10             ALL WARM — each turn ~$0.013
7:15 AM     Session ends           Cache TTLs ticking...
7:20 AM     (5 min passes)         Layer 2,3: EXPIRED (5min TTL)
                                   Layer 1: STILL WARM (1hr TTL)
7:30 AM     Thinking Queue runs    NO CACHE (server-side, Haiku, own prompt)
            (research_request)     This is independent of conversation cache
8:00 AM     Ad-hoc: "mark Arabic"  Layer 1: WARM (read — FREE!)
                                   Layer 2: COLD (re-write $0.003)
                                   Layer 3: COLD (re-write $0.002)
8:01 AM     Quick response done    Session ends. 1 turn only.
8:30 AM     Heartbeat: shows       No LLM — displays stored notification
            research notification  from Thinking Queue results
10:30 AM    Ad-hoc: "what's next?" Layer 1: COLD (1hr expired)
                                   Everything re-written.
                                   But this is Haiku → cheap anyway.
11:00 AM    Thinking Queue runs    NO CACHE (server-side, own context)
            (meeting_approaching)  Refreshes Gilbert briefing. $0.009
...
```

**Key insight: Thinking Queue has its own cost model.** It runs server-side with minimal context (compressed user state + events = ~2,500 tokens), so it doesn't benefit from conversation caching — but it doesn't need to. At Haiku pricing with small context, each micro-batch costs under a penny.

**Optimization: Keep Layer 1 alive.** If the user has 3+ sessions/day within an hour of each other, the 1-hour cache on Layer 1 pays for itself many times over. For power users (morning meeting + immediate follow-ups), this is the highest-ROI cache.

**Optimization: Pre-warm cache.** When the app opens, immediately send a lightweight "ping" request that loads Layer 1 + 2 into cache, even before the user types. The first real turn then gets a cache hit. Cost of the ping: ~$0.004 (cache write). Payoff: every subsequent turn in the session is 90% cheaper on the prefix.

### 17.10 Conversation History: The Hidden Cost Bomb

In a naive implementation, conversation history grows linearly and is re-sent every turn:

```
Turn 1:  system + memory + "hello"                    = 7,200 tokens
Turn 2:  system + memory + "hello" + resp + "next?"   = 8,800 tokens
Turn 3:  system + memory + [all above] + resp + "ok"  = 10,600 tokens
...
Turn 10: system + memory + [all history]              = 22,000 tokens
Turn 20: system + memory + [all history]              = 37,000 tokens

TOTAL INPUT across 20 turns: ~440,000 tokens
```

**Solution: Rolling summary + hard cap.**

```javascript
const buildHistory = (turns, maxTurns = 8) => {
  if (turns.length <= maxTurns) return turns
  // Summarize older turns into a single block
  const old = turns.slice(0, -maxTurns)
  const recent = turns.slice(-maxTurns)
  const summary = {
    role: 'user',
    content: `[Earlier in this conversation: ${summarizeLocally(old)}]`
  }
  return [summary, ...recent]
}
// summarizeLocally: no LLM call — just extract key decisions/topics
// from the structured extraction the agent already did on each turn
const summarizeLocally = (turns) => {
  return turns
    .filter(t => t.extraction) // only turns where something was extracted
    .map(t => t.extraction.oneLiner) // "discussed Q1 revenue with Gilbert"
    .join('; ')
}
```

**With rolling summary:**

```
Turn 1-8:   Normal growth (8 turns of history)      = 7,200 → 14,000 tokens
Turn 9:     Turns 1-2 summarized → 100 tokens        = 14,200 tokens
Turn 10:    Turns 1-3 summarized → 150 tokens         = 14,400 tokens
Turn 20:    Turns 1-12 summarized → 400 tokens        = 15,800 tokens

TOTAL INPUT across 20 turns: ~280,000 tokens (36% reduction)
```

**With rolling summary + prompt caching on older history:**

The summarized block + turns up to N-1 can be cached (they don't change). Only the latest turn is fresh. This means Layer 4 is ~90% cache reads after the first few turns.

### 17.11 Batch API Strategy for Overnight Processing

All sleep-time work is submitted as a single batch job:

```javascript
// Submit overnight batch at 3:00 AM (user's timezone)
const overnightBatch = await anthropic.messages.batches.create({
  requests: [
    // 1. Memory consolidation (Haiku)
    {
      custom_id: `${userId}-consolidate`,
      params: {
        model: 'claude-haiku-4-5',
        max_tokens: 8000,
        system: CONSOLIDATION_PROMPT,
        messages: [{ role: 'user', content: allActiveMemoriesCompressed }]
      }
    },
    // 2. Briefing generation (Sonnet)
    {
      custom_id: `${userId}-briefing`,
      params: {
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        system: BRIEFING_PROMPT,
        messages: [{ role: 'user', content: tomorrowContextCompressed }]
      }
    },
    // 3. Notification templates (Haiku)
    {
      custom_id: `${userId}-notifications`,
      params: {
        model: 'claude-haiku-4-5',
        max_tokens: 3000,
        system: NOTIFICATION_PROMPT,
        messages: [{ role: 'user', content: tomorrowScheduleCompressed }]
      }
    },
    // 4. Research (if needed)
    ...researchRequests,
    // 5. Habit analytics (Haiku)
    {
      custom_id: `${userId}-habits`,
      params: {
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        system: HABIT_ANALYTICS_PROMPT,
        messages: [{ role: 'user', content: completionsDataCompressed }]
      }
    }
  ]
})
// Results available within 24 hours (usually much faster)
// Process results and store in user's database before morning
```

**Multi-user batch optimization:** For a SaaS with 1,000 users, all overnight jobs can be submitted as a single batch. Anthropic processes them efficiently, and we get the 50% discount across the board. This is a massive advantage over real-time processing.

### 17.12 Cost at Scale

```
USERS     DAILY COST    MONTHLY COST    ANNUAL COST     PER-USER/MO
───────── ──────────── ──────────────── ─────────────── ────────────
1         $0.32         $9.63           $115.56         $9.63
100       $32.00        $963            $11,556         $9.63
1,000     $280*         $8,400*         $100,800*       $8.40
10,000    $2,400*       $72,000*        $864,000*       $7.20

* Volume discounts: At scale, not every user is active every day.
  Assume 70% DAU at 1K users, 60% at 10K. Inactive users cost $0.
  Also: batch jobs for multiple users can share prompts (system
  prompts identical across users → potential for cross-user caching
  though this requires custom arrangement with Anthropic).
```

**Break-even pricing:**
- At $9.63/user/month cost → $15/month subscription with 36% margin
- At $5.30/user/month cost (Haiku-first) → $9/month subscription with 41% margin
- At $7.20/user/month cost (10K scale) → $12/month subscription with 40% margin

### 17.13 Cost Monitoring & Guardrails

```javascript
// Per-user daily cost tracking
const DAILY_BUDGET = {
  conversation_input: 500_000,  // tokens (hard cap)
  conversation_output: 50_000,
  overnight_input: 100_000,
  overnight_output: 30_000,
  research_calls: 5,
}
// Track in completions/conversations tables
const trackUsage = async (engine, inputTokens, outputTokens) => {
  await db.execute(`
    INSERT INTO usage_log (date, engine, input_tokens, output_tokens)
    VALUES (date('now'), ?, ?, ?)
  `, [engine, inputTokens, outputTokens])
}
// Check budget before each API call
const checkBudget = async (engine) => {
  const today = await db.query(`
    SELECT SUM(input_tokens) as inp, SUM(output_tokens) as out
    FROM usage_log WHERE date = date('now') AND engine = ?
  `, [engine])
  return today.inp < DAILY_BUDGET[`${engine}_input`]
}
// Graceful degradation when approaching limits
// → Switch from Sonnet to Haiku
// → Reduce memory injection
// → Skip optional research
// → Inform user: "I'm conserving resources today"
```

### 17.14 Future Cost Reductions

Costs will continue to fall. Each lever compounds:

```
LEVER                           TIMELINE        PROJECTED IMPACT
─────────────────────────────── ─────────────── ────────────────
Model price decreases           Ongoing          -30-50%/year
  (Haiku 3→3.5→4.5: $0.25→$0.80→$1.00 but
   capability per dollar improving dramatically)

Local models for extraction     6-12 months      -40% of Haiku costs
  (Small quantized model for habit tracking,
   memory classification, notification text —
   runs on-device, zero API cost)

Smarter caching strategies      3-6 months       -10-20%
  (Share system prompts across users in batch,
   1-hour TTL on more layers,
   session resumption without re-sending context)

Context editing                 Available now     -15-25%
  (Anthropic's context editing feature allows
   modifying cached content without full rewrite)

Reduced output verbosity        Phase 1           -20% output tokens
  (Agent trained to be concise, use structured
   output, avoid pleasantries in internal calls)
```

**Projected 12-month cost:** $5.30 × 0.5 (price drops) × 0.7 (local models) = **~$1.85/user/month**

At that point, ThinkDone could offer a free tier with limited overnight processing and a $5/month premium tier with full features — and be profitable on both.

### 17.15 Architecture Rules for Cost Discipline

These rules should be enforced from day one:

```
RULE 1: The heartbeat NEVER calls an LLM.
  If you need natural language, pre-generate it overnight.

RULE 2: Every API call specifies a model.
  No default model. Force the developer to choose Haiku or Sonnet.

RULE 3: System prompt is immutable within a release.
  Changes to SOUL prompt = new deployment, not per-user.
  This maximizes 1-hour cache lifetime.

RULE 4: Memory injection is budgeted, not open-ended.
  Hard cap: 4,000 tokens of compressed memory per session.
  Anything beyond that requires explicit retrieval (vector search
  on the user's message, not pre-loaded).

RULE 5: Conversation history is capped at 8 turns.
  Older turns become a local summary (~200 tokens).
  No session ever exceeds 20K tokens of history.

RULE 6: Overnight processing uses Batch API exclusively.
  No exceptions. If it's not urgent, it's batched.

RULE 7: Research is gated by clear need.
  Sleep-time engine must justify each deep research call with a
  specific trigger (blocker, meeting, stale goal).
  Maximum 5 deep research calls per night.
  Quick research goes through Thinking Queue (Tier 2).

RULE 8: Track token usage per-user per-engine per-day.
  No surprises. If costs spike, know where and why immediately.

RULE 9: Output tokens are 3-5x more expensive than input.
  Agent prompts should request concise, structured output.
  Use JSON/pipe-delimited for internal calls, prose only
  for user-facing content.

RULE 10: When in doubt, use Haiku.
  Haiku 4.5 is "comparable to Sonnet 4" at 1/3 the price.
  Reserve Sonnet for genuinely complex synthesis only.

RULE 11: Thinking Queue events are COMBINED, not individual.
  Never make a separate API call for each event. Accumulate
  2-4 events, process in one Haiku call with combined context.
  Cross-event context often produces better insights anyway.

RULE 12: The Thinking Queue is the last thing you cut.
  At $0.046/day it's the cheapest engine that delivers the
  "always working for you" promise. Cutting it saves a dollar
  but turns the product into just another chat interface.
```

---

## 18. BYOM: Bring Your Own Model

The most radical cost optimization isn't optimizing our API calls — it's **not paying for them at all**. If users bring their own model access, ThinkDone's marginal cost per user drops to near zero.

### 18.1 The BYOM Landscape (Feb 2026)

Browser-based LLM access is viable today, but the landscape is uneven:

```
PROVIDER        BROWSER CORS    AUTH METHOD              NOTES
──────────────  ──────────────  ───────────────────────  ─────────────────────────────
Anthropic       ✅ Yes           API key + header          Requires "anthropic-dangerous-
                                                          direct-browser-access: true"
OpenAI          ✅ Yes           API key                   Works from fetch()
Gemini          ❌ No            CORS blocked              generativelanguage.googleapis.com
                                                          does NOT return CORS headers.
                                                          Requires a proxy.
OpenRouter      ✅ Yes           OAuth PKCE (browser-      Universal gateway. 400+ models.
                                 native) or API key        BYOK: first 1M requests/month free.
```

**Key insight:** Gemini can't be called directly from the browser. Google's API doesn't return CORS headers, confirmed across multiple developer forum threads and unchanged as of early 2026. This means the "connect to user's Gemini subscription" idea requires either a proxy or going through OpenRouter.

### 18.2 OpenRouter as the Universal Gateway

OpenRouter solves the BYOM problem cleanly:

1. **OAuth PKCE flow** — designed for browser SPAs, no server needed for auth
2. **User pays their own bill** — ThinkDone never sees their API key or charges
3. **400+ models** — user chooses Gemini, Claude, GPT, Llama, whatever they prefer
4. **BYOK (Bring Your Own Key)** — user can connect their own Gemini/OpenAI/Anthropic API key through OpenRouter, first 1M requests/month free of OpenRouter surcharge
5. **Automatic fallback** — if one provider is down, routes to another
6. **Unified API** — OpenAI-compatible endpoint, one integration covers all models

```javascript
// BYOM: User authenticates with OpenRouter via PKCE
const initBYOM = async () => {
  // Generate PKCE challenge
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateS256Challenge(codeVerifier)
  // Redirect user to OpenRouter auth
  const authUrl = new URL('https://openrouter.ai/auth')
  authUrl.searchParams.set('callback_url', `${location.origin}/auth/callback`)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  window.location.href = authUrl.toString()
}
// After redirect back, exchange code for API key
const handleCallback = async (code) => {
  const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: storedCodeVerifier })
  })
  const { key } = await response.json()
  // Store encrypted in local DB — user's key, user's device, user's cost
  await storeEncrypted('openrouter_key', key)
}
// Making calls through OpenRouter from browser
const callLLM = async (messages, model = 'anthropic/claude-haiku-4-5') => {
  const key = await getEncrypted('openrouter_key')
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin,
      'X-Title': 'ThinkDone'
    },
    body: JSON.stringify({ model, messages, max_tokens: 1500 })
  })
  return response.json()
}
```

### 18.3 Direct Provider Access (No OpenRouter)

For users who want to skip the middleman and use their own API keys directly:

```javascript
// Anthropic direct from browser — works today
const callAnthropic = async (messages, apiKey) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages
    })
  })
  return response.json()
}
// OpenAI direct from browser — also works
const callOpenAI = async (messages, apiKey) => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 1500 })
  })
  return response.json()
}
// Gemini — CANNOT call directly from browser (no CORS)
// Must use OpenRouter or a Cloudflare Worker proxy
```

### 18.4 The Provider Abstraction Layer

ThinkDone needs a provider abstraction that normalizes across backends:

```javascript
// provider.js — unified LLM interface
const PROVIDERS = {
  thinkdone: {
    // ThinkDone's own API (default, included in subscription)
    endpoint: 'https://api.thinkdone.ai/v1/messages',
    authType: 'session', // uses ThinkDone account auth
    models: { fast: 'haiku-4-5', smart: 'sonnet-4-5' }
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    authType: 'oauth_pkce', // OpenRouter PKCE flow
    format: 'openai', // OpenAI-compatible
    models: { fast: 'anthropic/claude-haiku-4-5', smart: 'anthropic/claude-sonnet-4-5' }
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    authType: 'api_key', // user pastes key
    format: 'anthropic',
    corsHeader: 'anthropic-dangerous-direct-browser-access',
    models: { fast: 'claude-haiku-4-5-20251001', smart: 'claude-sonnet-4-5-20250929' }
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    authType: 'api_key',
    format: 'openai',
    models: { fast: 'gpt-4o-mini', smart: 'gpt-4o' }
  }
}
// Route by task type, respecting user's provider choice
const route = async (taskType, messages, provider = getUserProvider()) => {
  const model = taskType === 'extraction' || taskType === 'classification'
    ? provider.models.fast
    : provider.models.smart
  return callProvider(provider, model, messages)
}
```

### 18.5 BYOM Economics

```
SCENARIO                     THINKDONE COST    USER COST         TOTAL
───────────────────────────  ────────────────  ────────────────  ───────────
Default (ThinkDone pays)     $6-10/user/month  $0                $10-15 subscription
BYOM via OpenRouter          ~$0               $3-8/month*       $5 subscription
BYOM via Anthropic direct    ~$0               $3-8/month*       $5 subscription
BYOM via OpenAI direct       ~$0               $2-6/month*       $5 subscription

* User's estimated LLM cost based on ThinkDone usage patterns
```

**The BYOM pricing model:**
- **Free tier:** BYOM only, user brings their own model, ThinkDone charges nothing
- **$5/month tier:** BYOM with ThinkDone premium features (overnight batch, deep research, advanced habits)
- **$10-15/month tier:** ThinkDone pays for LLM, user pays all-inclusive subscription

**Why this works:** ThinkDone's differentiator isn't the LLM — it's the SOUL prompt, the memory architecture, the Thinking Queue, the habit engine. Those are all code running in the browser and on Cloudflare Workers. The LLM is a commodity input. Let the user choose and pay for it.

### 18.6 Model-Agnostic Prompt Design

BYOM means prompts must work across providers. Key constraints:

```
CHALLENGE                    SOLUTION
───────────────────────────  ──────────────────────────────────────────
Different system prompt       Abstract SOUL into provider-specific
  formats                     format adapters (Anthropic system vs
                              OpenAI system role vs Gemini systemInstruction)

Prompt caching is Anthropic-  Accept: caching only works when using
  only                        Anthropic directly. Other providers don't
                              cache but are often cheaper per-token anyway.

Tool use syntax varies        Use OpenAI function-calling format as
                              canonical (most widely supported). Adapt
                              for Anthropic tool format when direct.

Output quality varies         The SOUL prompt is tested against multiple
  by model                    models. Haiku-class tasks (extraction,
                              classification) work across all fast models.
                              Synthesis tasks may need model-specific
                              tuning stored in personality table.

Token limits differ           Provider abstraction reports max_tokens
                              per model. Memory compression adapts budget
                              based on available context window.
```

**Rule: Write prompts for the weakest model you support.** If extraction works on GPT-4o-mini, it works on everything. If synthesis needs Sonnet-class quality, document that requirement in the task definition and let the router enforce it.

---

## 19. Browser-Native Heartbeat Architecture

Since ThinkDone presents as a persistent todo list / dashboard, the browser is open all day. This eliminates the need for a server-side heartbeat — the browser IS the heartbeat.

### 19.1 Why Browser-Based

```
SERVER HEARTBEAT (original design):
  ✗ Requires always-on server process per user
  ✗ Needs to push notifications via web push API
  ✗ Server has no direct access to local encrypted DB
  ✗ Must sync state between server and client
  ✗ Costs: Cloudflare Workers invocations per user per interval

BROWSER HEARTBEAT (new design):
  ✓ Browser is already open — it's the app's UI
  ✓ Direct access to local encrypted DB (OPFS/libSQL)
  ✓ Direct access to Notification API
  ✓ Zero server cost for heartbeat checks
  ✓ Can call LLM APIs directly (BYOM) or queue to Thinking Queue
  ✓ Works offline for basic checks (local data only)
```

### 19.2 Implementation: Visibility API + Timers

The browser heartbeat uses a layered timing strategy based on the tab's visibility state:

```javascript
// heartbeat.js — browser-native heartbeat engine
class BrowserHeartbeat {
  constructor(db, thinkingQueue) {
    this.db = db
    this.tq = thinkingQueue
    this.timerId = null
    this.lastCheck = null
    // Adjust frequency based on tab visibility
    document.addEventListener('visibilitychange', () => {
      this.reschedule()
    })
    // Also fire on app focus (user switches back to ThinkDone tab)
    window.addEventListener('focus', () => {
      if (this.stale()) this.runChecks()
    })
  }
  get interval() {
    // Foreground: check every 5 min (user is looking at the app)
    // Background: check every 15 min (tab is open but not focused)
    // Hidden: check every 30 min (browser minimized, keep alive)
    return document.hidden ? 30 * 60_000
      : document.hasFocus() ? 5 * 60_000
      : 15 * 60_000
  }
  stale() {
    return !this.lastCheck || (Date.now() - this.lastCheck > this.interval)
  }
  reschedule() {
    clearInterval(this.timerId)
    this.timerId = setInterval(() => this.runChecks(), this.interval)
  }
  async runChecks() {
    this.lastCheck = Date.now()
    const now = new Date()
    const events = []
    // Meeting approaching? (from local calendar data)
    const meetings = await this.db.getUpcomingMeetings(60) // next 60 min
    for (const m of meetings) {
      const minUntil = (new Date(m.start) - now) / 60_000
      if (minUntil <= 15 && !m.notified) {
        this.notify(`Meeting with ${m.title} in ${Math.round(minUntil)} min`)
        await this.db.markNotified(m.id)
      }
      if (minUntil <= 120 && minUntil > 15 && m.contextChanged) {
        events.push({ type: 'meeting_approaching', data: m })
      }
    }
    // Overdue tasks?
    if (now.getHours() >= 14) {
      const overdue = await this.db.getOverdueTodayTasks()
      if (overdue.length > 0 && !this.notifiedToday('overdue')) {
        this.notify(`${overdue.length} task(s) from this morning still open`)
        this.markNotifiedToday('overdue')
      }
    }
    // Habits not done and it's evening?
    if (now.getHours() >= 20) {
      const undone = await this.db.getUndoneHabitsToday()
      for (const h of undone.filter(h => !h.reminded)) {
        const msg = h.two_min_version
          ? `${h.name} still open — even the 2-min version counts!`
          : `${h.name} still open for today`
        this.notify(msg)
        await this.db.markReminded(h.id)
      }
    }
    // Queue thinking events if accumulated
    if (events.length > 0) await this.tq.queue(events)
    // Update the UI's "last updated" indicator
    this.updateStatusIndicator()
  }
  notify(message) {
    // Use Notification API if permission granted
    if (Notification.permission === 'granted') {
      new Notification('Think→Done', { body: message, icon: '/icon.png' })
    }
    // Also update in-app notification panel
    this.db.addNotification(message)
  }
  start() {
    this.runChecks() // immediate first check
    this.reschedule()
  }
}
```

### 19.3 Keeping the Tab Alive

Browser tabs can be throttled or suspended. Strategies to stay active:

```javascript
// Strategy 1: Web Lock API — prevents tab from being discarded
const keepAlive = async () => {
  if (navigator.locks) {
    await navigator.locks.request('thinkdone-heartbeat', { mode: 'exclusive' },
      () => new Promise(() => {}) // never resolves = lock held forever
    )
  }
}
// Strategy 2: Periodic audio context ping (very quiet, prevents suspension)
// Only if user opts in to "keep alive" setting
const audioKeepAlive = () => {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  gain.gain.value = 0.001 // effectively silent
  osc.connect(gain).connect(ctx.destination)
  osc.start()
}
// Strategy 3: Service Worker with periodic sync (most robust)
// Fires even when tab is backgrounded, up to browser limits
if ('serviceWorker' in navigator && 'periodicSync' in ServiceWorkerRegistration.prototype) {
  const reg = await navigator.serviceWorker.ready
  await reg.periodicSync.register('heartbeat', { minInterval: 15 * 60 * 1000 })
}
// Strategy 4: Shared Worker (persists across tabs)
// If user has multiple ThinkDone tabs, only one heartbeat runs
const worker = new SharedWorker('/heartbeat-worker.js')
worker.port.onmessage = (e) => handleHeartbeatResult(e.data)
```

**Graceful degradation:** If the tab gets suspended (laptop closed, browser killed), the next time the user opens ThinkDone, the `focus` event fires, the heartbeat catches up, and any accumulated events are processed. The UX shows: "You were away for 3 hours. Catching up..." then processes everything.

### 19.4 Browser Heartbeat + Thinking Queue Integration

The browser heartbeat queues events, but the Thinking Queue can run either client-side (BYOM) or server-side:

```
BYOM MODE (all processing in browser):
  Browser Heartbeat → detects state change → queues event
  Browser Thinking Queue → accumulates events → calls LLM via OpenRouter/direct
  Result → stored in local encrypted DB → UI updates

HOSTED MODE (ThinkDone pays for LLM):
  Browser Heartbeat → detects state change → queues event
  Events synced to Turso Cloud → Cloudflare Worker processes
  Results synced back → local DB updated → UI updates

HYBRID MODE (default):
  Browser handles: notifications, habit tracking, task display
  Server handles: overnight batch, deep research, web search
  LLM calls: user's BYOM for conversation, ThinkDone's for batch
```

### 19.5 Offline Capability

With the browser heartbeat + local DB, ThinkDone works offline for basic operations:

```
WORKS OFFLINE:
  ✓ View today's tasks, habits, meetings
  ✓ Mark tasks/habits complete
  ✓ Heartbeat checks (all local data)
  ✓ Notifications for upcoming events
  ✓ View pre-generated morning briefing (stored locally)

NEEDS CONNECTIVITY:
  ✗ LLM conversations (needs API)
  ✗ Web search / research
  ✗ Syncing to cloud replica
  ✗ Email/Docs/Dropbox retrieval
  ✗ Thinking Queue processing (if server mode)
```

---

## 20. Tool Integrations: Read-Only Context Retrieval

ThinkDone doesn't need to index your email or documents — it just needs to **retrieve relevant context on demand** when the LLM needs it. Google's OAuth2 system supports browser-based JavaScript applications natively, making read-only access to Gmail, Google Docs, and Dropbox achievable entirely from the client.

### 20.1 Design Principle: Retrieval, Not Indexing

```
WHAT WE DON'T DO:
  ✗ Index all emails into local DB (too much data, privacy risk)
  ✗ Sync Google Drive contents (storage explosion)
  ✗ Mirror Dropbox files (redundant, stale)
  ✗ Build a search engine over user's data

WHAT WE DO:
  ✓ When context would help, fetch specific items on demand
  ✓ Use search APIs to find relevant items (Gmail search, Drive search)
  ✓ Pull just the content needed for the current task
  ✓ Cache retrieved context as temporary memories (TTL: 24hr)
  ✓ Let the LLM decide what to retrieve based on conversation context

STORAGE IMPACT:
  Zero permanent storage for external tool data.
  Temporary cache only: ~50-200 tokens per retrieved item (compressed).
  The external APIs ARE the storage — we're just a read-through lens.
```

### 20.2 Google Workspace Integration (Browser OAuth)

Google's `gapi` JavaScript client library supports full OAuth2 from the browser, with read-only scopes:

```javascript
// Google OAuth setup — runs entirely in browser
const initGoogleAuth = async () => {
  await loadScript('https://apis.google.com/js/api.js')
  await new Promise(resolve => gapi.load('client', resolve))
  await gapi.client.init({
    clientId: GOOGLE_CLIENT_ID,
    discoveryDocs: [
      'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
      'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
      'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'
    ],
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',      // read email
      'https://www.googleapis.com/auth/drive.readonly',       // read docs
      'https://www.googleapis.com/auth/calendar.readonly'     // read calendar
    ].join(' ')
  })
}
```

**Scopes are read-only and minimal.** ThinkDone never modifies, sends, or deletes anything. Users see a clear Google consent screen listing exactly what's accessible.

### 20.3 Gmail: On-Demand Email Context

The LLM uses Gmail search to find relevant emails when conversation context suggests it:

```javascript
// Agent tool: search user's email
const searchEmail = async (query, maxResults = 5) => {
  const response = await gapi.client.gmail.users.messages.list({
    userId: 'me',
    q: query,        // Gmail search syntax: "from:gilbert subject:Q1"
    maxResults
  })
  if (!response.result.messages) return []
  // Fetch snippets (not full bodies — minimize data exposure)
  const emails = await Promise.all(
    response.result.messages.map(async (msg) => {
      const detail = await gapi.client.gmail.users.messages.get({
        userId: 'me', id: msg.id, format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date']
      })
      return {
        id: detail.result.id,
        from: getHeader(detail, 'From'),
        subject: getHeader(detail, 'Subject'),
        date: getHeader(detail, 'Date'),
        snippet: detail.result.snippet // ~100 char preview, no full body
      }
    })
  )
  return emails
}
// Agent tool: get full email (only when user explicitly asks)
const getEmailBody = async (messageId) => {
  const detail = await gapi.client.gmail.users.messages.get({
    userId: 'me', id: messageId, format: 'full'
  })
  return extractPlainText(detail.result.payload)
}
```

**Privacy principle:** Snippets by default, full body only on explicit request. The LLM sees "From: Gilbert | Subject: Q1 Revenue Concerns | Snippet: Hey Chad, wanted to follow up on..." — enough to be useful, minimal exposure.

**Use cases:**
- Morning meeting: "You have an email from Gilbert about Q1 revenue from yesterday. Want me to pull it up?"
- Meeting prep: "Searching for recent emails with Dr. Riazati... found 3 threads about the tablet schema."
- Commitment tracking: "You told Gilbert you'd send the report. I found his original email — want to review it?"

### 20.4 Google Docs / Drive: Document Retrieval

```javascript
// Agent tool: search Google Drive for relevant documents
const searchDrive = async (query, maxResults = 5) => {
  const response = await gapi.client.drive.files.list({
    q: `fullText contains '${query}' and trashed = false`,
    fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
    pageSize: maxResults,
    orderBy: 'modifiedTime desc'
  })
  return response.result.files || []
}
// Agent tool: get document content (Google Docs only)
const getDocContent = async (fileId) => {
  const response = await gapi.client.drive.files.export({
    fileId, mimeType: 'text/plain'
  })
  return response.body
}
```

**Use cases:**
- "Pull up the DRBI summer program proposal" → searches Drive, finds the doc, extracts key sections
- "What did the last board meeting minutes say about facility usage?" → searches for board meeting docs
- Strategic memo cross-reference: overnight research found a grant opportunity → Thinking Queue searches Drive for related proposals

### 20.5 Google Calendar: Schedule Context

Calendar integration is especially valuable — it feeds the morning meeting, meeting prep, and day planning:

```javascript
// Get today's and tomorrow's events
const getUpcomingEvents = async (days = 2) => {
  const now = new Date()
  const future = new Date(now.getTime() + days * 86400000)
  const response = await gapi.client.calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    fields: 'items(id,summary,start,end,location,attendees,description)'
  })
  return response.result.items || []
}
```

**This replaces the manual calendar sync** discussed in §14 Phase 5. Instead of importing calendar data into our DB, we query it live. The morning meeting calls `getUpcomingEvents()`, the heartbeat calls it before each check cycle, and the Thinking Queue uses it to determine if a meeting briefing needs refreshing.

### 20.6 Dropbox Integration

Dropbox supports OAuth2 with PKCE for SPAs and has a JavaScript SDK:

```javascript
// Dropbox OAuth (PKCE flow, browser-native)
// Uses @dropbox/sdk or direct fetch
const searchDropbox = async (query, accessToken) => {
  const response = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      options: { max_results: 5, file_status: 'active' }
    })
  })
  return response.json()
}
```

### 20.7 Tool Registration for the LLM

These integrations surface as **tools** in the LLM's system prompt, only when the user has connected the relevant service:

```javascript
// Build tool list based on connected integrations
const getAvailableTools = () => {
  const tools = []
  if (hasGoogleAuth()) {
    tools.push(
      { name: 'search_email', description: 'Search Gmail for relevant emails', params: { query: 'string', maxResults: 'number' } },
      { name: 'get_email', description: 'Get full email content by ID', params: { messageId: 'string' } },
      { name: 'search_drive', description: 'Search Google Drive for documents', params: { query: 'string' } },
      { name: 'get_document', description: 'Get content of a Google Doc', params: { fileId: 'string' } },
      { name: 'get_calendar', description: 'Get upcoming calendar events', params: { days: 'number' } }
    )
  }
  if (hasDropboxAuth()) {
    tools.push(
      { name: 'search_dropbox', description: 'Search Dropbox for files', params: { query: 'string' } }
    )
  }
  return tools
}
```

**The agent decides when to use tools.** If the user says "What did Gilbert email me about?", the agent calls `search_email` with query "from:Gilbert". If the user asks "Help me prepare for the DRBI board meeting", the agent might call `get_calendar` (to find the meeting), `search_email` (for related threads), and `search_drive` (for board docs) — all within a single conversation turn.

### 20.8 Privacy & Security Model for Integrations

```
PRINCIPLE                   IMPLEMENTATION
─────────────────────────── ─────────────────────────────────────────────
User controls all access    OAuth scopes are read-only. User can
                            revoke at any time via Google/Dropbox settings.

Data stays in the browser   API calls go browser → Google/Dropbox directly.
                            ThinkDone servers never see the data.

Minimal data retention      Retrieved content cached as temporary memories
                            with 24hr TTL. Full email bodies never stored.

No background scraping      Tools only fire during active conversation
                            or Thinking Queue processing. No bulk indexing.

Transparent tool use        UI shows when the agent uses a tool: "🔍 Searching
                            your email for messages from Gilbert..."

Graceful without tools      Everything works without integrations.
                            They're context enhancers, not dependencies.
                            Morning meeting still works with manual input.
```

### 20.9 Integration Cost Impact

```
INTEGRATION           COST TO THINKDONE    COST TO USER    RATE LIMITS
────────────────────  ───────────────────  ──────────────  ─────────────────
Google (Gmail/Drive/  $0 (APIs are free     $0              Gmail: 250 quota
  Calendar)            for OAuth apps)                      units/sec/user
                                                            Drive: 12,000/day
Dropbox               $0 (free API for      $0              ~20 calls/min
                       <500 users/month)

Token cost to send    ~200-500 tokens per   Included in     N/A
  results to LLM       retrieval to context  LLM cost
```

**Net effect:** Zero additional cost to ThinkDone. Marginal LLM token increase (~200-500 tokens per tool use). Massive increase in context quality. The morning meeting with email + calendar + Drive context is worth 10x the meeting without it.

---

## 21. Revised Architecture Overview

With BYOM, browser heartbeat, and tool integrations, the architecture simplifies in some ways and expands in others:

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                            │
│                    (open all day as todo/dashboard)               │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Conversation │  │  Heartbeat   │  │ Tool Integrations    │   │
│  │    Engine    │  │   (browser   │  │ (Gmail, Drive, Cal,  │   │
│  │  (morning    │  │    timers +  │  │  Dropbox via OAuth)  │   │
│  │   meeting,   │  │    visibility│  │                      │   │
│  │   ad-hoc)    │  │    API)      │  │  Browser → Google    │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│  ┌──────┴─────────────────┴──────────────────────┴────────────┐  │
│  │         Encrypted libSQL (OPFS/local)                      │  │
│  │         PIN-derived AES-256-GCM key                        │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │                                      │
│  ┌────────────────────────┴───────────────────────────────────┐  │
│  │         Provider Abstraction Layer                          │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │ThinkDone │ │OpenRouter│ │Anthropic │ │OpenAI        │  │  │
│  │  │  (hosted)│ │ (PKCE)   │ │ (direct) │ │(direct)      │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                           │ passive sync (encrypted pages)       │
└───────────────────────────┼──────────────────────────────────────┘
                            │
                    ┌───────┴────────┐
                    │  Turso Cloud   │
                    │  (encrypted    │
                    │   replica)     │
                    └───────┬────────┘
                            │
┌───────────────────────────┼──────────────────────────────────────┐
│                SERVER (Cloudflare Workers)                        │
│            Only needed for: overnight batch, deep research,      │
│            web search, and hosted-mode LLM calls                 │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Sleep-Time  │  │   Research   │  │  Thinking Queue        │ │
│  │   Engine     │  │   Engine     │  │  (server-side for      │ │
│  │  (overnight  │  │  (deep web   │  │   hosted mode; runs    │ │
│  │   batch)     │  │   search)    │  │   in browser for BYOM) │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 21.1 What Moves to the Browser

```
PREVIOUSLY SERVER-SIDE           NOW BROWSER-NATIVE
────────────────────────────────  ──────────────────────────────────
Heartbeat (Cloudflare Worker)   → Browser timers + Visibility API
Conversation LLM calls           → Browser → LLM API (BYOM) or
                                   Browser → ThinkDone proxy (hosted)
Calendar sync (cron job)         → Live Google Calendar API calls
Thinking Queue (in BYOM mode)   → Browser processes events directly
Notification delivery            → Browser Notification API
```

### 21.2 What Stays Server-Side

```
STILL SERVER-SIDE               WHY
────────────────────────────────  ──────────────────────────────────
Overnight batch (sleep-time)     Browser may be closed at 3 AM.
                                 Batch API is server-only anyway.
Deep research (web search)       Web search APIs typically don't
                                 support browser CORS. Need proxy.
Turso sync relay                 Database replication infrastructure.
Hosted-mode LLM calls           When ThinkDone pays for the LLM,
                                 calls route through our proxy.
```

### 21.3 Updated Cost Model with BYOM

```
SCENARIO A: FULL BYOM (user pays all LLM costs)

ThinkDone server costs per user:
  Turso Cloud sync:          $0.01/day (minimal storage + sync)
  Overnight batch (if any):  $0.00     (user's BYOM key used)
  Web search proxy:          $0.02/day (Cloudflare Worker + search API)
  ─────────────────────────────────────
  TOTAL:                     $0.03/day = $0.90/month

  ThinkDone subscription:    $5/month (free tier possible at $0 with ads/limits)
  Margin:                    $4.10/user/month = 82%

SCENARIO B: HYBRID (ThinkDone pays for overnight, user pays for conversation)

  ThinkDone server costs:    $0.15/day (overnight batch on our Haiku)
  User's BYOM costs:         ~$0.20/day (conversation on their key)
  ─────────────────────────────────────
  ThinkDone:                 $4.50/month
  User:                      $6.00/month LLM + $5/month subscription

SCENARIO C: ALL-INCLUSIVE (ThinkDone pays everything)

  Same as §17 analysis:      $6.42-10.71/month cost
  Subscription:              $12-15/month
  Margin:                    35-45%
```

**BYOM transforms the unit economics.** At $0.90/month server cost with a $5 subscription, ThinkDone is profitable from user #1 with no scale needed.

---

*Think→Done: Because your goals deserve a mind that never forgets, never sleeps, and never stops working for you.*
