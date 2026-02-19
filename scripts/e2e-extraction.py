"""End-to-end: start meeting, send messages, verify tasks appear."""
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})

    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

    # Use ?reset to start fresh
    page.goto("http://localhost:3456/meeting?reset")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(4000)

    # Click Start Meeting
    btn = page.locator("button.meeting-trigger")
    if btn.count() > 0:
        print("Clicking Start Meeting...")
        btn.click()
        # Wait for AI opening turn
        page.wait_for_timeout(15000)
    else:
        print("No Start Meeting button found")

    page.screenshot(path="scripts/e2e-1-after-start.png")

    # Type a message that clearly contains tasks
    print("Sending: 'I need to call the dentist and buy groceries today'")
    inp = page.locator("input[placeholder*='Message'], textarea[placeholder*='Message']").first
    if inp.count() == 0:
        # Try different selector
        inp = page.locator("[placeholder*='essage']").first
    
    if inp.count() > 0:
        inp.fill("I need to call the dentist and buy groceries today")
        inp.press("Enter")
        print("Waiting for AI response + extraction...")
        page.wait_for_timeout(20000)
    else:
        print("ERROR: Could not find input field")
        # Debug: print all input-like elements
        inputs = page.locator("input, textarea").all()
        print(f"Found {len(inputs)} input elements")
        for i, el in enumerate(inputs):
            print(f"  {i}: tag={el.evaluate('e => e.tagName')} placeholder={el.get_attribute('placeholder')}")

    page.screenshot(path="scripts/e2e-2-after-message.png")

    # Check DB state
    result = page.evaluate("""async () => {
        const { getDb, ensureSchema, getTasks } = await import('/src/lib/db.js');
        const db = await getDb();
        const today = new Date().toISOString().slice(0, 10);
        const todayTasks = await getTasks(db, today);
        const allTasks = await db.prepare('SELECT id, text, plan_date, source FROM tasks ORDER BY id DESC LIMIT 10').all();
        return {
            today,
            todayCount: todayTasks.length,
            todayTasks: todayTasks.map(t => ({text: t.text, date: t.plan_date})),
            allCount: allTasks.length,
            allTasks: allTasks.map(t => ({text: t.text, date: t.plan_date, source: t.source})),
        };
    }""")

    print(f"\n=== RESULTS ===")
    print(f"Today ({result['today']}): {result['todayCount']} tasks")
    for t in result.get('todayTasks', []):
        print(f"  ✓ {t['text']} (date={t['date']})")
    print(f"All tasks: {result['allCount']}")
    for t in result.get('allTasks', []):
        print(f"  [{t['source']}] {t['text']} (date={t['date']})")

    # Show extraction-related logs
    print(f"\n=== KEY LOGS ===")
    for log in logs:
        lo = log.lower()
        if any(kw in lo for kw in ["extract", "task", "processing", "created", "s2s", "gemini response", "parsed", "skip", "error", "fail", "no api", "credential"]):
            print(log[:300])

    browser.close()
    
    if result['todayCount'] > 0:
        print(f"\n✅ SUCCESS: {result['todayCount']} tasks created and visible for today")
    else:
        print(f"\n❌ FAIL: 0 tasks for today despite conversation about tasks")
        if result['allCount'] > 0:
            print(f"   BUT {result['allCount']} tasks exist with wrong dates!")
