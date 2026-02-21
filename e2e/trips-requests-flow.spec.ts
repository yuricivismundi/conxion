import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  bootstrapTripsRequestsE2E,
  fetchTripThreadState,
  waitForTripThreadState,
  waitForTripThreadParticipants,
  waitForTripRequestStatus,
  waitForTripNotification,
  type TripRequestScenario,
} from "./helpers/trips-requests-e2e";

function hardFail(reason: string): never {
  const message = `[trips-requests-flow] ${reason}`;
  console.error(message);
  throw new Error(message);
}

function requireStrictNotifications() {
  return process.env.PLAYWRIGHT_REQUIRE_NOTIFICATIONS === "1";
}

async function bootstrapOrFail(page: Page, actor: "owner" | "requester") {
  const boot = await bootstrapTripsRequestsE2E(page, actor);
  if (!boot.ready) {
    hardFail(`Bootstrap not ready: ${boot.reason}`);
  }

  await expect(page.getByTestId("trip-title")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("trip-tab-requests")).toBeVisible({ timeout: 10_000 });
  return boot.scenario;
}

async function getRequestCardOrFail(page: Page, scenario: TripRequestScenario): Promise<Locator> {
  const card = page.locator(`[data-testid="trip-request-card"][data-request-id="${scenario.requestId}"]`);
  await card.waitFor({ state: "visible", timeout: 10_000 }).catch(() => null);
  if ((await card.count()) === 0) {
    hardFail(`Request card ${scenario.requestId} is not visible.`);
  }
  return card.first();
}

test("owner sees incoming trip request", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, "owner");

  await expect(page.getByTestId("trip-requests-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("trip-incoming-count")).toContainText("1", { timeout: 10_000 });

  const card = await getRequestCardOrFail(page, scenario);
  await expect(card.getByTestId("trip-request-name")).toContainText(scenario.requesterName);
  await expect(card.getByTestId("trip-request-status")).toContainText(/pending/i);
  await expect(card.getByTestId("trip-request-accept")).toBeVisible();
  await expect(card.getByTestId("trip-request-decline")).toBeVisible();

  const notified = await waitForTripNotification({
    scenario,
    kind: "trip_request_received",
    userId: scenario.ownerId,
    timeoutMs: 20_000,
  });
  if (!notified) {
    if (requireStrictNotifications()) {
      hardFail("Incoming request notification was not persisted for owner.");
    } else {
      console.warn("[trips-requests-flow] Incoming request notification not detected.");
    }
  }
});

test("requester sees outgoing trip request", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, "requester");

  await expect(page.getByTestId("trip-requests-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("trip-my-request-status")).toContainText(/pending/i, { timeout: 10_000 });

  const card = await getRequestCardOrFail(page, scenario);
  await expect(card.getByTestId("trip-request-status")).toContainText(/pending/i);
  await expect(card.getByTestId("trip-request-cancel")).toBeVisible();
  await expect(card.getByTestId("trip-request-accept")).toHaveCount(0);
  await expect(card.getByTestId("trip-request-decline")).toHaveCount(0);
});

test("accepting request creates trip thread and opens chat", async ({ page }) => {
  test.setTimeout(70_000);
  const scenario = await bootstrapOrFail(page, "owner");

  const card = await getRequestCardOrFail(page, scenario);
  await card.getByTestId("trip-request-accept").click();

  const statusPersisted = await waitForTripRequestStatus({
    scenario,
    status: "accepted",
    timeoutMs: 15_000,
  });
  if (!statusPersisted) {
    hardFail("Trip request was not persisted as accepted.");
  }

  const threadState = await waitForTripThreadState({
    scenario,
    shouldExist: true,
    timeoutMs: 15_000,
  });
  if (!threadState.exists || !threadState.threadId) {
    hardFail("Trip thread was not created after accepting request.");
  }
  if (!threadState.participants.includes(scenario.ownerId) || !threadState.participants.includes(scenario.requesterId)) {
    const converged = await waitForTripThreadParticipants({
      scenario,
      participantIds: [scenario.ownerId, scenario.requesterId],
      timeoutMs: 12_000,
    });
    if (!converged.participants.includes(scenario.ownerId) || !converged.participants.includes(scenario.requesterId)) {
      hardFail("Trip thread participants are incomplete after acceptance.");
    }
  }

  await page.getByTestId("trip-tab-chat").click();
  await expect(page.getByTestId("trip-chat-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("trip-chat-no-thread")).toHaveCount(0, { timeout: 10_000 });

  const notified = await waitForTripNotification({
    scenario,
    kind: "trip_request_accepted",
    userId: scenario.requesterId,
    timeoutMs: 20_000,
  });
  if (!notified) {
    if (requireStrictNotifications()) {
      hardFail("Accepted notification was not persisted for requester.");
    } else {
      console.warn("[trips-requests-flow] Accepted notification not detected.");
    }
  }
});

test("declining request updates status and emits notification", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, "owner");
  const beforeThreadState = await fetchTripThreadState(scenario);

  const card = await getRequestCardOrFail(page, scenario);
  await card.getByTestId("trip-request-decline").click();

  await expect(page.getByTestId("confirmation-dialog")).toBeVisible({ timeout: 8_000 });
  await page.getByTestId("confirmation-confirm").click();

  await expect(page.getByTestId("trip-info")).toContainText(/Request declined\./i, { timeout: 10_000 });
  await expect(card.getByTestId("trip-request-status")).toContainText(/declined/i, { timeout: 10_000 });

  const statusPersisted = await waitForTripRequestStatus({
    scenario,
    status: "declined",
    timeoutMs: 10_000,
  });
  if (!statusPersisted) {
    hardFail("Trip request was not persisted as declined.");
  }

  const threadState = await waitForTripThreadState({
    scenario,
    shouldExist: beforeThreadState.exists,
    timeoutMs: 10_000,
  });
  if (!beforeThreadState.exists && threadState.exists) {
    hardFail("Trip thread should not exist after decline.");
  }

  const notified = await waitForTripNotification({
    scenario,
    kind: "trip_request_declined",
    userId: scenario.requesterId,
    timeoutMs: 20_000,
  });

  if (!notified) {
    if (requireStrictNotifications()) {
      hardFail("Decline notification was not persisted for requester.");
    } else {
      console.warn("[trips-requests-flow] Decline notification not detected.");
    }
  }

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("trip-tab-requests").click();
  const persistedDeclineCard = await getRequestCardOrFail(page, scenario);
  await expect(persistedDeclineCard.getByTestId("trip-request-status")).toContainText(/declined/i, { timeout: 10_000 });
});

test("accepted status persists after reload", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, "owner");

  const card = await getRequestCardOrFail(page, scenario);
  await card.getByTestId("trip-request-accept").click();

  const statusPersisted = await waitForTripRequestStatus({
    scenario,
    status: "accepted",
    timeoutMs: 15_000,
  });
  if (!statusPersisted) {
    hardFail("Trip request was not persisted as accepted before reload.");
  }

  const threadStateAfterAccept = await waitForTripThreadState({
    scenario,
    shouldExist: true,
    timeoutMs: 15_000,
  });
  if (!threadStateAfterAccept.exists) {
    hardFail("Trip thread was not created before persistence reload check.");
  }

  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  await page.getByTestId("trip-tab-requests").click();
  const persistedCard = await getRequestCardOrFail(page, scenario);
  await expect(persistedCard.getByTestId("trip-request-status")).toContainText(/accepted/i, { timeout: 10_000 });
  await expect(persistedCard.getByTestId("trip-request-message")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("trip-tab-chat").click();
  await expect(page.getByTestId("trip-chat-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("trip-chat-no-thread")).toHaveCount(0, { timeout: 10_000 });

  const threadState = await fetchTripThreadState(scenario);
  if (!threadState.exists) {
    hardFail("Trip thread disappeared after reload persistence check.");
  }
});
