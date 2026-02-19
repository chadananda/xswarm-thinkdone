import { useState, useEffect, useRef } from "react";
// ThinkDone — AI Planning Meeting Dashboard Mock
// Concept: "The War Room Study" — warm command center meets thoughtful advisor's desk
const GOALS = [
  { id: 1, name: "Ocean of Lights", progress: 68, color: "#E8A838", category: "project", icon: "◈" },
  { id: 2, name: "WholeReader K-12", progress: 45, color: "#38B2E8", category: "project", icon: "◉" },
  { id: 3, name: "Arabic Fluency", progress: 32, color: "#8BE838", category: "habit", icon: "✦" },
  { id: 4, name: "Health & Fitness", progress: 55, color: "#E85B38", category: "habit", icon: "♦" },
  { id: 5, name: "BlogWorks Launch", progress: 78, color: "#B838E8", category: "project", icon: "◆" },
  { id: 6, name: "ThinkDone MVP", progress: 25, color: "#E8D438", category: "project", icon: "⬡" },
  { id: 7, name: "Reading Goal", progress: 60, color: "#38E8B2", category: "habit", icon: "◇" },
];
const TASKS = [
  { id: 1, text: "Review OoL editorial workflow PR", project: "Ocean of Lights", priority: 1, due: "Today", done: false },
  { id: 2, text: "Draft Q1 investor update letter", project: "Immersive Ocean", priority: 2, due: "Today", done: false },
  { id: 3, text: "Ship article tagging system v2", project: "Ocean of Lights", priority: 3, due: "Tomorrow", done: false },
  { id: 4, text: "Record WholeReader demo video", project: "WholeReader", priority: 4, due: "Wed", done: true },
  { id: 5, text: "Arabic lesson — Surah vocabulary", project: "Arabic Fluency", priority: 5, due: "Daily", done: false },
  { id: 6, text: "xSwarm test suite for login flows", project: "xSwarm QA", priority: 6, due: "Thu", done: false },
  { id: 7, text: "DRBI newsletter draft", project: "DRBI", priority: 7, due: "Fri", done: false },
  { id: 8, text: "BlogWorks AI content pipeline spec", project: "BlogWorks", priority: 8, due: "Next Mon", done: false },
];
const AGENDA = [
  { id: 1, text: "Review yesterday's wins & incomplete items", phase: "reflect", status: "done" },
  { id: 2, text: "Calendar check — today & this week", phase: "orient", status: "done" },
  { id: 3, text: "Priority triage — what matters most today?", phase: "decide", status: "active" },
  { id: 4, text: "Project health check — any blockers?", phase: "decide", status: "pending" },
  { id: 5, text: "Habit streak review", phase: "reflect", status: "pending" },
  { id: 6, text: "Brainstorm: OoL launch marketing angles", phase: "create", status: "pending" },
  { id: 7, text: "Set commitments for today", phase: "commit", status: "pending" },
];
const MESSAGES = [
  { role: "ai", text: "Good morning, Chad. You had a strong day yesterday — 6 of 8 tasks completed including that WholeReader demo. Let's build on that momentum. I see 3 calendar items today. Ready to triage priorities?" },
  { role: "user", text: "Yeah, let's do it. I'm feeling focused today. What's the biggest lever I can pull?" },
  { role: "ai", text: "Your biggest leverage point today is the OoL editorial workflow review — it unblocks Dr. Riazati's team and 3 downstream tasks. Second priority: the investor update, since Gilbert mentioned it yesterday. Want to timebox those two and protect the rest of your day for deep work?" },
];
const EVENTS = [
  { time: "9:00 AM", title: "Daily standup", type: "meeting" },
  { time: "11:30 AM", title: "Gilbert — Q1 planning", type: "meeting" },
  { time: "2:00 PM", title: "Dr. Riazati — OoL review", type: "meeting" },
];
// -- Subcomponents --
const ProgressRing = ({ progress, color, size = 52, stroke = 3.5 }) => {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (progress / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }} />
    </svg>
  );
};
const VoiceOrb = ({ active }) => {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setPulse(p => (p + 1) % 360), 50);
    return () => clearInterval(id);
  }, [active]);
  const scale = active ? 1 + Math.sin(pulse * 0.1) * 0.08 : 1;
  const glow = active ? "0 0 40px rgba(232,168,56,0.4), 0 0 80px rgba(232,168,56,0.15)" : "0 0 20px rgba(232,168,56,0.15)";
  return (
    <div style={{
      width: 64, height: 64, borderRadius: "50%", cursor: "pointer",
      background: active
        ? "radial-gradient(circle at 40% 35%, #F0C050, #E8A838, #C07828)"
        : "radial-gradient(circle at 40% 35%, #5A4A30, #3D3425, #2A231A)",
      boxShadow: glow, transform: `scale(${scale})`,
      transition: "transform 0.15s, box-shadow 0.3s",
      display: "flex", alignItems: "center", justifyContent: "center",
      border: active ? "2px solid rgba(240,192,80,0.6)" : "2px solid rgba(232,168,56,0.25)",
    }}>
      <span style={{ fontSize: 22, color: active ? "#1A1510" : "#E8A838", opacity: active ? 1 : 0.7 }}>
        {active ? "◉" : "◎"}
      </span>
    </div>
  );
};
// -- Main Dashboard --
export default function ThinkDoneDashboard() {
  const [voiceActive, setVoiceActive] = useState(false);
  const [tasks, setTasks] = useState(TASKS);
  const [agenda, setAgenda] = useState(AGENDA);
  const [inputText, setInputText] = useState("");
  const [expandedGoal, setExpandedGoal] = useState(null);
  const [showHabits, setShowHabits] = useState(false);
  const chatEndRef = useRef(null);
  const toggleTask = (id) => setTasks(t => t.map(x => x.id === id ? { ...x, done: !x.done } : x));
  const phaseColors = { reflect: "#38B2E8", orient: "#8BE838", decide: "#E8A838", create: "#B838E8", commit: "#E85B38" };
  const statusIcon = { done: "✓", active: "●", pending: "○" };
  // Styles
  const S = {
    root: {
      fontFamily: "'DM Sans', 'Avenir', sans-serif", background: "#12100E",
      color: "#E8E0D4", height: "100vh", display: "flex", flexDirection: "column",
      overflow: "hidden", fontSize: 13,
    },
    topBar: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 20px", borderBottom: "1px solid rgba(232,168,56,0.1)",
      background: "linear-gradient(180deg, #1A1714 0%, #12100E 100%)",
    },
    columns: { display: "flex", flex: 1, overflow: "hidden" },
    leftCol: {
      width: 300, minWidth: 280, borderRight: "1px solid rgba(232,168,56,0.08)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    },
    centerCol: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
    rightCol: {
      width: 280, minWidth: 260, borderLeft: "1px solid rgba(232,168,56,0.08)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    },
    sectionHead: {
      padding: "12px 16px 8px", fontSize: 10, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.12em",
      color: "rgba(232,168,56,0.5)", borderBottom: "1px solid rgba(232,168,56,0.06)",
    },
    taskItem: (done) => ({
      padding: "8px 16px", display: "flex", alignItems: "flex-start", gap: 10,
      borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer",
      opacity: done ? 0.4 : 1, transition: "opacity 0.2s, background 0.15s",
    }),
    chatBubble: (isAi) => ({
      padding: "10px 14px", borderRadius: isAi ? "2px 14px 14px 14px" : "14px 2px 14px 14px",
      background: isAi ? "rgba(232,168,56,0.08)" : "rgba(56,178,232,0.1)",
      border: `1px solid ${isAi ? "rgba(232,168,56,0.12)" : "rgba(56,178,232,0.12)"}`,
      maxWidth: "85%", lineHeight: 1.55, fontSize: 13,
      alignSelf: isAi ? "flex-start" : "flex-end",
    }),
    agendaItem: (status) => ({
      padding: "6px 14px", display: "flex", alignItems: "center", gap: 8,
      opacity: status === "done" ? 0.4 : 1, fontSize: 12,
      borderLeft: status === "active" ? "2px solid #E8A838" : "2px solid transparent",
      background: status === "active" ? "rgba(232,168,56,0.04)" : "transparent",
    }),
  };
  return (
    <div style={S.root}>
      {/* -- TOP BAR: Goal Orbit Strip -- */}
      <div style={S.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#E8A838", letterSpacing: "-0.03em" }}>
            ThinkDone
          </span>
          <span style={{ fontSize: 10, color: "rgba(232,168,56,0.35)", fontWeight: 600, letterSpacing: "0.08em" }}>
            PLANNING SESSION
          </span>
        </div>
        {/* Goal orbit strip */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {GOALS.map(g => (
            <div key={g.id} style={{ position: "relative", cursor: "pointer", textAlign: "center" }}
              onMouseEnter={() => setExpandedGoal(g.id)} onMouseLeave={() => setExpandedGoal(null)}>
              <ProgressRing progress={g.progress} color={g.color} size={40} stroke={3} />
              <span style={{
                position: "absolute", top: "50%", left: "50%",
                transform: "translate(-50%,-50%)", fontSize: 11, color: g.color,
              }}>{g.icon}</span>
              {expandedGoal === g.id && (
                <div style={{
                  position: "absolute", top: 46, left: "50%", transform: "translateX(-50%)",
                  background: "#1E1B17", border: "1px solid rgba(232,168,56,0.15)",
                  borderRadius: 8, padding: "8px 12px", whiteSpace: "nowrap", zIndex: 100,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: g.color }}>{g.name}</div>
                  <div style={{ fontSize: 10, color: "rgba(232,224,212,0.5)", marginTop: 2 }}>
                    {g.progress}% · {g.category}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Today's events */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {EVENTS.map((e, i) => (
            <div key={i} style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 10,
              background: "rgba(232,168,56,0.06)", border: "1px solid rgba(232,168,56,0.08)",
              display: "flex", gap: 6, alignItems: "center",
            }}>
              <span style={{ color: "#E8A838", fontWeight: 700 }}>{e.time}</span>
              <span style={{ color: "rgba(232,224,212,0.6)" }}>{e.title}</span>
            </div>
          ))}
        </div>
      </div>
      {/* -- THREE COLUMNS -- */}
      <div style={S.columns}>
        {/* LEFT: Priority Task Stack */}
        <div style={S.leftCol}>
          <div style={S.sectionHead}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Priority Stack</span>
              <span style={{ fontSize: 10, color: "rgba(232,224,212,0.3)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                {tasks.filter(t => !t.done).length} active · {tasks.filter(t => t.done).length} done
              </span>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
            {tasks.sort((a, b) => a.priority - b.priority).map((t, i) => (
              <div key={t.id} style={S.taskItem(t.done)} onClick={() => toggleTask(t.id)}>
                <div style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
                  border: t.done ? "none" : `1.5px solid rgba(232,168,56,${Math.max(0.15, 0.6 - i * 0.07)})`,
                  background: t.done ? "rgba(139,232,56,0.2)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, color: "#8BE838",
                }}>{t.done ? "✓" : ""}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    textDecoration: t.done ? "line-through" : "none",
                    color: t.done ? "rgba(232,224,212,0.3)" : "#E8E0D4",
                    lineHeight: 1.4,
                  }}>{t.text}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                    <span style={{
                      fontSize: 9, padding: "1px 6px", borderRadius: 3,
                      background: "rgba(232,168,56,0.08)", color: "rgba(232,168,56,0.5)",
                    }}>{t.project}</span>
                    <span style={{ fontSize: 9, color: t.due === "Today" ? "#E8A838" : "rgba(232,224,212,0.3)" }}>
                      {t.due}
                    </span>
                  </div>
                </div>
                <span style={{
                  fontSize: 9, fontWeight: 800, color: `rgba(232,168,56,${Math.max(0.2, 0.8 - i * 0.08)})`,
                  width: 16, textAlign: "right", flexShrink: 0,
                }}>P{t.priority}</span>
              </div>
            ))}
          </div>
          {/* Habit Streak Footer */}
          <div style={{
            borderTop: "1px solid rgba(232,168,56,0.08)", padding: "8px 16px",
            cursor: "pointer", background: showHabits ? "rgba(232,168,56,0.03)" : "transparent",
          }} onClick={() => setShowHabits(!showHabits)}>
            <div style={{ ...S.sectionHead, padding: 0, paddingBottom: 6, borderBottom: "none" }}>
              <span>Habit Streaks</span>
              <span style={{ float: "right", fontSize: 12, color: "rgba(232,168,56,0.3)" }}>
                {showHabits ? "▾" : "▸"}
              </span>
            </div>
            {showHabits && (
              <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                {[
                  { name: "Arabic", streak: 12, icon: "✦" },
                  { name: "Reading", streak: 45, icon: "◇" },
                  { name: "Exercise", streak: 3, icon: "♦" },
                  { name: "Meditation", streak: 8, icon: "○" },
                ].map(h => (
                  <div key={h.name} style={{
                    padding: "4px 8px", borderRadius: 6, background: "rgba(232,168,56,0.05)",
                    border: "1px solid rgba(232,168,56,0.08)", fontSize: 10, display: "flex", gap: 4,
                  }}>
                    <span>{h.icon}</span>
                    <span style={{ color: "rgba(232,224,212,0.6)" }}>{h.name}</span>
                    <span style={{ color: "#E8A838", fontWeight: 700 }}>{h.streak}d</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* CENTER: Chat Arena */}
        <div style={S.centerCol}>
          {/* Meeting progress bar */}
          <div style={{ padding: "6px 20px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 9, color: "rgba(232,168,56,0.4)", fontWeight: 600, letterSpacing: "0.1em" }}>
              MEETING PROGRESS
            </span>
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.04)" }}>
              <div style={{
                width: `${(agenda.filter(a => a.status === "done").length / agenda.length) * 100}%`,
                height: "100%", borderRadius: 2,
                background: "linear-gradient(90deg, #E8A838, #E8D438)",
                transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
              }} />
            </div>
            <span style={{ fontSize: 9, color: "rgba(232,224,212,0.3)" }}>
              {agenda.filter(a => a.status === "done").length}/{agenda.length}
            </span>
          </div>
          {/* Chat messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            {MESSAGES.map((m, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "ai" ? "flex-start" : "flex-end" }}>
                {m.role === "ai" && (
                  <span style={{ fontSize: 9, color: "rgba(232,168,56,0.4)", marginBottom: 3, fontWeight: 600 }}>
                    THINKDONE COACH
                  </span>
                )}
                <div style={S.chatBubble(m.role === "ai")}>{m.text}</div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          {/* Voice + Input Bar */}
          <div style={{
            padding: "12px 20px 16px", borderTop: "1px solid rgba(232,168,56,0.06)",
            display: "flex", alignItems: "center", gap: 14,
          }}>
            <div onClick={() => setVoiceActive(!voiceActive)}>
              <VoiceOrb active={voiceActive} />
            </div>
            <div style={{ flex: 1, position: "relative" }}>
              <input value={inputText} onChange={(e) => setInputText(e.target.value)}
                placeholder={voiceActive ? "Listening..." : "Type or tap the orb to speak..."}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: 12,
                  border: "1px solid rgba(232,168,56,0.1)", background: "rgba(255,255,255,0.03)",
                  color: "#E8E0D4", fontSize: 13, outline: "none",
                  fontFamily: "inherit",
                }} />
            </div>
            <button style={{
              padding: "10px 18px", borderRadius: 10, border: "none",
              background: "rgba(232,168,56,0.15)", color: "#E8A838",
              fontWeight: 700, fontSize: 12, cursor: "pointer", letterSpacing: "0.03em",
            }}>Send</button>
          </div>
        </div>
        {/* RIGHT: Meeting Agenda + Metrics */}
        <div style={S.rightCol}>
          {/* Meeting Agenda */}
          <div style={S.sectionHead}>Meeting Agenda</div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {agenda.map(a => (
              <div key={a.id} style={S.agendaItem(a.status)}>
                <span style={{
                  fontSize: 11, width: 14,
                  color: a.status === "active" ? "#E8A838" : a.status === "done" ? "rgba(139,232,56,0.5)" : "rgba(232,224,212,0.2)",
                }}>{statusIcon[a.status]}</span>
                <span style={{
                  flex: 1, fontSize: 11.5, lineHeight: 1.4,
                  textDecoration: a.status === "done" ? "line-through" : "none",
                  color: a.status === "active" ? "#E8E0D4" : a.status === "done" ? "rgba(232,224,212,0.35)" : "rgba(232,224,212,0.55)",
                }}>{a.text}</span>
                <span style={{
                  fontSize: 8, padding: "1px 5px", borderRadius: 3,
                  background: `${phaseColors[a.phase]}15`, color: phaseColors[a.phase],
                  fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
                }}>{a.phase}</span>
              </div>
            ))}
            {/* Dynamic questions zone */}
            <div style={{
              margin: "8px 14px", padding: "8px 10px", borderRadius: 8,
              border: "1px dashed rgba(232,168,56,0.12)", background: "rgba(232,168,56,0.02)",
            }}>
              <div style={{ fontSize: 9, color: "rgba(232,168,56,0.35)", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 6 }}>
                EMERGING QUESTIONS
              </div>
              {[
                "Should OoL launch target Naw-Rúz?",
                "Revisit BlogWorks pricing tiers?",
              ].map((q, i) => (
                <div key={i} style={{
                  fontSize: 11, color: "rgba(232,224,212,0.5)", padding: "3px 0",
                  display: "flex", gap: 6, alignItems: "flex-start",
                }}>
                  <span style={{ color: "rgba(232,168,56,0.3)" }}>?</span> {q}
                </div>
              ))}
            </div>
          </div>
          {/* Project Health Metrics */}
          <div style={{ borderTop: "1px solid rgba(232,168,56,0.08)" }}>
            <div style={S.sectionHead}>Project Health</div>
            <div style={{ padding: "4px 14px 12px" }}>
              {[
                { name: "Ocean of Lights", velocity: "▲", health: "on track", color: "#8BE838" },
                { name: "WholeReader", velocity: "►", health: "steady", color: "#E8D438" },
                { name: "BlogWorks", velocity: "▲", health: "ahead", color: "#8BE838" },
                { name: "ThinkDone", velocity: "▼", health: "needs focus", color: "#E85B38" },
              ].map((p, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "5px 0", borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.02)" : "none",
                }}>
                  <span style={{ fontSize: 11, color: "rgba(232,224,212,0.7)" }}>{p.name}</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: p.color, fontWeight: 600 }}>{p.health}</span>
                    <span style={{ fontSize: 10, color: p.color }}>{p.velocity}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Weekly Scorecard */}
          <div style={{ borderTop: "1px solid rgba(232,168,56,0.08)", padding: "8px 14px 12px" }}>
            <div style={{ ...S.sectionHead, padding: "0 0 6px", borderBottom: "none" }}>This Week</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
              {[
                { label: "Tasks Done", value: "23/31", pct: 74 },
                { label: "Habits", value: "18/21", pct: 86 },
                { label: "Focus Hrs", value: "14.5", pct: 60 },
              ].map((m, i) => (
                <div key={i} style={{
                  flex: 1, padding: "8px 6px", borderRadius: 8, textAlign: "center",
                  background: "rgba(232,168,56,0.03)", border: "1px solid rgba(232,168,56,0.06)",
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#E8A838" }}>{m.value}</div>
                  <div style={{ fontSize: 8, color: "rgba(232,224,212,0.35)", marginTop: 2, letterSpacing: "0.05em" }}>
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
