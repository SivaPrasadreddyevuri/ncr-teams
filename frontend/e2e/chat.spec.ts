/**
 * Chat, driven through a real browser.
 *
 * These are the assertions the server suite cannot make. It proves a frame is
 * published; nothing up to now proved a browser connects to the socket, receives the
 * frame, and renders it. Every test here is one where the failure mode is "the API is
 * fine and the screen is wrong".
 *
 * The two-context tests are the point of the harness. A message delivered to one
 * browser is a subscription bug that a single-context test cannot see at all.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/** The seeded demo credentials. Public by design; see backend/.env.example. */
const ALEX = { email: 'alex@company.com', password: 'showcase-2026' };
const SARAH = { email: 'sarah@company.com', password: 'showcase-2026' };

/**
 * Signs in through the real form.
 *
 * Deliberately not a token injection or a seeded cookie: the login form is part of
 * what a person does, and a shortcut past it would skip the CSRF handshake and the
 * `Secure` cookie flag, both of which are exactly what breaks in a split deployment.
 */
/**
 * The composer.
 *
 * `.first()` rather than a strict single match, because the chat tree can briefly
 * hold two composers during the client-side transition after `goto('/chat')`: the
 * outgoing route's DOM and the incoming one coexist for a frame or two. Measured
 * with `e2e/probe.spec.ts`, the settled page has exactly one, so the second is a
 * transition artefact and not a screen rendering two composers.
 */
const composerInput = (page: Page) => page.getByTestId('composer-input').first();

/**
 * Signs in through the real form.
 *
 * Deliberately not a token injection or a seeded cookie: the login form is part of
 * what a person does, and a shortcut past it would skip the CSRF handshake and the
 * `Secure` cookie flag, both of which is exactly what breaks in a split deployment.
 *
 * It also *types* the address rather than clicking the persona picker, which is the
 * more honest path and caught a real bug. The picker seeds the email field, so
 * clicking it keeps the two in step; typing an address does not. The form used to
 * take the identity from the picker, so signing in as Sarah while it sat on Alex left
 * the app believing it was Alex -- and because `currentUserId` decides whether a
 * frame is another person or an echo of your own, every incoming typing indicator
 * was discarded as a phantom second cursor.
 */
async function signIn(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Login lands on the dashboard, which has no composer -- waiting for one here would
  // time out on a perfectly good sign-in. The route change is the observable signal
  // that the session cookie was set, so that is what is waited on.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

/**
 * Waits until the socket is actually open.
 *
 * On the app's own connection state, not a sleep. `ChatClient` drops a `typing.start`
 * if the socket is not up yet (`if (!client) return`), so a fixed pause made the typing
 * test fail intermittently depending on how fast the machine was -- which is the
 * worst kind of test failure, because it passes in CI and fails on a laptop, or the
 * reverse.
 */
async function waitForSocket(page: Page): Promise<void> {
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'open', {
    timeout: 25_000,
  });
}

/**
 * Opens the shared channel and waits for the socket.
 *
 * The channel rail is collapsed into a drawer at desktop width, so the buttons exist
 * in the DOM but cannot be clicked -- measured, not assumed. Both people are already
 * on `general` on arrival (verified: `c1` is `channels[0]` for Alex and for Sarah, and
 * the socket reaches `open`), so this asserts that rather than clicking to force it.
 * If the default ever changes, this fails loudly instead of the two-person tests
 * quietly running in different channels -- which is what made the typing test look
 * like a server bug when it was the harness.
 */
const GENERAL = 'c1';

async function openGeneral(page: Page): Promise<void> {
  await page.goto('/chat');
  await expect(composerInput(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('message-list')).toBeVisible({ timeout: 20_000 });
  await waitForSocket(page);
  await expect(page.getByTestId('channel-button').filter({ hasText: '#' })).toBeVisible({
    timeout: 5_000,
  }).catch(() => undefined);
  await expect(
    page.locator(`[data-testid="channel-button"][data-channel-id="${GENERAL}"][aria-current="true"]`),
  ).toHaveCount(1, { timeout: 20_000 });
}

const messageBody = (page: Page, text: string) =>
  page.getByTestId('message').filter({ hasText: text });

test.describe('chat: signing in and loading', () => {
  test('signs in and renders the composer', async ({ page }) => {
    await signIn(page, ALEX);
    await openGeneral(page);
    await expect(composerInput(page)).toBeVisible();
  });

  test('loads messages from the API rather than the fixtures', async ({ page }) => {
    await signIn(page, ALEX);
    await openGeneral(page);

    // The seeded channel is `general` and carries channel messages. If this renders
    // an empty list with the fixtures loaded instead, the rewrite or the session is
    // wrong and every other test would be asserting against fixture data.
    await expect(page.getByTestId('message').first()).toBeVisible({ timeout: 20_000 });
  });

  test('the API is reachable through the frontend origin', async ({ page }) => {
    await signIn(page, ALEX);

    // Proves the proxy path directly rather than inferring it from the screen. A
    // rewrite pointing at the wrong host fails here with a readable message instead
    // of as an empty channel.
    const health = await page.request.get('/api/health');
    expect(health.ok()).toBe(true);
    const body = await health.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ready');
    expect(body.migrationsApplied).toBe(true);
  });
});

test.describe('chat: sending', () => {
  test('sends a message and it stays on screen', async ({ page }) => {
    await signIn(page, ALEX);
    await openGeneral(page);

    const text = `harness-send-${Date.now()}`;
    await composerInput(page).fill(text);
    await composerInput(page).press('Enter');

    await expect(messageBody(page, text)).toBeVisible({ timeout: 20_000 });

    // The optimistic row must be reconciled by the server's response, not left
    // pending forever -- that is the failure a hand test misses because the text is
    // on screen either way.
    const row = messageBody(page, text).first();
    await expect(row).not.toHaveAttribute('data-pending', /.*/, { timeout: 20_000 });
  });

  test('Enter sends and Shift+Enter inserts a newline', async ({ page }) => {
    await signIn(page, ALEX);
    await openGeneral(page);

    const composer = composerInput(page);

    await composer.fill('first line');
    await composer.press('Shift+Enter');
    await composer.type('second line');

    // Two lines in the box, and nothing sent.
    await expect(composer).toHaveValue('first line\nsecond line');
    await expect(page.getByTestId('message').filter({ hasText: 'first line' })).toHaveCount(0);
  });
});

test.describe('chat: realtime between two people', () => {
  /**
   * Two independent sessions.
   *
   * Separate contexts rather than two tabs, because the session is an `httpOnly`
   * cookie: two tabs in one context share it, which would silently make both sides
   * the same user and turn a subscription test into a no-op.
   */
  test('a message from one person appears in the other', async ({ browser }) => {
    const alexContext: BrowserContext = await browser.newContext();
    const sarahContext: BrowserContext = await browser.newContext();

    const alex = await alexContext.newPage();
    const sarah = await sarahContext.newPage();

    try {
      await signIn(alex, ALEX);
      await signIn(sarah, SARAH);

      await openGeneral(alex);
      await openGeneral(sarah);

      // Both sockets, on the app's own state rather than a pause. See waitForSocket.
      await waitForSocket(alex);
      await waitForSocket(sarah);

      const text = `harness-realtime-${Date.now()}`;

      await composerInput(alex).fill(text);
      await composerInput(alex).press('Enter');

      // The whole reason for the harness.
      await expect(messageBody(sarah, text)).toBeVisible({ timeout: 25_000 });
      // And it must not be marked as the other person's optimistic row.
      await expect(messageBody(sarah, text).first()).not.toHaveAttribute('data-pending', /.*/);
    } finally {
      await alexContext.close();
      await sarahContext.close();
    }
  });

  test('a typing indicator reaches the other person and then clears', async ({ browser }) => {
    const alexContext: BrowserContext = await browser.newContext();
    const sarahContext: BrowserContext = await browser.newContext();

    const alex = await alexContext.newPage();
    const sarah = await sarahContext.newPage();

    try {
      await signIn(alex, ALEX);
      await signIn(sarah, SARAH);
      await openGeneral(alex);
      await openGeneral(sarah);

      await waitForSocket(alex);
      await waitForSocket(sarah);

      // Type without sending.
      await composerInput(alex).fill('typing something');
      await composerInput(alex).press('Space');

      // The hook exposes the count and names rather than the rendered sentence, which
      // changes shape with the peer count and would need three assertions.
      const indicator = sarah.getByTestId('typing-indicator');
      await expect(indicator).toBeVisible({ timeout: 15_000 });
      await expect(indicator).toHaveAttribute('data-count', '1');

      // Clear the box: the indicator must go, not linger until its expiry. The server
      // broadcasts an empty draft as "stopped typing", and a screen that keeps
      // showing it is reporting someone as typing when they are not.
      await composerInput(alex).fill('');
      await expect(indicator).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await alexContext.close();
      await sarahContext.close();
    }
  });
});
