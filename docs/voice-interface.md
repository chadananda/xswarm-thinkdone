Below is a concise PRD-style recommendation tailored to an ES6/Astro/Svelte/Tailwind app on Cloudflare Pages, with a cloud voice backend and future local S2S.

***

## 1. Product summary

**Product**
AI Personal Planner that users can interact with via:

- Web portal (voice + text)
- SMS
- Phone calls through a dedicated Twilio number (1 USD/month/number)

**Goal (MVP)**
Enable users to have short, high‑value, voice‑interactive planning sessions with an AI assistant, while keeping infra cost low and reusing the same backend for web and phone.

***

## 2. Frontend (Astro/Svelte/Tailwind on Cloudflare Pages)

### 2.1 Tech constraints

- Static hosting on Cloudflare Pages.
- Frontend-only runtime: ES modules, Svelte components, Tailwind styling.
- No long‑running server on the Pages side (backend must be via Cloudflare Workers / external services).

### 2.2 User flows

1. **Login / onboarding**
   - User signs up / logs in.
   - Sees assigned phone number and brief instructions: “Call or text this number to reach your planner”.

2. **Web voice session**
   - Click “Start voice session”.
   - Browser:
     - Requests mic permission.
     - Opens WebSocket to `wss://voice.<your-domain>/ws` (Cloudflare Worker or external backend).
     - Streams audio up; plays audio down.
   - UI shows:
     - Live transcript (user + assistant text).
     - Simple controls: Start, Stop, Mute, End session.

3. **Web text chat**
   - Svelte chat component:
     - Sends messages via `POST /api/chat`.
     - Shows assistant replies and marks which ones were also spoken.

4. **Planner dashboard**
   - Simple agenda/tasks view (read from REST API).
   - “Generate plan for today / this week” buttons that trigger LLM planning via HTTP.

### 2.3 Frontend implementation notes

- Use Astro for routing/layout, Svelte for interactive components (voice control, chat, dashboard).
- Tailwind for styling; keep UI minimal.
- All real-time work (WebSocket, audio) is done from the browser to the voice backend, not via Astro.

***

## 3. Backend architecture (high-level)

Host backend either as:

- Cloudflare Workers (for APIs + WebSockets), or
- A small external service (FastAPI/Node) fronted by Cloudflare (recommended for lower friction with audio).

For the PRD, treat backend as `api.<your-domain>` with:

- HTTP APIs (REST/JSON)
- WebSocket endpoint for voice

### Core services

1. **Auth & user service**
   - Stores users, Twilio phone mapping, settings.

2. **Session & planning service**
   - Entities:
     - User
     - PlanningSession (daily/weekly)
     - PlanItem (tasks, events, notes)
     - Memory (short notes about preferences)
   - APIs:
     - `GET /api/plan/today`
     - `POST /api/plan/generate`
     - `POST /api/chat` (text-based conversation)

3. **Planner brain (LLM)**
   - Uses **gpt‑4o‑mini** for:
     - Interpreting user text (from STT or SMS).
     - Generating planning decisions and assistant responses.
     - Updating PlanItems and Memories via backend tools.

4. **Voice service**
   - WebSocket: `wss://voice.<your-domain>/ws`
   - Responsibilities:
     - Receive user audio (web or Twilio stream → STT).
     - Call planner brain (text in → text out).
     - Stream TTS audio back.
   - Uses **managed STT+TTS**:
     - STT: Whisper / 4o‑mini transcribe via API.
     - TTS: OpenAI TTS / gpt‑4o‑mini‑tts streaming.

5. **Twilio integration**
   - Voice: `/twilio/voice` webhook → TwiML with `<Stream>` to voice backend.
   - SMS: `/twilio/sms` webhook → text into planner brain; reply via SMS.

***

## 4. APIs (PRD-level, not full spec)

### 4.1 WebSocket voice endpoint

**Endpoint**
`wss://voice.<your-domain>/ws`

**Client → Server messages**

```jsonc
// Start session
{ "type": "start", "session_id": "uuid", "user_id": "uuid" }

// Audio from user (binary or base64)
{ "type": "audio_chunk", "session_id": "uuid", "audio": "<binary/base64>" }

// End session
{ "type": "stop", "session_id": "uuid" }
```

**Server → Client messages**

```jsonc
// Partial transcript
{ "type": "stt_partial", "text": "so today let's..." }

// Final transcript for user turn
{ "type": "stt_final", "text": "So today let's plan your afternoon." }

// Assistant text (optional captions)
{ "type": "assistant_text_delta", "delta": "First, let's look at your tasks." }

// Assistant audio
{ "type": "audio_chunk", "audio": "<binary/base64>" }

// End of assistant response
{ "type": "assistant_done" }
```

### 4.2 HTTP APIs (examples)

- `POST /api/chat`
  - Body: `{ user_id, message }`
  - Returns: `{ reply, state_updates }`

- `GET /api/plan/today`
  - Returns: list of PlanItems.

- `POST /api/plan/generate`
  - Body: `{ user_id, scope: "today" | "week" }`
  - LLM generates/updates PlanItems.

***

## 5. Technology choices (“sweet spot”)

### 5.1 LLM: planner brain

- **Model**: gpt‑4o‑mini (hosted).
- Use plain HTTPS chat API (not Realtime) to keep costs low and control prompting.
- Tools:
  - `get_plan`, `update_plan`, `add_task`, `summarize_day` implemented as backend HTTP/DB calls the planner service exposes (not as model-side tools for now).

### 5.2 STT

- Start with **OpenAI Whisper API / 4o‑mini transcribe** (~0.003–0.006 USD/min). [brasstranscripts](https://brasstranscripts.com/blog/openai-whisper-api-pricing-2025-self-hosted-vs-managed)
- Web:
  - Browser streams audio → backend → STT API → text.
- Twilio:
  - Twilio Media Streams → backend → STT API → text.

### 5.3 TTS

- **OpenAI TTS / gpt‑4o‑mini‑tts streaming** (~0.015 USD/min effective). [costgoat](https://costgoat.com/pricing/openai-tts)
- Serve audio frames to:
  - Web: via WebSocket.
  - Twilio: via Media Streams or by serving a streaming audio URL.

### 5.4 Local S2S (future)

- Same interface as voice backend, but implemented on your Framework desktop with:
  - Local STT (Whisper)
  - Local LLM
  - Local TTS / S2S model
- Dev config: web app can target `ws://localhost:…` instead of cloud when you prototype.

***

## 6. Cost & behavior guidelines

- **Phone number**: 1 USD/month/user (Twilio).
- **Voice usage** (MVP target):
  - Encourage ~10–20 min/day of assistant speech per active user:
    - Intro: “Let’s keep this planning call to about 10 minutes.”
    - Suggest text follow-up for details.
- **Text usage**:
  - Unlimited SMS + web chat (within fair-use) since text is cheaper than voice.

***

## 7. MVP scope

**Must have**

- Web login with basic dashboard (Astro/Svelte/Tailwind).
- Web voice sessions via WebSocket (mic in, audio out).
- SMS + voice integration for at least one region (Twilio).
- Basic planning features:
  - Capture tasks/goals.
  - Daily planning session script (LLM prompt).
  - Simple “today’s plan” view.

**Nice to have**

- Weekly reviews and summaries.
- Multi-language hints.
- Per-user config: preferred meeting length, time windows, tone.

***

This PRD keeps the frontend within Cloudflare Pages constraints, uses a cheap‑but‑good cloud stack for voice now, and sets you up to drop in your local S2S box later just by swapping the voice backend host.