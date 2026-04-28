import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { bootstrapMessagesAuthE2E } from "./helpers/messages-e2e";

function hardFail(reason: string): never {
  const message = `[profile-settings-flow] ${reason}`;
  console.error(message);
  throw new Error(message);
}

async function bootstrapOrFail(page: Page, request: APIRequestContext) {
  const boot = await bootstrapMessagesAuthE2E(page, { initialPath: "/" });
  if (!boot.ready) {
    hardFail(`Bootstrap not ready: ${boot.reason}`);
  }

  await request.get("/me/edit", { timeout: 120_000 });
  await page.goto("/me/edit", { waitUntil: "commit", timeout: 120_000 });
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("profile-edit-title")).toBeVisible({ timeout: 10_000 });
}

test("profile settings persist after save + reload", async ({ page, request }) => {
  test.setTimeout(180_000);
  await bootstrapOrFail(page, request);

  const newDisplayName = `Profile E2E ${Date.now().toString().slice(-6)}`;
  const displayNameInput = page.getByTestId("profile-edit-display-name");

  if (!(await displayNameInput.isVisible().catch(() => false))) {
    await page.getByTestId("profile-edit-open-info").click();
    await expect(displayNameInput).toBeVisible({ timeout: 10_000 });
  }

  await displayNameInput.fill(newDisplayName);
  await page.getByTestId("profile-edit-save").click();

  await expect(page.getByTestId("profile-edit-open-info")).toBeVisible({ timeout: 15_000 });

  await page.goto("/me/edit", { waitUntil: "commit", timeout: 60_000 });
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("profile-edit-title")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("profile-edit-open-info").click();
  await expect(page.getByTestId("profile-edit-display-name")).toHaveValue(newDisplayName, { timeout: 10_000 });
});
