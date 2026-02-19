"""Capture screenshots of blog index and several new articles."""
from playwright.sync_api import sync_playwright

PAGES = [
    ("http://localhost:3456/blog/", "test-results/blog-index.png"),
    ("http://localhost:3456/blog/todoist-review/", "test-results/article-todoist.png"),
    ("http://localhost:3456/blog/clickup-review/", "test-results/article-clickup.png"),
    ("http://localhost:3456/blog/getting-things-done-guide/", "test-results/article-gtd.png"),
    ("http://localhost:3456/blog/monday-com-review/", "test-results/article-monday.png"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    for url, path in PAGES:
        page.goto(url)
        page.wait_for_load_state("networkidle")
        page.screenshot(path=path, full_page=True)
        print(f"Captured {path}")
    browser.close()
