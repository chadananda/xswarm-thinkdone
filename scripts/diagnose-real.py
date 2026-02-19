"""Look at what's actually in the user's browser DB and session."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})

    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

    page.goto("http://localhost:3456/meeting")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(5000)

    info = page.evaluate("""async () => {
        try {
            const { getDb, ensureSchema, getTasks } = await import('/src/lib/db.js');
            const db = await getDb();
            await ensureSchema(db);

            const today = new Date().toISOString().slice(0, 10);
            const todayTasks = await getTasks(db, today);
            const allTasks = await db.prepare('SELECT id, text, plan_date, source, checked FROM tasks ORDER BY id DESC LIMIT 30').all();
            const memories = await db.prepare('SELECT id, content, type FROM memories ORDER BY id DESC LIMIT 20').all();
            const convs = await db.prepare('SELECT id, session_type, summary FROM conversations ORDER BY id DESC LIMIT 5').all();

            // Get session from sessionStorage
            const raw = sessionStorage.getItem('thinkdone_active_session');
            let sess = null;
            if (raw) {
                const p = JSON.parse(raw);
                sess = {
                    type: p.session?.type,
                    state: p.session?.state,
                    started: p.meetingStarted,
                    msgCount: p.session?.messages?.length || 0,
                    messages: (p.session?.messages || []).map(m => ({
                        role: m.role,
                        text: (m.content || '').slice(0, 150)
                    }))
                };
            }

            return {
                today,
                todayCount: todayTasks.length,
                todayTasks: todayTasks.map(t => ({id: t.id, text: t.text, plan_date: t.plan_date})),
                allCount: allTasks.length,
                allTasks: allTasks.map(t => ({id: t.id, text: t.text.slice(0,80), plan_date: t.plan_date, source: t.source})),
                memCount: memories.length,
                memories: memories.slice(0,10).map(m => ({id: m.id, type: m.type, content: (m.content||'').slice(0,80)})),
                convCount: convs.length,
                session: sess
            };
        } catch(e) { return {error: e.message, stack: e.stack}; }
    }""")

    if info.get('error'):
        print(f"ERROR: {info['error']}")
    else:
        print(f"=== TODAY: {info['today']} ===")
        print(f"Today's tasks: {info['todayCount']}")
        for t in info.get('todayTasks', []):
            print(f"  #{t['id']}: {t['text']} (date={t['plan_date']})")
        print(f"\nAll tasks (any date): {info['allCount']}")
        for t in info.get('allTasks', []):
            print(f"  #{t['id']}: [{t['source']}] {t['text']} (date={t['plan_date']})")
        print(f"\nMemories: {info['memCount']}")
        for m in info.get('memories', []):
            print(f"  #{m['id']}: [{m['type']}] {m['content']}")
        print(f"\nConversations: {info['convCount']}")
        s = info.get('session')
        if s:
            print(f"\nSession: type={s['type']} state={s['state']} started={s['started']} msgs={s['msgCount']}")
            for m in s.get('messages', []):
                print(f"  [{m['role']}] {m['text']}")
        else:
            print("\nNo active session in sessionStorage")

    print(f"\n=== CONSOLE LOGS ===")
    for log in logs:
        if any(kw in log.lower() for kw in ["extract", "task", "s2s", "error", "fail", "warn", "skip", "credential", "api error"]):
            print(log[:250])

    page.screenshot(path="scripts/diagnose-real.png", full_page=True)
    browser.close()
