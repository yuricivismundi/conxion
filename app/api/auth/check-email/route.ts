import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function findUserByEmail(email: string) {
  const service = getServiceClient();
  for (let page = 1; page <= 10; page += 1) {
    const listed = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) throw listed.error;

    const users = listed.data.users ?? [];
    const matched = users.find((item) => (item.email ?? "").trim().toLowerCase() === email);
    if (matched?.id) return true;
    if (users.length < 200) break;
  }
  return false;
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = normalizeEmail(payload.email);

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "Please provide a valid email." }, { status: 400 });
    }

    const exists = await findUserByEmail(email);
    return NextResponse.json({ exists });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not check email.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
