from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto("http://localhost:3456/meeting")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3000)
    page.screenshot(path="scripts/meeting-now.png", full_page=True)
    
    # Also get the tasks page
    page.goto("http://localhost:3456/tasks")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3000)
    page.screenshot(path="scripts/tasks-now.png", full_page=True)
    browser.close()
