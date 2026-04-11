import { sendAppEmail } from "@/lib/email/app-events";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

type ReferencePromptRow = {
  id: string;
  user_id: string;
  peer_user_id: string;
  context_tag: string | null;
  connection_id: string | null;
  source_table: string | null;
  source_id: string | null;
  due_at: string;
  expires_at: string;
  last_reminded_at: string | null;
  status: string;
};

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

function toMillis(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

function shouldSend(row: ReferencePromptRow, nowMs: number): boolean {
  const dueAtMs = toMillis(row.due_at);
  const expiresAtMs = toMillis(row.expires_at);

  return (
    row.status === "pending" &&
    !Number.isNaN(dueAtMs) &&
    !Number.isNaN(expiresAtMs) &&
    dueAtMs <= nowMs &&
    expiresAtMs > nowMs &&
    row.last_reminded_at == null // only send once — no reminders
  );
}

async function loadActivityDetails(
  service: ReturnType<typeof getSupabaseServiceClient>,
  sourceTable: string | null,
  sourceId: string | null
): Promise<{ title: string | null; happenedAt: string | null }> {
  if (!sourceTable || !sourceId || sourceTable !== "activities") {
    return { title: null, happenedAt: null };
  }

  const res = await (service as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  })
    .from("activities")
    .select("title,activity_type,start_at,end_at,accepted_at")
    .eq("id", sourceId)
    .maybeSingle();

  if (!res.data) return { title: null, happenedAt: null };

  const row = res.data as {
    title?: string | null;
    activity_type?: string | null;
    start_at?: string | null;
    end_at?: string | null;
    accepted_at?: string | null;
  };

  const title = (row.title?.trim() || row.activity_type?.replace(/_/g, " ")?.trim()) ?? null;
  const happenedAt = row.end_at ?? row.start_at ?? row.accepted_at ?? null;
  return { title, happenedAt };
}

function shouldRecordAttempt(result: Awaited<ReturnType<typeof sendAppEmail>>) {
  if (result.ok) return true;
  if (!result.skipped) return false;
  return !/not configured/i.test(result.error);
}

async function markPromptSent(
  service: ReturnType<typeof getSupabaseServiceClient>,
  rowId: string,
  sentAtIso: string
) {
  const update = await service
    .from("reference_requests")
    .update({ last_reminded_at: sentAtIso, updated_at: sentAtIso } as never)
    .eq("id", rowId)
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
      "id,user_id,peer_user_id,context_tag,connection_id,source_table,source_id,due_at,expires_at,last_reminded_at,status"
    )
    .eq("status", "pending")
    .is("last_reminded_at", null) // unsent only
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
      return { ok: true, inspected: 0, sent: 0, skipped: 0, failed: 0 };
    }
    throw new Error(rowsRes.error.message);
  }

  const rows = ((rowsRes.data ?? []) as ReferencePromptRow[]).filter(
    (row) => row.id && row.user_id && row.peer_user_id
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!shouldSend(row, nowMs)) continue;

    const { title: activityTitle, happenedAt: activityHappenedAt } = await loadActivityDetails(
      service,
      row.source_table,
      row.source_id
    );

    const result = await sendAppEmail({
      kind: "reference_prompt_due",
      recipientUserId: row.user_id,
      actorUserId: row.peer_user_id,
      connectionId: row.connection_id,
      promptId: row.id,
      contextTag: row.context_tag,
      promptDueAt: row.due_at,
      promptExpiresAt: row.expires_at,
      activityTitle,
      activityHappenedAt,
    });

    if (result.ok) {
      await markPromptSent(service, row.id, nowIso);
      sent += 1;
      continue;
    }

    if (shouldRecordAttempt(result)) {
      await markPromptSent(service, row.id, nowIso);
      skipped += 1;
      continue;
    }

    failed += 1;
    console.error("[email] reference prompt dispatch failed", row.id, result.error);
  }

  return { ok: true, inspected: rows.length, sent, skipped, failed };
}
