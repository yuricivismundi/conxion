import { createClient } from "@supabase/supabase-js";

export function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

export function getSupabaseUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anon, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

