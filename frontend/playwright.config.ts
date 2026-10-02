/**
 * Browser harness.
 *
 * The server tests cover the realtime frames: that `message.created` is published,
 * that presence is tracked, that a typing event reaches the right peers. None of
 * them prove the browser does anything with those frames, because a message can be
 * published perfectly and still never appear on screen if the socket never opened.
 *
 * That gap is what this closes. Two real Chromium contexts, two real sessions, one
 * real WebSocket each -- which is the only configuration that can catch a rewrite
 * pointing at the wrong host, a cookie that is not `httpOnly` in practice, or a
 * socket that connects and immediately drops.
 *
 * ## What it drives
 *
 * The app, not the API. Every assertion goes through rendered text, so a passing run
 * means a person could have done it. Where a hook was needed to make an assertion
 * unambiguous, a `data-testid` was added to the component rather than reaching for a
 * CSS class, because a class is presentation and a rename would break the test
 * without breaking anything.
 *
 * ## What it deliberately does not do
 *
 * It does not assert on anything the server suite already asserts. Duplicating those
 * assertions in a slower, flakier layer is a cost with no new information. The
 * interesting failures here are the ones only a browser can see.
 */

import { defineConfig, devices } from '@playwright/test';

/**
 * The app under test.
 *
 * Defaults to the production build served by `next start` rather than the dev server,
 * for two reasons: `next dev` injects a client-side runtime that behaves differently
 * from a deployed build, and it is far slower with two contexts open. The harness
 * measures the thing that is actually deployed.
 *
 * `webServer` starts it here so a run is one command. The API is a separate process
 * the caller must already be running -- see README in this directory -- because
 * `API_ORIGIN` is read at build time and pointing it at a port that is not up yet
 * produces a build with no rewrite rather than a clear failure.
 */
const baseURL = process.env.HARNESS_BASE_URL ?? 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './e2e',
  // Two contexts per test is already the expensive part; workers beyond this fight
  // over the single seeded channel the tests share.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Generous, because the first run compiles the app and later assertions wait on
  // a WebSocket round trip. A timeout here that is really a slow machine produces a
  // failure nobody can act on.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.HARNESS_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run start -- --port 3100',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
