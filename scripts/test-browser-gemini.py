"""Test Gemini Live voice in actual browser with API key"""
from playwright.sync_api import sync_playwright
import json, urllib.parse, time, os

# Read API key from .env
env_vars = {}
with open('.env') as f:
    for line in f:
        if '=' in line:
            k, v = line.strip().split('=', 1)
            v = v.strip().strip('"').strip("'")
            env_vars[k] = v
API_KEY = env_vars.get('GEMINI_API_KEY', '')

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
    
    # Enter the real API key
    api_input = page.locator('#speech-api-key')
    api_input.fill(API_KEY)
    page.locator('button:has-text("Save")').last.click()
    page.wait_for_timeout(500)
    
    # Click mic to test
    page.locator('button.test-mic').click()
    page.wait_for_timeout(15000)  # Give Gemini time to respond
    
    page.screenshot(path='test-results/gemini-browser-test.png', full_page=False)
    
    print("=== Console logs ===")
    for log in logs:
        if any(k in log.lower() for k in ['speech', 'direct', 'speak', 'audio', 'chunks', 'error', 'gemini', 'pcm', 'wav', 'play', 'decode', 'premium']):
            print(log)
    
    print("\n=== Verification ===")
    checks = {
        "Direct path": any("browser-direct" in l for l in logs),
        "Direct service created": any("creating DIRECT" in l for l in logs),
        "Speak called": any("premium TTS via" in l for l in logs),
        "Got audio chunks": any("chunks=" in l and "chunks=0" not in l for l in logs),
        "playTestAudio called": any("playTestAudio" in l for l in logs),
        "No errors": not any("[PAGE_ERROR]" in l for l in logs),
    }
    for k, v in checks.items():
        print(f"  [{'PASS' if v else 'FAIL'}] {k}")
    
    # Check audio bytes
    for log in logs:
        if "playTestAudio" in log:
            print(f"\n  Audio details: {log}")
    
    browser.close()
