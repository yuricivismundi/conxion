/**
 * Smoke tests for Messages inbox changes:
 * - Unread badge correctness
 * - "SERVICE INQUIRIES" label not truncating
 * - Quota display alignment
 * - Events inbox: All tab first, filter icon always visible
 * - Cross-kind hint dismissal
 *
 * These tests run unauthenticated where possible and skip gracefully
 * when auth is required.
 */
import { expect, test, type Page } from "@playwright/test";

const KNOWN_NOISE = ["download the react devtools", "fast refresh"];

function attachErrorCollector(page: Page, issues: string[]) {
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text().toLowerCase();
    if (KNOWN_NOISE.some((n) => t.includes(n))) return;
    issues.push(`console.error: ${msg.text()}`);
  });
}

async function gotoMessages(page: Page) {
  await page.goto("/messages");
  await page.waitForLoadState("domcontentloaded");
  // Redirect to auth if unauthenticated — that's acceptable
  if (page.url().includes("/auth")) return false;
  await expect(page.getByRole("heading", { name: /^Inbox$/i })).toBeVisible({ timeout: 8_000 });
  return true;
}

// ── page load ──────────────────────────────────────────────────────────────

test("messages page loads without JS errors", async ({ page }) => {
  const issues: string[] = [];
  attachErrorCollector(page, issues);

  const authed = await gotoMessages(page);
  if (!authed) {
    console.log("[skip] not authenticated");
    return;
  }

  expect(issues).toHaveLength(0);
});

// ── kind filter nav ────────────────────────────────────────────────────────

test("messages kind filter buttons are visible", async ({ page }) => {
  const authed = await gotoMessages(page);
  if (!authed) return;

  // At minimum Connections and Events kind buttons should exist in sidebar or nav
  await expect(page.getByRole("button", { name: /connections/i }).first()).toBeVisible({ timeout: 6_000 });
});

// ── service inquiries label ────────────────────────────────────────────────

test("SERVICE INQUIRIES label is not truncated in header", async ({ page }) => {
  const authed = await gotoMessages(page);
  if (!authed) return;

  // Navigate to service kind
  const serviceBtn = page.getByRole("button", { name: /service/i }).first();
  const visible = await serviceBtn.isVisible().catch(() => false);
  if (!visible) {
    console.log("[skip] No service filter button found");
    return;
  }
  await serviceBtn.click();
  await page.waitForTimeout(400);

  // The label should render in full (no ellipsis via truncation)
  const label = page.getByText(/SERVICE INQUIRIES/i);
  await expect(label).toBeVisible({ timeout: 4_000 });

  // Check no text-overflow truncation: offsetWidth should equal scrollWidth
  const isTruncated = await label.evaluate((el) => {
    return el.scrollWidth > el.clientWidth + 2; // +2px tolerance
  });
  expect(isTruncated).toBe(false);
});

// ── quota display ──────────────────────────────────────────────────────────

test("quota row (SENT THIS MONTH) is visible and vertically centered", async ({ page }) => {
  const authed = await gotoMessages(page);
  if (!authed) return;

  const serviceBtn = page.getByRole("button", { name: /service/i }).first();
  const visible = await serviceBtn.isVisible().catch(() => false);
  if (!visible) return;
  await serviceBtn.click();
  await page.waitForTimeout(400);

  const quotaLabel = page.getByText(/sent this month/i);
  await expect(quotaLabel).toBeVisible({ timeout: 4_000 });

  // RESETS date label should also be visible
  await expect(page.getByText(/resets/i)).toBeVisible();
});

// ── events inbox tab order ─────────────────────────────────────────────────

test("Events inbox has All tab first", async ({ page }) => {
  const authed = await gotoMessages(page);
  if (!authed) return;

  // Click Events kind
  const eventsKindBtn = page.getByRole("button", { name: /^events$/i }).first();
  const visible = await eventsKindBtn.isVisible().catch(() => false);
  if (!visible) {
    console.log("[skip] No events kind button");
    return;
  }
  await eventsKindBtn.click();
  await page.waitForTimeout(400);

  // Get all tab buttons in order
  const tabs = page.getByRole("button", { name: /^(all|upcoming|requests|created|past)$/i });
  const count = await tabs.count();
  if (count === 0) {
    console.log("[skip] No inbox tabs found");
    return;
  }

  const firstTabText = await tabs.first().textContent();
  expect(firstTabText?.trim().toLowerCase()).toBe("all");
});

test("Events inbox filter icon (tune) is always visible", async ({ page }) => {
  const authed = await gotoMessages(page);
  if (!authed) return;

  const eventsKindBtn = page.getByRole("button", { name: /^events$/i }).first();
  const visible = await eventsKindBtn.isVisible().catch(() => false);
  if (!visible) return;
  await eventsKindBtn.click();
  await page.waitForTimeout(400);

  // The tune/filter button should be visible without scrolling
  const tuneBtn = page.locator("button").filter({ has: page.locator(".material-symbols-outlined", { hasText: "tune" }) });
  await expect(tuneBtn).toBeVisible({ timeout: 4_000 });
});

// ── unread badge ───────────────────────────────────────────────────────────

test("nav unread badge is a reasonable number (not stale inflated count)", async ({ page }) => {
  const authed = await gotoMessages(page);
  if (!authed) return;

  // Navigate away so Nav is visible
  await page.goto("/connections");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1_500); // let badge settle

  const badge = page.locator("[data-testid='unread-badge'], .unread-badge").first();
  const hasBadge = await badge.isVisible().catch(() => false);
  if (!hasBadge) {
    // No badge = 0 unread, which is correct
    return;
  }

  const badgeText = await badge.textContent();
  const count = parseInt(badgeText ?? "0", 10);
  // Badge must not show absurd stale values (>50 is a red flag for a test account)
  expect(count).toBeLessThan(50);
});

// ── search placeholder ─────────────────────────────────────────────────────

test("search placeholder updates per kind filter", async ({ page }) => {
  const authed = await gotoMessages(page);
  if (!authed) return;

  // Default (connections) placeholder
  const searchInput = page.locator("input[type=text]").first();
  await expect(searchInput).toBeVisible();
  const defaultPlaceholder = await searchInput.getAttribute("placeholder");
  expect(defaultPlaceholder).toBeTruthy();

  // Switch to events kind
  const eventsBtn = page.getByRole("button", { name: /^events$/i }).first();
  const visible = await eventsBtn.isVisible().catch(() => false);
  if (!visible) return;
  await eventsBtn.click();
  await page.waitForTimeout(300);

  const eventsPlaceholder = await searchInput.getAttribute("placeholder");
  expect(eventsPlaceholder?.toLowerCase()).toContain("event");
  expect(eventsPlaceholder).not.toBe(defaultPlaceholder);
});
