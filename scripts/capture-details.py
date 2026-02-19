"""Capture detailed screenshots of layout components in new articles."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})

    # GTD article - has TOC with similar articles sidebar
    page.goto("http://localhost:3456/blog/getting-things-done-guide/")
    page.wait_for_load_state("networkidle")
    page.evaluate("window.scrollTo(0, 600)")
    page.wait_for_timeout(500)
    page.screenshot(path="test-results/detail-toc-sidebar.png")
    print("Captured TOC + Similar Articles sidebar")

    # ClickUp article - has insight, technical, warning callouts
    page.goto("http://localhost:3456/blog/clickup-review/")
    page.wait_for_load_state("networkidle")
    callout = page.locator(".callout").first
    if callout.count() > 0:
        callout.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        page.screenshot(path="test-results/detail-callout-types.png")
        print("Captured callout types")

    # Monday article - stat block area
    page.goto("http://localhost:3456/blog/monday-com-review/")
    page.wait_for_load_state("networkidle")
    page.evaluate("window.scrollTo(0, 800)")
    page.wait_for_timeout(500)
    page.screenshot(path="test-results/detail-monday-components.png")
    print("Captured Monday.com components")

    # Todoist - related articles at bottom
    page.goto("http://localhost:3456/blog/todoist-review/")
    page.wait_for_load_state("networkidle")
    page.evaluate("window.scrollTo(0, document.body.scrollHeight - 1200)")
    page.wait_for_timeout(500)
    page.screenshot(path="test-results/detail-related-articles.png")
    print("Captured related articles section")

    browser.close()
