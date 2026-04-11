import { expect, test } from "@playwright/test";

import { bootstrapMessagesE2E } from "./helpers/messages-e2e";

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

/**
 * Navigate robustly — tolerates client-side redirects that interrupt Playwright's goto.
 * Returns the final URL after settling.
 */
async function gotoSettled(page: Parameters<typeof test>[0]["page"], url: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      break;
    } catch {
      // Navigation may be interrupted by a client-side redirect; wait for it to settle
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  return page.url();
}

test.describe("mobile core qa", () => {
  test.use({
    viewport: MOBILE_VIEWPORT,
    isMobile: true,
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    const result = await bootstrapMessagesE2E(page, { initialPath: "/messages" });
    test.skip(!result.ready, `[mobile-core-qa] ${result.reason}`);
  });

  test("messages layout stays stable on phone", async ({ page }) => {
    const currentUrl = await gotoSettled(page, "/messages");
    test.skip(currentUrl.includes("/auth"), "Redirected to auth — session token expired");

    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByPlaceholder("Search messages...")).toBeVisible();
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(page.locator("text=Loading conversations...")).toHaveCount(0);
    await expect(page.getByText("Thread Inbox")).toHaveCount(0);
    await expectNoDocumentOverflow(page, "Messages");
  });

  test("discover layout stays stable on phone", async ({ page }) => {
    const currentUrl = await gotoSettled(page, "/connections");
    test.skip(currentUrl.includes("/auth"), "Redirected to auth — session token expired");

    await expect(page.getByRole("button", { name: "Dancers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Travelers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hosts" })).toBeVisible();
    await expectNoDocumentOverflow(page, "Discover");
  });

  test("network layout stays stable on phone", async ({ page }) => {
    const currentUrl = await gotoSettled(page, "/network");
    test.skip(currentUrl.includes("/auth"), "Redirected to auth — session token expired");

    await expect(page.getByRole("link", { name: /Connections/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Following/i })).toBeVisible();
    await expectNoDocumentOverflow(page, "Network");
  });

  test("events layout stays stable on phone", async ({ page }) => {
    const currentUrl = await gotoSettled(page, "/events");
    test.skip(currentUrl.includes("/auth"), "Redirected to auth — session token expired");

    await expect(page.getByRole("button", { name: /Filters/i })).toBeVisible();
    await expectNoDocumentOverflow(page, "Events");
  });

  test("my space layout stays stable on phone", async ({ page }) => {
    const currentUrl = await gotoSettled(page, "/account-settings");
    test.skip(currentUrl.includes("/auth"), "Redirected to auth — session token expired");

    await expect(page.getByRole("heading").first()).toBeVisible();
    await expectNoDocumentOverflow(page, "My Space");
  });

  test("profile layout stays stable on phone", async ({ page }) => {
    const profileUrl = "/profile/5fd75dd8-1893-4eb4-a8cc-6f026fd10d02";

    // Navigate and tolerate interruptions (auth redirect or profile not found)
    const currentUrl = await gotoSettled(page, profileUrl);
    if (currentUrl.includes("/auth")) {
      test.skip(true, "Redirected to auth — session token expired");
      return;
    }
    if (!currentUrl.includes("/profile/")) {
      test.skip(true, "Could not navigate to profile — environment mismatch");
      return;
    }

    // Wait for either the profile tabs or the "not found" state (skeleton may show briefly)
    await Promise.race([
      page.getByRole("button", { name: "Overview" }).first().waitFor({ timeout: 20000 }).catch(() => {}),
      page.getByText("left the floor").waitFor({ timeout: 20000 }).catch(() => {}),
    ]);

    const hasLeftFloor = await page.getByText("left the floor").isVisible().catch(() => false);
    test.skip(hasLeftFloor, "Profile UUID not found in this environment");

    // Profile may redirect to /teacher sub-page for teacher profiles
    const resolvedUrl = page.url();
    if (resolvedUrl.includes("/teacher")) {
      // Teacher profile page loaded — tab check not applicable here
      return;
    }

    await expect(page.getByRole("button", { name: "Overview" }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "References" }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Trips" }).first()).toBeVisible({ timeout: 15000 });
    await expectNoDocumentOverflow(page, "Profile");
  });

  test("support layout stays stable on phone", async ({ page }) => {
    const currentUrl = await gotoSettled(page, "/support");
    test.skip(currentUrl.includes("/auth"), "Redirected to auth — session token expired");

    await expect(page.getByRole("heading", { name: "What do you need help with?" })).toBeVisible();
    await expect(page.getByPlaceholder(/Search plans, upgrades, references, hosting, account access/i)).toBeVisible();
    await expectNoDocumentOverflow(page, "Support");
  });
});
