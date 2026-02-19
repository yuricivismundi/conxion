import { expect, test, type Page } from "@playwright/test";
import { bootstrapMessagesE2E } from "./helpers/messages-e2e";

function hardFail(reason: string): never {
  const message = `[profile-settings-flow] ${reason}`;
  console.error(message);
  throw new Error(message);
}

async function bootstrapOrFail(page: Page) {
  const boot = await bootstrapMessagesE2E(page);
  if (!boot.ready) {
    hardFail(`Bootstrap not ready: ${boot.reason}`);
  }

  await page.goto("/me/edit");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("profile-edit-title")).toBeVisible({ timeout: 10_000 });
}

test("profile settings persist after save + reload", async ({ page }) => {
  await bootstrapOrFail(page);

  const newDisplayName = `Profile E2E ${Date.now().toString().slice(-6)}`;
  const displayNameInput = page.getByTestId("profile-edit-display-name");

  await displayNameInput.fill(newDisplayName);
  await page.getByTestId("profile-edit-save").click();

  await page.waitForURL(/\/me(?:\?.*)?$/, { timeout: 15_000 });

  await page.goto("/me/edit");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("profile-edit-title")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("profile-edit-display-name")).toHaveValue(newDisplayName, { timeout: 10_000 });
});
