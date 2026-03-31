import { expect, test, type Page } from "@playwright/test";
import { bootstrapMessagesE2E } from "./helpers/messages-e2e";

function hardFail(reason: string): never {
  const message = `[messages-activation-quota] ${reason}`;
  console.error(message);
  throw new Error(message);
}

async function openFirstThread(page: Page) {
  const bootstrap = await bootstrapMessagesE2E(page);
  if (!bootstrap.ready) {
    hardFail(`Bootstrap not ready: ${bootstrap.reason}`);
  }

  await page.goto("/messages");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { name: /^Inbox$/ })).toBeVisible();

  const rows = page.getByTestId("thread-row");
  await rows.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => null);
  if ((await rows.count()) === 0) {
    hardFail("No thread rows available for activation lifecycle test.");
  }

  await rows.first().click();
}

async function metricValue(page: Page, label: "Used this month") {
  const card = page
    .locator("div.rounded-2xl", {
      has: page.getByText(label, { exact: true }),
    })
    .first();
  const value = (await card.locator("p").nth(1).textContent())?.trim();
  if (!value) {
    hardFail(`Missing metric value for ${label}.`);
  }
  return value;
}

function parseRatio(text: string) {
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) {
    throw new Error(`Unable to parse ratio from "${text}"`);
  }
  return {
    used: Number(match[1]),
    limit: Number(match[2]),
  };
}

async function waitForRatioMetric(page: Page, label: "Used this month") {
  await expect
    .poll(async () => await metricValue(page, label), {
      timeout: 12_000,
      message: `Waiting for ${label} metric to load`,
    })
    .toMatch(/\d+\s*\/\s*\d+/);
  return parseRatio(await metricValue(page, label));
}

async function openThreadActions(page: Page) {
  await page.getByTestId("thread-actions-button").click();
  await expect(page.getByTestId("thread-actions-menu")).toBeVisible();
}

test("first outbound message activates thread and reopening same-cycle does not consume a second activation", async ({
  page,
}) => {
  await openFirstThread(page);

  await expect(page.getByText(/Sending a message will activate this conversation/i).first()).toBeVisible({
    timeout: 10_000,
  });

  const beforeUsed = await waitForRatioMetric(page, "Used this month");

  const body = page.locator("textarea").last();
  await body.fill("Activation lifecycle smoke message.");
  await page.getByRole("button", { name: /^send$/i }).click();

  await expect(page.getByText("Active conversation", { exact: false }).first()).toBeVisible({ timeout: 10_000 });

  const afterFirstSendUsed = await waitForRatioMetric(page, "Used this month");

  expect(afterFirstSendUsed.used).toBe(beforeUsed.used + 1);

  await openThreadActions(page);
  await page.getByTestId("thread-action-archive").click();
  await expect(page.getByText("Archived conversation", { exact: false }).first()).toBeVisible({ timeout: 10_000 });

  const afterArchiveUsed = await waitForRatioMetric(page, "Used this month");

  expect(afterArchiveUsed.used).toBe(afterFirstSendUsed.used);

  await body.fill("Reopen archived thread in same cycle.");
  await page.getByRole("button", { name: /^send$/i }).click();
  await expect(page.getByText("Active conversation", { exact: false }).first()).toBeVisible({ timeout: 10_000 });

  const afterReopenUsed = await waitForRatioMetric(page, "Used this month");

  expect(afterReopenUsed.used).toBe(afterFirstSendUsed.used);
});
