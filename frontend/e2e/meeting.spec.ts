/**
 * The meeting room.
 *
 * These run **without LiveKit credentials on purpose**. That is the configuration a
 * fresh clone and a demo without keys are in, and it is the one most likely to be
 * shipped broken -- a room that renders, accepts clicks, and quietly does nothing is
 * worse than one that says media is unavailable.
 *
 * So the assertions are about honesty rather than about video:
 *
 * - the room says which mode it is in, out loud, before anything is pressed
 * - the media controls are disabled rather than inert, so a press cannot look like
 *   a camera toggle that failed
 * - the tile list is still populated from the meeting, so the room is usable
 *
 * The live-media path is covered by `media.spec.ts`, which skips unless credentials
 * are present. Between them, both configurations are asserted rather than assumed.
 */

import { expect, test, type Page } from '@playwright/test';

const ALEX = { email: 'alex@company.com', password: 'showcase-2026' };

async function signIn(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

/** Opens the first meeting's room, which is what the Join button does. */
async function joinFirstMeeting(page: Page): Promise<void> {
  await page.goto('/meetings');
  await page.getByRole('button', { name: /^join$/i }).first().click();
  await expect(page.getByTestId('room-status')).toBeVisible({ timeout: 20_000 });
}

test.describe('meeting room: without LiveKit configured', () => {
  test('states plainly that there is no media, before anything is pressed', async ({ page }) => {
    await signIn(page, ALEX);
    await joinFirstMeeting(page);

    const status = page.getByTestId('room-status');

    // The build under test has no NEXT_PUBLIC_LIVEKIT_URL, so this must be the
    // simulated state. Asserted by exact text because the whole point is that the
    // room does not pretend.
    await expect(status).toHaveAttribute('data-state', 'simulated');
    await expect(status).toContainText('not configured');

    // And visible without clicking anything, so somebody sitting in the room cannot
    // believe they are on camera.
    await expect(status).toBeVisible();
  });

  test('disables the media controls instead of accepting clicks that do nothing', async ({ page }) => {
    await signIn(page, ALEX);
    await joinFirstMeeting(page);

    for (const name of [
      'Unmute microphone',
      'Turn camera on',
      'Share screen',
      'Raise hand',
    ]) {
      await expect(page.getByRole('button', { name })).toBeDisabled();
    }

    // Pressing one anyway must not change what the room claims. A disabled button
    // cannot, but the assertion is here because "disabled" is the thing under test.
    const status = page.getByTestId('room-status');
    const before = await status.getAttribute('data-state');
    await page.getByRole('button', { name: 'Turn camera on' }).click({ force: true });
    expect(await status.getAttribute('data-state')).toBe(before);
  });

  test('still shows the meeting and its participants, so the room is usable', async ({ page }) => {
    await signIn(page, ALEX);
    await joinFirstMeeting(page);

    // Tiles come from the meeting's participant list, not from a live room, so
    // somebody waiting to be let in is not invisible.
    const tiles = page.getByTestId('meeting-tile');
    await expect(tiles.first()).toBeVisible({ timeout: 20_000 });
    expect(await tiles.count()).toBeGreaterThan(0);
  });

  test('can still leave', async ({ page }) => {
    await signIn(page, ALEX);
    await joinFirstMeeting(page);

    await page.getByRole('button', { name: 'Leave meeting' }).click();
    // Back to the list rather than a blank screen: leaving has to work even when the
    // call never connected.
    await expect(page.getByTestId('room-status')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Your Meetings' })).toBeVisible();
  });
});