import { chromium } from 'playwright';

const fakeTokens = {
  access_token: 'ya29.test-fake-token-1234567890',
  refresh_token: '1//test-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  email: 'test@gmail.com',
  name: 'Test User',
};
const hash = `google_tokens=${encodeURIComponent(JSON.stringify(fakeTokens))}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Collect console logs
const logs = [];
page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => logs.push(`[ERROR] ${err.message}`));

// Helper: wait for a specific console message
function waitForLog(pattern, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for log: ${pattern}`)), timeoutMs);
    const handler = msg => {
      if (msg.text().includes(pattern)) {
        clearTimeout(timer);
        page.off('console', handler);
        setTimeout(resolve, 300);
      }
    };
    // Check already-collected logs
    for (const l of logs) {
      if (l.includes(pattern)) {
        clearTimeout(timer);
        setTimeout(resolve, 300);
        return;
      }
    }
    page.on('console', handler);
  });
}

// Step 1: Load settings page fresh (no hash) to init DB
console.log('--- Step 1: Fresh load ---');
await page.goto('http://localhost:3456/settings', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(3000);

let providers = await page.$$eval('td.cell-provider', els => els.map(e => e.textContent.trim()));
console.log('Providers on fresh load:', providers);

// Step 2: Simulate real OAuth flow — user comes from Google → callback → 302 to /settings#tokens
// Navigate away first (simulates being on Google's OAuth page), then load settings with hash
console.log('\n--- Step 2: Load with OAuth hash (full navigation) ---');
await page.goto('about:blank');
await page.goto(`http://localhost:3456/settings#${hash}`, { waitUntil: 'networkidle', timeout: 15000 });

// Wait for the OAuth processing to complete
try {
  await waitForLog('[OAuth] complete', 20000);
  console.log('OAuth processing confirmed complete');
} catch (e) {
  console.log('WARNING:', e.message);
}

// Extra time for DOM flush
await page.waitForTimeout(500);

providers = await page.$$eval('td.cell-provider', els => els.map(e => e.textContent.trim()));
console.log('Providers after OAuth hash:', providers);

const step2HasGemini = providers.some(p => p.includes('Gemini'));

// Check URL (was hash cleaned up?)
const currentUrl = page.url();
console.log('Current URL:', currentUrl);
console.log('Hash cleaned up:', !currentUrl.includes('google_tokens'));

// Step 3: Refresh to verify persistence
console.log('\n--- Step 3: Refresh (verify persistence) ---');
await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(3000);

providers = await page.$$eval('td.cell-provider', els => els.map(e => e.textContent.trim()));
console.log('Providers after refresh:', providers);

const step3HasGemini = providers.some(p => p.includes('Gemini'));

// Dump relevant console logs
console.log('\n--- Console logs ---');
for (const l of logs) {
  if (l.includes('OAuth') || l.includes('error') || l.includes('Error') || l.includes('Failed')) {
    console.log(l);
  }
}

// Results
console.log('\n--- Results ---');
console.log(`Step 2 (immediate): ${step2HasGemini ? 'PASS' : 'FAIL'} — Gemini ${step2HasGemini ? 'appears' : 'MISSING'}`);
console.log(`Step 3 (after refresh): ${step3HasGemini ? 'PASS' : 'FAIL'} — Gemini ${step3HasGemini ? 'appears' : 'MISSING'}`);
console.log(`Overall: ${step2HasGemini && step3HasGemini ? 'PASS' : 'FAIL'}`);

await browser.close();
