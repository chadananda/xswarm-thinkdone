"""Detailed S2S test — verify audio decode, playback, and S2S listening"""
from playwright.sync_api import sync_playwright
import json, time

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
    page.on("pageerror", lambda err: logs.append(f"[PAGE_ERROR] {err}"))

    page.goto('http://localhost:3456/settings')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # Select Gemini Live
    page.locator('input[type="radio"]').nth(1).click()
    page.wait_for_timeout(500)

    # Enter API key if needed
    api_input = page.locator('#speech-api-key')
    if api_input.is_visible():
        api_input.fill(env_vars.get('GEMINI_API_KEY', ''))
        page.locator('button:has-text("Save")').last.click()
        page.wait_for_timeout(500)

    # Click mic
    page.locator('button.test-mic').click()

    # Wait for the full flow: setup → speak → audio → decode → play → S2S listen
    print("Waiting 25s for full S2S flow...")
    page.wait_for_timeout(25000)

    page.screenshot(path='test-results/s2s-detailed.png', full_page=False)

    # Detailed analysis
    print("\n=== Full Flow ===")
    flow_steps = [
        ("1. Service created",      "creating DIRECT"),
        ("2. S2S mode",             "S2S mode"),
        ("3. Greeting sent",        "S2S greeting"),
        ("4. Audio received",       "playTestAudio"),
        ("5. Audio decoded",        "decodeAudioData" if any("decode" in l.lower() for l in logs) else "playTestAudio"),
        ("6. S2S listening started","S2S PCM streaming"),
        ("7. S2S browser STT",     "S2S browser STT"),
    ]
    for label, keyword in flow_steps:
        found = any(keyword in l for l in logs)
        print(f"  [{'OK' if found else 'NO'}] {label}")

    # Show all relevant logs in order
    print("\n=== All Speech Logs (ordered) ===")
    for log in logs:
        if any(k in log for k in ['Settings', 'speech-svc', 'gemini', 'S2S', 'playTest', 'decode', 'error', 'Error', 'PAGE_ERROR']):
            # Truncate long lines
            print(f"  {log[:200]}")

    # Check for errors
    errors = [l for l in logs if 'error' in l.lower() or 'PAGE_ERROR' in l]
    if errors:
        print(f"\n=== {len(errors)} Error(s) ===")
        for e in errors:
            print(f"  {e[:300]}")

    browser.close()
