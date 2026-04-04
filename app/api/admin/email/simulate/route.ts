import { NextResponse } from "next/server";
import { sendAppEmail, type AppEmailKind, type AppEmailParams } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type SimulateBody = Partial<AppEmailParams> & {
  promptId?: string;
  kind?: AppEmailKind;
};

type ReferencePromptRow = {
  id: string;
  user_id: string;
  peer_user_id: string;
  context_tag: string | null;
  connection_id: string | null;
  due_at: string;
};

function isMissingSchemaError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("relation") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("column")
  );
}

function isLocalDev() {
  return process.env.NODE_ENV !== "production";
}

async function requireAdmin(req: Request) {
  if (isLocalDev()) {
    return { ok: true as const };
  }

  const token = getBearerToken(req);
  if (!token) {
    return { ok: false as const, status: 401, error: "Missing auth token." };
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
  if (authErr || !authData.user) {
    return { ok: false as const, status: 401, error: "Invalid auth token." };
  }

  const adminCheck = await supabaseUser.from("admins").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (adminCheck.error || !adminCheck.data) {
    return { ok: false as const, status: 403, error: "Admin access required." };
  }

  return { ok: true as const };
}

function isDeliverableEmail(email: string | null | undefined) {
  return Boolean(email && !email.toLowerCase().endsWith("@local.test"));
}

async function resolvePromptSimulation(promptId?: string | null): Promise<AppEmailParams | null> {
  const service = getSupabaseServiceClient();
  let query = service
    .from("reference_requests")
    .select("id,user_id,peer_user_id,context_tag,connection_id,due_at")
    .eq("status", "pending")
    .order("due_at", { ascending: false })
    .limit(30);

  if (promptId) {
    query = query.eq("id", promptId).limit(1);
  }

  const promptRes = await query;
  if (promptRes.error) {
    if (isMissingSchemaError(promptRes.error.message)) {
      return null;
    }
    throw new Error(promptRes.error.message);
  }

  const rows = (promptRes.data ?? []) as ReferencePromptRow[];
  for (const row of rows) {
    const [recipientAuth, actorAuth] = await Promise.all([
      service.auth.admin.getUserById(row.user_id),
      service.auth.admin.getUserById(row.peer_user_id),
    ]);

    const recipientEmail = recipientAuth.data.user?.email ?? null;
    const actorEmail = actorAuth.data.user?.email ?? null;
    if (!isDeliverableEmail(recipientEmail) || !isDeliverableEmail(actorEmail)) {
      continue;
    }

    return {
      kind: "reference_prompt_due",
      recipientUserId: row.user_id,
      actorUserId: row.peer_user_id,
      connectionId: row.connection_id,
      promptId: row.id,
      contextTag: row.context_tag,
      promptDueAt: row.due_at,
      reminderCount: 0,
    };
  }

  return null;
}

async function resolveFallbackUsers(): Promise<Pick<AppEmailParams, "recipientUserId" | "actorUserId"> | null> {
  const service = getSupabaseServiceClient();
  const listed = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listed.error) {
    throw new Error(listed.error.message);
  }

  const users = (listed.data.users ?? []).filter((user) => isDeliverableEmail(user.email));
  if (users.length < 2) {
    return null;
  }

  return {
    recipientUserId: users[0].id,
    actorUserId: users[1].id,
  };
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });
    }

    const body = (await req.json().catch(() => null)) as SimulateBody | null;
    const kind = body?.kind ?? "reference_prompt_due";

    let payload: AppEmailParams | null =
      body?.recipientUserId && body?.actorUserId
        ? {
            kind,
            recipientUserId: body.recipientUserId,
            recipientEmailOverride: body.recipientEmailOverride ?? null,
            recipientNameOverride: body.recipientNameOverride ?? null,
            actorUserId: body.actorUserId,
            connectionId: body.connectionId ?? null,
            tripId: body.tripId ?? null,
            eventId: body.eventId ?? null,
            syncId: body.syncId ?? null,
            hostingRequestId: body.hostingRequestId ?? null,
            referenceId: body.referenceId ?? null,
            requestType: body.requestType ?? null,
            promptId: body.promptId ?? null,
            contextTag: body.contextTag ?? "travel",
            promptDueAt: body.promptDueAt ?? new Date().toISOString(),
            reminderCount: body.reminderCount ?? (kind === "reference_prompt_reminder" ? 1 : 0),
          }
        : null;

    if (!payload && (kind === "reference_prompt_due" || kind === "reference_prompt_reminder")) {
      const promptPayload = await resolvePromptSimulation(body?.promptId ?? null);
      if (promptPayload) {
        payload = {
          ...promptPayload,
          kind,
          reminderCount: kind === "reference_prompt_reminder" ? 1 : 0,
        };
      }
    }

    if (!payload) {
      const users = await resolveFallbackUsers();
      if (!users) {
        return NextResponse.json(
          { ok: false, error: "No deliverable users found for email simulation." },
          { status: 400 }
        );
      }

      payload = {
        kind,
        recipientUserId: users.recipientUserId,
        actorUserId: users.actorUserId,
        contextTag: body?.contextTag ?? "travel",
        promptDueAt: body?.promptDueAt ?? new Date().toISOString(),
        reminderCount: body?.reminderCount ?? (kind === "reference_prompt_reminder" ? 1 : 0),
      };
    }

    const result = await sendAppEmail(payload);
    return NextResponse.json({
      ok: result.ok,
      result,
      payload: {
        kind: payload.kind,
        recipientUserId: payload.recipientUserId,
        actorUserId: payload.actorUserId ?? null,
        connectionId: payload.connectionId ?? null,
        tripId: payload.tripId ?? null,
        eventId: payload.eventId ?? null,
        syncId: payload.syncId ?? null,
        hostingRequestId: payload.hostingRequestId ?? null,
        referenceId: payload.referenceId ?? null,
        promptId: payload.promptId ?? null,
        contextTag: payload.contextTag ?? null,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to simulate app email." },
      { status: 500 }
    );
  }
}
