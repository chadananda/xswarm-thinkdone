"""Capture Keep Reading section and blog index to verify card redesign."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})

    # Blog index
    page.goto("http://localhost:3456/blog/")
    page.wait_for_load_state("networkidle")
    page.screenshot(path="test-results/cards-blog-index.png", full_page=True)
    print("Captured blog index")

    # Article page - scroll to Keep Reading section
    page.goto("http://localhost:3456/blog/todoist-review/")
    page.wait_for_load_state("networkidle")
    page.screenshot(path="test-results/cards-article-full.png", full_page=True)
    print("Captured full article")

    # Scroll to bottom for Keep Reading
    page.evaluate("window.scrollTo(0, document.body.scrollHeight - 900)")
    page.wait_for_timeout(800)
    page.screenshot(path="test-results/cards-keep-reading.png")
    print("Captured Keep Reading section")

    # Another article to check different related articles
    page.goto("http://localhost:3456/blog/getting-things-done-guide/")
    page.wait_for_load_state("networkidle")
    page.evaluate("window.scrollTo(0, document.body.scrollHeight - 900)")
    page.wait_for_timeout(800)
    page.screenshot(path="test-results/cards-keep-reading-2.png")
    print("Captured GTD Keep Reading section")

    browser.close()
