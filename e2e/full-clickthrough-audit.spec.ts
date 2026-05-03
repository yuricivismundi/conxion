import { expect, test, type Page } from "@playwright/test";

import { bootstrapMessagesAuthE2E } from "./helpers/messages-e2e";

type AuditIssue = {
  scope: string;
  kind: string;
  detail: string;
};

const SAME_ORIGIN_PREFIXES = ["http://127.0.0.1:3000", "http://localhost:3000"];
const KNOWN_NOISE_PATTERNS = [
  "download the react devtools",
  "fast refresh",
  "your stripe.js integration is over http",
  "was detected as the largest contentful paint",
];

function isKnownNoise(message: string) {
  const normalized = message.toLowerCase();
  return KNOWN_NOISE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function dedupeIssues(issues: AuditIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.scope}|${issue.kind}|${issue.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldTrackResponse(url: string, status: number) {
  if (status < 400) return false;
  if (url.includes("/_next/webpack-hmr")) return false;
  if (url.includes("/__nextjs_font/")) return false;
  if (SAME_ORIGIN_PREFIXES.some((prefix) => url.startsWith(prefix))) return true;
  if (url.includes("supabase.co")) return true;
  return false;
}

function attachCollectors(page: Page, issues: AuditIssue[]) {
  page.on("pageerror", (error) => {
    issues.push({
      scope: page.url() || "unknown",
      kind: "pageerror",
      detail: error.message,
    });
  });

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text().trim();
    if (!text || isKnownNoise(text)) return;
    issues.push({
      scope: page.url() || "unknown",
      kind: "console",
      detail: text,
    });
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!shouldTrackResponse(url, 500)) return;
    issues.push({
      scope: page.url() || "unknown",
      kind: "requestfailed",
      detail: `${request.method()} ${url} :: ${request.failure()?.errorText ?? "failed"}`,
    });
  });

  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    if (!shouldTrackResponse(url, status)) return;
    issues.push({
      scope: page.url() || "unknown",
      kind: "response",
      detail: `${status} ${url}`,
    });
  });
}

async function gotoAndSettle(page: Page, path: string) {
  await page.goto(path, { waitUntil: "commit", timeout: 20_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function inspectVisibleState(page: Page, scope: string, issues: AuditIssue[]) {
  const bodyText = (await page.locator("body").innerText().catch(() => "")).trim();
  if (!bodyText) {
    issues.push({ scope, kind: "empty", detail: "Body rendered with no visible text." });
    return;
  }

  const suspiciousSnippets = [
    "Application error",
    "Something went wrong",
    "Internal Server Error",
    "This site can’t be reached",
    "Unhandled Runtime Error",
  ];

  suspiciousSnippets.forEach((snippet) => {
    if (bodyText.includes(snippet)) {
      issues.push({ scope, kind: "ui-error", detail: snippet });
    }
  });

  const loadingMatches = bodyText.match(/Loading [A-Za-z ]+\.\.\.|Loading [A-Za-z ]+/g) ?? [];
  loadingMatches.forEach((match) => {
    issues.push({ scope, kind: "stuck-loading", detail: match });
  });

  const deadLinks = await page.locator('a[href="#"]').count().catch(() => 0);
  if (deadLinks > 0) {
    issues.push({ scope, kind: "dead-link", detail: `${deadLinks} anchor(s) rendered with href="#"` });
  }
}

test.describe("full clickthrough audit", () => {
  test("public surface audit", async ({ page }) => {
    test.setTimeout(180_000);
    const issues: AuditIssue[] = [];
    attachCollectors(page, issues);

    const routes = ["/", "/events", "/pricing", "/support", "/auth"];
    for (const route of routes) {
      await gotoAndSettle(page, route);
      await inspectVisibleState(page, route, issues);
    }

    if (await page.getByRole("link", { name: /Explore all events/i }).isVisible().catch(() => false)) {
      await page.getByRole("link", { name: /Explore all events/i }).click();
      await page.waitForURL(/\/events(?:\?.*)?$/, { timeout: 10_000 }).catch(() => {
        issues.push({ scope: "/", kind: "navigation", detail: "Explore all events CTA did not reach /events." });
      });
    }

    expect(dedupeIssues(issues), issues.map((issue) => `${issue.scope} [${issue.kind}] ${issue.detail}`).join("\n")).toEqual([]);
  });

  test("authenticated surface audit", async ({ page }) => {
    test.setTimeout(240_000);
    const boot = await bootstrapMessagesAuthE2E(page, { initialPath: "/connections" });
    test.skip(!boot.ready, `[full-clickthrough-audit] ${boot.reason}`);

    const issues: AuditIssue[] = [];
    attachCollectors(page, issues);

    await gotoAndSettle(page, "/connections");
    await page.getByRole("button", { name: "Travelers" }).click().catch(() => {
      issues.push({ scope: "/connections", kind: "interaction", detail: "Could not switch to Travelers tab." });
    });
    await page.getByRole("button", { name: "Hosts" }).click().catch(() => {
      issues.push({ scope: "/connections", kind: "interaction", detail: "Could not switch to Hosts tab." });
    });
    await page.getByRole("button", { name: /Filters/i }).first().click().catch(() => {
      issues.push({ scope: "/connections", kind: "interaction", detail: "Could not open Discover filters." });
    });
    await page.getByLabel("Close filters").click().catch(() => {});
    await inspectVisibleState(page, "/connections", issues);

    await gotoAndSettle(page, "/messages");
    await page.getByRole("button", { name: "Requests" }).click().catch(() => {
      issues.push({ scope: "/messages", kind: "interaction", detail: "Could not switch to Requests tab." });
    });
    await page.getByRole("button", { name: "All" }).click().catch(() => {
      issues.push({ scope: "/messages", kind: "interaction", detail: "Could not switch to All tab." });
    });
    await inspectVisibleState(page, "/messages", issues);

    await gotoAndSettle(page, "/events");
    await page.getByRole("button", { name: /Filters/i }).click().catch(() => {
      issues.push({ scope: "/events", kind: "interaction", detail: "Could not open Event filters." });
    });
    await page.keyboard.press("Escape").catch(() => {});
    await inspectVisibleState(page, "/events", issues);

    await gotoAndSettle(page, "/activity");
    for (const tabLabel of ["Trips", "Groups", "Hosting", "Events"]) {
      await page.getByRole("link", { name: tabLabel }).click().catch(() => {
        issues.push({ scope: "/activity", kind: "interaction", detail: `Could not switch to ${tabLabel} tab.` });
      });
    }
    await inspectVisibleState(page, "/activity", issues);

    await gotoAndSettle(page, "/network");
    await page.getByRole("link", { name: /References/i }).first().click().catch(() => {
      issues.push({ scope: "/network", kind: "interaction", detail: "Could not open References section." });
    });
    await inspectVisibleState(page, "/network", issues);

    await gotoAndSettle(page, "/me/edit");
    await page.getByRole("button", { name: "Hosting" }).click().catch(() => {
      issues.push({ scope: "/me/edit", kind: "interaction", detail: "Could not switch to Hosting tab." });
    });
    await page.getByRole("button", { name: "Media" }).click().catch(() => {
      issues.push({ scope: "/me/edit", kind: "interaction", detail: "Could not switch to Media tab." });
    });
    await inspectVisibleState(page, "/me/edit", issues);

    await gotoAndSettle(page, "/pricing");
    await inspectVisibleState(page, "/pricing", issues);

    await gotoAndSettle(page, "/support");
    await inspectVisibleState(page, "/support", issues);

    await gotoAndSettle(page, "/account-settings");
    await inspectVisibleState(page, "/account-settings", issues);

    expect(dedupeIssues(issues), issues.map((issue) => `${issue.scope} [${issue.kind}] ${issue.detail}`).join("\n")).toEqual([]);
  });
});
