from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 800, 'height': 900})
    page.goto('http://localhost:3456/blog/clickup-review/', timeout=15000)
    page.wait_for_load_state('networkidle')

    # Force all blog-reveal elements to be visible
    page.evaluate('''() => {
        document.querySelectorAll('.blog-reveal').forEach(el => {
            el.style.opacity = '1';
            el.style.transform = 'none';
        });
    }''')

    # Find and screenshot the CTA
    cta = page.locator('[data-cta-root]').first
    cta.scroll_into_view_if_needed()
    page.wait_for_timeout(1500)

    # Force visible again after scroll
    page.evaluate('''() => {
        document.querySelectorAll('.blog-reveal, [data-cta-root]').forEach(el => {
            el.style.opacity = '1';
            el.style.transform = 'none';
        });
    }''')
    page.wait_for_timeout(500)

    cta.screenshot(path='test-results/cta-new.png')
    print("New CTA captured")

    # Also get a wider viewport shot
    page.set_viewport_size({'width': 680, 'height': 600})
    page.wait_for_timeout(300)
    cta.screenshot(path='test-results/cta-new-narrow.png')
    print("Narrow CTA captured")

    browser.close()
