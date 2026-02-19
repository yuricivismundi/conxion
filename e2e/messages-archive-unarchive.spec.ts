import { expect, test, type Locator, type Page } from "@playwright/test";
import { bootstrapMessagesE2E } from "./helpers/messages-e2e";

function hardFail(reason: string): never {
  const message = `[messages-archive-unarchive] ${reason}`;
  console.error(message);
  throw new Error(message);
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
    hardFail("No thread rows available for archive/unarchive test.");
  }
  return rows.first();
}

async function openThreadActions(page: Page) {
  await page.getByTestId("thread-actions-button").click();
  await expect(page.getByTestId("thread-actions-menu")).toBeVisible();
}

async function tokenFromRow(row: Locator) {
  const token = await row.getAttribute("data-thread-token");
  if (!token) {
    hardFail("Thread row missing data-thread-token.");
  }
  return token;
}

test("archive and unarchive thread keeps Archived tab in sync", async ({ page }) => {
  const row = await getThreadRowOrFail(page);
  const token = await tokenFromRow(row);

  await row.click();

  await openThreadActions(page);
  await page.getByTestId("thread-action-archive").click();

  const rowByToken = page.locator(`[data-testid="thread-row"][data-thread-token="${token}"]`);
  await expect(rowByToken).toHaveCount(0, { timeout: 10_000 });

  await page.getByTestId("thread-filter-archived").click();
  await expect(rowByToken).toBeVisible({ timeout: 10_000 });

  await rowByToken.first().click();
  await openThreadActions(page);
  await page.getByTestId("thread-action-unarchive").click();

  await expect(rowByToken).toHaveCount(0, { timeout: 10_000 });

  await page.getByTestId("thread-filter-all").click();
  await expect(rowByToken).toBeVisible({ timeout: 10_000 });
});
