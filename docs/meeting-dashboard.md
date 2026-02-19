# ThinkDone — Planning Meeting Dashboard
## Conceptual Specification & Implementation Guide

---

## 1. Core Concept

**"The War Room Study"** — A voice-first AI planning session interface that combines a productivity coach chat with a living dashboard of the user's goals, projects, habits, and tasks. The aesthetic is warm command center: dark earthy tones with amber/gold as the action color. Think mission control designed by someone who reads poetry.

The interface serves a single purpose: **a structured planning meeting between the user and their AI productivity coach**. The AI guides the user through a meeting agenda while simultaneously building, reordering, and updating a priority task list and surfacing insights about goal/project health. The meeting is conversational but productive — every exchange potentially modifies the visible dashboard state.

---

## 2. Information Architecture

### 2.1 The Five Information Layers

The dashboard presents five distinct layers of information, each at a different altitude of abstraction:

1. **Life Goals / Goal Orbit** (highest altitude) — The 5-10 major goals and projects that define the user's current season of life. Shown as progress rings. Always visible. Changes slowly (weekly/monthly).

2. **Project Health** — Status, velocity, and blockers for active projects. Updated during the meeting. Changes moderately (daily/weekly).

3. **Today's Context** — Calendar events, meetings, deadlines, and time-sensitive items. The "reality constraints" that shape what's possible today.

4. **Priority Task Stack** — The actionable task list, ordered by priority. The primary output of the meeting. Changes frequently (every meeting).

5. **Habits & Streaks** — Personal recurring commitments (reading, exercise, language study, meditation). Optional layer — some users care deeply, others skip entirely. Changes daily.

### 2.2 Meeting-Specific Layers

These exist only during the active meeting:

- **Meeting Agenda** — The structured checklist of meeting phases
- **Emerging Questions** — AI-surfaced questions that arise mid-conversation
- **Meeting Progress** — How far through the agenda we are
- **Weekly Scorecard** — Summary metrics for the current week

---

## 3. Desktop Layout — Three Columns + Top Strip

### 3.1 Top Bar (full width, ~50px tall)

Left-to-right:

- **ThinkDone wordmark** — Bold, warm gold. No logo graphic needed yet.
- **Session label** — Small muted text: "PLANNING SESSION" or "DAILY STANDUP" or "WEEKLY REVIEW" depending on meeting type.
- **Goal Orbit Strip** — Horizontally scrollable row of progress rings (one per goal/project/habit). Each ring is ~40px with a unique icon centered inside. Hover/tap reveals a tooltip with name, progress percentage, and category. These rings are the "life dashboard at a glance." The color of each ring reflects its category or is user-assigned. The rings subtly animate on load (progress fills in).
- **Today's Calendar Events** — Compact chips showing time + title for today's meetings/events. These provide temporal context: "you have 3 hours before your next meeting." Color-coded by type (meeting, deadline, reminder, birthday).

**Design notes:** The top bar is the "situational awareness" strip. It answers: "What are my big goals, and what's happening today?" without requiring any interaction. It should feel like an airplane instrument panel — information-dense but scannable.

### 3.2 Left Column — Priority Task Stack (280-320px wide)

This is the primary output artifact of the meeting. It's a living, reorderable list of tasks.

**Section header:** "Priority Stack" with a count of active/done tasks.

**Task items** (top to bottom, ordered by priority):

Each task row contains:
- **Checkbox** — Rounded square. Border opacity/color fades with priority (P1 is bright amber, P8 is barely visible). Checked state shows green checkmark with strikethrough text.
- **Task text** — The action item. 1-2 lines max.
- **Metadata row** below the text:
  - Project tag (small pill/chip with project name)
  - Due indicator ("Today" in amber, "Tomorrow" in neutral, "Overdue" in red)
- **Priority badge** — Right-aligned, shows P1, P2, etc. Opacity fades with priority number so the eye is drawn to the top items.

**Interaction behaviors:**
- Click checkbox to toggle done
- Drag to reorder (changes priority numbers)
- Swipe-left to defer/reschedule (mobile)
- Long-press or right-click for context menu: edit, defer, delegate, delete, move to project
- The AI coach can suggest reordering during the meeting — the list animates to show proposed changes, user confirms or rejects

**Habit Streaks Footer** (collapsible, bottom of left column):

A toggleable section showing personal habit streaks as small chips. Each chip shows: icon, habit name, streak count in days. This section is collapsed by default for users who don't track habits, and expanded for those who do. The AI can prompt: "Want to check in on your habits?" and expand this section.

**Design notes:** The left column should feel like a physical notepad or index card stack. Tasks at the top should feel "heavy" and important. Tasks near the bottom fade in visual weight. The done items can optionally be hidden or shown at the bottom with reduced opacity.

### 3.3 Center Column — Chat Arena (flexible width, fills remaining space)

This is the heart of the interface — the conversation with the AI productivity coach.

**Meeting Progress Bar** (top of center column):

A thin horizontal progress bar showing meeting completion. Left-aligned label "MEETING PROGRESS" in small muted text. The bar fills left-to-right with an amber-to-gold gradient as agenda items are completed. Right side shows fraction (e.g., "2/7"). This gives the user a sense of momentum and pacing.

**Chat Message Area** (scrollable, fills center):

Standard chat layout with two bubble styles:
- **AI messages** — Left-aligned. Subtle amber-tinted background. Small "THINKDONE COACH" label above the first message in a sequence. The AI's messages can contain:
  - Plain text (advice, questions, observations)
  - Inline task suggestions (rendered as actionable cards the user can accept/reject/modify)
  - Inline priority reordering proposals (shows before/after with accept button)
  - Project health summaries (mini cards with velocity indicators)
  - Brainstorm lists (when the AI generates options for the user to evaluate)
  - Calendar conflict warnings
  - Motivational observations based on streak data or progress

- **User messages** — Right-aligned. Blue-tinted background. Can be typed text or voice transcript.

**Special Chat Cards** — The AI can emit structured cards inline in the conversation:

- **Task Card** — Proposed task with project tag, suggested priority, and due date. User can tap "Add to Stack" to insert it into the left column.
- **Reorder Card** — Shows current priority order vs. proposed order. User can accept, modify, or dismiss.
- **Decision Card** — When a question from the Emerging Questions zone is addressed, the AI can emit a decision card summarizing the conclusion.
- **Brainstorm Card** — A numbered list of ideas with vote/star buttons. Starred items can become tasks.
- **Goal Update Card** — Proposes changing a goal's progress percentage based on the conversation.

**Voice + Input Bar** (bottom of center column):

Left-to-right:
- **Voice Orb** — 64px circular button. The primary interaction point. Two states:
  - **Inactive:** Dark, muted amber border, hollow icon. Tapping activates voice input.
  - **Active:** Bright amber fill with radial gradient, pulsing glow animation, solid icon. Audio is being captured. Tapping again stops and sends.
  - When voice is active, the text input placeholder changes to "Listening..." and can show a live transcript.
  - The orb should feel like the most important button on the screen. It's the "start talking" button.

- **Text Input** — Standard text field with rounded corners. Placeholder: "Type or tap the orb to speak..." Functions as both manual input and voice transcript display.

- **Send Button** — Amber-tinted button. Sends the current text input.

**Design notes:** The chat arena should feel spacious and calm. Generous padding. The AI's messages should feel like a thoughtful advisor speaking, not a chatbot spitting responses. The structured cards break up the text flow and make the conversation feel productive rather than just conversational.

### 3.4 Right Column — Meeting Sidebar (260-300px wide)

This column is the meeting's "control panel" — it shows where we are in the meeting and surfaces insights.

**Meeting Agenda** (top section, scrollable):

An ordered checklist of meeting phases. Each item shows:
- **Status icon** — ✓ (done, green), ● (active, amber), ○ (pending, muted)
- **Item text** — The agenda step description
- **Phase tag** — Small colored pill indicating the phase type:
  - `reflect` (blue) — Looking back at what happened
  - `orient` (green) — Understanding current situation
  - `decide` (amber) — Making priority decisions
  - `create` (purple) — Brainstorming and ideation
  - `commit` (red-orange) — Setting firm commitments

The active item has a left border highlight and subtle background tint. Done items are struck through and faded.

The agenda is not static — the AI can add items during the meeting based on the conversation. For example, if the user mentions a blocker, the AI might add "Discuss [blocker] resolution" to the agenda.

**Emerging Questions Zone** (below agenda):

A dashed-border container that holds questions surfaced by the AI during the meeting. These are things like:
- "Should OoL launch target Naw-Rúz?"
- "Revisit BlogWorks pricing tiers?"
- "Is the WholeReader demo good enough for investors?"

Questions appear here when the AI identifies decision points in the conversation. When a question is addressed (the user makes a decision), it fades out or transforms into a decision summary. If a question is complex enough, the AI can promote it to an agenda item.

This zone can be empty at the start of the meeting and grow organically. It should feel like a living scratchpad of "things we need to figure out."

**Project Health** (lower section):

A compact list of active projects with three data points each:
- **Project name**
- **Health label** — "on track" (green), "steady" (yellow), "needs focus" (red), "ahead" (green), "blocked" (red)
- **Velocity indicator** — ▲ (accelerating), ► (steady), ▼ (decelerating)

The AI updates these during the meeting based on the conversation. If the user reports a blocker, the velocity arrow changes. If tasks are completed, health improves.

**Weekly Scorecard** (bottom section, fixed):

Three compact metric cards side by side:
- **Tasks Done** — Fraction (e.g., "23/31") representing tasks completed this week vs. total
- **Habits** — Fraction of habit check-ins completed
- **Focus Hours** — Estimated deep work hours logged

These provide week-level context. The AI can reference them: "You're at 74% task completion this week — two more tasks today gets you to your weekly goal."

---

## 4. Meeting Workflow

### 4.1 Meeting Types

The system supports multiple meeting types, each with a different default agenda:

- **Daily Planning** (10-15 min) — Quick review of yesterday, triage today's priorities, check calendar
- **Weekly Review** (30-45 min) — Full goal/project review, habit assessment, planning next week
- **Monthly Strategy** (60 min) — Goal progress evaluation, project pivots, new goal setting
- **Ad-hoc Focus** (variable) — User wants to brainstorm or deep-dive on a specific project

### 4.2 Daily Planning Flow (default)

1. **Greet & Reflect** — AI summarizes yesterday's results. "You completed 6/8 tasks. Nice work on the WholeReader demo."
2. **Calendar Orient** — AI shows today's schedule. "You have 3 meetings today. Your biggest open block is 12:30-2:00 PM."
3. **Priority Triage** — AI suggests today's priority order. User discusses, reorders, adds/removes tasks. This is the most interactive phase.
4. **Project Health Check** — AI asks about any blockers or updates on active projects. Updates the project health indicators.
5. **Habit Check-in** (optional) — AI asks about daily habits if the user has them configured.
6. **Brainstorm** (optional) — If time allows, dive into a specific project question or marketing angle.
7. **Commit** — AI summarizes the plan. "Today you're focused on X, Y, Z. Your stretch goal is W. Let's do it."

### 4.3 How the AI Modifies the Dashboard

The AI is not just a chatbot — it actively manipulates the visible dashboard during the meeting:

- **Adds tasks** to the Priority Stack (with user confirmation)
- **Reorders tasks** based on discussion (shows before/after, user approves)
- **Marks agenda items** complete as topics are covered
- **Surfaces questions** in the Emerging Questions zone
- **Updates project health** indicators based on reported blockers/progress
- **Updates goal progress rings** when milestones are discussed
- **Modifies habit streaks** when the user reports completions
- **Adds calendar context** when time-sensitive items are discussed

---

## 5. Mobile Layout Strategy

### 5.1 Core Principle: Tab-Based Navigation with Persistent Voice

On mobile, the three columns collapse into a **tabbed single-column view** with the Voice Orb always accessible. The meeting is still voice-first — the phone becomes a "walkie-talkie to your productivity coach."

### 5.2 Mobile Structure

**Persistent Top Bar (slim, ~44px):**
- ThinkDone wordmark (small)
- Meeting progress bar (thin, fills remaining width)
- Compact meeting timer or phase indicator

**Persistent Bottom Bar (~70px):**
- Voice Orb (centered, 56px) — Always visible, always tappable. This is the anchor.
- Text input (expandable — tapping reveals full input bar that slides up)
- Tab navigation icons flanking the orb (see below)

**Tab Navigation (integrated into bottom bar or as swipeable views):**

Four tabs, swipeable left/right like a card deck:

1. **Chat** (default/home tab) — Full-screen chat view. This is where the meeting happens. Structured cards from the AI are full-width and tappable. Swipe up on a task card to add it to the stack.

2. **Tasks** (left swipe from chat) — Full-screen Priority Stack. Identical to the desktop left column but full-width. Drag to reorder. Swipe-left on a task to defer. Habit streaks section at bottom (collapsible).

3. **Dashboard** (right swipe from chat) — The "life at a glance" view. Contains:
   - Goal Orbit as a grid of progress rings (2-3 per row instead of horizontal strip)
   - Project Health list
   - Weekly Scorecard
   - Today's Calendar Events (vertical list instead of horizontal chips)

4. **Agenda** (accessible via meeting progress bar tap or swipe) — Full meeting agenda with emerging questions below. Phase tags and status icons. Tapping an agenda item scrolls the chat to the relevant conversation point.

### 5.3 Mobile Interaction Patterns

**Voice-First Flow:**
- User taps the Voice Orb, speaks their update/question
- AI responds with voice (when S2S is available) and text
- Structured cards appear inline in chat
- User taps cards to accept/reject/modify
- Dashboard updates happen automatically and are reflected when user swipes to other tabs

**Notification Dots:**
- The Tasks tab icon shows a badge when the AI has proposed new tasks or reordering
- The Dashboard tab shows a badge when project health has changed
- The Agenda tab shows a badge when new questions have been surfaced

**Gesture Navigation:**
- Swipe between tabs (chat is the home/center tab)
- Pull-down on chat to see the Goal Orbit strip (like a drawer)
- Long-press Voice Orb for push-to-talk (release to send)
- Swipe-up from bottom to expand text input

### 5.4 Mobile-Specific Considerations

**Compact Card Designs:**
- Task cards in chat should be single-tap actionable (add to stack)
- Brainstorm cards should use swipe-right to star, swipe-left to dismiss
- Decision cards should have large tap targets

**Progressive Disclosure:**
- Start with just Chat + Voice Orb visible
- Introduce other tabs via AI suggestion: "I've updated your task list — swipe left to review"
- Habit section hidden until AI asks about habits
- Keep the screen uncluttered; let the conversation drive what appears

**Offline Considerations:**
- Tasks and agenda should be cached locally
- Voice recordings should queue for processing
- Chat history should be available offline
- Progress rings should show last-known state

---

## 6. State Management Concepts

### 6.1 Core Data Objects

```
Meeting {
  id, type (daily/weekly/monthly/adhoc),
  startedAt, status (active/paused/complete),
  agenda: AgendaItem[],
  emergingQuestions: Question[],
  transcript: Message[]
}

AgendaItem {
  id, text, phase (reflect/orient/decide/create/commit),
  status (pending/active/done), addedDuring (boolean)
}

Question {
  id, text, surfacedAt, resolvedAt, resolution (string|null)
}

Task {
  id, text, project, priority, due, done,
  createdDuring (meetingId|null),
  suggestedBy (ai|user)
}

Goal {
  id, name, progress (0-100), color, category (project/habit),
  icon, lastUpdated
}

HabitStreak {
  id, name, icon, currentStreak, longestStreak,
  todayComplete (boolean)
}

ProjectHealth {
  id, name, velocity (up/steady/down),
  health (on-track/steady/needs-focus/blocked/ahead),
  lastUpdated
}

WeeklyScorecard {
  tasksDone, tasksTotal,
  habitsCompleted, habitsTotal,
  focusHours
}
```

### 6.2 AI Coach Capabilities (Actions the AI can take)

The AI's responses can include structured action payloads that modify dashboard state:

- `addTask(text, project, suggestedPriority, due)` → Appears as a Task Card in chat for user confirmation
- `reorderTasks(newOrder[])` → Appears as a Reorder Card
- `completeAgendaItem(id)` → Automatically marks agenda item done
- `addAgendaItem(text, phase)` → Inserts into agenda list
- `surfaceQuestion(text)` → Adds to Emerging Questions
- `resolveQuestion(id, resolution)` → Removes from questions, optionally logs decision
- `updateProjectHealth(id, velocity, health)` → Updates right column
- `updateGoalProgress(id, newProgress)` → Animates progress ring change
- `updateHabitStreak(id, complete)` → Modifies streak display
- `suggestFocusBlock(startTime, endTime, task)` → Proposes calendar block

---

## 7. Visual Design System

### 7.1 Color Palette

```
Background:       #12100E (warm near-black)
Surface:          #1A1714 (elevated panels)
Surface hover:    #221F1A (interactive states)
Border:           rgba(232, 168, 56, 0.08) (subtle warm lines)
Border active:    rgba(232, 168, 56, 0.15)

Text primary:     #E8E0D4 (warm off-white)
Text secondary:   rgba(232, 224, 212, 0.6)
Text muted:       rgba(232, 224, 212, 0.35)

Amber (primary):  #E8A838 (action, focus, branding)
Amber glow:       rgba(232, 168, 56, 0.4)
Gold:             #E8D438 (secondary accent)

Phase colors:
  Reflect:        #38B2E8 (blue)
  Orient:         #8BE838 (green)
  Decide:         #E8A838 (amber)
  Create:         #B838E8 (purple)
  Commit:         #E85B38 (red-orange)

Status:
  On track:       #8BE838
  Steady:         #E8D438
  Needs focus:    #E85B38
  Blocked:        #E83838
```

### 7.2 Typography

- **Display/Brand:** Bold, tight letter-spacing (-0.03em), 18px
- **Section headers:** All-caps, 10px, weight 700, letter-spacing 0.12em, muted amber
- **Body/chat:** 13px, line-height 1.55, regular weight
- **Metadata:** 9-10px, muted colors, sometimes uppercase
- **Task text:** 13px, regular weight, full opacity for active, 0.3 opacity for done
- **Priority badges:** 9px, weight 800, fading opacity per rank

### 7.3 Spacing & Borders

- Column borders: 1px solid at 0.08 opacity amber
- Section dividers: Same as column borders
- Task item padding: 8px 16px
- Chat bubble padding: 10px 14px
- Chat bubble radius: 14px with one 2px corner (pointing toward speaker)
- General border-radius for pills/chips: 6px
- Cards and containers: 8px radius

### 7.4 Animation Principles

- Progress ring fill: 1.2s cubic-bezier(0.4, 0, 0.2, 1)
- Task reorder: 300ms ease with staggered delays
- Voice Orb pulse: continuous sine wave on scale (1 ± 0.08)
- Voice Orb glow: box-shadow transition 300ms
- Meeting progress bar: 600ms ease fill
- Agenda item transitions: 200ms opacity
- New task insertion: slide-down from 0 height + fade in
- Question appearance: fade in + slight upward drift

---

## 8. Future Considerations

### 8.1 S2S Voice Integration

When real-time voice becomes available:
- The Voice Orb becomes the primary interface
- Chat text becomes a live transcript (like Otter.ai)
- The AI speaks its responses aloud
- Voice commands can navigate: "show me my tasks," "what's next on the agenda"
- The orb visualizes audio levels (waveform ring or amplitude-reactive glow)
- Interruption handling: user can speak over the AI to redirect

### 8.2 Multi-Person Meetings

Future expansion for team standups:
- Multiple participant avatars in top bar
- Each person gets their own task stack (tabbed)
- Shared project health view
- AI facilitates turn-taking and tracks who committed to what

### 8.3 Meeting History & Trends

- Past meeting transcripts searchable
- Week-over-week progress charts for goals
- AI can reference previous meetings: "Last Tuesday you said you'd finish X by now"
- Commitment tracking: what did you promise vs. what did you deliver

### 8.4 Integrations

- Calendar sync (Google Calendar, Outlook) for real event data
- Project management tools (Linear, Asana, Todoist) for task sync
- Note-taking apps for meeting summaries
- Habit tracking apps for streak data
