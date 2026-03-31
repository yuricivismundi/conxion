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
    await page.goto("/messages");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByPlaceholder("Search messages...")).toBeVisible();
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(page.locator("text=Loading conversations...")).toHaveCount(0);
    await expect(page.getByText("Thread Inbox")).toHaveCount(0);
    await expectNoDocumentOverflow(page, "Messages");
  });

  test("discover layout stays stable on phone", async ({ page }) => {
    await page.goto("/connections");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: "Dancers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Travelers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hosts" })).toBeVisible();
    await expectNoDocumentOverflow(page, "Discover");
  });

  test("network layout stays stable on phone", async ({ page }) => {
    await page.goto("/network");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("link", { name: /Connections/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Saved Dancers/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Search connections/i)).toBeVisible();
    await expectNoDocumentOverflow(page, "Network");
  });

  test("events layout stays stable on phone", async ({ page }) => {
    await page.goto("/events");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: "Filters" })).toBeVisible();
    await expect(page.getByPlaceholder(/Search events/i)).toBeVisible();
    await expectNoDocumentOverflow(page, "Events");
  });

  test("my space layout stays stable on phone", async ({ page }) => {
    await page.goto("/my-space");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Trust & Hosting")).toBeVisible();
    await expect(page.getByText("Growth Progress")).toBeVisible();
    await expectNoDocumentOverflow(page, "My Space");
  });

  test("profile layout stays stable on phone", async ({ page }) => {
    await page.goto("/profile/5fd75dd8-1893-4eb4-a8cc-6f026fd10d02");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: "Overview" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "References" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Activities" }).first()).toBeVisible();
    await expectNoDocumentOverflow(page, "Profile");
  });

  test("support layout stays stable on phone", async ({ page }) => {
    await page.goto("/support");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "What do you need help with?" })).toBeVisible();
    await expect(page.getByPlaceholder(/Search references, trust, hosting, account access/i)).toBeVisible();
    await expectNoDocumentOverflow(page, "Support");
  });
});
