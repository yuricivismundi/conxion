import type { SupabaseClient } from "@supabase/supabase-js";

// Common Supabase query patterns and helpers

export async function fetchByIdSafe<T>(
  client: SupabaseClient,
  table: string,
  id: string,
  columns = "*"
): Promise<T | null> {
  try {
    const { data, error } = await client.from(table).select(columns).eq("id", id).maybeSingle();
    if (error) {
      console.error(`[query-helpers] fetchByIdSafe error for ${table}:`, error.message);
      return null;
    }
    return (data as T) || null;
  } catch (err) {
    console.error(`[query-helpers] fetchByIdSafe exception for ${table}:`, err);
    return null;
  }
}

export async function fetchByUserIdSafe<T>(
  client: SupabaseClient,
  table: string,
  userId: string,
  columns = "*"
): Promise<T | null> {
  try {
    const { data, error } = await client.from(table).select(columns).eq("user_id", userId).maybeSingle();
    if (error) {
      console.error(`[query-helpers] fetchByUserIdSafe error for ${table}:`, error.message);
      return null;
    }
    return (data as T) || null;
  } catch (err) {
    console.error(`[query-helpers] fetchByUserIdSafe exception for ${table}:`, err);
    return null;
  }
}

export async function fetchAllSafe<T>(
  client: SupabaseClient,
  table: string,
  columns = "*",
  limit = 1000
): Promise<T[]> {
  try {
    const { data, error } = await client.from(table).select(columns).limit(limit);
    if (error) {
      console.error(`[query-helpers] fetchAllSafe error for ${table}:`, error.message);
      return [];
    }
    return (data as T[]) || [];
  } catch (err) {
    console.error(`[query-helpers] fetchAllSafe exception for ${table}:`, err);
    return [];
  }
}

export async function countRowsSafe(client: SupabaseClient, table: string, filterCol?: string, filterVal?: unknown): Promise<number> {
  try {
    let query = client.from(table).select("id", { count: "exact", head: true });
    if (filterCol && filterVal !== undefined) {
      query = query.eq(filterCol, filterVal) as typeof query;
    }
    const { count, error } = await query;
    if (error) {
      console.error(`[query-helpers] countRowsSafe error for ${table}:`, error.message);
      return 0;
    }
    return count || 0;
  } catch (err) {
    console.error(`[query-helpers] countRowsSafe exception for ${table}:`, err);
    return 0;
  }
}

export async function checkExistsSafe(
  client: SupabaseClient,
  table: string,
  filterCol: string,
  filterVal: unknown
): Promise<boolean> {
  try {
    const { data, error } = await client.from(table).select("id", { head: true }).eq(filterCol, filterVal).maybeSingle();
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

export type UpdateOptions = {
  merge?: boolean; // true = merge with existing, false = replace
};

export async function updateRowSafe<T>(
  client: SupabaseClient,
  table: string,
  id: string,
  updates: Record<string, unknown>,
  options: UpdateOptions = {}
): Promise<T | null> {
  try {
    const query = client.from(table).update(updates as never).eq("id", id).select();
    const { data, error } = await query;
    if (error) {
      console.error(`[query-helpers] updateRowSafe error for ${table}:`, error.message);
      return null;
    }
    return (data?.[0] as T) || null;
  } catch (err) {
    console.error(`[query-helpers] updateRowSafe exception for ${table}:`, err);
    return null;
  }
}

export async function deleteRowSafe(client: SupabaseClient, table: string, id: string): Promise<boolean> {
  try {
    const { error } = await client.from(table).delete().eq("id", id);
    if (error) {
      console.error(`[query-helpers] deleteRowSafe error for ${table}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[query-helpers] deleteRowSafe exception for ${table}:`, err);
    return false;
  }
}
