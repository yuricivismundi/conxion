import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { buildRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { validateCsrfOrigin, csrfError } from "@/lib/security/csrf";
import { encodeCursor, decodeCursor, validatePaginationLimit, PaginationResponse } from "@/lib/pagination/cursor";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function getUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeChatMode(value: unknown): "discussion" | "broadcast" {
  if (value === "broadcast") return "broadcast";
  return "discussion";
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const url = new URL(req.url);
    const limit = validatePaginationLimit(url.searchParams.get("limit"));
    const cursor = url.searchParams.get("cursor");
    const filter = url.searchParams.get("filter") || "member"; // member, admin, all

    const userClient = getUserClient(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const pageSize = limit + 1;

    let memberQuery = userClient.from("group_members").select("group_id");
    if (filter === "admin") {
      memberQuery = memberQuery.eq("role", "host");
    } else if (filter === "member") {
      memberQuery = memberQuery.eq("role", "member");
    }
    // filter === "all" has no role restriction
    memberQuery = memberQuery.eq("user_id", authData.user.id);

    const { data: memberData, error: memberErr } = await memberQuery;
    if (memberErr) {
      return NextResponse.json({ ok: false, error: memberErr.message }, { status: 400 });
    }

    const groupIds = (memberData ?? []).map((m: Record<string, unknown>) => m.group_id as string).filter(Boolean);
    if (groupIds.length === 0) {
      return NextResponse.json({ ok: true, items: [], cursor: null, hasMore: false });
    }

    let query = userClient.from("groups").select("id,title,description,chat_mode,city,country,cover_url,host_user_id,status,created_at,updated_at").in("id", groupIds);

    query = query.eq("status", "active");

    // Cursor-based pagination
    if (decodedCursor?.id) {
      query = query.lt("created_at", decodedCursor.sortValue as string).lt("id", decodedCursor.id);
    }

    query = query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    const items = (data ?? []).slice(0, limit);
    const hasMore = (data ?? []).length > limit;
    const nextCursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]?.id ?? "", items[items.length - 1]?.created_at ?? "") : null;

    const response: PaginationResponse<typeof items> & { ok: boolean } = {
      ok: true,
      items,
      cursor: nextCursor,
      hasMore,
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load groups." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  if (!validateCsrfOrigin(req)) return csrfError();
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const userClient = getUserClient(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }
    const userId = authData.user.id;

    // Rate limit: 5 group creates per hour per user
    const rlKey = buildRateLimitKey(req, "group:create", userId);
    const rl = consumeRateLimit({ key: rlKey, limit: 5, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: `Too many requests. Try again in ${rl.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const chatMode = normalizeChatMode(body?.chatMode);
    const city = typeof body?.city === "string" && body.city.trim() ? body.city.trim() : null;
    const country = typeof body?.country === "string" && body.country.trim() ? body.country.trim() : null;
    const coverUrl = typeof body?.coverUrl === "string" && body.coverUrl.trim() ? body.coverUrl.trim() : null;
    const eventId = typeof body?.eventId === "string" && body.eventId.trim() ? body.eventId.trim() : null;
    const memberIds: string[] = Array.isArray(body?.memberIds)
      ? (body.memberIds as unknown[]).filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];

    if (!title) {
      return NextResponse.json({ ok: false, error: "Group name is required." }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json({ ok: false, error: "Description is required." }, { status: 400 });
    }
    if (coverUrl && !/\/storage\/v1\/(object\/public|render\/image\/public)\/avatars\//i.test(coverUrl)) {
      return NextResponse.json({ ok: false, error: "Invalid cover URL." }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = getSupabaseServiceClient() as any;

    // Enforce plan-based group cap
    try {
      await service.rpc("cx_check_group_create_allowed", { p_user_id: userId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("group_limit_reached")) {
        return NextResponse.json(
          { ok: false, error: "You've reached your group limit. Upgrade to Plus to create more groups." },
          { status: 403 }
        );
      }
      throw e;
    }

    const { data: insertData, error: insertErr } = await service
      .from("groups")
      .insert({
        host_user_id: userId,
        title,
        description: description || null,
        chat_mode: chatMode,
        city,
        country,
        cover_url: coverUrl,
        cover_status: coverUrl ? "pending" : "approved",
        max_members: 25,
        status: "active",
        ...(eventId ? { event_id: eventId } : {}),
      })
      .select("id")
      .single();

    if (insertErr || !(insertData as { id?: string } | null)?.id) {
      return NextResponse.json(
        { ok: false, error: (insertErr as { message?: string } | null)?.message ?? "Failed to create group." },
        { status: 500 }
      );
    }

    const groupId = (insertData as { id: string }).id;

    // Add host as member
    await service.from("group_members").upsert(
      { group_id: groupId, user_id: userId, role: "host" },
      { onConflict: "group_id,user_id" }
    );

    // Add additional members (from event-based creation), excluding creator
    const extraIds = memberIds.filter((id) => id !== userId).slice(0, 24); // hard cap: 25 total
    if (extraIds.length > 0) {
      await service.from("group_members").upsert(
        extraIds.map((id) => ({ group_id: groupId, user_id: id, role: "member" })),
        { onConflict: "group_id,user_id" }
      );
    }

    // Create group thread (best effort)
    try {
      await service.rpc("cx_ensure_group_thread", {
        p_group_id: groupId,
        p_actor: userId,
      });
    } catch {
      // non-fatal
    }

    return NextResponse.json({ ok: true, group_id: groupId });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
