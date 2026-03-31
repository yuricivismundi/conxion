import { expect, test, type Page } from "@playwright/test";
import { bootstrapMessagesE2E, bootstrapMessagesPeerE2E } from "./helpers/messages-e2e";

function hardFail(reason: string): never {
  const message = `[messages-activity-request-flow] ${reason}`;
  console.error(message);
  throw new Error(message);
}

async function bootstrapPrimaryOrFail(page: Page) {
  const boot = await bootstrapMessagesE2E(page, { initialPath: "/messages" });
  if (!boot.ready) {
    hardFail(`Bootstrap not ready: ${boot.reason}`);
  }
  await expect(page.getByRole("heading", { name: /^Inbox$/ })).toBeVisible({ timeout: 10_000 });
}

async function bootstrapPeerOrFail(page: Page) {
  const boot = await bootstrapMessagesPeerE2E(page, { initialPath: "/messages" });
  if (!boot.ready) {
    hardFail(`Peer bootstrap not ready: ${boot.reason}`);
  }
  await expect(page.getByRole("heading", { name: /^Inbox$/ })).toBeVisible({ timeout: 10_000 });
}

async function openFirstThreadOrFail(page: Page) {
  const rows = page.getByTestId("thread-row");
  await rows.first().waitFor({ state: "visible", timeout: 12_000 }).catch(() => null);
  if ((await rows.count()) === 0) {
    hardFail("No thread rows available.");
  }
  await rows.first().click();
}

test("activity request persists across reload and completes the accept cycle", async ({ page, browser }) => {
  await bootstrapPrimaryOrFail(page);
  await openFirstThreadOrFail(page);

  await expect(page.getByTestId("thread-open-activity-composer")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("thread-open-activity-composer").click();
  await expect(page.getByTestId("activity-composer-modal")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("activity-composer-type").selectOption("practice");
  await page.getByTestId("activity-composer-note").fill("Playwright full-circle activity trace.");
  await page.getByTestId("activity-composer-submit").click();

  await expect(page.getByTestId("activity-composer-modal")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("thread-pending-contexts")).toBeVisible({ timeout: 10_000 });
  const pendingCard = page.getByTestId("thread-pending-context-card").first();
  await expect(pendingCard).toContainText(/practice/i, { timeout: 10_000 });
  await expect(pendingCard).toContainText(/pending/i, { timeout: 10_000 });
  await expect(page.getByText(/not_authenticated/i)).toHaveCount(0);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openFirstThreadOrFail(page);
  await expect(page.getByTestId("thread-pending-contexts")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("thread-pending-context-card").first()).toContainText(/practice/i, {
    timeout: 10_000,
  });

  const recipientContext = await browser.newContext();
  const recipientPage = await recipientContext.newPage();
  try {
    await bootstrapPeerOrFail(recipientPage);
    await openFirstThreadOrFail(recipientPage);

    const peerPendingCard = recipientPage.getByTestId("thread-pending-context-card").first();
    await expect(peerPendingCard).toBeVisible({ timeout: 10_000 });
    await peerPendingCard.getByRole("button", { name: "Accept" }).click();

    await expect(recipientPage.getByTestId("thread-pending-context-card")).toHaveCount(0, { timeout: 10_000 });
    await expect(recipientPage.getByText(/Practice accepted\./i).first()).toBeVisible({ timeout: 10_000 });
    await expect(recipientPage.getByText(/not_authenticated/i)).toHaveCount(0);
  } finally {
    await recipientContext.close();
  }

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openFirstThreadOrFail(page);
  await expect(page.getByTestId("thread-pending-context-card")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(/Practice accepted\./i).first()).toBeVisible({ timeout: 10_000 });
});
