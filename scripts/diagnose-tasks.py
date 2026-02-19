from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})

    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

    page.goto("http://localhost:3456/meeting")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(5000)

    # Check DB state
    db_info = page.evaluate("""async () => {
        try {
            const { getDb, ensureSchema, getTasks } = await import('/src/lib/db.js');
            const db = await getDb();
            await ensureSchema(db);

            const today = new Date().toISOString().slice(0, 10);
            const tasks = await getTasks(db, today);

            // Check ALL tasks regardless of date
            const allTasks = await db.prepare('SELECT id, text, plan_date, checked, source FROM tasks ORDER BY id DESC LIMIT 20').all();

            // Check recent memories
            const memories = await db.prepare('SELECT id, content, type, source FROM memories ORDER BY id DESC LIMIT 10').all();

            // Check conversations
            const convs = await db.prepare('SELECT id, session_type, started_at, ended_at, summary FROM conversations ORDER BY id DESC LIMIT 5').all();

            // Check session messages count
            const sessionData = sessionStorage.getItem('thinkdone_active_session');
            let sessionInfo = null;
            if (sessionData) {
                const parsed = JSON.parse(sessionData);
                sessionInfo = {
                    type: parsed.session?.type,
                    state: parsed.session?.state,
                    messageCount: parsed.session?.messages?.length || 0,
                    lastMessages: (parsed.session?.messages || []).slice(-4).map(m => ({
                        role: m.role,
                        content: m.content?.slice(0, 80),
                    })),
                    meetingStarted: parsed.meetingStarted,
                };
            }

            return {
                today,
                todayTaskCount: tasks.length,
                todayTasks: tasks.slice(0, 10).map(t => ({ id: t.id, text: t.text, plan_date: t.plan_date })),
                allTaskCount: allTasks.length,
                allTasks: allTasks.slice(0, 10).map(t => ({ id: t.id, text: t.text, plan_date: t.plan_date, source: t.source })),
                memoryCount: memories.length,
                memories: memories.slice(0, 5).map(m => ({ id: m.id, content: m.content?.slice(0, 60), type: m.type })),
                convCount: convs.length,
                conversations: convs,
                sessionInfo,
            };
        } catch(e) {
            return { error: e.message, stack: e.stack };
        }
    }""")

    print("=== DB STATE ===")
    print(f"Today: {db_info.get('today')}")
    print(f"Today's tasks: {db_info.get('todayTaskCount')}")
    for t in (db_info.get('todayTasks') or []):
        print(f"  #{t['id']}: {t['text'][:60]} (date={t['plan_date']})")

    print(f"\nAll tasks (any date): {db_info.get('allTaskCount')}")
    for t in (db_info.get('allTasks') or []):
        print(f"  #{t['id']}: {t['text'][:60]} (date={t['plan_date']}, src={t.get('source','')})")

    print(f"\nMemories: {db_info.get('memoryCount')}")
    for m in (db_info.get('memories') or []):
        print(f"  #{m['id']}: [{m['type']}] {m['content']}")

    print(f"\nConversations: {db_info.get('convCount')}")
    for c in (db_info.get('conversations') or []):
        print(f"  #{c['id']}: {c['session_type']} started={c.get('started_at','?')[:16]} summary={str(c.get('summary',''))[:60]}")

    print(f"\nSession: {db_info.get('sessionInfo')}")

    if db_info.get('error'):
        print(f"\nERROR: {db_info['error']}")
        print(f"Stack: {db_info.get('stack','')[:200]}")

    print("\n=== RELEVANT CONSOLE LOGS ===")
    for log in logs:
        if any(kw in log.lower() for kw in ["extract", "task", "dashboard", "s2s", "gemini", "error", "fail", "turn"]):
            print(log[:200])

    page.screenshot(path="scripts/diagnose-tasks.png", full_page=True)
    browser.close()
