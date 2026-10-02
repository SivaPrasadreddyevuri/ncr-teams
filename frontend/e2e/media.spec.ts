/**
 * Live media, when LiveKit is configured.
 *
 * ## Why this file mostly skips
 *
 * It needs three things that a checkout does not have: the API key and secret on the
 * server, `NEXT_PUBLIC_LIVEKIT_URL` in the built frontend, and a browser that will
 * grant camera and microphone. Rather than fail on a machine without them, the suite
 * skips with a message naming what is missing -- a red suite that only means "no
 * credentials" trains people to ignore red.
 *
 * `meeting.spec.ts` covers the unconfigured case, so between the two every
 * configuration has assertions rather than assumptions.
 *
 * ## Fake devices, not real hardware
 *
 * `--use-fake-device-for-media-stream` gives Chromium a synthetic camera and
 * microphone. That is what makes this testable at all in CI: no webcam, no drivers,
 * and a frame that renders whether or not a human is sitting at the machine. It also
 * means the test proves media *flowed* -- a track was published, subscribed to, and
 * attached to an element -- which is the part a screenshot cannot show.
 */

import { expect, test, type Page } from '@playwright/test';

/** Set on the test process so the build under test has a URL inlined. */
const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

const ALEX = { email: 'alex@company.com', password: 'showcase-2026' };
const SARAH = { email: 'sarah@company.com', password: 'showcase-2026' };

/**
 * Whether the live path can be exercised at all.
 *
 * Asked through the token endpoint rather than by reading the environment, because
 * `setup-env` loads the developer's own `backend/.env` and the browser cannot see it.
 * A 503 here is the honest answer -- the deployment has no LiveKit credentials -- and
 * is what turns into a skip with a message naming what is missing.
 */
async function liveMediaAvailable(page: Page): Promise<boolean> {
  if (!livekitUrl) return false;

  const list = await page
    .request
    .get('/api/meetings?scope=upcoming')
    .then((r) => (r.ok() ? r.json() : null))
    .catch(() => null);

  const meeting = list?.meetings?.[0];
  if (!meeting) return false;

  const token = await page
    .request
    .post(`/api/meetings/${meeting.id}/token`)
    .then((r) => (r.ok() ? r.json() : null))
    .catch(() => null);

  return Boolean(token?.token);
}

async function signIn(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

async function joinFirstMeeting(page: Page): Promise<void> {
  await page.goto('/meetings');
  await page.getByRole('button', { name: /^join$/i }).first().click();
  await expect(page.getByTestId('room-status')).toBeVisible({ timeout: 20_000 });
}

/**
 * Asserts `viewer` is receiving a real frame from `other`.
 *
 * This is the assertion that separates a call from a picture of one. A tile carrying
 * the other person's name is satisfied by the meeting's seeded participant list, so
 * it passes with the camera disconnected -- which is exactly the bug it originally
 * masked. Three things are therefore asserted in order of what they rule out:
 *
 * 1. the tile is a *connected* participant, not an invited one
 * 2. a track was attached to the element -- the component's own report of it
 * 3. the element is playing frames -- which `attach` alone does not guarantee, since a
 *    stream that never starts leaves `videoWidth` at 0 and renders nothing
 */
async function assertReceivingFrames(viewer: Page, other: string): Promise<void> {
  const tile = viewer.getByTestId('meeting-tile').filter({ hasText: other }).first();
  await expect(tile).toHaveAttribute('data-connected', 'true', { timeout: 45_000 });

  const video = tile.getByTestId('meeting-video');
  await expect(video).toHaveAttribute('data-has-video', 'true', { timeout: 45_000 });

  const box = await video.boundingBox();
  expect(box, `${other}'s tile should have a laid-out video element`).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  const playing = await video.evaluate(
    (element) =>
      (element as HTMLVideoElement).videoWidth > 0 &&
      (element as HTMLVideoElement).videoHeight > 0 &&
      (element as HTMLVideoElement).readyState >= 2,
  );
  expect(playing, `${other}'s stream should be reaching the video element`).toBe(true);
}

test.describe('meeting room: live media', () => {
  test('connects and reports itself live, with the controls enabled', async ({ page }) => {
    await signIn(page, ALEX);

    if (!(await liveMediaAvailable(page))) {
      test.skip(
        true,
        'LiveKit is not configured (needs NEXT_PUBLIC_LIVEKIT_URL plus server credentials).',
      );
    }

    await joinFirstMeeting(page);

    const status = page.getByTestId('room-status');
    await expect(status).toHaveAttribute('data-state', 'live', { timeout: 45_000 });
    await expect(status).toContainText('Live');

    // A live room has working controls, so the simulated case's disabled buttons must
    // not be left disabled here.
    await expect(page.getByRole('button', { name: 'Turn camera off' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Unmute microphone' })).toBeEnabled();
  });

  test('two people in one room both see a remote video track attached', async ({ browser }) => {
    const alexContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const sarahContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const alex = await alexContext.newPage();
    const sarah = await sarahContext.newPage();

    try {
      await signIn(alex, ALEX);

      if (!(await liveMediaAvailable(alex))) {
        test.skip(
          true,
          'LiveKit is not configured (needs NEXT_PUBLIC_LIVEKIT_URL plus server credentials).',
        );
      }

      await signIn(sarah, SARAH);
      await joinFirstMeeting(alex);
      await joinFirstMeeting(sarah);

      // Both sockets settled before joining matters: a track published before the
      // other side subscribes still arrives, but the participant list only fills in
      // after the remote event, so waiting on status avoids racing the first tile.
      await expect(alex.getByTestId('room-status')).toHaveAttribute('data-state', 'live', {
        timeout: 45_000,
      });
      await expect(sarah.getByTestId('room-status')).toHaveAttribute('data-state', 'live', {
        timeout: 45_000,
      });

      // Each side sees a tile for the other's identity -- proof the room is shared
      // rather than two separate copies of the meeting page.
      await expect(
        alex.getByTestId('meeting-tile').filter({ hasText: 'Sarah' }),
      ).toBeVisible({ timeout: 45_000 });
      await expect(
        sarah.getByTestId('meeting-tile').filter({ hasText: 'Alex' }),
      ).toBeVisible({ timeout: 45_000 });
      await assertReceivingFrames(alex, 'Sarah');
      await assertReceivingFrames(sarah, 'Alex');
    } finally {
      await alexContext.close();
      await sarahContext.close();
    }
  });

  test('muting publishes the state rather than only moving an icon', async ({ page }) => {
    await signIn(page, ALEX);

    if (!(await liveMediaAvailable(page))) {
      test.skip(
        true,
        'LiveKit is not configured (needs NEXT_PUBLIC_LIVEKIT_URL plus server credentials).',
      );
    }

    await joinFirstMeeting(page);
    await expect(page.getByTestId('room-status')).toHaveAttribute('data-state', 'live', {
      timeout: 45_000,
    });

    const mic = page.getByRole('button', { name: /microphone/i });
    const before = await mic.getAttribute('aria-pressed');
    await mic.click();
    await expect(mic).not.toHaveAttribute('aria-pressed', before!, { timeout: 15_000 });
  });
});