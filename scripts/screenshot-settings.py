from playwright.sync_api import sync_playwright
import os

out_dir = os.path.join(os.path.dirname(__file__), '..', 'docs')
os.makedirs(out_dir, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # Desktop screenshot (1280px)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto('http://localhost:3456/settings')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    desktop_path = os.path.join(out_dir, 'settings-desktop.png')
    page.screenshot(path=desktop_path, full_page=True)
    print(f"Desktop screenshot saved to {desktop_path}")
    page.close()

    # Mobile screenshot (375px)
    page = browser.new_page(viewport={"width": 375, "height": 812})
    page.goto('http://localhost:3456/settings')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    mobile_path = os.path.join(out_dir, 'settings-mobile.png')
    page.screenshot(path=mobile_path, full_page=True)
    print(f"Mobile screenshot saved to {mobile_path}")
    page.close()

    browser.close()
