// Visual regression for the PUBLIC website.
// Baseline = the approved site (git `main`). See docs/CURRENT_SITE_BASELINE.md.
//   1. Serve the approved version and run `npm run test:visual:update` once.
//   2. Serve the version under test and run `npm run test:visual`.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  snapshotPathTemplate: '{testDir}/baseline/{arg}{ext}',
  timeout: 90_000,
  workers: 2,
  reporter: [['list']],
  expect: {
    // Pixel-identical is expected for an unchanged site. A tiny tolerance
    // absorbs font anti-aliasing noise between runs only.
    toHaveScreenshot: { maxDiffPixelRatio: 0.0005, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:8090',
    channel: 'chrome',
    reducedMotion: 'reduce',
    colorScheme: 'light',
  },
});
