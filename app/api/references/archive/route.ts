import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseUserClient(token: string) {
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

function pickString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function extractReferenceParties(raw: unknown) {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: pickString(row, ["id"]),
    authorId: pickString(row, ["author_id", "from_user_id", "source_id"]),
    recipientId: pickString(row, ["recipient_id", "to_user_id", "target_id"]),
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const referenceId = typeof body?.referenceId === "string" ? body.referenceId.trim() : "";

    if (!referenceId) {
      return NextResponse.json({ ok: false, error: "referenceId is required." }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const me = authData.user.id;

    const { data: referenceRow, error: referenceErr } = await supabase
      .from("references")
      .select("*")
      .eq("id", referenceId)
      .maybeSingle();

    if (referenceErr) {
      return NextResponse.json({ ok: false, error: referenceErr.message }, { status: 400 });
    }

    const reference = extractReferenceParties(referenceRow);
    if (!reference.id || !reference.authorId || !reference.recipientId) {
      return NextResponse.json({ ok: false, error: "Reference not found." }, { status: 404 });
    }

    if (me !== reference.authorId && me !== reference.recipientId) {
      return NextResponse.json({ ok: false, error: "You can only archive references from your own relationship feed." }, { status: 403 });
    }

    const { error: archiveErr } = await supabase
      .from("reference_archives")
      .upsert({ user_id: me, reference_id: referenceId }, { onConflict: "user_id,reference_id" });

    if (archiveErr) {
      return NextResponse.json({ ok: false, error: archiveErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const referenceId = typeof body?.referenceId === "string" ? body.referenceId.trim() : "";

    if (!referenceId) {
      return NextResponse.json({ ok: false, error: "referenceId is required." }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const me = authData.user.id;

    const { error: deleteErr } = await supabase
      .from("reference_archives")
      .delete()
      .eq("user_id", me)
      .eq("reference_id", referenceId);

    if (deleteErr) {
      return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
