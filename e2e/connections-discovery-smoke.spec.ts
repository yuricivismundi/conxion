/**
 * Smoke tests for the /connections city-discovery page.
 * Requires auth — uses PLAYWRIGHT_E2E_EMAIL + PLAYWRIGHT_E2E_PASSWORD env vars.
 */
import { expect, test, type Page } from "@playwright/test";
import { gotoAuthed } from "./helpers/auth-e2e";

const KNOWN_NOISE = ["download the react devtools", "fast refresh", "mapbox", "largest contentful paint", "stripe.js"];

function attachErrors(page: Page, bucket: string[]) {
  page.on("pageerror", (e) => bucket.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text().toLowerCase();
    if (KNOWN_NOISE.some((n) => t.includes(n))) return;
    bucket.push(`console.error: ${msg.text()}`);
  });
}

async function gotoConnections(page: Page) {
  const ok = await gotoAuthed(page, "/connections");
  if (!ok) { console.log("[skip] auth not available"); }
  return ok;
}

async function clickTab(page: Page, label: string) {
  await page.locator("button", { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.waitForTimeout(600);
}

// ── /discover redirect ─────────────────────────────────────────────────────

test("GET /discover redirects to /connections or /auth", async ({ page }) => {
  await page.goto("/discover", { waitUntil: "commit" });
  await page.waitForURL((url) => !url.pathname.startsWith("/discover"), { timeout: 10_000 });
  expect(page.url()).toMatch(/\/(connections|auth)/);
});

// ── page structure ─────────────────────────────────────────────────────────

test("connections page loads without JS errors", async ({ page }) => {
  const errors: string[] = [];
  attachErrors(page, errors);
  const ok = await gotoConnections(page);
  if (!ok) return;

  await expect(page.locator("input[placeholder*='Search a city']")).toBeVisible({ timeout: 8_000 });
  expect(errors).toHaveLength(0);
});

test("city search bar is visible", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  await expect(page.locator("input[placeholder*='Search a city']")).toBeVisible({ timeout: 8_000 });
});

// ── tabs ───────────────────────────────────────────────────────────────────

test("all 4 tabs are visible", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  for (const label of ["Dancers", "Travelers", "Events", "Teachers"]) {
    await expect(page.locator("button", { hasText: new RegExp(`^${label}$`) }).first()).toBeVisible({ timeout: 6_000 });
  }
});

test("Travelers tab shows no teacher/event content", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  await clickTab(page, "Travelers");
  await expect(page.getByText(/book a class/i)).toHaveCount(0);
  await expect(page.locator("text=UPCOMING")).toHaveCount(0);
});

test("Events tab shows event cards or empty state", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  await clickTab(page, "Events");

  const empty = page.getByText(/no upcoming events/i);
  const cards = page.locator("article");
  await Promise.race([
    cards.first().waitFor({ state: "visible", timeout: 8_000 }),
    empty.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => null);

  expect((await cards.count()) > 0 || (await empty.isVisible().catch(() => false))).toBe(true);
});

test("Events tab cards have date badge, Interested button", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  await clickTab(page, "Events");
  await page.waitForTimeout(500);

  const cards = page.locator("article");
  if ((await cards.count()) === 0) { console.log("[skip] no cards"); return; }

  const first = cards.first();
  await expect(first.locator("text=/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/")).toBeVisible();
  await expect(first.getByText(/interested/i)).toBeVisible();
});

test("Events tab grid uses 3 columns on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ok = await gotoConnections(page);
  if (!ok) return;
  await clickTab(page, "Events");
  await page.waitForTimeout(500);

  const grid = page.locator(".grid").filter({ has: page.locator("article") }).first();
  if (!(await grid.isVisible().catch(() => false))) { console.log("[skip] no grid"); return; }
  expect((await grid.getAttribute("class")) ?? "").toMatch(/lg:grid-cols-3/);
});

test("Teachers tab shows no event UPCOMING badge", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  await clickTab(page, "Teachers");
  await page.waitForTimeout(500);
  await expect(page.locator("text=UPCOMING")).toHaveCount(0);
});

// ── Filters panel ──────────────────────────────────────────────────────────

test("Filters button is visible", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  await expect(page.locator("button", { hasText: /^Filters/ }).first()).toBeVisible({ timeout: 6_000 });
});

test("Filters panel opens and shows Dance Styles", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  await page.locator("button", { hasText: /^Filters/ }).first().click();
  await expect(page.getByText(/dance styles/i)).toBeVisible({ timeout: 5_000 });
});

test("Filters panel has no standalone Location heading", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  await page.locator("button", { hasText: /^Filters/ }).first().click();
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { name: /^location$/i })).toHaveCount(0);
});

test("Events tab opens event-specific filters", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  await clickTab(page, "Events");
  await page.waitForTimeout(300);
  await page.locator("button", { hasText: /^Filters/ }).first().click();
  await expect(page.getByText(/event type/i)).toBeVisible({ timeout: 5_000 });
});

// ── See all link ───────────────────────────────────────────────────────────

test("See all events link points to /events", async ({ page }) => {
  const ok = await gotoConnections(page);
  if (!ok) return;
  await clickTab(page, "Events");
  await page.waitForTimeout(500);

  const link = page.getByRole("link", { name: /see all.*events/i });
  if (!(await link.isVisible().catch(() => false))) { console.log("[skip] no events"); return; }
  expect(await link.getAttribute("href")).toMatch(/\/events/);
});
