from playwright.sync_api import sync_playwright
import os

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(base, 'test-results')
os.makedirs(out, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # Home page
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto('http://localhost:3456/', wait_until='networkidle')
    page.wait_for_timeout(2000)
    page.screenshot(path=os.path.join(out, 'home-full.png'), full_page=True)
    page.screenshot(path=os.path.join(out, 'home-hero.png'))
    page.close()

    # Blog article
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto('http://localhost:3456/blog/why-your-todo-list-doesnt-work/', wait_until='networkidle')
    page.wait_for_timeout(2000)
    page.screenshot(path=os.path.join(out, 'blog-full.png'), full_page=True)
    page.screenshot(path=os.path.join(out, 'blog-hero.png'))
    page.evaluate('window.scrollTo(0, 2000)')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'blog-mid.png'))
    page.evaluate('window.scrollTo(0, document.body.scrollHeight - 1200)')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'blog-bottom.png'))
    page.close()

    # Mobile
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto('http://localhost:3456/blog/why-your-todo-list-doesnt-work/', wait_until='networkidle')
    page.wait_for_timeout(2000)
    page.screenshot(path=os.path.join(out, 'blog-mobile-full.png'), full_page=True)
    page.close()

    browser.close()
    print("All screenshots captured to test-results/")
