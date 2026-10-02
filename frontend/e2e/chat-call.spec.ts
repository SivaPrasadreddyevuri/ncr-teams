/**
 * Starting a call from the chat screen.
 *
 * These drive the header buttons rather than the meetings list, because "I want to
 * call from the chat" is the whole point: an employee who is already reading a channel
 * should not have to navigate away to reach a call.
 *
 * They run **without LiveKit credentials**, like `meeting.spec.ts`, so what they prove
 * is that the flow reaches the room and the room is honest about media. Whether a
 * camera track reaches a `<video>` element is `media.spec.ts`'s job.
 *
 * ## These write to the development database
 *
 * Pressing a call button creates a real `Meeting` row, so a run leaves a standing
 * room behind per channel it touched. That is the same situation as every other
 * browser test here: they run against the development database, not `ncr_teams_test`.
 * `npm run db:demo` resets it, and `npm run db:verify` expects a freshly seeded one --
 * so run that before verifying, as the README says. There is no delete endpoint for a
 * meeting, which is why this cannot clean up after itself.
 */

import { expect, test, type Page } from '@playwright/test';

const ALEX = { email: 'alex@company.com', password: 'showcase-2026' };
const SARAH = { email: 'sarah@company.com', password: 'showcase-2026' };

async function signIn(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

async function openChat(page: Page): Promise<void> {
  await page.goto('/chat');
  await expect(page.getByTestId('message-list').or(page.getByText(/quiet so far/i))).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('chat: starting a call', () => {
  test('the channel header offers audio and video call buttons', async ({ page }) => {
    await signIn(page, ALEX);
    await openChat(page);

    // Named per channel, because there is one set of buttons per channel and "Start
    // video call" alone would not say which room it opens.
    await expect(page.getByRole('button', { name: /^Start audio call in #/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Start video call in #/ })).toBeVisible();
  });

  test('pressing the video button opens this channel’s room', async ({ page }) => {
    await signIn(page, ALEX);
    await openChat(page);

    await page.getByRole('button', { name: /^Start video call in #/ }).click();

    // Over the chat, not navigated away from it: the channel is still behind it.
    const overlay = page.getByTestId('call-overlay');
    await expect(overlay).toBeVisible({ timeout: 20_000 });
    await expect(overlay.getByTestId('room-status')).toBeVisible({ timeout: 20_000 });
  });

  test('the room it opens says plainly that media is unavailable here', async ({ page }) => {
    await signIn(page, ALEX);
    await openChat(page);

    await page.getByRole('button', { name: /^Start video call in #/ }).click();

    const status = page.getByTestId('call-overlay').getByTestId('room-status');
    await expect(status).toHaveAttribute('data-state', 'simulated');
    await expect(status).toContainText('not configured');
  });

  test('the same room is open to a colleague, from one button press', async ({ browser }) => {
    const alexContext = await browser.newContext();
    const sarahContext = await browser.newContext();
    const alex = await alexContext.newPage();
    const sarah = await sarahContext.newPage();

    try {
      await signIn(alex, ALEX);
      await openChat(alex);

      // What the channel name is, so the second browser can press the button for the
      // same channel rather than whatever happens to be selected.
      const label = await alex
        .getByRole('button', { name: /^Start video call in #/ })
        .getAttribute('aria-label');
      expect(label).toBeTruthy();
      const channelName = label!.replace('Start video call in #', '');

      await alex.getByRole('button', { name: /^Start video call in #/ }).click();
      await expect(alex.getByTestId('call-overlay')).toBeVisible({ timeout: 20_000 });

      await signIn(sarah, SARAH);
      await openChat(sarah);

      // The same derived room name is what makes this land in one room rather than
      // two, so this is the assertion that the feature is idempotent end to end.
      await sarah
        .getByRole('button', { name: `Start video call in #${channelName}` })
        .click();
      await expect(sarah.getByTestId('call-overlay')).toBeVisible({ timeout: 20_000 });

      const alexRoom = await alex.getByTestId('room-status').getAttribute('data-state');
      const sarahRoom = await sarah.getByTestId('room-status').getAttribute('data-state');
      expect(alexRoom).toBe(sarahRoom);
    } finally {
      await alexContext.close();
      await sarahContext.close();
    }
  });

  test('leaving returns to the channel', async ({ page }) => {
    await signIn(page, ALEX);
    await openChat(page);

    await page.getByRole('button', { name: /^Start video call in #/ }).click();
    await expect(page.getByTestId('call-overlay')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Leave meeting' }).click();

    // Back to the chat, not a blank screen. The whole reason the call renders over
    // the chat is that leaving it should put you back in the conversation.
    await expect(page.getByTestId('call-overlay')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^Start video call in #/ })).toBeVisible();
  });

  test('the Meetings tab offers the channel’s call', async ({ page }) => {
    await signIn(page, ALEX);
    await openChat(page);

    await page.getByRole('button', { name: /^Meetings$/ }).click();

    const tab = page.locator('.empty-state');
    // Either state is a real answer: a call exists, or one can be started. What this
    // rejects is the old placeholder that said the chat was unreachable.
    await expect(tab).toBeVisible();
    await expect(tab).not.toContainText('opens inside the room');
    await expect(
      tab.getByRole('button', { name: /^(Start a call|Join the call) in #/ }),
    ).toBeVisible({ timeout: 20_000 });
  });
});