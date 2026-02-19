import { expect, test, type Locator, type Page } from "@playwright/test";
import { bootstrapMessagesE2E } from "./helpers/messages-e2e";

function hardFail(reason: string): never {
  const message = `[messages-unread-read] ${reason}`;
  console.error(message);
  throw new Error(message);
}

async function openRowMenu(row: Locator) {
  await row.getByTestId("thread-row-menu-button").click();
  await expect(row.getByTestId("thread-row-menu")).toBeVisible();
}

async function getThreadRowOrFail(page: Page) {
  const bootstrap = await bootstrapMessagesE2E(page);
  if (!bootstrap.ready) {
    hardFail(`Bootstrap not ready: ${bootstrap.reason}`);
  }

  await page.goto("/messages");
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByRole("heading", { name: /^Inbox$/ })).toBeVisible();

  const noThreads = page.getByText("No threads found.");
  const rows = page.getByTestId("thread-row");
  await Promise.race([
    rows.first().waitFor({ state: "visible", timeout: 8_000 }),
    noThreads.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => null);

  if (await noThreads.isVisible().catch(() => false)) {
    hardFail("No threads exist for seeded account.");
  }

  const rowCount = await rows.count();
  if (rowCount === 0) {
    hardFail("No thread rows available to validate unread/read.");
  }

  return rows.first();
}

test("thread row menu toggles unread/read indicator", async ({ page }) => {
  const row = await getThreadRowOrFail(page);

  await expect(row).toBeVisible();

  const unreadDot = row.getByTestId("thread-unread-dot");
  const initialUnread = (await unreadDot.count()) > 0;

  // First toggle
  await openRowMenu(row);
  const markRead = row.getByTestId("thread-mark-read");
  const markUnread = row.getByTestId("thread-mark-unread");

  if (initialUnread) {
    if ((await markRead.count()) === 0) {
      hardFail("Row menu did not expose 'mark read' action for unread row.");
    }
    await markRead.click();
    await expect(unreadDot).toHaveCount(0, { timeout: 10_000 });
  } else {
    if ((await markUnread.count()) === 0) {
      hardFail("Row menu did not expose 'mark unread' action for read row.");
    }
    await markUnread.click();
    await expect(unreadDot).toHaveCount(1, { timeout: 10_000 });
  }

  // Toggle back to original state
  await openRowMenu(row);
  const markReadAgain = row.getByTestId("thread-mark-read");
  const markUnreadAgain = row.getByTestId("thread-mark-unread");

  if (initialUnread) {
    if ((await markUnreadAgain.count()) === 0) {
      hardFail("Row menu did not expose 'mark unread' action on second toggle.");
    }
    await markUnreadAgain.click();
    await expect(unreadDot).toHaveCount(1, { timeout: 10_000 });
  } else {
    if ((await markReadAgain.count()) === 0) {
      hardFail("Row menu did not expose 'mark read' action on second toggle.");
    }
    await markReadAgain.click();
    await expect(unreadDot).toHaveCount(0, { timeout: 10_000 });
  }
});
