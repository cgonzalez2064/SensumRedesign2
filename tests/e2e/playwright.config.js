// Browser tests for the Content Manager and the public site with managed content.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.mjs',
  outputDir: './.artifacts/results',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:8210', trace: 'off' },
  projects: [
    { name: 'desktop-chrome', use: { channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'tablet-chrome', use: { channel: 'chrome', viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
