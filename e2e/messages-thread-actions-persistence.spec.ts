import { expect, test, type Locator, type Page } from "@playwright/test";
import { bootstrapMessagesE2E } from "./helpers/messages-e2e";

function hardFail(reason: string): never {
  const message = `[messages-thread-actions-persistence] ${reason}`;
  console.error(message);
  throw new Error(message);
}

async function openThreadActions(page: Page) {
  await page.getByTestId("thread-actions-button").click();
  await expect(page.getByTestId("thread-actions-menu")).toBeVisible();
}

async function getThreadRowOrFail(page: Page) {
  const bootstrap = await bootstrapMessagesE2E(page);
  if (!bootstrap.ready) {
    hardFail(`Bootstrap not ready: ${bootstrap.reason}`);
  }

  await page.goto("/messages");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { name: /^Inbox$/ })).toBeVisible();

  const rows = page.getByTestId("thread-row");
  await rows.first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => null);
  if ((await rows.count()) === 0) {
    hardFail("No thread rows available for persistence test.");
  }
  return rows.first();
}

async function ensureThreadMarkedUnread(rowByToken: Locator) {
  const unreadDot = rowByToken.getByTestId("thread-unread-dot");
  if ((await unreadDot.count()) > 0) return;

  await rowByToken.getByTestId("thread-row-menu-button").click();
  await expect(rowByToken.getByTestId("thread-row-menu")).toBeVisible();

  const markUnread = rowByToken.getByTestId("thread-mark-unread");
  if ((await markUnread.count()) > 0) {
    await markUnread.click();
    await expect(unreadDot).toHaveCount(1, { timeout: 10_000 });
    return;
  }

  const markRead = rowByToken.getByTestId("thread-mark-read");
  if ((await markRead.count()) === 0) {
    hardFail("Thread row menu did not expose unread toggle actions.");
  }

  await markRead.click();
  await rowByToken.getByTestId("thread-row-menu-button").click();
  await expect(rowByToken.getByTestId("thread-row-menu")).toBeVisible();
  await rowByToken.getByTestId("thread-mark-unread").click();
  await expect(unreadDot).toHaveCount(1, { timeout: 10_000 });
}

test("pin + mute + unread survive reload", async ({ page }) => {
  const row = await getThreadRowOrFail(page);
  const token = await row.getAttribute("data-thread-token");
  if (!token) {
    hardFail("Thread row missing data-thread-token.");
  }

  await row.click();

  if ((await page.getByText("Local prefs mode").count()) > 0) {
    hardFail("Thread preferences are in local mode. Apply latest SQL migration for thread_participants prefs.");
  }

  await openThreadActions(page);
  if ((await page.getByTestId("thread-action-pin").count()) === 0) {
    hardFail("Pin action is unavailable.");
  }
  await page.getByTestId("thread-action-pin").click();

  await openThreadActions(page);
  if ((await page.getByTestId("thread-action-mute-8h").count()) === 0) {
    hardFail("Mute action is unavailable.");
  }
  await page.getByTestId("thread-action-mute-8h").click();

  const rowByToken = page.locator(`[data-testid="thread-row"][data-thread-token="${token}"]`);
  await expect(rowByToken).toBeVisible({ timeout: 10_000 });

  await ensureThreadMarkedUnread(rowByToken);

  await expect(rowByToken.getByTestId("thread-pinned-indicator")).toBeVisible({ timeout: 10_000 });
  await expect(rowByToken.getByTestId("thread-muted-indicator")).toBeVisible({ timeout: 10_000 });
  await expect(rowByToken.getByTestId("thread-unread-dot")).toHaveCount(1, { timeout: 10_000 });

  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  const persistedRow = page.locator(`[data-testid="thread-row"][data-thread-token="${token}"]`);
  await expect(persistedRow).toBeVisible({ timeout: 10_000 });
  await expect(persistedRow.getByTestId("thread-pinned-indicator")).toBeVisible({ timeout: 10_000 });
  await expect(persistedRow.getByTestId("thread-muted-indicator")).toBeVisible({ timeout: 10_000 });
  await expect(persistedRow.getByTestId("thread-unread-dot")).toHaveCount(1, { timeout: 10_000 });

  await persistedRow.click();
  await openThreadActions(page);
  await expect(page.getByTestId("thread-action-unpin")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("thread-action-unmute")).toBeVisible({ timeout: 10_000 });
});
