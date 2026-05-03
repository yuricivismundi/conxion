import { test } from "@playwright/test";

import { bootstrapMessagesE2E } from "./helpers/messages-e2e";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

const ROUTES = ["/messages", "/connections", "/network", "/account-settings", "/profile/5fd75dd8-1893-4eb4-a8cc-6f026fd10d02", "/support"] as const;

type ControlRecord = {
  route: string;
  tag: string;
  label: string;
  width: number;
  height: number;
};

test.describe("mobile touch audit", () => {
  test.use({
    viewport: MOBILE_VIEWPORT,
    isMobile: true,
    hasTouch: true,
  });

  test("report undersized mobile controls on core screens", async ({ page }) => {
    test.setTimeout(120_000);

    const result = await bootstrapMessagesE2E(page, { initialPath: "/messages" });
    test.skip(!result.ready, `[mobile-touch-audit] ${result.reason}`);

    const findings: ControlRecord[] = [];

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: "commit" }).catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);

      // Skip this route if redirected to auth
      if (page.url().includes("/auth")) continue;

      const routeFindings = await page.evaluate((currentRoute) => {
        const isVisible = (element: Element) => {
          const style = window.getComputedStyle(element as HTMLElement);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
          const rect = (element as HTMLElement).getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const shouldSkip = (element: HTMLElement, label: string) => {
          const aria = (element.getAttribute("aria-label") || "").toLowerCase();
          const classes = element.className || "";
          if (aria.includes("enlarge profile photo")) return true;
          if (aria.includes("open notifications")) return true;
          if (aria.includes("settings")) return true;
          if (aria.includes("share")) return true;
          if (label.length === 0) return true;
          if (label.length <= 2) return true;
          if (classes.includes("no-scrollbar")) return true;
          return false;
        };

        return Array.from(document.querySelectorAll("button, a[href], input, select")).flatMap((node) => {
          if (!(node instanceof HTMLElement) || !isVisible(node)) return [];
          const rect = node.getBoundingClientRect();
          const label =
            node.getAttribute("aria-label")?.trim() ||
            node.textContent?.replace(/\s+/g, " ").trim() ||
            node.getAttribute("placeholder")?.trim() ||
            "";

          if (shouldSkip(node, label)) return [];

          const isSmall = rect.height < 38 || rect.width < 38;
          if (!isSmall) return [];

          return [
            {
              route: currentRoute,
              tag: node.tagName.toLowerCase(),
              label,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          ];
        });
      }, route);

      findings.push(...routeFindings);
    }

    console.log(JSON.stringify(findings, null, 2));
  });
});
