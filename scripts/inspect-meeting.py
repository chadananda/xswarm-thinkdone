from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})

    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

    page.goto("http://localhost:3456/meeting")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(4000)

    page.screenshot(path="scripts/meeting-state.png", full_page=True)

    # Query the DB from the browser to check connections and tasks
    db_info = page.evaluate("""async () => {
        try {
            const { getDb, ensureSchema, getTasks, getConnection } = await import('/src/lib/db.js');
            const db = await getDb();
            await ensureSchema(db);

            const today = new Date().toISOString().slice(0, 10);
            const tasks = await getTasks(db, today);

            // Check connections
            const geminiConn = await getConnection(db, 'gemini');
            const thinkdoneConn = await getConnection(db, 'thinkdone');

            // Check all connections
            const allConns = await db.prepare('SELECT provider, email, access_token IS NOT NULL as has_token FROM connections').all();

            // Check settings
            const provSetting = await db.prepare("SELECT value FROM settings WHERE key = 'ai_providers_enabled'").get();

            return {
                taskCount: tasks.length,
                tasks: tasks.slice(0, 5).map(t => ({ text: t.text, checked: t.checked, plan_date: t.plan_date })),
                geminiConn: geminiConn ? { provider: geminiConn.provider, email: geminiConn.email, hasToken: !!geminiConn.access_token } : null,
                thinkdoneConn: thinkdoneConn ? { provider: thinkdoneConn.provider } : null,
                allConns: allConns?.results || allConns || [],
                providerSetting: provSetting?.value || null,
            };
        } catch(e) {
            return { error: e.message };
        }
    }""")

    print("--- DB State ---")
    print(f"Tasks: {db_info.get('taskCount', 'unknown')}")
    if db_info.get('tasks'):
        for t in db_info['tasks']:
            print(f"  - [{('x' if t['checked'] else ' ')}] {t['text']} ({t['plan_date']})")
    print(f"Gemini connection: {db_info.get('geminiConn')}")
    print(f"ThinkDone connection: {db_info.get('thinkdoneConn')}")
    print(f"All connections: {db_info.get('allConns')}")
    print(f"Provider setting: {db_info.get('providerSetting')}")
    if db_info.get('error'):
        print(f"ERROR: {db_info['error']}")

    print("\n--- Console logs ---")
    for log in logs:
        if any(kw in log.lower() for kw in ["dashboard", "provider", "error", "fail", "extract", "task", "gemini", "init", "chain"]):
            print(log[:200])

    browser.close()
