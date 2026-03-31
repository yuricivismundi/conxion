import type { SupabaseClient } from "@supabase/supabase-js";

export const REFERENCE_AUTHOR_COLUMNS = ["author_id", "from_user_id", "source_id"] as const;
export const REFERENCE_RECIPIENT_COLUMNS = ["recipient_id", "to_user_id", "target_id"] as const;
export const REFERENCE_MEMBER_COLUMNS = [...REFERENCE_AUTHOR_COLUMNS, ...REFERENCE_RECIPIENT_COLUMNS] as const;

export type ReferenceMemberColumn = (typeof REFERENCE_MEMBER_COLUMNS)[number];

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isReferenceSchemaCompatError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("column") ||
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("relation")
  );
}

function dedupeReferenceRows(rows: Array<Record<string, unknown>>) {
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const id = asString(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }

  return merged;
}

export async function fetchReferencesForMember(
  client: SupabaseClient,
  params: {
    memberId: string;
    select?: string;
    columns?: readonly ReferenceMemberColumn[];
    perColumnLimit?: number;
    ascending?: boolean;
  }
) {
  const columns = params.columns ?? REFERENCE_MEMBER_COLUMNS;
  const select = params.select ?? "*";
  const perColumnLimit = Math.max(1, params.perColumnLimit ?? 400);
  const ascending = params.ascending ?? false;
  const overallLimit = perColumnLimit * columns.length;
  const filter = columns.map((column) => `${column}.eq.${params.memberId}`).join(",");

  const combinedRes = await client
    .from("references")
    .select(select)
    .or(filter)
    .order("created_at", { ascending })
    .limit(overallLimit);

  if (!combinedRes.error) {
    return dedupeReferenceRows(((combinedRes.data ?? []) as unknown[]).map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => Boolean(row)));
  }

  if (!isReferenceSchemaCompatError(combinedRes.error.message)) {
    throw combinedRes.error;
  }

  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const column of columns) {
    const res = await client
      .from("references")
      .select(select)
      .eq(column, params.memberId)
      .order("created_at", { ascending })
      .limit(perColumnLimit);

    if (res.error) {
      if (isReferenceSchemaCompatError(res.error.message)) continue;
      throw res.error;
    }

    for (const raw of (res.data ?? []) as unknown[]) {
      const row = asRecord(raw);
      if (!row) continue;
      const id = asString(row.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
  }

  merged.sort((a, b) => {
    const aCreatedAt = asString(a.created_at);
    const bCreatedAt = asString(b.created_at);
    return ascending ? aCreatedAt.localeCompare(bCreatedAt) : bCreatedAt.localeCompare(aCreatedAt);
  });

  return merged;
}
