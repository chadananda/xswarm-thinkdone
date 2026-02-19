"""Trace the full extraction pipeline in the live app."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})

    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

    page.goto("http://localhost:3456/meeting?reset")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(4000)

    # Click Start Meeting
    btn = page.locator("button.meeting-trigger")
    if btn.count() > 0:
        print("Clicking Start Meeting...")
        btn.click()
        page.wait_for_timeout(15000)
    else:
        print("No Start Meeting button found")

    # Send message with tasks
    inp = page.locator("[placeholder]").first
    if inp.count() > 0:
        print("Sending task message...")
        inp.fill("I need to call the dentist and buy groceries today")
        inp.press("Enter")
        page.wait_for_timeout(20000)
    else:
        print("No input found")

    # Check DB state
    result = page.evaluate("""async () => {
        const { getDb, getTasks } = await import('/src/lib/db.js');
        const db = await getDb();
        const today = new Date().toISOString().slice(0, 10);
        const todayTasks = await getTasks(db, today);
        const allTasks = await db.prepare('SELECT id, text, plan_date, source FROM tasks ORDER BY id DESC LIMIT 10').all();
        return {
            today,
            todayCount: todayTasks.length,
            allCount: allTasks.length,
            allTasks: allTasks.map(t => ({text: t.text, date: t.plan_date, source: t.source})),
        };
    }""")

    print(f"\nToday ({result['today']}): {result['todayCount']} tasks")
    print(f"All: {result['allCount']}")
    for t in result.get('allTasks', []):
        print(f"  [{t['source']}] {t['text']} (date={t['date']})")

    print("\n=== EXTRACTION LOGS ===")
    for log in logs:
        lo = log.lower()
        if any(kw in lo for kw in ['extract', 'processing', 'created task', 'no api', 'credential', 'fallback', 'inline', 'ensure', 'error', 'fail', 'skip']):
            print(log[:250])

    print("\n=== PROVIDER/MODE LOGS ===")
    for log in logs:
        lo = log.lower()
        if any(kw in lo for kw in ['provider', 'chain', 'init:', 's2s', 'speech', 'mode']):
            print(log[:250])

    browser.close()
