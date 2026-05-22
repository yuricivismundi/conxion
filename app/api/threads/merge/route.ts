import { NextResponse } from "next/server";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

type MergePayload = {
  /** The orphaned thread (with the activity context but no history) */
  sourceThreadId?: string;
  /** The target thread to merge into (the one with full history) */
  targetThreadId?: string;
};

export async function POST(req: Request) {
  if (!validateCsrfOrigin(req)) return csrfError();
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });

    const body = (await req.json().catch(() => null)) as MergePayload | null;
    const sourceThreadId = body?.sourceThreadId?.trim() ?? "";
    const targetThreadId = body?.targetThreadId?.trim() ?? "";
    if (!sourceThreadId || !targetThreadId || sourceThreadId === targetThreadId) {
      return NextResponse.json({ ok: false, error: "Invalid thread IDs." }, { status: 400 });
    }

    const supabaseUser = getSupabaseUserClient(token);
    const service = getSupabaseServiceClient();
    const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr || !authData.user) return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    const userId = authData.user.id;

    const [srcThread, tgtThread] = await Promise.all([
      service.from("threads").select("id,thread_type").eq("id", sourceThreadId).maybeSingle(),
      service.from("threads").select("id,thread_type").eq("id", targetThreadId).maybeSingle(),
    ]);

    const src = srcThread.data as { id?: string; thread_type?: string } | null;
    const tgt = tgtThread.data as { id?: string; thread_type?: string } | null;

    if (!src?.id || !tgt?.id) {
      return NextResponse.json({ ok: false, error: "One or both threads not found." }, { status: 404 });
    }
    if (src.thread_type !== "direct") {
      return NextResponse.json({ ok: false, error: "Source must be a direct thread." }, { status: 400 });
    }

    // Verify caller is a participant in both threads.
    // Verify access to source: thread_participants OR being requester/recipient in thread_contexts.
    // Verify access to target: thread_participants OR being part of the underlying connection.
    const [srcPart, tgtPart, srcCtx, tgtMeta] = await Promise.all([
      service.from("thread_participants").select("user_id").eq("thread_id", sourceThreadId).eq("user_id", userId).maybeSingle(),
      service.from("thread_participants").select("user_id").eq("thread_id", targetThreadId).eq("user_id", userId).maybeSingle(),
      service.from("thread_contexts").select("requester_id,recipient_id").eq("thread_id", sourceThreadId).limit(5),
      service.from("threads").select("id,connection_id,direct_user_low,direct_user_high").eq("id", targetThreadId).maybeSingle(),
    ]);

    const inSourceViaCtx = ((srcCtx.data ?? []) as Array<{ requester_id?: string | null; recipient_id?: string | null }>)
      .some((r) => r.requester_id === userId || r.recipient_id === userId);

    const canAccessSource = Boolean(srcPart.data) || inSourceViaCtx;

    // For connection threads, verify via the connections table
    let canAccessTarget = Boolean(tgtPart.data);
    if (!canAccessTarget && tgtMeta.data) {
      const tgt2 = tgtMeta.data as { connection_id?: string | null; direct_user_low?: string | null; direct_user_high?: string | null };
      if (tgt2.connection_id) {
        const connCheck = await service
          .from("connections")
          .select("id")
          .eq("id", tgt2.connection_id)
          .or(`requester_id.eq.${userId},target_id.eq.${userId}`)
          .maybeSingle();
        canAccessTarget = Boolean(connCheck.data);
      } else if (tgt2.direct_user_low === userId || tgt2.direct_user_high === userId) {
        canAccessTarget = true;
      }
    }

    if (!canAccessSource || !canAccessTarget) {
      return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    }

    // Safety: move thread_messages to target before deleting source (ON DELETE CASCADE would destroy them)
    const tmCount = await service
      .from("thread_messages")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", sourceThreadId);
    if ((tmCount.count ?? 0) > 0) {
      await service
        .from("thread_messages")
        .update({ thread_id: targetThreadId } as never)
        .eq("thread_id", sourceThreadId);
    }

    // Move thread_contexts from source to target
    await service
      .from("thread_contexts")
      .update({ thread_id: targetThreadId } as never)
      .eq("thread_id", sourceThreadId);

    // Move activities from source to target
    await service
      .from("activities")
      .update({ thread_id: targetThreadId } as never)
      .eq("thread_id", sourceThreadId);

    // Delete the orphaned source thread (thread_messages already moved above)
    await service.from("threads").delete().eq("id", sourceThreadId);

    return NextResponse.json({ ok: true, targetThreadId });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to merge threads." },
      { status: 500 }
    );
  }
}
