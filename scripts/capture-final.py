from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto("http://localhost:3456/blog/")
    page.wait_for_load_state("networkidle")
    page.screenshot(path="test-results/final-blog-index.png", full_page=True)
    print("Blog index captured")
    for slug in ["todoist-review", "trello-review", "getting-things-done-guide", "monday-com-review"]:
        page.goto(f"http://localhost:3456/blog/{slug}/")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=f"test-results/final-hero-{slug}.png")
        print(f"Captured {slug}")
    browser.close()
