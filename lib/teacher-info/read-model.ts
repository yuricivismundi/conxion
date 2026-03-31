import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeTeacherInfoBlockRow,
  normalizeTeacherInfoProfileRow,
  sortTeacherInfoBlocks,
  type TeacherInfoBlock,
  type TeacherInfoProfileConfig,
} from "@/lib/teacher-info/types";

const TEACHER_INFO_PROFILE_SELECT = "user_id,headline,intro_text,is_enabled,created_at,updated_at";
const TEACHER_INFO_BLOCK_SELECT =
  "id,user_id,kind,title,short_summary,content_json,is_active,position,created_at,updated_at";

export async function fetchTeacherInfoProfile(
  client: SupabaseClient,
  userId: string
): Promise<TeacherInfoProfileConfig | null> {
  const { data, error } = await client.from("teacher_info_profiles").select(TEACHER_INFO_PROFILE_SELECT).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return normalizeTeacherInfoProfileRow(data);
}

export async function fetchTeacherInfoBlocks(
  client: SupabaseClient,
  userId: string,
  options?: { activeOnly?: boolean }
): Promise<TeacherInfoBlock[]> {
  let query = client
    .from("teacher_info_blocks")
    .select(TEACHER_INFO_BLOCK_SELECT)
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (options?.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return sortTeacherInfoBlocks(((data ?? []) as unknown[]).map(normalizeTeacherInfoBlockRow).filter((item): item is TeacherInfoBlock => Boolean(item)));
}
