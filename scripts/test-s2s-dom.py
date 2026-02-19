"""Check what S2S test shows in the chat display"""
from playwright.sync_api import sync_playwright

env_vars = {}
with open('.env') as f:
    for line in f:
        if '=' in line:
            k, v = line.strip().split('=', 1)
            v = v.strip().strip('"').strip("'")
            env_vars[k] = v

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

    page.goto('http://localhost:3456/settings')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # Select Gemini Live
    page.locator('input[type="radio"]').nth(1).click()
    page.wait_for_timeout(500)

    # Enter API key
    api_input = page.locator('#speech-api-key')
    if api_input.is_visible():
        api_input.fill(env_vars.get('GEMINI_API_KEY', ''))
        page.locator('button:has-text("Save")').last.click()
        page.wait_for_timeout(500)

    # Start test
    page.locator('button.test-mic').click()
    page.wait_for_timeout(15000)

    # Check chat bubbles
    bubbles = page.locator('.test-bubble').all()
    print(f"\n=== Chat Bubbles ({len(bubbles)}) ===")
    for b in bubbles:
        cls = b.get_attribute('class') or ''
        text = b.inner_text()
        role = 'AI' if 'test-ai' in cls else 'USER'
        print(f"  [{role}] {text[:100]}")

    # Check status hint
    hints = page.locator('.test-hint').all()
    for h in hints:
        if h.is_visible():
            print(f"\n  Status: {h.inner_text()}")

    page.screenshot(path='test-results/s2s-chat-display.png', full_page=False)
    print("\nScreenshot: test-results/s2s-chat-display.png")

    browser.close()
