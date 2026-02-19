from playwright.sync_api import sync_playwright
import os

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(base, 'test-results')
os.makedirs(out, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto('http://localhost:3456/blog/why-your-todo-list-doesnt-work/', wait_until='networkidle')
    page.wait_for_timeout(3000)

    # 1. Hero + TLDR area
    page.screenshot(path=os.path.join(out, 'article-hero-tldr.png'))

    # 2. Scroll to first paragraph (drop cap)
    page.evaluate('window.scrollTo(0, 600)')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'article-dropcap.png'))

    # 3. Stat block
    page.evaluate('''
        const s = document.querySelector('.stat-block');
        if (s) s.scrollIntoView({block: 'center'});
    ''')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'article-statblock.png'))

    # 4. Study card
    page.evaluate('''
        const s = document.querySelector('.study-card');
        if (s) s.scrollIntoView({block: 'center'});
    ''')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'article-studycard.png'))

    # 5. Quote block
    page.evaluate('''
        const q = document.querySelector('.quote-block');
        if (q) q.scrollIntoView({block: 'center'});
    ''')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'article-quoteblock.png'))

    # 6. Callout (research type)
    page.evaluate('''
        const c = document.querySelector('.callout');
        if (c) c.scrollIntoView({block: 'center'});
    ''')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'article-callout.png'))

    # 7. Video embed
    page.evaluate('''
        const v = document.querySelector('.video-embed');
        if (v) v.scrollIntoView({block: 'center'});
    ''')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'article-video.png'))

    # 8. Q&A section
    page.evaluate('''
        const q = document.querySelector('.qanda');
        if (q) q.scrollIntoView({block: 'center'});
    ''')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'article-qanda.png'))

    # 9. CTA card
    page.evaluate('''
        const c = document.querySelector('.blog-cta-glow');
        if (c) c.scrollIntoView({block: 'center'});
    ''')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'article-cta.png'))

    # 10. Bio + FAQ
    page.evaluate('''
        const b = document.querySelector('.custom-author-bio');
        if (b) b.scrollIntoView({block: 'center'});
    ''')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(out, 'article-bio.png'))

    # 11. Full page
    page.screenshot(path=os.path.join(out, 'article-fullpage.png'), full_page=True)

    page.close()
    browser.close()
    print("Article screenshots captured")
