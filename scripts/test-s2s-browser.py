"""Test Gemini Live S2S in actual browser — persistent session approach"""
from playwright.sync_api import sync_playwright
import json, time, os

# Read API key from .env
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

    # Check if API key already stored (from OAuth), or enter one
    api_input = page.locator('#speech-api-key')
    if api_input.is_visible():
        api_input.fill(env_vars.get('GEMINI_API_KEY', ''))
        page.locator('button:has-text("Save")').last.click()
        page.wait_for_timeout(500)

    page.screenshot(path='test-results/s2s-before-test.png', full_page=False)

    # Click mic to start S2S test
    print("Clicking mic button...")
    page.locator('button.test-mic').click()

    # Give Gemini time to connect, receive system prompt, generate greeting, stream audio
    print("Waiting for Gemini to respond (up to 20s)...")
    page.wait_for_timeout(20000)

    page.screenshot(path='test-results/s2s-after-test.png', full_page=False)

    # Analyze logs
    print("\n=== Relevant Console Logs ===")
    keywords = ['speech', 'direct', 'speak', 'audio', 's2s', 'gemini', 'pcm', 'wav',
                'play', 'decode', 'premium', 'error', 'S2S', 'listen', 'system']
    for log in logs:
        if any(k in log.lower() for k in keywords):
            print(log)

    print("\n=== Verification ===")
    checks = {
        "S2S mode detected": any("S2S mode" in l for l in logs),
        "Direct service created": any("creating DIRECT" in l for l in logs),
        "Gemini session started": any("gemini" in l.lower() and ("setup" in l.lower() or "open" in l.lower()) for l in logs),
        "Got audio chunks": any("playTestAudio" in l or "audio response" in l for l in logs),
        "No page errors": not any("[PAGE_ERROR]" in l for l in logs),
    }
    for k, v in checks.items():
        print(f"  [{'PASS' if v else 'FAIL'}] {k}")

    # Show errors if any
    errors = [l for l in logs if '[PAGE_ERROR]' in l or 'error' in l.lower()]
    if errors:
        print("\n=== Errors ===")
        for e in errors[:10]:
            print(f"  {e}")

    browser.close()
