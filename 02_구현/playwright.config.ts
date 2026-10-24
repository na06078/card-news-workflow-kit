import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.브라우저');
export default defineConfig({
  testDir: './tests/integration', testMatch: '**/*.spec.ts',
  outputDir: './실행데이터/I2/playwright-results',
  reporter: [['list']], workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', headless: true }
});
