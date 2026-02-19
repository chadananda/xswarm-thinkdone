"""Test extraction pipeline by sending a message and watching console."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})

    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

    page.goto("http://localhost:3456/meeting")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(4000)

    # Check current provider and S2S state
    state = page.evaluate("""() => {
        const session = sessionStorage.getItem('thinkdone_active_session');
        const parsed = session ? JSON.parse(session) : null;
        return {
            meetingStarted: parsed?.meetingStarted,
            sessionType: parsed?.session?.type,
            sessionState: parsed?.session?.state,
            messageCount: parsed?.session?.messages?.length || 0,
            lastMessages: (parsed?.session?.messages || []).slice(-3).map(m => ({
                role: m.role,
                content: m.content?.slice(0, 100),
            })),
        };
    }""")
    print(f"Session: type={state.get('sessionType')} state={state.get('sessionState')} msgs={state.get('messageCount')} started={state.get('meetingStarted')}")
    for m in state.get('lastMessages', []):
        print(f"  [{m['role']}] {m['content']}")

    # Check if Start Meeting button exists
    start_btn = page.locator("button.meeting-trigger")
    if start_btn.count() > 0:
        print("\nStart Meeting button visible — clicking it...")
        start_btn.click()
        # Wait for AI to respond (streaming)
        page.wait_for_timeout(15000)
    else:
        print("\nMeeting already started or button not found")

    # Now type a message to test extraction
    print("\nSending test message: 'add a task: buy groceries after work'")
    input_field = page.locator("input[type='text'], textarea, [contenteditable]").first
    if input_field.count() > 0:
        input_field.fill("add a task: buy groceries after work")
        # Find send button or press Enter
        send_btn = page.locator("button[aria-label*='send'], button[type='submit']").first
        if send_btn.count() > 0:
            send_btn.click()
        else:
            input_field.press("Enter")
        print("Message sent, waiting for response + extraction...")
        page.wait_for_timeout(20000)
    else:
        print("Could not find input field")

    # Check DB for tasks
    db_info = page.evaluate("""async () => {
        try {
            const { getDb, ensureSchema, getTasks } = await import('/src/lib/db.js');
            const db = await getDb();
            const today = new Date().toISOString().slice(0, 10);
            const tasks = await getTasks(db, today);
            const allTasks = await db.prepare('SELECT id, text, plan_date, source FROM tasks ORDER BY id DESC LIMIT 10').all();
            return { today, todayCount: tasks.length, allCount: allTasks.length, tasks: allTasks.map(t => `#${t.id} [${t.source}] ${t.text} (${t.plan_date})`) };
        } catch(e) { return { error: e.message }; }
    }""")
    print(f"\n=== TASKS IN DB ===")
    print(f"Today ({db_info.get('today')}): {db_info.get('todayCount')}")
    print(f"All: {db_info.get('allCount')}")
    for t in db_info.get('tasks', []):
        print(f"  {t}")

    print(f"\n=== EXTRACTION-RELATED CONSOLE LOGS ===")
    for log in logs:
        if any(kw in log.lower() for kw in ["extract", "task", "s2s", "gemini", "transcript", "stt", "error", "fail", "warn", "api", "credential", "skip"]):
            print(log[:300])

    page.screenshot(path="scripts/extraction-test.png", full_page=True)
    browser.close()
