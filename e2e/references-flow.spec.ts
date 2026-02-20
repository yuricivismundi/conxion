import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  bootstrapReferencesE2E,
  countReferencesByEntity,
  fetchReferenceByEntity,
  fetchReferencesUserAccessToken,
  waitForReferenceByEntity,
  waitForReferenceNotification,
} from "./helpers/references-e2e";

function hardFail(reason: string): never {
  const message = `[references-flow] ${reason}`;
  console.error(message);
  throw new Error(message);
}

function requireStrictNotifications() {
  return process.env.PLAYWRIGHT_REQUIRE_NOTIFICATIONS === "1";
}

type ApiResult = {
  ok: boolean;
  status: number;
  error: string;
  referenceId: string;
  mode: string;
};

async function bootstrapOrFail(page: Page, actor: "author" | "recipient") {
  const boot = await bootstrapReferencesE2E(page, actor);
  if (!boot.ready) {
    hardFail(`Bootstrap not ready: ${boot.reason}`);
  }

  await expect(page.getByTestId("references-page-title")).toBeVisible({ timeout: 10_000 });
  return boot.scenario;
}

async function createReferenceApi(
  request: APIRequestContext,
  token: string,
  payload: {
    connectionId: string;
    recipientId: string;
    sentiment: "positive" | "neutral" | "negative";
    body: string;
    entityType: "sync" | "trip" | "event" | "connection";
    entityId: string;
  }
): Promise<ApiResult> {
  const res = await request.post("/api/references", {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    data: payload,
  });

  const json = (await res.json().catch(() => null)) as
    | {
        ok?: boolean;
        error?: string;
        reference_id?: string;
        mode?: string;
      }
    | null;

  return {
    ok: Boolean(res.ok() && json?.ok),
    status: res.status(),
    error: typeof json?.error === "string" ? json.error : "",
    referenceId: typeof json?.reference_id === "string" ? json.reference_id : "",
    mode: typeof json?.mode === "string" ? json.mode : "",
  };
}

async function patchReferenceApi(
  request: APIRequestContext,
  token: string,
  payload:
    | {
        mode: "edit";
        referenceId: string;
        sentiment: "positive" | "neutral" | "negative";
        body: string;
      }
    | {
        mode: "reply";
        referenceId: string;
        replyText: string;
      }
): Promise<ApiResult> {
  const res = await request.patch("/api/references", {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    data: payload,
  });

  const json = (await res.json().catch(() => null)) as
    | {
        ok?: boolean;
        error?: string;
        reference_id?: string;
        mode?: string;
      }
    | null;

  return {
    ok: Boolean(res.ok() && json?.ok),
    status: res.status(),
    error: typeof json?.error === "string" ? json.error : "",
    referenceId: typeof json?.reference_id === "string" ? json.reference_id : "",
    mode: typeof json?.mode === "string" ? json.mode : "",
  };
}

async function expectReferenceInfoOrFail(page: Page, regex: RegExp, timeoutMs = 10_000) {
  const info = page.getByTestId("references-info");
  const error = page.getByTestId("references-error");

  try {
    await expect(info).toContainText(regex, { timeout: timeoutMs });
    return;
  } catch {
    const errorVisible = await error.isVisible().catch(() => false);
    if (errorVisible) {
      const text = ((await error.textContent().catch(() => "")) || "").trim();
      hardFail(`Expected success banner but saw error banner: ${text || "unknown error"}`);
    }
    throw new Error(`Expected references-info banner: ${regex}`);
  }
}

test("author creates reference for recent completed sync", async ({ page }) => {
  test.setTimeout(45_000);
  const scenario = await bootstrapOrFail(page, "author");

  await page.getByTestId("references-candidates-filter-sync").click();
  const candidateById = page.locator(
    `[data-testid="reference-candidate"][data-entity-type="sync"][data-entity-id="${scenario.recentSyncId}"]`
  );
  let candidate = candidateById;
  const hasSpecificCandidate = await candidateById.isVisible().catch(() => false);
  if (!hasSpecificCandidate) {
    candidate = page.locator('[data-testid="reference-candidate"][data-entity-type="sync"]').first();
  }
  await expect(candidate).toBeVisible({ timeout: 10_000 });
  const selectedEntityId = (await candidate.getAttribute("data-entity-id")) || scenario.recentSyncId;
  await candidate.click();

  await page.getByTestId("reference-sentiment-positive").click();
  await page
    .getByTestId("reference-body-input")
    .fill("Strong communication and reliable timing through the full sync.");
  await page.getByTestId("reference-submit").click();

  await expectReferenceInfoOrFail(page, /Reference submitted\./i, 10_000);

  const persisted = await waitForReferenceByEntity({
    scenario,
    authorId: scenario.authorId,
    entityType: "sync",
    entityId: selectedEntityId,
    timeoutMs: 12_000,
  });
  if (!persisted?.id) {
    hardFail("Reference was not persisted for recent sync entity.");
  }

  const feedRow = page.locator(`[data-testid="reference-feed-item"][data-reference-id="${persisted.id}"]`);
  await expect(feedRow).toBeVisible({ timeout: 10_000 });
  await expect(feedRow).toHaveAttribute("data-reference-direction", "given");

  const notified = await waitForReferenceNotification({
    scenario,
    userId: scenario.recipientId,
    timeoutMs: 20_000,
  });
  if (!notified) {
    if (requireStrictNotifications()) {
      hardFail("reference_received notification was not persisted for recipient.");
    } else {
      console.warn("[references-flow] reference_received notification not detected.");
    }
  }
});

test("duplicate reference for same entity is blocked", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, "author");
  test.skip(!scenario.supportsV2, "create_reference_v2 guardrails are not available in this schema.");

  const token = await fetchReferencesUserAccessToken({ scenario, actor: "author" });

  const first = await createReferenceApi(page.request, token, {
    connectionId: scenario.connectionId,
    recipientId: scenario.recipientId,
    sentiment: "positive",
    body: "First reference for duplicate guardrail validation.",
    entityType: "sync",
    entityId: scenario.recentSyncId,
  });
  if (!first.ok) {
    hardFail(`First reference create failed unexpectedly: ${first.error || first.status}`);
  }

  const second = await createReferenceApi(page.request, token, {
    connectionId: scenario.connectionId,
    recipientId: scenario.recipientId,
    sentiment: "neutral",
    body: "Second duplicate reference should be blocked.",
    entityType: "sync",
    entityId: scenario.recentSyncId,
  });

  if (second.ok) {
    hardFail("Duplicate reference create unexpectedly succeeded for the same entity.");
  }

  const count = await countReferencesByEntity({
    scenario,
    authorId: scenario.authorId,
    entityType: "sync",
    entityId: scenario.recentSyncId,
  });
  expect(count).toBe(1);
});

test("out-of-window sync is excluded and blocked", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, "author");

  await page.getByTestId("references-candidates-filter-sync").click();
  const oldSyncCandidate = page.locator(
    `[data-testid="reference-candidate"][data-entity-type="sync"][data-entity-id="${scenario.oldSyncId}"]`
  );
  await expect(oldSyncCandidate).toHaveCount(0);

  test.skip(!scenario.supportsV2, "create_reference_v2 15-day guardrail is not available in this schema.");

  const token = await fetchReferencesUserAccessToken({ scenario, actor: "author" });
  const blocked = await createReferenceApi(page.request, token, {
    connectionId: scenario.connectionId,
    recipientId: scenario.recipientId,
    sentiment: "positive",
    body: "This should fail because the sync is outside the 15 day window.",
    entityType: "sync",
    entityId: scenario.oldSyncId,
  });

  if (blocked.ok) {
    hardFail("Out-of-window sync reference unexpectedly succeeded.");
  }

  const count = await countReferencesByEntity({
    scenario,
    authorId: scenario.authorId,
    entityType: "sync",
    entityId: scenario.oldSyncId,
  });
  expect(count).toBe(0);
});

test("receiver can reply once to a reference", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, "recipient");
  test.skip(!scenario.supportsReply, "reply_reference_receiver is not available in this schema.");

  const authorToken = await fetchReferencesUserAccessToken({ scenario, actor: "author" });
  const created = await createReferenceApi(page.request, authorToken, {
    connectionId: scenario.connectionId,
    recipientId: scenario.recipientId,
    sentiment: "positive",
    body: "Great floorcraft, communication and reliability throughout the session.",
    entityType: "sync",
    entityId: scenario.recentSyncId,
  });
  if (!created.ok || !created.referenceId) {
    hardFail(`Failed to seed received reference for reply: ${created.error || created.status}`);
  }

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("references-feed-filter-received").click();

  const row = page.locator(`[data-testid="reference-feed-item"][data-reference-id="${created.referenceId}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });

  const replyInput = row.getByTestId("reference-reply-input");
  await expect(replyInput).toBeVisible({ timeout: 10_000 });
  await replyInput.fill("Thanks for the feedback. Looking forward to the next one.");
  await row.getByTestId("reference-reply-submit").click();

  await expect(page.getByTestId("references-info")).toContainText(/Reply posted\./i, { timeout: 10_000 });
  await expect
    .poll(
      async () => {
        const text = ((await row.textContent().catch(() => "")) || "").toLowerCase();
        if (text.includes("reply:") || text.includes("response:")) return true;
        const replyInputVisible = await row.getByTestId("reference-reply-input").isVisible().catch(() => false);
        return !replyInputVisible;
      },
      { timeout: 10_000 }
    )
    .toBe(true);

  const recipientToken = await fetchReferencesUserAccessToken({ scenario, actor: "recipient" });
  const secondReply = await patchReferenceApi(page.request, recipientToken, {
    mode: "reply",
    referenceId: created.referenceId,
    replyText: "Second reply should be rejected.",
  });
  if (secondReply.ok) {
    hardFail("Second reply unexpectedly succeeded; receiver should only reply once.");
  }
});

test("author can edit once then edit is blocked", async ({ page }) => {
  const scenario = await bootstrapOrFail(page, "author");
  test.skip(!scenario.supportsEdit, "update_reference_author is not available in this schema.");

  const authorToken = await fetchReferencesUserAccessToken({ scenario, actor: "author" });
  const created = await createReferenceApi(page.request, authorToken, {
    connectionId: scenario.connectionId,
    recipientId: scenario.recipientId,
    sentiment: "positive",
    body: "Initial reference body for one-time edit validation.",
    entityType: "sync",
    entityId: scenario.recentSyncId,
  });
  if (!created.ok || !created.referenceId) {
    hardFail(`Failed to seed authored reference for edit: ${created.error || created.status}`);
  }

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("references-feed-filter-given").click();

  const row = page.locator(`[data-testid="reference-feed-item"][data-reference-id="${created.referenceId}"]`);
  try {
    await expect(row).toBeVisible({ timeout: 10_000 });
  } catch {
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.getByTestId("references-feed-filter-given").click();
    await expect(row).toBeVisible({ timeout: 10_000 });
  }

  const editInput = row.getByTestId("reference-edit-input");
  await expect(editInput).toBeVisible({ timeout: 10_000 });
  await editInput.fill("Edited once: communication was clear and timing remained consistent.");

  await row
    .locator(
      `[data-testid="reference-edit-sentiment"][data-reference-id="${created.referenceId}"][data-sentiment="neutral"]`
    )
    .click();
  await row.getByTestId("reference-edit-submit").click();

  await expect(page.getByTestId("references-info")).toContainText(/Reference updated\./i, { timeout: 10_000 });

  const persisted = await waitForReferenceByEntity({
    scenario,
    authorId: scenario.authorId,
    entityType: "sync",
    entityId: scenario.recentSyncId,
    timeoutMs: 10_000,
  });
  if (!persisted?.id) {
    hardFail("Edited reference was not persisted.");
  }

  const refreshed = await fetchReferenceByEntity({
    scenario,
    authorId: scenario.authorId,
    entityType: "sync",
    entityId: scenario.recentSyncId,
  });
  expect(refreshed?.editCount).toBe(1);

  const secondEdit = await patchReferenceApi(page.request, authorToken, {
    mode: "edit",
    referenceId: created.referenceId,
    sentiment: "negative",
    body: "Second edit attempt should fail.",
  });

  if (secondEdit.ok) {
    hardFail("Second edit unexpectedly succeeded; author should only edit once.");
  }
});
