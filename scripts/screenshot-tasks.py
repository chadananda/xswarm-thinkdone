from playwright.sync_api import sync_playwright
import os

out = os.path.join(os.path.dirname(__file__), '..')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto('http://localhost:3456/meeting')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    page.screenshot(path=os.path.join(out, 'docs/meeting-tasks-full.png'))

    left = page.locator('.left-column')
    if left.count() > 0:
        left.first.screenshot(path=os.path.join(out, 'docs/meeting-tasks-col.png'))

    browser.close()
    print("Done")
