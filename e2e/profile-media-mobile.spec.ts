import { expect, test } from "@playwright/test";

import { bootstrapMessagesAuthE2E } from "./helpers/messages-e2e";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function expectNoDocumentOverflow(page: Parameters<typeof test>[0]["page"], label: string) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        })),
      { message: `${label} should not overflow horizontally` }
    )
    .toEqual({ scrollWidth: MOBILE_VIEWPORT.width, clientWidth: MOBILE_VIEWPORT.width });
}

test.describe("profile media mobile", () => {
  test.use({
    viewport: MOBILE_VIEWPORT,
    isMobile: true,
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    const result = await bootstrapMessagesAuthE2E(page, { initialPath: "/" });
    test.skip(!result.ready, `[profile-media-mobile] ${result.reason}`);
  });

  test("profile overview media fits cleanly on phone", async ({ page }) => {
    await page.goto("/u/yuri.bucio1");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("button", { name: "Overview" }).first()).toBeVisible();
    await expect(page.getByTestId("profile-media-tile").first()).toBeVisible();
    await expectNoDocumentOverflow(page, "Profile");
    await page.screenshot({ path: "/tmp/profile-mobile-auth.png", fullPage: true });
  });

  test("profile edit layout fits cleanly on phone", async ({ page }) => {
    await page.goto("/me/edit");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("profile-edit-title")).toBeVisible();
    await expectNoDocumentOverflow(page, "Edit profile");
    await page.screenshot({ path: "/tmp/edit-mobile-auth.png", fullPage: true });
  });

  test("profile edit media tab fits cleanly on phone", async ({ page }) => {
    await page.goto("/me/edit");
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("button", { name: "Media" }).click();
    await expect(page.getByText("Showcase videos")).toBeVisible();
    await expect(page.getByText("Your media")).toBeVisible();
    await expectNoDocumentOverflow(page, "Edit profile media");
    await page.screenshot({ path: "/tmp/edit-media-mobile-auth.png", fullPage: true });
  });
});
