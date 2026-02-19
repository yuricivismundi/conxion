import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  bootstrapSyncsE2E,
  waitForConnectionSyncStatus,
  type SyncScenario,
} from "./helpers/syncs-e2e";

function hardFail(reason: string): never {
  const message = `[syncs-lifecycle-flow] ${reason}`;
  console.error(message);
  throw new Error(message);
}

async function failIfSyncErrorVisible(page: Page) {
  const errorBanner = page.getByTestId("connection-sync-error");
  const isVisible = await errorBanner.isVisible().catch(() => false);
  if (!isVisible) return;
  const text = ((await errorBanner.textContent().catch(() => "")) || "").trim();
  hardFail(`Sync action error visible in UI: ${text || "unknown error"}`);
}

async function bootstrapOrFail(
  page: Page,
  params: {
    actor: "requester" | "recipient";
    seedPending: boolean;
  }
): Promise<SyncScenario> {
  const boot = await bootstrapSyncsE2E(page, params);
  if (!boot.ready) {
    hardFail(`Bootstrap not ready: ${boot.reason}`);
  }

  await expect(page.getByTestId("connection-detail-title")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("sync-list")).toBeVisible({ timeout: 10_000 });
  return boot.scenario;
}

function syncCardById(page: Page, syncId: string): Locator {
  return page.locator(`[data-testid="sync-card"][data-sync-id="${syncId}"]`).first();
}

async function firstSyncCard(page: Page): Promise<Locator> {
  const card = page.locator('[data-testid="sync-card"]').first();
  await card.waitFor({ state: "visible", timeout: 10_000 }).catch(() => null);
  if ((await card.count()) === 0) {
    hardFail("Expected at least one sync card, but none is visible.");
  }
  return card;
}

async function syncIdFromCardOrFail(card: Locator): Promise<string> {
  const syncId = await card.getAttribute("data-sync-id");
  if (!syncId) {
    hardFail("Sync card is missing data-sync-id.");
  }
  return syncId;
}

test("requester proposes a sync", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, { actor: "requester", seedPending: false });

  await expect(page.getByTestId("sync-empty")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("sync-propose-open").click();
  await expect(page.getByTestId("sync-propose-modal")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("sync-propose-type").selectOption("workshop");
  await page.getByTestId("sync-propose-note").fill("E2E proposal: workshop planning and timing.");
  await page.getByTestId("sync-propose-submit").click();
  await failIfSyncErrorVisible(page);

  const card = await firstSyncCard(page);
  const syncId = await syncIdFromCardOrFail(card);
  await expect(card.getByTestId("sync-status")).toContainText(/pending/i);

  const persisted = await waitForConnectionSyncStatus({
    scenario,
    syncId,
    status: "pending",
    timeoutMs: 10_000,
  });
  if (!persisted) {
    hardFail("Proposed sync was not persisted as pending.");
  }
});

test("recipient accepts pending sync", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, { actor: "recipient", seedPending: true });
  if (!scenario.pendingSyncId) {
    hardFail("Pending sync id is missing from deterministic seed.");
  }

  const card = syncCardById(page, scenario.pendingSyncId);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.getByTestId("sync-status")).toContainText(/pending/i);

  await card.getByTestId("sync-action-accept").click();
  await failIfSyncErrorVisible(page);
  await expect(card.getByTestId("sync-status")).toContainText(/accepted/i, { timeout: 15_000 });

  const persisted = await waitForConnectionSyncStatus({
    scenario,
    syncId: scenario.pendingSyncId,
    status: "accepted",
    timeoutMs: 10_000,
  });
  if (!persisted) {
    hardFail("Accepted sync status was not persisted.");
  }
});

test("recipient declines pending sync", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, { actor: "recipient", seedPending: true });
  if (!scenario.pendingSyncId) {
    hardFail("Pending sync id is missing from deterministic seed.");
  }

  const card = syncCardById(page, scenario.pendingSyncId);
  await expect(card).toBeVisible({ timeout: 10_000 });

  await card.getByTestId("sync-action-decline").click();
  await failIfSyncErrorVisible(page);
  await expect(card.getByTestId("sync-status")).toContainText(/declined/i, { timeout: 15_000 });

  const persisted = await waitForConnectionSyncStatus({
    scenario,
    syncId: scenario.pendingSyncId,
    status: "declined",
    timeoutMs: 10_000,
  });
  if (!persisted) {
    hardFail("Declined sync status was not persisted.");
  }
});

test("requester cancels pending sync", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, { actor: "requester", seedPending: true });
  if (!scenario.pendingSyncId) {
    hardFail("Pending sync id is missing from deterministic seed.");
  }

  const card = syncCardById(page, scenario.pendingSyncId);
  await expect(card).toBeVisible({ timeout: 10_000 });

  await card.getByTestId("sync-action-cancel").click();
  await expect(page.getByTestId("confirmation-dialog")).toBeVisible({ timeout: 8_000 });
  await page.getByTestId("confirmation-confirm").click();
  await failIfSyncErrorVisible(page);

  const persisted = await waitForConnectionSyncStatus({
    scenario,
    syncId: scenario.pendingSyncId,
    status: "cancelled",
    timeoutMs: 15_000,
  });
  if (!persisted) {
    hardFail("Cancelled sync status was not persisted.");
  }

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  const persistedCard = syncCardById(page, scenario.pendingSyncId);
  await expect(persistedCard).toBeVisible({ timeout: 10_000 });
  await expect(persistedCard.getByTestId("sync-status")).toContainText(/cancelled/i, { timeout: 15_000 });
});

test("accepted sync can be completed and keeps reference CTA after reload", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, { actor: "recipient", seedPending: true });
  if (!scenario.pendingSyncId) {
    hardFail("Pending sync id is missing from deterministic seed.");
  }

  const card = syncCardById(page, scenario.pendingSyncId);
  await expect(card).toBeVisible({ timeout: 10_000 });

  await card.getByTestId("sync-action-accept").click();
  await failIfSyncErrorVisible(page);
  await expect(card.getByTestId("sync-status")).toContainText(/accepted/i, { timeout: 15_000 });

  await card.getByTestId("sync-action-complete").click();
  await expect(page.getByTestId("confirmation-dialog")).toBeVisible({ timeout: 8_000 });
  await page.getByTestId("confirmation-confirm").click();
  await failIfSyncErrorVisible(page);
  await expect(card.getByTestId("sync-status")).toContainText(/completed/i, { timeout: 15_000 });
  await expect(page.getByTestId("sync-leave-reference")).toBeVisible({ timeout: 10_000 });

  const persisted = await waitForConnectionSyncStatus({
    scenario,
    syncId: scenario.pendingSyncId,
    status: "completed",
    timeoutMs: 10_000,
  });
  if (!persisted) {
    hardFail("Completed sync status was not persisted.");
  }

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("sync-leave-reference")).toBeVisible({ timeout: 10_000 });
  await expect(syncCardById(page, scenario.pendingSyncId).getByTestId("sync-status")).toContainText(/completed/i, {
    timeout: 10_000,
  });
});
