"""Capture blog index and a few articles to verify hero images load."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})

    page.goto("http://localhost:3456/blog/")
    page.wait_for_load_state("networkidle")
    page.screenshot(path="test-results/heroes-blog-index.png", full_page=True)
    print("Captured blog index")

    page.goto("http://localhost:3456/blog/trello-review/")
    page.wait_for_load_state("networkidle")
    page.screenshot(path="test-results/heroes-trello.png")
    print("Captured Trello hero")

    page.goto("http://localhost:3456/blog/getting-things-done-guide/")
    page.wait_for_load_state("networkidle")
    page.screenshot(path="test-results/heroes-gtd.png")
    print("Captured GTD hero")

    page.goto("http://localhost:3456/blog/monday-com-review/")
    page.wait_for_load_state("networkidle")
    page.screenshot(path="test-results/heroes-monday.png")
    print("Captured Monday.com hero")

    browser.close()
