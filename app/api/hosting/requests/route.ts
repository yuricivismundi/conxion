import { NextResponse } from "next/server";
import { getBillingAccountState } from "@/lib/billing/account-state";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";
import { sendAppEmailBestEffort } from "@/lib/email/app-events";
import { findPendingPairRequestConflict } from "@/lib/requests/pending-pair-conflicts";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { isPaymentVerified } from "@/lib/verification";
import {
  ensureLinkedMemberPairThread,
  mergeLinkedMemberContextMetadata,
  resolveLinkedMember,
} from "@/lib/requests/linked-members";
import { parseHostingSleepingArrangement } from "@/lib/hosting/preferences";
import { normalizeTravelIntentReason } from "@/lib/trips/join-reasons";

type CreateHostingPayload = {
  recipientUserId?: string;
  requestType?: "request_hosting" | "offer_to_host";
  tripId?: string | null;
  reason?: string | null;
  arrivalDate?: string;
  departureDate?: string;
  arrivalFlexible?: boolean;
  departureFlexible?: boolean;
  travellersCount?: number;
  maxTravellersAllowed?: number | null;
  message?: string | null;
  linkedMemberUserId?: string | null;
};

function toDateOnly(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function isAcceptedStatus(value: unknown) {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  return status === "accepted" || status === "active" || status === "completed";
}

function currentMonthWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as CreateHostingPayload | null;
    const recipientUserId = body?.recipientUserId?.trim();
    const requestType = body?.requestType;
    const tripId = typeof body?.tripId === "string" && body.tripId.trim() ? body.tripId.trim() : null;
    const providedReason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const normalizedTravelIntentReason = providedReason ? normalizeTravelIntentReason(providedReason) : null;
    const normalizedHostingSpaceType = providedReason ? parseHostingSleepingArrangement(providedReason) : null;
    const arrivalDate = toDateOnly(body?.arrivalDate);
    const departureDate = toDateOnly(body?.departureDate);
    const arrivalFlexible = Boolean(body?.arrivalFlexible);
    const departureFlexible = Boolean(body?.departureFlexible);
    const travellersCount = Number(body?.travellersCount ?? 1);
    const maxTravellersAllowed =
      body?.maxTravellersAllowed === null || body?.maxTravellersAllowed === undefined
        ? null
        : Number(body.maxTravellersAllowed);
    const message = typeof body?.message === "string" ? body.message : null;
    const linkedMemberUserId = typeof body?.linkedMemberUserId === "string" ? body.linkedMemberUserId.trim() : "";

    if (!recipientUserId) {
      return NextResponse.json({ ok: false, error: "recipientUserId is required." }, { status: 400 });
    }
    if (requestType !== "request_hosting" && requestType !== "offer_to_host") {
      return NextResponse.json({ ok: false, error: "Invalid requestType." }, { status: 400 });
    }
    if (requestType === "request_hosting" && providedReason && !normalizedTravelIntentReason) {
      return NextResponse.json({ ok: false, error: "Invalid hosting reason." }, { status: 400 });
    }
    if (requestType === "offer_to_host" && providedReason && !normalizedHostingSpaceType) {
      return NextResponse.json({ ok: false, error: "Invalid space type." }, { status: 400 });
    }
    if (!arrivalDate) {
      return NextResponse.json({ ok: false, error: "Arrival date is required." }, { status: 400 });
    }
    if (!departureDate && !departureFlexible) {
      return NextResponse.json({ ok: false, error: "Enter a departure date or mark it as flexible." }, { status: 400 });
    }

    if (!Number.isFinite(travellersCount)) {
      return NextResponse.json({ ok: false, error: "Invalid travellersCount." }, { status: 400 });
    }
    if (maxTravellersAllowed !== null && !Number.isFinite(maxTravellersAllowed)) {
      return NextResponse.json({ ok: false, error: "Invalid maxTravellersAllowed." }, { status: 400 });
    }

    const supabase = getSupabaseUserClient(token);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return NextResponse.json({ ok: false, error: "Invalid auth token." }, { status: 401 });
    }

    const service = getSupabaseServiceClient();
    const pendingConflict = await findPendingPairRequestConflict(service, {
      actorUserId: authData.user.id,
      otherUserId: recipientUserId,
    });
    if (pendingConflict) {
      return NextResponse.json({ ok: false, error: pendingConflict.message }, { status: 409 });
    }

    if (requestType === "request_hosting") {
      const profileRes = await supabase
        .from("profiles")
        .select("verified,verified_label")
        .eq("user_id", authData.user.id)
        .maybeSingle();

      if (profileRes.error) {
        return NextResponse.json({ ok: false, error: profileRes.error.message }, { status: 400 });
      }

      if (!isPaymentVerified((profileRes.data ?? null) as Record<string, unknown> | null)) {
        return NextResponse.json(
          { ok: false, error: "Request hosting requires verification." },
          { status: 403 }
        );
      }
    }

    if (!tripId && requestType === "offer_to_host") {
      const connectionRes = await supabase
        .from("connections")
        .select("id,status,blocked_by")
        .or(
          `and(requester_id.eq.${authData.user.id},target_id.eq.${recipientUserId}),and(requester_id.eq.${recipientUserId},target_id.eq.${authData.user.id})`
        );

      if (connectionRes.error) {
        return NextResponse.json(
          { ok: false, error: connectionRes.error.message ?? "Failed to validate connection state." },
          { status: 400 }
        );
      }

      const hasAcceptedConnection = ((connectionRes.data ?? []) as Array<{ status?: string | null; blocked_by?: string | null }>).some(
        (row) => isAcceptedStatus(row.status) && !row.blocked_by
      );

      if (!hasAcceptedConnection) {
        return NextResponse.json(
          { ok: false, error: "Host offers require an accepted connection or a trip context first." },
          { status: 409 }
        );
      }
    }

    if (requestType === "offer_to_host") {
      const billingState = getBillingAccountState({
        userMetadata: authData.user.user_metadata,
      });
      const monthlyLimit = billingState.currentPlanId === "pro" ? 10 : 5;
      const { startIso, endIso } = currentMonthWindow();

      const offersThisMonthRes = await supabase
        .from("hosting_requests")
        .select("id", { count: "exact", head: true })
        .eq("sender_user_id", authData.user.id)
        .eq("request_type", "offer_to_host")
        .gte("created_at", startIso)
        .lt("created_at", endIso);

      if (offersThisMonthRes.error) {
        return NextResponse.json(
          { ok: false, error: offersThisMonthRes.error.message ?? "Failed to validate hosting offer limit." },
          { status: 400 }
        );
      }

      const offersUsed = Number(offersThisMonthRes.count ?? 0);
      if (offersUsed >= monthlyLimit) {
        return NextResponse.json(
          {
            ok: false,
            error:
              billingState.currentPlanId === "pro"
                ? `You have reached your ${monthlyLimit} hosting offers for this month.`
                : `Starter includes ${monthlyLimit} hosting offers per month. Upgrade to Plus for 10.`,
          },
          { status: 403 }
        );
      }
    }

    const { data, error } = await supabase.rpc("create_hosting_request", {
      p_recipient_user_id: recipientUserId,
      p_request_type: requestType,
      p_trip_id: tripId,
      p_arrival_date: arrivalDate,
      p_departure_date: departureDate,
      p_arrival_flexible: arrivalFlexible,
      p_departure_flexible: departureFlexible,
      p_travellers_count: travellersCount,
      p_max_travellers_allowed: maxTravellersAllowed,
      p_message: message,
    });

    if (error) {
      const messageText = error.message ?? "Failed to create hosting request.";
      const status =
        messageText.includes("already_pending_hosting_request") ? 409 :
        messageText.includes("not_authenticated") ? 401 :
        messageText.includes("blocked") ? 403 :
        messageText.includes("not_hosting") || messageText.includes("unavailable") ? 403 : 400;
      return NextResponse.json({ ok: false, error: messageText }, { status });
    }

    const requestId = typeof data === "string" ? data : "";
    const normalizedReasonToPersist =
      requestType === "request_hosting" ? normalizedTravelIntentReason : normalizedHostingSpaceType;

    if (requestId && normalizedReasonToPersist) {
      const reasonUpdateRes = await service
        .from("hosting_requests")
        .update({ reason: normalizedReasonToPersist } as never)
        .eq("id", requestId);
      if (reasonUpdateRes.error) {
        await service.from("hosting_requests").delete().eq("id", requestId);
        throw new Error(reasonUpdateRes.error.message);
      }
    }
    if (requestId && requestType === "request_hosting") {
      try {
        const linkedMember = await resolveLinkedMember({
          serviceClient: service,
          actorUserId: authData.user.id,
          recipientUserId,
          linkedMemberUserId,
        });

        if (linkedMember) {
          const linkedUpdateRes = await service
            .from("hosting_requests")
            .update({ linked_member_user_id: linkedMember.userId } as never)
            .eq("id", requestId);
          if (linkedUpdateRes.error) {
            throw new Error(linkedUpdateRes.error.message);
          }

          await mergeLinkedMemberContextMetadata({
            serviceClient: service,
            sourceTable: "hosting_requests",
            sourceId: requestId,
            linkedMember,
          });

          await ensureLinkedMemberPairThread({
            serviceClient: service,
            actorUserId: authData.user.id,
            linkedMember,
            recipientUserId,
          });
        }
      } catch (linkedMemberError) {
        console.error("[hosting_requests] linked member sync failed", {
          requestId,
          requestType,
          actorUserId: authData.user.id,
          recipientUserId,
          linkedMemberUserId,
          error: linkedMemberError,
        });
      }
    }

    await sendAppEmailBestEffort({
      kind: "hosting_request_received",
      recipientUserId,
      actorUserId: authData.user.id,
      hostingRequestId: requestId || null,
      tripId,
      requestType,
    });

    return NextResponse.json({ ok: true, id: data ?? null });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
