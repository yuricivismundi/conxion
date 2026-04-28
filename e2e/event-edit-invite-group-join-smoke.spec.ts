import fs from "node:fs";
import path from "node:path";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { bootstrapMessagesE2E, bootstrapMessagesPeerE2E } from "./helpers/messages-e2e";

type SmokeRuntime = {
  supabaseUrl: string;
  anonKey: string;
  adminClient: SupabaseClient;
};

let cachedDotEnv: Record<string, string> | null = null;
let cachedRuntimePromise: Promise<SmokeRuntime> | null = null;

function hardFail(reason: string): never {
  const message = `[event-edit-invite-group-join-smoke] ${reason}`;
  console.error(message);
  throw new Error(message);
}

function loadDotEnvLocal(): Record<string, string> {
  if (cachedDotEnv) return cachedDotEnv;

  const envPath = path.resolve(process.cwd(), ".env.local");
  const parsed: Record<string, string> = {};
  if (!fs.existsSync(envPath)) {
    cachedDotEnv = parsed;
    return parsed;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  raw.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  });

  cachedDotEnv = parsed;
  return parsed;
}

function env(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  return loadDotEnvLocal()[name] ?? "";
}

async function bootstrapPrimaryOrFail(page: Page) {
  const boot = await bootstrapMessagesE2E(page, { initialPath: "/" });
  if (!boot.ready) {
    hardFail(`Primary bootstrap not ready: ${boot.reason}`);
  }
}

async function bootstrapPeerOrFail(page: Page) {
  const boot = await bootstrapMessagesPeerE2E(page, { initialPath: "/" });
  if (!boot.ready) {
    hardFail(`Peer bootstrap not ready: ${boot.reason}`);
  }
}

async function getRuntime(): Promise<SmokeRuntime> {
  if (cachedRuntimePromise) return cachedRuntimePromise;

  cachedRuntimePromise = (async () => {
    const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      hardFail("Missing Supabase env vars for smoke runtime.");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return {
      supabaseUrl,
      anonKey,
      adminClient,
    };
  })();

  return cachedRuntimePromise;
}

type CreateEventResult = {
  eventId: string;
  suffix: string;
  eventIds: string[];
  seriesId: string | null;
};

async function createEvent(
  request: APIRequestContext,
  accessToken: string,
  data: Record<string, unknown>
): Promise<CreateEventResult> {
  const suffix = Date.now().toString().slice(-6);
  const response = await request.post("/api/events", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    data,
  });

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    event_id?: string;
    event_ids?: string[];
    series_id?: string | null;
    error?: string;
  } | null;
  if (!response.ok || !payload?.ok || !payload.event_id) {
    hardFail(payload?.error ?? `Failed to create smoke event (status ${response.status()}).`);
  }

  return {
    eventId: payload.event_id,
    suffix,
    eventIds: Array.isArray(payload.event_ids) ? payload.event_ids.filter((value): value is string => typeof value === "string") : [payload.event_id],
    seriesId: typeof payload.series_id === "string" ? payload.series_id : null,
  };
}

async function createPublishedEvent(request: APIRequestContext, accessToken: string) {
  const suffix = Date.now().toString().slice(-6);
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
  return createEvent(request, accessToken, {
    title: `Smoke Event ${suffix}`,
    description: "Smoke test event description that is long enough to publish safely.",
    eventType: "Social",
    eventAccessType: "public",
    chatMode: "broadcast",
    city: "Tallinn",
    country: "Estonia",
    venueName: "Smoke Hall",
    venueAddress: "Narva mnt 1",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    status: "published",
    styles: ["bachata"],
    settings: {
      showGuestList: true,
      guestsCanInvite: true,
      approveMessages: false,
    },
  });
}

function createAuthorizedClient(runtime: SmokeRuntime, accessToken: string) {
  return createClient(runtime.supabaseUrl, runtime.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function joinEvent(request: APIRequestContext, eventId: string, accessToken: string) {
  const response = await request.post(`/api/events/${eventId}/join`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    data: { action: "join" },
  });

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !payload?.ok) {
    hardFail(payload?.error ?? `Failed to join smoke event ${eventId}.`);
  }
}

async function cleanupEvents(runtime: SmokeRuntime, eventIds: string[]) {
  const ids = eventIds.filter(Boolean);
  if (ids.length === 0) return;
  await runtime.adminClient.from("events").delete().in("id", ids);
}

async function cleanupGroups(runtime: SmokeRuntime, groupId: string | null) {
  if (!groupId) return;
  await runtime.adminClient.from("groups").delete().eq("id", groupId);
}

async function cleanupHistoricalSmokeArtifacts(runtime: SmokeRuntime, hostUserId: string) {
  const eventPatterns = [
    "Smoke Event %",
    "Recurring Smoke Event %",
    "Approval Smoke Event %",
    "Direct Patch Smoke %",
    "Direct patch request %",
  ];

  for (const pattern of eventPatterns) {
    await runtime.adminClient.from("events").delete().eq("host_user_id", hostUserId).ilike("title", pattern);
  }

  await runtime.adminClient.from("groups").delete().eq("host_user_id", hostUserId).ilike("title", "Smoke Group %");
}

async function createGroup(request: APIRequestContext, accessToken: string) {
  const suffix = Date.now().toString().slice(-6);
  const response = await request.post("/api/groups", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    data: {
      title: `Smoke Group ${suffix}`,
      description: "Smoke test group for invite-link join verification.",
      chatMode: "discussion",
      city: "Tallinn",
      country: "Estonia",
    },
  });

  const payload = (await response.json().catch(() => null)) as { ok?: boolean; group_id?: string; error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.group_id) {
    hardFail(payload?.error ?? `Failed to create smoke group (status ${response.status()}).`);
  }

  return payload.group_id;
}

async function readPageSession(page: Page, supabaseUrl: string) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const keys = [`sb-${projectRef}-auth-token`, "supabase.auth.token"];
  const session = await page.evaluate((storageKeys) => {
    for (const key of storageKeys) {
      const raw = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
      if (!raw) continue;
      try {
        return JSON.parse(raw);
      } catch {
        // ignore malformed values
      }
    }
    return null;
  }, keys);

  if (!session || typeof session !== "object") {
    hardFail("Could not read the browser auth session from local storage.");
  }

  const typed = session as Session;
  if (!typed.access_token || !typed.user?.id) {
    hardFail("Browser auth session was missing access_token or user.id.");
  }

  return typed;
}

async function setSwitchByLabel(page: Page, label: string, desired: boolean) {
  const toggle = page
    .getByText(label, { exact: true })
    .locator("xpath=../..//button[@role='switch']")
    .first();

  await expect(toggle).toBeVisible({ timeout: 15_000 });
  const checked = (await toggle.getAttribute("aria-checked")) === "true";
  if (checked !== desired) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-checked", desired ? "true" : "false");
}

test.describe("event edit + invite + group join smoke", () => {
  test("event edit persists request-mode and message settings, then sends an invite", async ({ page, request }) => {
    test.setTimeout(180_000);
    await bootstrapPrimaryOrFail(page);
    const runtime = await getRuntime();
    const pageSession = await readPageSession(page, runtime.supabaseUrl);
    await cleanupHistoricalSmokeArtifacts(runtime, pageSession.user.id);
    const { eventId, suffix } = await createPublishedEvent(request, pageSession.access_token);
    const ticketsUrl = `https://example.com/tickets/${suffix}`;

    await page.goto(`/events/${eventId}/edit`, { waitUntil: "commit", timeout: 120_000 });
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: "Edit Event" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("textbox", { name: /^Event Title/ }).first()).toHaveValue(new RegExp(`Smoke Event ${suffix}`), {
      timeout: 15_000,
    });
    const modeSelect = page
      .getByText("Mode", { exact: true })
      .locator("xpath=following-sibling::div[1]//select[1]");
    await expect(modeSelect).toBeVisible();
    await modeSelect.selectOption("request");
    await expect(modeSelect).toHaveValue("request");

    const ticketsField = page
      .locator("label")
      .filter({ has: page.getByText("Tickets URL", { exact: true }) })
      .locator("input")
      .first();
    await ticketsField.fill(ticketsUrl);

    await setSwitchByLabel(page, "Only hosts can message", false);
    await expect(page.getByText("Approve attendee messages", { exact: true })).toBeVisible({ timeout: 10_000 });
    await setSwitchByLabel(page, "Approve attendee messages", true);
    await setSwitchByLabel(page, "Show guest list", false);
    await setSwitchByLabel(page, "Guests can invite friends", true);

    const patchRequestPromise = page.waitForRequest((req) => req.method() === "PATCH" && req.url().includes(`/api/events/${eventId}`));
    await page.getByRole("button", { name: "Save changes" }).click();
    const patchRequest = await patchRequestPromise;
    const patchPayload = patchRequest.postDataJSON() as Record<string, unknown> | null;
    expect(patchPayload?.eventAccessType).toBe("request");
    await page.waitForURL(new RegExp(`/events/${eventId}$`), { timeout: 20_000 });

    await expect
      .poll(
        async () => {
          const result = await runtime.adminClient
            .from("events")
            .select("event_access_type, chat_mode, approve_messages, show_guest_list, guests_can_invite, links")
            .eq("id", eventId)
            .single();
          if (result.error || !result.data) {
            throw result.error ?? new Error("Updated event row not found.");
          }

          const links = Array.isArray(result.data.links)
            ? result.data.links
            : [];
          const ticketsLink = links.find((item) => typeof item?.type === "string" && item.type.toLowerCase() === "tickets");

          return {
            access: result.data.event_access_type,
            chat: result.data.chat_mode,
            approve: result.data.approve_messages,
            showGuestList: result.data.show_guest_list,
            guestsCanInvite: result.data.guests_can_invite,
            ticketsUrl: typeof ticketsLink?.url === "string" ? ticketsLink.url : null,
          };
        },
        { timeout: 15_000 }
      )
      .toEqual({
        access: "request",
        chat: "discussion",
        approve: true,
        showGuestList: false,
        guestsCanInvite: true,
        ticketsUrl,
      });

    const inviteSection = page.getByText("Invite your connections", { exact: true });
    await inviteSection.scrollIntoViewIfNeeded();
    await expect(inviteSection).toBeVisible({ timeout: 20_000 });

    const inviteButton = page.getByRole("button", { name: "Invite" }).first();
    await inviteButton.click();
    await expect(page.getByRole("button", { name: "Invited" }).first()).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(
        async () => {
          const result = await runtime.adminClient
            .from("event_invitations")
            .select("id", { head: true, count: "exact" })
            .eq("event_id", eventId)
            .not("recipient_user_id", "eq", pageSession.user.id);
          if (result.error) throw result.error;
          return result.count ?? 0;
        },
        { timeout: 15_000 }
      )
      .toBe(1);

    await cleanupEvents(runtime, [eventId]);
  });

  test("recurring event creation writes a real event series with ordered occurrences", async ({ page, request }) => {
    test.setTimeout(180_000);
    await bootstrapPrimaryOrFail(page);
    const runtime = await getRuntime();
    const pageSession = await readPageSession(page, runtime.supabaseUrl);
    await cleanupHistoricalSmokeArtifacts(runtime, pageSession.user.id);
    const suffix = Date.now().toString().slice(-6);
    const base = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const occurrence1Start = new Date(base);
    const occurrence1End = new Date(base.getTime() + 2 * 60 * 60 * 1000);
    const occurrence2Start = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
    const occurrence2End = new Date(occurrence2Start.getTime() + 2 * 60 * 60 * 1000);
    const occurrence3Start = new Date(base.getTime() + 14 * 24 * 60 * 60 * 1000);
    const occurrence3End = new Date(occurrence3Start.getTime() + 2 * 60 * 60 * 1000);

    const created = await createEvent(request, pageSession.access_token, {
      title: `Recurring Smoke Event ${suffix}`,
      description: "Recurring smoke event description that is long enough to publish correctly.",
      eventType: "Social",
      eventAccessType: "public",
      chatMode: "broadcast",
      city: "Tallinn",
      country: "Estonia",
      venueName: "Series Hall",
      venueAddress: "Pikk 24",
      startsAt: occurrence1Start.toISOString(),
      endsAt: occurrence1End.toISOString(),
      status: "draft",
      styles: ["bachata"],
      settings: {
        showGuestList: true,
        guestsCanInvite: false,
        approveMessages: false,
      },
      recurrence: {
        kind: "custom",
        timezone: "Europe/Tallinn",
        occurrences: [
          { startsAt: occurrence1Start.toISOString(), endsAt: occurrence1End.toISOString() },
          { startsAt: occurrence2Start.toISOString(), endsAt: occurrence2End.toISOString() },
          { startsAt: occurrence3Start.toISOString(), endsAt: occurrence3End.toISOString() },
        ],
      },
    });

    expect(created.seriesId).not.toBeNull();
    expect(created.eventIds).toHaveLength(3);

    await expect
      .poll(
        async () => {
          const rows = await runtime.adminClient
            .from("events")
            .select("id,event_series_id,series_position,starts_at,ends_at")
            .eq("event_series_id", created.seriesId)
            .order("series_position", { ascending: true });
          if (rows.error) throw rows.error;
          return (rows.data ?? []).map((row) => ({
            id: typeof row.id === "string" ? row.id : "",
            seriesId: typeof row.event_series_id === "string" ? row.event_series_id : null,
            position: typeof row.series_position === "number" ? row.series_position : null,
            startsAt: typeof row.starts_at === "string" ? new Date(row.starts_at).toISOString() : null,
            endsAt: typeof row.ends_at === "string" ? new Date(row.ends_at).toISOString() : null,
          }));
        },
        { timeout: 15_000 }
      )
      .toEqual([
        {
          id: created.eventIds[0],
          seriesId: created.seriesId,
          position: 1,
          startsAt: occurrence1Start.toISOString(),
          endsAt: occurrence1End.toISOString(),
        },
        {
          id: created.eventIds[1],
          seriesId: created.seriesId,
          position: 2,
          startsAt: occurrence2Start.toISOString(),
          endsAt: occurrence2End.toISOString(),
        },
        {
          id: created.eventIds[2],
          seriesId: created.seriesId,
          position: 3,
          startsAt: occurrence3Start.toISOString(),
          endsAt: occurrence3End.toISOString(),
        },
      ]);

    await cleanupEvents(runtime, created.eventIds);
  });

  test("direct event patch persists request access type", async ({ page, request }) => {
    test.setTimeout(180_000);
    await bootstrapPrimaryOrFail(page);
    const runtime = await getRuntime();
    const pageSession = await readPageSession(page, runtime.supabaseUrl);
    await cleanupHistoricalSmokeArtifacts(runtime, pageSession.user.id);
    const created = await createEvent(request, pageSession.access_token, {
      title: `Direct Patch Smoke ${Date.now().toString().slice(-6)}`,
      description: "Direct patch smoke description long enough to save as a draft.",
      eventType: "Social",
      eventAccessType: "public",
      chatMode: "broadcast",
      city: "Tallinn",
      country: "Estonia",
      venueName: "Patch Hall",
      venueAddress: "Test 5",
      startsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
      status: "draft",
      styles: ["bachata"],
      settings: {
        showGuestList: true,
        guestsCanInvite: false,
        approveMessages: false,
      },
    });

    const patchResponse = await request.patch(`/api/events/${created.eventId}`, {
      headers: {
        authorization: `Bearer ${pageSession.access_token}`,
        "content-type": "application/json",
      },
      data: {
        title: `Direct patch request ${created.suffix}`,
        description: "Direct patch request description that is long enough to publish safely.",
        eventType: "Social",
        eventAccessType: "request",
        chatMode: "discussion",
        city: "Tallinn",
        country: "Estonia",
        venueName: "Direct Patch Hall",
        venueAddress: "Test 5",
        startsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
        status: "draft",
        styles: ["bachata"],
        links: [],
        settings: {
          showGuestList: false,
          guestsCanInvite: true,
          approveMessages: true,
        },
      },
    });
    const patchPayload = (await patchResponse.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!patchResponse.ok || !patchPayload?.ok) {
      hardFail(patchPayload?.error ?? `Direct event patch failed with status ${patchResponse.status()}.`);
    }

    await expect
      .poll(
        async () => {
          const row = await runtime.adminClient
            .from("events")
            .select("event_access_type,chat_mode,approve_messages,show_guest_list,guests_can_invite")
            .eq("id", created.eventId)
            .single();
          if (row.error) throw row.error;
          return row.data;
        },
        { timeout: 15_000 }
      )
      .toEqual({
        event_access_type: "request",
        chat_mode: "discussion",
        approve_messages: true,
        show_guest_list: false,
        guests_can_invite: true,
      });

    await cleanupEvents(runtime, [created.eventId]);
  });

  test("event attendee messages land pending, enforce one-message limit, and can be approved by the organiser", async ({ page, request }) => {
    test.setTimeout(180_000);
    await bootstrapPrimaryOrFail(page);
    const runtime = await getRuntime();
    const pageSession = await readPageSession(page, runtime.supabaseUrl);
    await cleanupHistoricalSmokeArtifacts(runtime, pageSession.user.id);
    const created = await createEvent(request, pageSession.access_token, {
      title: `Approval Smoke Event ${Date.now().toString().slice(-6)}`,
      description: "Approval smoke event description that is long enough to publish correctly.",
      eventType: "Social",
      eventAccessType: "public",
      chatMode: "discussion",
      city: "Tallinn",
      country: "Estonia",
      venueName: "Approval Hall",
      venueAddress: "Mere pst 8",
      startsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
      status: "published",
      styles: ["bachata"],
      settings: {
        showGuestList: true,
        guestsCanInvite: false,
        approveMessages: true,
      },
    });

    const peerContext = await page.context().browser()?.newContext();
    if (!peerContext) {
      hardFail("Could not create a peer browser context for the moderation smoke.");
    }
    const peerPage = await peerContext.newPage();
    let peerSession: Session | null = null;
    try {
      await bootstrapPeerOrFail(peerPage);
      peerSession = await readPageSession(peerPage, runtime.supabaseUrl);
    } catch (error) {
      await peerContext.close();
      throw error;
    }

    await joinEvent(request, created.eventId, peerSession.access_token);

    await expect
      .poll(
        async () => {
          const row = await runtime.adminClient
            .from("threads")
            .select("id")
            .eq("event_id", created.eventId)
            .eq("thread_type", "event")
            .maybeSingle();
          if (row.error) throw row.error;
          return (row.data as { id?: string } | null)?.id ?? null;
        },
        { timeout: 15_000 }
      )
      .toBeTruthy();

    const resolvedThreadId = await runtime.adminClient
      .from("threads")
      .select("id")
      .eq("event_id", created.eventId)
      .eq("thread_type", "event")
      .single();
    if (resolvedThreadId.error || !resolvedThreadId.data?.id) {
      hardFail(resolvedThreadId.error?.message ?? "Event thread was not found after creation.");
    }
    const eventThreadId = resolvedThreadId.data.id;

    await expect
      .poll(
        async () => {
          const participant = await runtime.adminClient
            .from("thread_participants")
            .select("id", { head: true, count: "exact" })
            .eq("thread_id", eventThreadId)
            .eq("user_id", peerSession.user.id);
          if (participant.error) throw participant.error;
          return participant.count ?? 0;
        },
        { timeout: 15_000 }
      )
      .toBe(1);

    const guestClient = createAuthorizedClient(runtime, peerSession.access_token);
    const guestBody = `Pending attendee smoke message ${Date.now().toString().slice(-6)}`;
    const firstInsert = await guestClient.from("thread_messages").insert({
      thread_id: eventThreadId,
      sender_id: peerSession.user.id,
      body: guestBody,
    });
    if (firstInsert.error) {
      hardFail(firstInsert.error.message);
    }

    await expect
      .poll(
        async () => {
          const row = await runtime.adminClient
            .from("thread_messages")
            .select("id,status_tag,context_tag")
            .eq("thread_id", eventThreadId)
            .eq("sender_id", peerSession.user.id)
            .eq("body", guestBody)
            .order("created_at", { ascending: false })
            .maybeSingle();
          if (row.error) throw row.error;
          const message = row.data as { id?: string; status_tag?: string | null; context_tag?: string | null } | null;
          if (!message?.id) return null;
          return {
            id: message.id,
            status: message.status_tag ?? null,
            context: message.context_tag ?? null,
          };
        },
        { timeout: 15_000 }
      )
      .toEqual({
        id: expect.any(String),
        status: "pending",
        context: "event_chat",
      });

    const insertedPendingRow = await runtime.adminClient
      .from("thread_messages")
      .select("id")
      .eq("thread_id", eventThreadId)
      .eq("sender_id", peerSession.user.id)
      .eq("body", guestBody)
      .order("created_at", { ascending: false })
      .single();
    if (insertedPendingRow.error || !insertedPendingRow.data?.id) {
      hardFail(insertedPendingRow.error?.message ?? "Pending event chat message was not found.");
    }
    const pendingId = insertedPendingRow.data.id;

    const secondInsert = await guestClient.from("thread_messages").insert({
      thread_id: eventThreadId,
      sender_id: peerSession.user.id,
      body: `${guestBody} second`,
    });
    expect(secondInsert.error?.message.toLowerCase()).toContain("event_guest_message_limit_reached");

    const approveResponse = await request.post(`/api/events/${created.eventId}/messages/${pendingId}`, {
      headers: {
        authorization: `Bearer ${pageSession.access_token}`,
        "content-type": "application/json",
      },
      data: { action: "approve" },
    });
    const approvePayload = (await approveResponse.json().catch(() => null)) as { ok?: boolean; status_tag?: string; error?: string } | null;
    if (!approveResponse.ok || !approvePayload?.ok) {
      hardFail(approvePayload?.error ?? `Failed to approve pending event message (status ${approveResponse.status()}).`);
    }
    expect(approvePayload.status_tag).toBe("active");

    await expect
      .poll(
        async () => {
          const row = await runtime.adminClient
            .from("thread_messages")
            .select("status_tag")
            .eq("id", pendingId)
            .maybeSingle();
          if (row.error) throw row.error;
          return (row.data as { status_tag?: string | null } | null)?.status_tag ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("active");

    await peerContext.close();
    await cleanupEvents(runtime, [created.eventId]);
  });

  test("group invite link joins a second signed-in user", async ({ browser, page, request }) => {
    test.setTimeout(180_000);
    await bootstrapPrimaryOrFail(page);
    const runtime = await getRuntime();
    const pageSession = await readPageSession(page, runtime.supabaseUrl);
    await cleanupHistoricalSmokeArtifacts(runtime, pageSession.user.id);
    const groupId = await createGroup(request, pageSession.access_token);

    const inviteTokenResult = await runtime.adminClient
      .from("groups")
      .select("invite_token")
      .eq("id", groupId)
      .single();
    if (inviteTokenResult.error || !inviteTokenResult.data?.invite_token) {
      hardFail(inviteTokenResult.error?.message ?? "Group invite token was not created.");
    }

    const peerContext = await browser.newContext();
    const peerPage = await peerContext.newPage();
    try {
      await bootstrapPeerOrFail(peerPage);
      await peerPage.goto(`/groups/join/${inviteTokenResult.data.invite_token}`, {
        waitUntil: "commit",
        timeout: 120_000,
      });
      await peerPage.waitForURL(new RegExp(`/groups/${groupId}$`), { timeout: 20_000 });
      await peerPage.waitForTimeout(1_500);
      await expect(peerPage).toHaveURL(new RegExp(`/groups/${groupId}$`));

      await expect
        .poll(
          async () => {
            const membership = await runtime.adminClient
              .from("group_members")
              .select("id", { head: true, count: "exact" })
              .eq("group_id", groupId)
              .not("user_id", "eq", pageSession.user.id);
            if (membership.error) throw membership.error;
            return membership.count ?? 0;
          },
        { timeout: 15_000 }
      )
      .toBe(1);

      await cleanupGroups(runtime, groupId);
    } finally {
      await peerContext.close();
    }
  });
});
