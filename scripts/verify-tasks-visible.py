"""End-to-end: start meeting, send task messages, screenshot the result."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})

    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

    # Fresh start
    page.goto("http://localhost:3456/meeting?reset")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(4000)

    # Start meeting
    btn = page.locator("button.meeting-trigger")
    if btn.count() > 0:
        print("Starting meeting...")
        btn.click()
        page.wait_for_timeout(15000)
    else:
        print("ERROR: No Start Meeting button")

    page.screenshot(path="scripts/verify-1-after-start.png", full_page=True)

    # Send first task message
    inp = page.locator("[placeholder]").first
    if inp.count() > 0:
        print("Sending: 'I need to call the dentist and buy groceries today'")
        inp.fill("I need to call the dentist and buy groceries today")
        inp.press("Enter")
        page.wait_for_timeout(20000)
    else:
        print("ERROR: No input field")

    page.screenshot(path="scripts/verify-2-after-first-msg.png", full_page=True)

    # Send second task message
    inp = page.locator("[placeholder]").first
    if inp.count() > 0:
        print("Sending: 'Also add finish the report for Gilbert by Thursday'")
        inp.fill("Also add finish the report for Gilbert by Thursday")
        inp.press("Enter")
        page.wait_for_timeout(20000)
    else:
        print("ERROR: No input field")

    page.screenshot(path="scripts/verify-3-after-second-msg.png", full_page=True)

    # Check DB
    result = page.evaluate("""async () => {
        const { getDb, getTasks } = await import('/src/lib/db.js');
        const db = await getDb();
        const today = new Date().toISOString().slice(0, 10);
        const todayTasks = await getTasks(db, today);
        const allTasks = await db.prepare('SELECT id, text, plan_date, source FROM tasks ORDER BY id DESC LIMIT 20').all();
        return {
            today,
            todayCount: todayTasks.length,
            allCount: allTasks.length,
            allTasks: allTasks.map(t => ({text: t.text, date: t.plan_date, source: t.source})),
        };
    }""")

    print(f"\n=== DB STATE ===")
    print(f"Today ({result['today']}): {result['todayCount']} tasks")
    print(f"All tasks: {result['allCount']}")
    for t in result.get('allTasks', []):
        print(f"  [{t['source']}] {t['text']} (date={t['date']})")

    # Check what's visible in the left panel
    left_panel = page.locator(".left-column")
    left_text = left_panel.inner_text() if left_panel.count() > 0 else "(not found)"
    print(f"\n=== LEFT PANEL (task list) ===")
    print(left_text[:500])

    # Check status bar
    status = page.locator(".status-bar")
    status_text = status.inner_text() if status.count() > 0 else "(not found)"
    print(f"\n=== STATUS BAR ===")
    print(status_text)

    # Key logs
    print(f"\n=== KEY LOGS ===")
    for log in logs:
        lo = log.lower()
        if any(kw in lo for kw in ['extract', 'processing', 'created task', 'created id', 'error', 'fail', 'no api', 'skip']):
            print(log[:250])

    browser.close()

    if result['todayCount'] > 0:
        print(f"\n=== PASS: {result['todayCount']} tasks created and visible ===")
    else:
        print(f"\n=== FAIL: 0 tasks for today ===")
