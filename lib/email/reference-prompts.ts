import { sendAppEmail } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

type ReferencePromptRow = {
  id: string;
  user_id: string;
  peer_user_id: string;
  context_tag: string | null;
  connection_id: string | null;
  due_at: string;
  remind_after: string;
  expires_at: string;
  reminder_count: number | null;
  last_reminded_at: string | null;
  status: string;
};

type DispatchPhase = "due" | "reminder";

export type DispatchReferencePromptEmailsOptions = {
  userId?: string | null;
  limit?: number;
};

export type DispatchReferencePromptEmailsResult = {
  ok: true;
  inspected: number;
  sent: number;
  skipped: number;
  failed: number;
  due: number;
  reminders: number;
};

const REMINDER_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;

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

function toMillis(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

function getDispatchPhase(row: ReferencePromptRow, nowMs: number): DispatchPhase | null {
  const dueAtMs = toMillis(row.due_at);
  const remindAfterMs = toMillis(row.remind_after);
  const expiresAtMs = toMillis(row.expires_at);

  if (
    row.status !== "pending" ||
    Number.isNaN(dueAtMs) ||
    Number.isNaN(remindAfterMs) ||
    Number.isNaN(expiresAtMs) ||
    dueAtMs > nowMs ||
    expiresAtMs < nowMs
  ) {
    return null;
  }

  const lastRemindedAtMs = toMillis(row.last_reminded_at);
  if (nowMs >= remindAfterMs) {
    if (Number.isNaN(lastRemindedAtMs) || lastRemindedAtMs <= nowMs - REMINDER_INTERVAL_MS) {
      return "reminder";
    }
    return null;
  }

  if (!row.last_reminded_at) {
    return "due";
  }

  return null;
}

function shouldRecordAttempt(result: Awaited<ReturnType<typeof sendAppEmail>>) {
  if (result.ok) return true;
  if (!result.skipped) return false;
  return !/not configured/i.test(result.error);
}

async function markPromptAttempted(row: ReferencePromptRow, phase: DispatchPhase, attemptedAtIso: string) {
  const service = getSupabaseServiceClient();
  const nextReminderCount = phase === "reminder" ? (row.reminder_count ?? 0) + 1 : row.reminder_count ?? 0;
  const payload = {
    last_reminded_at: attemptedAtIso,
    reminder_count: nextReminderCount,
    updated_at: attemptedAtIso,
  } as never;

  const update = await service
    .from("reference_requests")
    .update(payload)
    .eq("id", row.id)
    .eq("status", "pending");

  if (update.error) {
    throw new Error(update.error.message);
  }
}

export async function dispatchReferencePromptEmails(
  options: DispatchReferencePromptEmailsOptions = {}
): Promise<DispatchReferencePromptEmailsResult> {
  const service = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 200)));

  let query = service
    .from("reference_requests")
    .select(
      "id,user_id,peer_user_id,context_tag,connection_id,due_at,remind_after,expires_at,reminder_count,last_reminded_at,status"
    )
    .eq("status", "pending")
    .lte("due_at", nowIso)
    .gte("expires_at", nowIso)
    .order("due_at", { ascending: false })
    .limit(limit);

  if (options.userId) {
    query = query.eq("user_id", options.userId);
  }

  const rowsRes = await query;
  if (rowsRes.error) {
    if (isMissingSchemaError(rowsRes.error.message)) {
      return {
        ok: true,
        inspected: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        due: 0,
        reminders: 0,
      };
    }
    throw new Error(rowsRes.error.message);
  }

  const rows = ((rowsRes.data ?? []) as ReferencePromptRow[]).filter((row) => row.id && row.user_id && row.peer_user_id);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let due = 0;
  let reminders = 0;

  for (const row of rows) {
    const phase = getDispatchPhase(row, nowMs);
    if (!phase) {
      continue;
    }

    const result = await sendAppEmail({
      kind: phase === "due" ? "reference_prompt_due" : "reference_prompt_reminder",
      recipientUserId: row.user_id,
      actorUserId: row.peer_user_id,
      connectionId: row.connection_id,
      promptId: row.id,
      contextTag: row.context_tag,
      promptDueAt: row.due_at,
      reminderCount: phase === "reminder" ? (row.reminder_count ?? 0) + 1 : row.reminder_count ?? 0,
    });

    if (result.ok) {
      await markPromptAttempted(row, phase, nowIso);
      sent += 1;
      if (phase === "due") due += 1;
      else reminders += 1;
      continue;
    }

    if (shouldRecordAttempt(result)) {
      await markPromptAttempted(row, phase, nowIso);
      skipped += 1;
      if (phase === "due") due += 1;
      else reminders += 1;
      continue;
    }

    failed += 1;
    console.error("[email] reference prompt dispatch failed", row.id, result.error);
  }

  return {
    ok: true,
    inspected: rows.length,
    sent,
    skipped,
    failed,
    due,
    reminders,
  };
}
