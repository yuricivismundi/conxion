import { createClient } from "@supabase/supabase-js";

export type SupabaseServiceClient = ReturnType<typeof createClient>;

export function getSupabaseServiceClient(): SupabaseServiceClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error("Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
