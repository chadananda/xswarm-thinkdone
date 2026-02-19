import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 600_000, // 10 min — real AI conversations are slow
  expect: { timeout: 120_000 },
  use: {
    baseURL: 'http://localhost:3456',
    screenshot: 'on',
    video: 'retain-on-failure',
    launchOptions: {
      args: [
        '--enable-features=SharedArrayBuffer',
        '--disable-web-security',
      ],
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 } } },
  ],
  outputDir: './test-results/e2e',
});
