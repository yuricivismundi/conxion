import { expect, test, type Locator, type Page } from "@playwright/test";

import { bootstrapMessagesAuthE2E } from "./helpers/messages-e2e";
import { bootstrapOnboardingE2E } from "./helpers/onboarding-e2e";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function expectNoDocumentOverflow(page: Page, label: string) {
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function chooseSearchableOption(
  page: Page,
  trigger: Locator,
  searchLabel: RegExp,
  query: string,
  optionLabel: string
) {
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await expect(trigger).toBeEnabled({ timeout: 10_000 });
  await trigger.tap().catch(async () => {
    await trigger.click();
  });
  const searchInput = page.getByLabel(searchLabel);
  await expect(searchInput).toBeVisible({ timeout: 10_000 });
  await searchInput.fill(query);
  const exactOption = page.getByRole("button", { name: optionLabel, exact: true }).first();
  if (await exactOption.isVisible({ timeout: 1500 }).catch(() => false)) {
    await exactOption.tap().catch(async () => {
      await exactOption.click();
    });
    return;
  }
  const partialOption = page.getByRole("button", { name: new RegExp(escapeRegExp(optionLabel), "i") }).first();
  if (await partialOption.isVisible({ timeout: 1500 }).catch(() => false)) {
    await partialOption.tap().catch(async () => {
      await partialOption.click();
    });
    return;
  }
  const customOption = page.getByRole("button", { name: new RegExp(`Use\\s+"${escapeRegExp(optionLabel)}"`, "i") }).first();
  await customOption.tap().catch(async () => {
    await customOption.click();
  });
}

test.describe("mobile searchable flows", () => {
  test.use({
    viewport: MOBILE_VIEWPORT,
    isMobile: true,
    hasTouch: true,
  });

  test("onboarding works on mobile with searchable country, city, and language menus", async ({ page }) => {
    const result = await bootstrapOnboardingE2E(page, { initialPath: "/onboarding/age" });
    test.skip(!result.ready, `[mobile-searchable-flows] ${result.reason}`);

    await expect(page.getByRole("button", { name: "I am 18 or older" })).toBeVisible();
    await page.getByRole("button", { name: "I am 18 or older" }).click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).toContain("/onboarding/profile");

    const username = `mob${Date.now().toString(36).slice(-8)}`;
    await page.getByPlaceholder("e.g. Maria Dance").fill("Mobile Flow Tester");
    await page.locator('input[autoCapitalize="none"]').fill(username);
    await expect(page.getByText("Username available.")).toBeVisible({ timeout: 10_000 });

    await chooseSearchableOption(
      page,
      page.getByRole("button", { name: "Select Country" }),
      /Search country/i,
      "Estonia",
      "Estonia"
    );
    await chooseSearchableOption(
      page,
      page.getByRole("button", { name: /Select City|City:/i }).first(),
      /Search city/i,
      "Tal",
      "Tallinn"
    );

    await page.getByRole("button", { name: /Social Dancer/i }).click();
    await page.getByRole("button", { name: "Continue to step 2" }).click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).toContain("/onboarding/interests");

    await page.getByTestId("onboarding-style-bachata").tap().catch(async () => {
      await page.getByTestId("onboarding-style-bachata").click();
    });
    await page.getByTestId("onboarding-style-level-bachata").selectOption({ label: "Improver (3–9 months)" });
    await page.getByRole("button", { name: "Continue to step 3" }).click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).toContain("/onboarding/finalize");

    await chooseSearchableOption(
      page,
      page.getByRole("button", { name: "Select Language" }),
      /Search language/i,
      "French",
      "French"
    );

    await page.getByRole("button", { name: "Complete profile" }).click();
    await expect
      .poll(() => page.url(), { timeout: 30_000 })
      .toMatch(/\/auth\/success|\/connections/);
    await expectNoDocumentOverflow(page, "Onboarding completion");
  });

  test("authenticated mobile create and edit flows use searchable pickers", async ({ page }) => {
    const result = await bootstrapMessagesAuthE2E(page, { initialPath: "/me/edit" });
    test.skip(!result.ready, `[mobile-searchable-flows] ${result.reason}`);

    await expect(page.getByTestId("profile-edit-title")).toBeVisible();
    const openInfoButton = page.getByTestId("profile-edit-open-info");
    if (await openInfoButton.isVisible().catch(() => false)) {
      await openInfoButton.click();
    }

    await chooseSearchableOption(
      page,
      page.locator('button[aria-label^="Country:"], button[aria-label="Select Country"]').first(),
      /Search country/i,
      "Spain",
      "Spain"
    );
    await chooseSearchableOption(
      page,
      page.locator('button[aria-label^="City:"], button[aria-label="Select City"]').first(),
      /Search city/i,
      "Barcelona",
      "Barcelona"
    );
    await expectNoDocumentOverflow(page, "Edit profile");

    await page.goto("/trips", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.getByRole("button", { name: "Create trip" }).click();
    await chooseSearchableOption(
      page,
      page.getByRole("button", { name: "Select Destination country" }),
      /Search destination country/i,
      "Portugal",
      "Portugal"
    );
    await chooseSearchableOption(
      page,
      page.getByRole("button", { name: "Select Destination city" }),
      /Search destination city/i,
      "Lisbon",
      "Lisbon"
    );
    await expectNoDocumentOverflow(page, "Trips create");

    await page.goto("/groups/new", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await chooseSearchableOption(
      page,
      page.getByRole("button", { name: "Select Country" }),
      /Search country/i,
      "Estonia",
      "Estonia"
    );
    const groupCityButton = page.getByRole("button", { name: "Select City" });
    if (await groupCityButton.count()) {
      await chooseSearchableOption(page, groupCityButton, /Search city/i, "Tal", "Tallinn");
    } else {
      await page.getByPlaceholder(/City name|Select country first or type city/i).fill("Tallinn");
    }
    await expectNoDocumentOverflow(page, "Groups new");

    await page.goto("/events/new", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.getByRole("button", { name: /Add location/i }).click();
    await expect(page.getByPlaceholder(/Search city,\s*venue,\s*address/i)).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder(/Search city,\s*venue,\s*address/i).fill("Paris");
    await expectNoDocumentOverflow(page, "Event location modal");
    await page.getByRole("button", { name: /close/i }).click();
    await expectNoDocumentOverflow(page, "Event create");
  });
});
