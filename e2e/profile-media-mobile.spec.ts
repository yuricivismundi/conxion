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
    await page.goto("/u/yuri.bucio1", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    const currentUrl = page.url();
    test.skip(currentUrl.includes("/auth"), "Redirected to auth — session token expired");

    // If redirected to teacher sub-page, the regular profile tabs are not shown
    if (currentUrl.includes("/teacher")) {
      await expectNoDocumentOverflow(page, "Profile (teacher)");
      await page.screenshot({ path: "/tmp/profile-mobile-auth.png", fullPage: true });
      return;
    }

    await expect(page.getByRole("button", { name: "Overview" }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("profile-media-tile").first()).toBeVisible();
    await expectNoDocumentOverflow(page, "Profile");
    await page.screenshot({ path: "/tmp/profile-mobile-auth.png", fullPage: true });
  });

  test("profile edit layout fits cleanly on phone", async ({ page }) => {
    await page.goto("/me/edit", { waitUntil: "commit" }).catch(() => {});
    await page.waitForLoadState("domcontentloaded");

    const currentUrl = page.url();
    test.skip(currentUrl.includes("/auth"), "Redirected to auth — session token expired");

    await expect(page.getByTestId("profile-edit-title")).toBeVisible();
    await expectNoDocumentOverflow(page, "Edit profile");
    await page.screenshot({ path: "/tmp/edit-mobile-auth.png", fullPage: true });
  });

  test("profile edit media tab fits cleanly on phone", async ({ page }) => {
    await page.goto("/me/edit", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    const currentUrl = page.url();
    test.skip(currentUrl.includes("/auth"), "Redirected to auth — session token expired");

    await page.getByRole("button", { name: "Media" }).click();
    // ProfileMediaManager is embedded in edit page — shows "Your media" section (not "Showcase videos")
    await expect(page.getByText("Your media")).toBeVisible({ timeout: 30000 });
    await expectNoDocumentOverflow(page, "Edit profile media");
    await page.screenshot({ path: "/tmp/edit-media-mobile-auth.png", fullPage: true });
  });
});
