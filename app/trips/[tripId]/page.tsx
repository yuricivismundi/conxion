"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import Nav from "@/components/Nav";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { supabase } from "@/lib/supabase/client";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

type Tab = "requests" | "chat" | "details";
type ConfirmAction = "decline_request" | "cancel_request";

type TripRow = {
  id?: string;
  user_id?: string;
  destination_city?: string | null;
  destination_country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  purpose?: string | null;
  status?: string | null;
  note?: string | null;
};

type TripRequestRow = {
  id?: string;
  trip_id?: string;
  requester_id?: string;
  status?: string;
  note?: string | null;
  created_at?: string;
  decided_at?: string | null;
};

type ProfileRow = {
  user_id?: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

type ThreadMessageRow = {
  id?: string;
  sender_id?: string;
  body?: string | null;
  created_at?: string;
};

type TripMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatTime(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function mapRequestStatus(status: string | undefined) {
  if (status === "accepted" || status === "declined" || status === "cancelled") return status;
  return "pending";
}

function shouldFallbackTripRequestRpc(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("function") ||
    text.includes("column") ||
    text.includes("decided_by") ||
    text.includes("decided_at") ||
    text.includes("schema cache") ||
    text.includes("on conflict")
  );
}

function isCompatColumnError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("column") ||
    text.includes("schema cache") ||
    (text.includes("null value in column") && text.includes("role"))
  );
}

async function ensureThreadParticipantCompat(params: {
  threadId: string;
  userId: string;
  includeLastReadAt?: boolean;
}) {
  const payloads: Array<Record<string, string>> = [];
  const nowIso = new Date().toISOString();

  if (params.includeLastReadAt !== false) {
    payloads.push({ thread_id: params.threadId, user_id: params.userId, role: "member", last_read_at: nowIso });
  }

  payloads.push({ thread_id: params.threadId, user_id: params.userId, role: "member" });
  if (params.includeLastReadAt !== false) {
    payloads.push({ thread_id: params.threadId, user_id: params.userId, last_read_at: nowIso });
  }
  payloads.push({ thread_id: params.threadId, user_id: params.userId });

  let lastCompatError: Error | null = null;
  for (const payload of payloads) {
    const insertRes = await supabase.from("thread_participants").insert(payload);
    if (!insertRes.error) return true;

    const message = insertRes.error.message.toLowerCase();
    if (insertRes.error.code === "23505" || message.includes("duplicate")) {
      return true;
    }
    if (isCompatColumnError(message)) {
      lastCompatError = new Error(insertRes.error.message);
      continue;
    }
    throw new Error(insertRes.error.message);
  }

  if (lastCompatError) throw lastCompatError;
  return false;
}

export default function TripDetailsPage() {
  const router = useRouter();
  const params = useParams<{ tripId: string }>();
  const tripId = typeof params?.tripId === "string" ? params.tripId : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("requests");

  const [meId, setMeId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [trip, setTrip] = useState<TripRow | null>(null);
  const [requests, setRequests] = useState<Array<Required<Pick<TripRequestRow, "id" | "requester_id" | "status">> & TripRequestRow>>([]);
  const [profilesById, setProfilesById] = useState<Record<string, { displayName: string; avatarUrl: string | null }>>({});
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<TripMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ open: boolean; action: ConfirmAction; requestId: string }>({
    open: false,
    action: "decline_request",
    requestId: "",
  });

  const acceptedRequests = useMemo(() => requests.filter((row) => row.status === "accepted"), [requests]);
  const pendingRequests = useMemo(() => requests.filter((row) => row.status === "pending"), [requests]);
  const myRequest = useMemo(() => requests.find((row) => row.requester_id === meId) ?? null, [meId, requests]);

  const ensureTripThreadServer = useCallback(
    async (tripIdValue: string, acceptedRequesterId?: string | null) => {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token ?? "";
      if (!accessToken) return null;

      const requestPayload =
        typeof acceptedRequesterId === "string" && acceptedRequesterId.trim().length > 0
          ? { requesterId: acceptedRequesterId.trim() }
          : undefined;
      const res = await fetch(`/api/trips/${encodeURIComponent(tripIdValue)}/thread`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(requestPayload ? { "Content-Type": "application/json" } : {}),
        },
        ...(requestPayload ? { body: JSON.stringify(requestPayload) } : {}),
      });

      if (!res.ok) return null;

      const responsePayload = (await res.json().catch(() => null)) as { threadId?: string | null } | null;
      const serverThreadId = responsePayload?.threadId;
      return typeof serverThreadId === "string" && serverThreadId.length > 0 ? serverThreadId : null;
    },
    []
  );

  const createNotificationCompat = useCallback(
    async (params: {
      userId: string;
      kind: "trip_request_received" | "trip_request_accepted" | "trip_request_declined";
      title: string;
      body?: string | null;
      linkUrl?: string | null;
      metadata?: Record<string, unknown>;
    }) => {
      const rpcRes = await supabase.rpc("create_notification", {
        p_user_id: params.userId,
        p_kind: params.kind,
        p_title: params.title,
        p_body: params.body ?? null,
        p_link_url: params.linkUrl ?? null,
        p_metadata: params.metadata ?? {},
      });
      if (!rpcRes.error) return true;

      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token ?? "";
      if (!accessToken) return false;

      const fallbackRes = await fetch("/api/notifications/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: params.userId,
          kind: params.kind,
          title: params.title,
          body: params.body ?? null,
          linkUrl: params.linkUrl ?? null,
          metadata: params.metadata ?? {},
        }),
      });
      if (!fallbackRes.ok) return false;

      const fallbackPayload = (await fallbackRes.json().catch(() => null)) as { ok?: boolean } | null;
      return Boolean(fallbackPayload?.ok);
    },
    []
  );

  const loadData = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    setError(null);

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      router.replace("/auth");
      return;
    }
    const userId = authData.user.id;
    setMeId(userId);

    const tripColumnsPrimary = "id,user_id,destination_city,destination_country,start_date,end_date,purpose,status,note";
    const tripColumnsFallback = "id,user_id,destination_city,destination_country,start_date,end_date,purpose,status";
    const buildTripQuery = (columns: string) => supabase.from("trips").select(columns).eq("id", tripId).maybeSingle();

    let tripRes = await buildTripQuery(tripColumnsPrimary);
    if (tripRes.error) {
      const message = tripRes.error.message.toLowerCase();
      if (message.includes("column") || message.includes("schema cache")) {
        tripRes = await buildTripQuery(tripColumnsFallback);
      }
    }

    if (tripRes.error) {
      setError(tripRes.error.message);
      setLoading(false);
      return;
    }
    const loadedTrip = (tripRes.data ?? null) as TripRow | null;
    if (!loadedTrip?.id || !loadedTrip.user_id) {
      setError("Trip not found.");
      setLoading(false);
      return;
    }

    const owner = loadedTrip.user_id === userId;
    setTrip(loadedTrip);
    setIsOwner(owner);

    const requestColumnsPrimary = "id,trip_id,requester_id,status,note,created_at,decided_at";
    const requestColumnsFallbackLegacy = "id,trip_id,requester_id,status,note,created_at";
    const requestColumnsFallbackMinimal = "id,trip_id,requester_id,status,created_at";
    const buildRequestsQuery = (columns: string) =>
      owner
        ? supabase
            .from("trip_requests")
            .select(columns)
            .eq("trip_id", tripId)
            .order("created_at", { ascending: false })
            .limit(500)
        : supabase
            .from("trip_requests")
            .select(columns)
            .eq("trip_id", tripId)
            .eq("requester_id", userId)
            .limit(50);

    const [requestsPrimaryRes, threadRes] = await Promise.all([
      buildRequestsQuery(requestColumnsPrimary),
      supabase.from("threads").select("id").eq("trip_id", tripId).maybeSingle(),
    ]);

    let requestsRes = requestsPrimaryRes;
    if (requestsPrimaryRes.error) {
      const message = requestsPrimaryRes.error.message.toLowerCase();
      if (message.includes("column") || message.includes("schema cache")) {
        requestsRes = await buildRequestsQuery(requestColumnsFallbackLegacy);
        if (requestsRes.error) {
          const fallbackMessage = requestsRes.error.message.toLowerCase();
          if (fallbackMessage.includes("column") || fallbackMessage.includes("schema cache")) {
            requestsRes = await buildRequestsQuery(requestColumnsFallbackMinimal);
          }
        }
      }
    }

    if (requestsRes.error) {
      if (!requestsRes.error.message.toLowerCase().includes("relation")) {
        setError(requestsRes.error.message);
        setLoading(false);
        return;
      }
    }

    const loadedRequests = ((requestsRes.data ?? []) as TripRequestRow[])
      .map((row) => {
        const id = row.id ?? "";
        const requesterId = row.requester_id ?? "";
        if (!id || !requesterId) return null;
        return { ...row, id, requester_id: requesterId, status: mapRequestStatus(row.status) };
      })
      .filter(
        (row): row is Required<Pick<TripRequestRow, "id" | "requester_id" | "status">> & TripRequestRow => Boolean(row)
      );

    if (!owner && loadedRequests.length === 0) {
      setError("You do not have access to this trip.");
      setLoading(false);
      return;
    }

    setRequests(loadedRequests);

    const profileIds = Array.from(new Set([loadedTrip.user_id, ...loadedRequests.map((row) => row.requester_id)])).filter(Boolean);
    if (profileIds.length) {
      const profileRes = await supabase
        .from("profiles")
        .select("user_id,display_name,avatar_url")
        .in("user_id", profileIds);
      const mapped: Record<string, { displayName: string; avatarUrl: string | null }> = {};
      ((profileRes.data ?? []) as ProfileRow[]).forEach((row) => {
        const id = row.user_id ?? "";
        if (!id) return;
        mapped[id] = {
          displayName: row.display_name ?? "Member",
          avatarUrl: row.avatar_url ?? null,
        };
      });
      setProfilesById(mapped);
    } else {
      setProfilesById({});
    }

    let resolvedThreadId = (threadRes.data as { id?: string } | null)?.id ?? null;
    const hasAcceptedRequest = loadedRequests.some((row) => row.status === "accepted");
    const canAccessAcceptedTrip = owner
      ? hasAcceptedRequest
      : loadedRequests.some((row) => row.requester_id === userId && row.status === "accepted");

    if (!resolvedThreadId && canAccessAcceptedTrip) {
      const serverThreadId = await ensureTripThreadServer(tripId);
      if (serverThreadId) {
        resolvedThreadId = serverThreadId;
      }
    }

    if (!resolvedThreadId && canAccessAcceptedTrip) {
      try {
        const createThreadRes = await supabase
          .from("threads")
          .insert({
            thread_type: "trip",
            trip_id: tripId,
            created_by: userId,
            last_message_at: new Date().toISOString(),
          })
          .select("id")
          .maybeSingle();

        if (!createThreadRes.error) {
          resolvedThreadId = createThreadRes.data?.id ?? null;
        } else if (
          createThreadRes.error.code === "23505" ||
          createThreadRes.error.message.toLowerCase().includes("duplicate")
        ) {
          const retryThreadRes = await supabase.from("threads").select("id").eq("trip_id", tripId).maybeSingle();
          if (!retryThreadRes.error) {
            resolvedThreadId = retryThreadRes.data?.id ?? null;
          }
        }

        if (resolvedThreadId) {
          await ensureThreadParticipantCompat({
            threadId: resolvedThreadId,
            userId,
            includeLastReadAt: true,
          });
        }
      } catch {
        // Optional compatibility bootstrap for legacy schemas.
      }
    }

    setThreadId(resolvedThreadId);

    if (resolvedThreadId) {
      const msgsRes = await supabase
        .from("thread_messages")
        .select("id,sender_id,body,created_at")
        .eq("thread_id", resolvedThreadId)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (!msgsRes.error) {
        setThreadMessages(
          ((msgsRes.data ?? []) as ThreadMessageRow[]).map((row) => ({
            id: row.id ?? crypto.randomUUID(),
            senderId: row.sender_id ?? "",
            body: row.body ?? "",
            createdAt: row.created_at ?? "",
          }))
        );
      } else if (!msgsRes.error.message.toLowerCase().includes("relation")) {
        setError(msgsRes.error.message);
      }
    } else {
      setThreadMessages([]);
    }

    setLoading(false);
  }, [ensureTripThreadServer, router, tripId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function respondRequest(requestId: string, action: "accept" | "decline", force = false) {
    if (action === "decline" && !force) {
      setConfirmAction({ open: true, action: "decline_request", requestId });
      return;
    }

    setActionBusyId(requestId);
    setError(null);
    setInfo(null);
    const requestActorId = requests.find((row) => row.id === requestId)?.requester_id ?? null;

    try {
      const rpcRes = await supabase.rpc("respond_trip_request", {
        p_request_id: requestId,
        p_action: action,
      });

      if (rpcRes.error) {
        if (!shouldFallbackTripRequestRpc(rpcRes.error.message)) {
          throw new Error(rpcRes.error.message);
        }

        const fallback = await supabase
          .from("trip_requests")
          .update({
            status: action === "accept" ? "accepted" : "declined",
          })
          .eq("id", requestId);
        if (fallback.error) throw new Error(fallback.error.message);

        // Continue to compatibility helpers below.
      }

      if (action === "accept" && meId && tripId && requestActorId) {
        const serverThreadId = await ensureTripThreadServer(tripId, requestActorId);
        if (serverThreadId) {
          setThreadId(serverThreadId);
        }

        try {
          let resolvedThreadId: string | null = null;
          const existingThreadRes = await supabase.from("threads").select("id").eq("trip_id", tripId).maybeSingle();
          if (!existingThreadRes.error) {
            resolvedThreadId = existingThreadRes.data?.id ?? null;
          }

          if (!resolvedThreadId) {
            const insertThreadRes = await supabase
              .from("threads")
              .insert({
                thread_type: "trip",
                trip_id: tripId,
                created_by: meId,
                last_message_at: new Date().toISOString(),
              })
              .select("id")
              .maybeSingle();
            if (!insertThreadRes.error) {
              resolvedThreadId = insertThreadRes.data?.id ?? null;
            } else if (
              insertThreadRes.error.code === "23505" ||
              insertThreadRes.error.message.toLowerCase().includes("duplicate")
            ) {
              const retryThreadRes = await supabase.from("threads").select("id").eq("trip_id", tripId).maybeSingle();
              if (!retryThreadRes.error) {
                resolvedThreadId = retryThreadRes.data?.id ?? null;
              }
            }
          }

          if (resolvedThreadId) {
            await ensureThreadParticipantCompat({
              threadId: resolvedThreadId,
              userId: meId,
              includeLastReadAt: true,
            });
            await ensureThreadParticipantCompat({
              threadId: resolvedThreadId,
              userId: requestActorId,
              includeLastReadAt: false,
            });
          }
        } catch {
          // Ignore optional thread bootstrap errors on legacy schemas.
        }
      }

      if (requestActorId && tripId) {
        await createNotificationCompat({
          userId: requestActorId,
          kind: action === "accept" ? "trip_request_accepted" : "trip_request_declined",
          title: action === "accept" ? "Trip request accepted" : "Trip request declined",
          body: null,
          linkUrl: `/trips/${tripId}`,
          metadata: {
            trip_id: tripId,
            request_id: requestId,
          },
        });
      }

      await loadData();
      setInfo(action === "accept" ? "Request accepted." : "Request declined.");
      if (action === "accept") {
        setTab("chat");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update request.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function cancelRequest(requestId: string, force = false) {
    if (!force) {
      setConfirmAction({ open: true, action: "cancel_request", requestId });
      return;
    }

    setActionBusyId(requestId);
    setError(null);
    setInfo(null);
      try {
        const rpcRes = await supabase.rpc("cancel_trip_request", { p_request_id: requestId });
      if (rpcRes.error) {
        if (!shouldFallbackTripRequestRpc(rpcRes.error.message)) throw new Error(rpcRes.error.message);
        const fallback = await supabase.from("trip_requests").update({ status: "cancelled" }).eq("id", requestId);
        if (fallback.error) throw new Error(fallback.error.message);
      }
      await loadData();
      setInfo("Request cancelled.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to cancel request.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function sendChatMessage() {
    if (!threadId || !meId || !chatText.trim()) return;
    setChatBusy(true);
    setError(null);
    try {
      const res = await supabase.from("thread_messages").insert({
        thread_id: threadId,
        sender_id: meId,
        body: chatText.trim(),
      });
      if (res.error) throw new Error(res.error.message);
      setChatText("");
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send message.");
    } finally {
      setChatBusy(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#071316] text-white">Loading trip...</div>;
  }

  return (
    <div
      className={`${plusJakarta.className} min-h-screen bg-[radial-gradient(circle_at_top,_#10272b,_#071316_45%,_#05090b_100%)] text-white`}
    >
      <Nav />

      <main className="mx-auto w-full max-w-[1220px] px-4 pb-14 pt-7 sm:px-6 lg:px-8">
        <div className="mb-5">
          <Link href="/trips" className="text-sm text-cyan-200 hover:text-cyan-100">
            ← Back to trips
          </Link>
          <h1 className="mt-2 text-3xl font-black" data-testid="trip-title">
            {[trip?.destination_city, trip?.destination_country].filter(Boolean).join(", ") || "Trip"}
          </h1>
          <p className="mt-1 text-sm text-slate-300">
            {formatDate(trip?.start_date)} - {formatDate(trip?.end_date)} • {trip?.purpose ?? "Trip"}
          </p>
        </div>

        {error ? (
          <div
            className="mb-4 rounded-xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
            data-testid="trip-error"
          >
            {error}
          </div>
        ) : null}
        {info ? (
          <div
            className="mb-4 rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100"
            data-testid="trip-info"
          >
            {info}
          </div>
        ) : null}

        <div className="mb-4 flex gap-2 overflow-x-auto">
          {([
            { key: "requests", label: "Requests" },
            { key: "chat", label: "Chat" },
            { key: "details", label: "Details" },
          ] as const).map((item) => {
            const selected = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                data-testid={`trip-tab-${item.key}`}
                className={[
                  "rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors",
                  selected
                    ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100"
                    : "border-white/15 bg-black/25 text-slate-300 hover:text-white",
                ].join(" ")}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {tab === "requests" ? (
          <section className="rounded-2xl border border-white/10 bg-[#0b1a1d]/70 p-4 space-y-3" data-testid="trip-requests-panel">
            {isOwner ? (
              <p className="text-sm text-slate-300">
                Incoming requests:{" "}
                <span className="font-semibold text-white" data-testid="trip-incoming-count">
                  {pendingRequests.length}
                </span>
              </p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-300">
                  Your request status:{" "}
                  <span className="font-semibold text-white" data-testid="trip-my-request-status">
                    {myRequest?.status ?? "No request"}
                  </span>
                </p>
                {myRequest?.status === "accepted" ? (
                  <button
                    type="button"
                    onClick={() => setTab("chat")}
                    data-testid="trip-my-request-message"
                    className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                  >
                    Message
                  </button>
                ) : null}
              </div>
            )}

            {requests.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                No requests found for this trip.
              </div>
            ) : (
              requests.map((request) => {
                const profile = profilesById[request.requester_id];
                const busy = actionBusyId === request.id;
                return (
                  <article
                    key={request.id}
                    className="rounded-xl border border-white/10 bg-black/20 p-4"
                    data-testid="trip-request-card"
                    data-request-id={request.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white" data-testid="trip-request-name">
                          {profile?.displayName ?? request.requester_id}
                        </p>
                        <p className="text-xs text-slate-400">
                          Requested {formatDate(request.created_at ?? null)} •{" "}
                          <span data-testid="trip-request-status">{request.status}</span>
                        </p>
                        {request.note ? <p className="mt-2 text-sm text-slate-300">{request.note}</p> : null}
                      </div>

                      <div className="flex gap-2">
                        {isOwner && request.status === "pending" ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void respondRequest(request.id, "accept")}
                              data-testid="trip-request-accept"
                              className="rounded-lg bg-cyan-300 px-3 py-1.5 text-xs font-semibold text-[#052328] hover:bg-cyan-200 disabled:opacity-60"
                            >
                              {busy ? "Saving..." : "Accept"}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void respondRequest(request.id, "decline")}
                              data-testid="trip-request-decline"
                              className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-60"
                            >
                              {busy ? "Saving..." : "Decline"}
                            </button>
                          </>
                        ) : null}

                        {!isOwner && request.requester_id === meId && request.status === "pending" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void cancelRequest(request.id)}
                            data-testid="trip-request-cancel"
                            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-100 hover:bg-white/5 disabled:opacity-60"
                          >
                            {busy ? "Saving..." : "Cancel"}
                          </button>
                        ) : null}

                        {request.status === "accepted" ? (
                          <button
                            type="button"
                            onClick={() => setTab("chat")}
                            data-testid="trip-request-message"
                            className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                          >
                            Message
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        ) : null}

        {tab === "chat" ? (
          <section className="rounded-2xl border border-white/10 bg-[#0b1a1d]/70 p-4" data-testid="trip-chat-panel">
            {!threadId ? (
              <div
                className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 p-4 text-sm text-cyan-100"
                data-testid="trip-chat-no-thread"
              >
                No trip thread yet. Accept at least one request to start trip chat.
              </div>
            ) : (
              <>
                <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                  {threadMessages.length === 0 ? (
                    <p className="text-sm text-slate-300">No messages yet.</p>
                  ) : (
                    threadMessages.map((message) => {
                      const mine = message.senderId === meId;
                      return (
                        <div
                          key={message.id}
                          className={`flex ${mine ? "justify-end" : "justify-start"}`}
                          data-testid="trip-chat-message"
                        >
                          <div
                            className={[
                              "max-w-[80%] rounded-xl px-3 py-2 text-sm",
                              mine ? "bg-cyan-300 text-[#052328]" : "bg-[#224949] text-white",
                            ].join(" ")}
                          >
                            <p>{message.body}</p>
                            <p className="mt-1 text-[10px] opacity-70">{formatTime(message.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <textarea
                    rows={1}
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void sendChatMessage()}
                    disabled={chatBusy || !chatText.trim()}
                    data-testid="trip-chat-send"
                    className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#052328] hover:bg-cyan-200 disabled:opacity-60"
                  >
                    {chatBusy ? "Sending..." : "Send"}
                  </button>
                </div>
              </>
            )}
          </section>
        ) : null}

        {tab === "details" ? (
          <section className="rounded-2xl border border-white/10 bg-[#0b1a1d]/70 p-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Destination</dt>
                <dd className="text-sm text-white mt-1">{[trip?.destination_city, trip?.destination_country].filter(Boolean).join(", ")}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Purpose</dt>
                <dd className="text-sm text-white mt-1">{trip?.purpose ?? "Trip"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Start</dt>
                <dd className="text-sm text-white mt-1">{formatDate(trip?.start_date)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">End</dt>
                <dd className="text-sm text-white mt-1">{formatDate(trip?.end_date)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Status</dt>
                <dd className="text-sm text-white mt-1">{trip?.status ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Accepted participants</dt>
                <dd className="text-sm text-white mt-1">{acceptedRequests.length + 1}</dd>
              </div>
            </dl>
          </section>
        ) : null}
      </main>

      <ConfirmationDialog
        open={confirmAction.open}
        title={confirmAction.action === "decline_request" ? "Decline this trip request?" : "Cancel your trip request?"}
        description={
          confirmAction.action === "decline_request"
            ? "The requester will see this request as declined."
            : "This removes your pending request from the trip host queue."
        }
        confirmVariant="danger"
        confirmLabel={confirmAction.action === "decline_request" ? "Decline" : "Cancel Request"}
        onCancel={() => setConfirmAction({ open: false, action: "decline_request", requestId: "" })}
        onConfirm={() => {
          const payload = confirmAction;
          setConfirmAction({ open: false, action: "decline_request", requestId: "" });
          if (!payload.requestId) return;
          if (payload.action === "decline_request") {
            void respondRequest(payload.requestId, "decline", true);
          } else {
            void cancelRequest(payload.requestId, true);
          }
        }}
      />
    </div>
  );
}
