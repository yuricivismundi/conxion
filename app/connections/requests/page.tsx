"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import Nav from "@/components/Nav";
import { fetchVisibleConnections } from "@/lib/connections/read-model";

type ConnectionStatus = "pending" | "accepted" | "blocked" | "declined";
type ConnectContext = "member" | "trip" | "traveller" | null;

type ConnectionRow = {
  id: string;
  requester_id: string;
  target_id: string;
  status: ConnectionStatus;
  created_at?: string;
  blocked_by?: string | null;

  connect_context?: ConnectContext;
  connect_reason?: string | null;
  connect_reason_role?: string | null;
  connect_note?: string | null;
  trip_id?: string | null;

  trip_destination_city?: string | null;
  trip_destination_country?: string | null;
  trip_start_date?: string | null;
  trip_end_date?: string | null;
  trip_purpose?: string | null;
};

type ProfileLite = {
  user_id: string;
  display_name: string;
  city: string;
  country: string | null;
  avatar_url: string | null;
  roles: string[];
  last_seen_at: string | null;
  is_active_now: boolean;
};

type RowWithProfile = {
  conn: ConnectionRow;
  other: ProfileLite | null;
};

type TripRow = {
  id: string;
  user_id: string;
  destination_city: string;
  destination_country: string;
  start_date: string;
  end_date: string;
  purpose: string;
  status: string;
  created_at: string | null;
};

type TripPreview = {
  destination_city: string;
  destination_country: string;
  start_date: string;
  end_date: string;
  purpose: string;
} | null;

type ActionType = "block" | "report";

type ActionModalState = {
  open: boolean;
  type: ActionType;
  connId: string | null;
  targetId: string | null;
  targetName: string;
};

const EMPTY_ACTION_MODAL: ActionModalState = {
  open: false,
  type: "report",
  connId: null,
  targetId: null,
  targetName: "this user",
};

const BLOCK_REASONS = [
  "Not a good fit",
  "Spam or solicitation",
  "Harassment or abuse",
  "Unsafe behavior",
  "Fake profile or misrepresentation",
  "Other",
];

const REPORT_REASONS = [
  "Spam / scams",
  "Harassment / hate speech",
  "Inappropriate content",
  "Impersonation / fake profile",
  "Safety concern",
  "Other",
];

type BlockConfirmState = {
  open: boolean;
  connId: string;
  targetId: string;
  targetName: string;
  reason: string;
  note: string;
  tripId: string | null;
};

const EMPTY_BLOCK_CONFIRM: BlockConfirmState = {
  open: false,
  connId: "",
  targetId: "",
  targetName: "this user",
  reason: "",
  note: "",
  tripId: null,
};

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function formatReasonLabel(
  reason: string | null | undefined,
  reasonMap: Record<string, string>,
  note?: string | null
) {
  if (!reason) return note?.trim() || "-";
  const hit = reasonMap[reason];
  if (hit) return hit;
  if (isUuid(reason) && note?.trim()) return note.trim();
  if (isUuid(reason)) return "Connection request";
  return reason.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function toIsoDate(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "";
  return x.toISOString().slice(0, 10);
}

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start || !end) return "";
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
  const sText = s.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const eText = e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${sText} - ${eText}`;
}

function formatRelativeTime(iso?: string) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function getTripPreview(conn: ConnectionRow): TripPreview {
  if (!conn.trip_id) return null;
  const city = (conn.trip_destination_city ?? "").trim();
  const country = (conn.trip_destination_country ?? "").trim();
  const start = toIsoDate(conn.trip_start_date ?? "");
  const end = toIsoDate(conn.trip_end_date ?? "");
  const purpose = (conn.trip_purpose ?? "").trim();
  if (!city || !country || !start || !end) return null;
  return {
    destination_city: city,
    destination_country: country,
    start_date: start,
    end_date: end,
    purpose: purpose || "Trip",
  };
}

function toTime(iso?: string | null) {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

const ACTIVE_WINDOW_MS = 10 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

function isActiveWithinWindow(lastSeenAt: string | null | undefined, nowMs: number) {
  const seenAt = toTime(lastSeenAt ?? null);
  if (!seenAt) return false;
  return nowMs - seenAt <= ACTIVE_WINDOW_MS;
}

function normalizeTrip(row: Record<string, unknown>): TripRow {
  return {
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? ""),
    destination_city: String(row.destination_city ?? ""),
    destination_country: String(row.destination_country ?? ""),
    start_date: toIsoDate(String(row.start_date ?? "")),
    end_date: toIsoDate(String(row.end_date ?? "")),
    purpose: String(row.purpose ?? "Trip"),
    status: String(row.status ?? "active"),
    created_at: typeof row.created_at === "string" ? row.created_at : null,
  };
}

export default function ConnectionsRequestsPage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"incoming" | "outgoing">("incoming");
  const [requestKind, setRequestKind] = useState<"connections" | "trips">("connections");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<RowWithProfile[]>([]);
  const [outgoing, setOutgoing] = useState<RowWithProfile[]>([]);
  const [acceptedAnimatingId, setAcceptedAnimatingId] = useState<string | null>(null);
  const [reasonLabels, setReasonLabels] = useState<Record<string, string>>({});
  const [lastDeclined, setLastDeclined] = useState<{ row: RowWithProfile; expiresAt: number } | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<ActionModalState>(EMPTY_ACTION_MODAL);
  const [actionReason, setActionReason] = useState<string>("");
  const [actionNote, setActionNote] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [blockConfirm, setBlockConfirm] = useState<BlockConfirmState>(EMPTY_BLOCK_CONFIRM);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const acceptRemoveTimerRef = useRef<number | null>(null);
  const acceptRedirectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const kindParam = searchParams.get("kind");
    if (tabParam === "incoming" || tabParam === "outgoing") setTab(tabParam);
    if (kindParam === "connections" || kindParam === "trips") setRequestKind(kindParam);
  }, [searchParams]);

  const touchLastSeen = useCallback(async (userId: string, force = false) => {
    if (!userId) return;
    const nowMs = Date.now();
    const storageKey = `conxion:last-seen:${userId}`;

    try {
      const prevRaw = window.localStorage.getItem(storageKey);
      const prevMs = prevRaw ? Number(prevRaw) : 0;
      if (!force && Number.isFinite(prevMs) && nowMs - prevMs < LAST_SEEN_THROTTLE_MS) {
        return;
      }
      window.localStorage.setItem(storageKey, String(nowMs));
    } catch {
      // Local storage may be unavailable; skip throttling and still update server.
    }

    await supabase
      .from("profiles")
      .update({ last_seen_at: new Date(nowMs).toISOString() })
      .eq("user_id", userId);
  }, []);

  const loadRequests = useCallback(
    async () => {
      setLoading(true);
      setError(null);
      setReasonLabels({});

      try {
        let user: { id: string } | null = null;

        for (let i = 0; i < 3 && !user; i += 1) {
          const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
          if (sessionErr) {
            setError(sessionErr.message);
            setLoading(false);
            return;
          }

          user = sessionData?.session?.user ?? null;
          if (!user) {
            const { data: authData } = await supabase.auth.getUser();
            user = authData?.user ?? null;
          }

          if (!user) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        if (!user) {
          setError("Auth session missing. Please sign in again.");
          setLoading(false);
          return;
        }
        setMyUserId(user.id);
        void touchLastSeen(user.id);

        const visibleRows = await fetchVisibleConnections(supabase, user.id);
        const connsRaw = visibleRows.map((raw) => {
          const row: ConnectionRow = {
            id: raw.id,
            requester_id: raw.requester_id,
            target_id: raw.target_id,
            status: (raw.status as ConnectionStatus) ?? "pending",
            created_at: raw.created_at ?? undefined,
            blocked_by: raw.blocked_by ?? null,
            connect_context: (raw.connect_context ?? null) as ConnectContext,
            connect_reason: raw.connect_reason ?? null,
            connect_reason_role: raw.connect_reason_role ?? null,
            connect_note: raw.connect_note ?? null,
            trip_id: raw.trip_id ?? null,
            trip_destination_city: raw.trip_destination_city ?? null,
            trip_destination_country: raw.trip_destination_country ?? null,
            trip_start_date: raw.trip_start_date ?? null,
            trip_end_date: raw.trip_end_date ?? null,
            trip_purpose: raw.trip_purpose ?? null,
          };
          return row;
        });

        const otherIds = Array.from(
          new Set(connsRaw.map((c) => (c.requester_id === user.id ? c.target_id : c.requester_id)))
        );
        otherIds.push(user.id);

        let profilesById: Record<string, ProfileLite> = {};
        if (otherIds.length) {
          const { data: profs, error: profErr } = await supabase
            .from("profiles")
            .select("user_id,display_name,city,country,avatar_url,roles,last_seen_at")
            .in("user_id", otherIds);

          if (profErr) {
            setError(profErr.message);
            setLoading(false);
            return;
          }

          const nowMs = Date.now();
          profilesById = Object.fromEntries(
            (profs ?? []).map((p) => {
              const row = p as Partial<ProfileLite> & { last_seen_at?: string | null };
              const lastSeenAt = typeof row.last_seen_at === "string" ? row.last_seen_at : null;
              return [
                String(row.user_id ?? ""),
                {
                  user_id: String(row.user_id ?? ""),
                  display_name: row.display_name ?? "-",
                  city: row.city ?? "-",
                  country: row.country ?? null,
                  avatar_url: row.avatar_url ?? null,
                  roles: Array.isArray(row.roles) ? row.roles : [],
                  last_seen_at: lastSeenAt,
                  is_active_now: isActiveWithinWindow(lastSeenAt, nowMs),
                },
              ];
            })
          );
        }

        const { data: reasons, error: reasonErr } = await supabase
          .from("connect_reasons")
          .select("id,label")
          .limit(1000);
        if (!reasonErr) {
          const map = Object.fromEntries(
            (reasons ?? []).map((r) => {
              const row = r as { id?: string | number; label?: string | null };
              return [String(row.id ?? ""), String(row.label ?? "")];
            })
          );
          setReasonLabels(map);
        }

        const tripIds = Array.from(new Set(connsRaw.map((c) => c.trip_id).filter((v): v is string => !!v)));
        let tripsById: Record<string, TripRow> = {};
        if (tripIds.length) {
          const { data: tripRows, error: tripErr } = await supabase
            .from("trips")
            .select("id,user_id,destination_city,destination_country,start_date,end_date,purpose,status,created_at")
            .in("id", tripIds);
          if (tripErr) {
            setError(tripErr.message);
            setLoading(false);
            return;
          }
          tripsById = Object.fromEntries(
            (tripRows ?? []).map((trip) => {
              const parsed = normalizeTrip(trip as Record<string, unknown>);
              return [parsed.id, parsed];
            })
          );
        }

        const conns = connsRaw.map((conn) => {
          if (!conn.trip_id) return conn;
          const trip = tripsById[conn.trip_id];
          if (!trip) return conn;
          return {
            ...conn,
            trip_destination_city: conn.trip_destination_city || trip.destination_city,
            trip_destination_country: conn.trip_destination_country || trip.destination_country,
            trip_start_date: conn.trip_start_date || trip.start_date,
            trip_end_date: conn.trip_end_date || trip.end_date,
            trip_purpose: conn.trip_purpose || trip.purpose,
          };
        });

        const toRow = (c: ConnectionRow): RowWithProfile => {
          const otherId = c.requester_id === user.id ? c.target_id : c.requester_id;
          return { conn: c, other: profilesById[otherId] ?? null };
        };

        const incomingRows = conns.filter((c) => c.status === "pending" && c.target_id === user.id).map(toRow);
        const outgoingRows = conns.filter((c) => c.status === "pending" && c.requester_id === user.id).map(toRow);

        setIncoming(incomingRows);
        setOutgoing(outgoingRows);

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch data.");
        setLoading(false);
      }
    },
    [touchLastSeen]
  );

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void touchLastSeen(session.user.id, true);
        loadRequests();
      }
    });

    return () => {
      sub?.subscription?.unsubscribe();
    };
  }, [loadRequests, touchLastSeen]);

  useEffect(() => {
    if (!myUserId) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void touchLastSeen(myUserId);
      }
    };
    const onFocus = () => {
      void touchLastSeen(myUserId);
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [myUserId, touchLastSeen]);

  useEffect(() => {
    const onActionPointer = (event: MouseEvent) => {
      if (!actionMenuRef.current) return;
      if (!actionMenuRef.current.contains(event.target as Node)) setActionMenuId(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionMenuId(null);
    };
    document.addEventListener("mousedown", onActionPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onActionPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (acceptRemoveTimerRef.current) {
        window.clearTimeout(acceptRemoveTimerRef.current);
      }
      if (acceptRedirectTimerRef.current) {
        window.clearTimeout(acceptRedirectTimerRef.current);
      }
    };
  }, []);

  const clearUndoTimer = () => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  };

  async function callConnectionAction(payload: {
    connId: string;
    action: "accept" | "decline" | "undo_decline" | "cancel" | "block" | "report";
    reason?: string;
    note?: string;
    context?: "connection" | "trip" | "message" | "profile" | "reference";
    contextId?: string | null;
  }) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? "";
    if (!accessToken) {
      throw new Error("Missing auth session token");
    }

    const response = await fetch("/api/connections/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || `Failed to ${payload.action}`);
    }
  }

  async function acceptIncoming(connId: string) {
    if (!myUserId) return;
    setBusyId(connId);
    setError(null);
    setInfoMessage(null);

    try {
      await callConnectionAction({ connId, action: "accept" });
    } catch (err) {
      setBusyId(null);
      setError(err instanceof Error ? err.message : "Failed to accept request.");
      return;
    }
    setBusyId(null);

    const nextUrl = `/messages?thread=${encodeURIComponent(`conn:${connId}`)}`;

    // Animate card collapse before removing it from the list.
    setAcceptedAnimatingId(connId);
    if (acceptRemoveTimerRef.current) {
      window.clearTimeout(acceptRemoveTimerRef.current);
    }
    if (acceptRedirectTimerRef.current) {
      window.clearTimeout(acceptRedirectTimerRef.current);
    }
    acceptRemoveTimerRef.current = window.setTimeout(() => {
      setIncoming((prev) => prev.filter((r) => r.conn.id !== connId));
      setAcceptedAnimatingId((prev) => (prev === connId ? null : prev));
      setInfoMessage("Accepted — you can message now");
      void touchLastSeen(myUserId, true);
      acceptRedirectTimerRef.current = window.setTimeout(() => {
        window.location.assign(nextUrl);
      }, 700);
    }, 260);
  }

  async function declineIncoming(connId: string) {
    if (!myUserId) return;
    const row = incoming.find((r) => r.conn.id === connId);
    if (!row) return;

    setBusyId(connId);
    setError(null);
    setInfoMessage(null);

    try {
      await callConnectionAction({ connId, action: "decline" });
    } catch (err) {
      setBusyId(null);
      setError(err instanceof Error ? err.message : "Failed to decline request.");
      return;
    }
    setBusyId(null);

    setIncoming((prev) => prev.filter((r) => r.conn.id !== connId));
    // eslint-disable-next-line react-hooks/purity -- timestamp used for undo window.
    const expiresAt = Date.now() + 8000;
    setLastDeclined({ row, expiresAt });
    clearUndoTimer();
    undoTimerRef.current = window.setTimeout(() => {
      setLastDeclined(null);
      undoTimerRef.current = null;
    }, 8000);
    void touchLastSeen(myUserId, true);
    void loadRequests();
  }

  async function undoDecline() {
    if (!lastDeclined) return;
    if (!myUserId) return;
    // eslint-disable-next-line react-hooks/purity -- compare against stored timestamp.
    if (Date.now() > lastDeclined.expiresAt) {
      setLastDeclined(null);
      return;
    }

    setBusyId(lastDeclined.row.conn.id);
    setError(null);

    try {
      await callConnectionAction({ connId: lastDeclined.row.conn.id, action: "undo_decline" });
    } catch (err) {
      setBusyId(null);
      setError(err instanceof Error ? err.message : "Failed to restore request.");
      return;
    }
    setBusyId(null);

    setIncoming((prev) => [lastDeclined.row, ...prev]);
    setLastDeclined(null);
    clearUndoTimer();
    void touchLastSeen(myUserId, true);
    void loadRequests();
  }

  async function cancelOutgoing(connId: string) {
    if (!myUserId) return;
    setBusyId(connId);
    setError(null);
    setInfoMessage(null);

    try {
      await callConnectionAction({ connId, action: "cancel" });
    } catch (err) {
      setBusyId(null);
      setError(err instanceof Error ? err.message : "Failed to cancel request.");
      return;
    }
    setBusyId(null);

    setOutgoing((prev) => prev.filter((r) => r.conn.id !== connId));
    setInfoMessage("Outgoing request canceled.");
    void touchLastSeen(myUserId, true);
    void loadRequests();
  }

  function openActionModal(type: ActionType, row: RowWithProfile) {
    setActionModal({
      open: true,
      type,
      connId: row.conn.id,
      targetId: row.other?.user_id ?? null,
      targetName: row.other?.display_name ?? "this user",
    });
    setActionReason("");
    setActionNote("");
    setActionError(null);
  }

  async function performAction(payload: {
    type: ActionType;
    connId: string;
    targetId: string;
    targetName: string;
    reason: string;
    note: string;
    tripId: string | null;
  }) {
    if (!myUserId) {
      setActionError("Missing user data. Refresh and try again.");
      setActionBusy(false);
      return;
    }

    try {
      if (payload.type === "report") {
        await callConnectionAction({
          connId: payload.connId,
          action: "report",
          reason: payload.reason,
          note: payload.note,
          context: payload.tripId ? "trip" : "connection",
          contextId: payload.tripId ?? payload.connId,
        });
      } else {
        await callConnectionAction({ connId: payload.connId, action: "block" });
      }
    } catch (err) {
      setActionBusy(false);
      setActionError(err instanceof Error ? err.message : "Action failed.");
      return;
    }
    setActionBusy(false);

    if (payload.type === "report") {
      setActionModal(EMPTY_ACTION_MODAL);
      setActionReason("");
      setActionNote("");
      setInfoMessage("Thanks for reporting. Our team will review this shortly.");
      void touchLastSeen(myUserId, true);
      return;
    }

    setIncoming((prev) => prev.filter((r) => r.conn.id !== payload.connId));
    setOutgoing((prev) => prev.filter((r) => r.conn.id !== payload.connId));
    setActionModal(EMPTY_ACTION_MODAL);
    setBlockConfirm(EMPTY_BLOCK_CONFIRM);
    setActionReason("");
    setActionNote("");
    setInfoMessage(`${payload.targetName} has been blocked.`);
    void touchLastSeen(myUserId, true);
    void loadRequests();
  }

  async function submitAction() {
    if (!actionModal.connId || !actionModal.targetId || !myUserId) {
      setActionError("Missing user data. Refresh and try again.");
      return;
    }

    const reason = actionReason.trim();
    if (!reason) {
      setActionError("Please select a reason.");
      return;
    }
    if (reason === "Other" && actionNote.trim().length < 5) {
      setActionError("Please add a short note (min 5 chars).");
      return;
    }

    const row = incoming.find((r) => r.conn.id === actionModal.connId) ?? outgoing.find((r) => r.conn.id === actionModal.connId);
    const tripId = row?.conn.trip_id ?? null;

    if (actionModal.type === "block") {
      setBlockConfirm({
        open: true,
        connId: actionModal.connId,
        targetId: actionModal.targetId,
        targetName: actionModal.targetName,
        reason,
        note: actionNote,
        tripId,
      });
      return;
    }

    setActionBusy(true);
    setActionError(null);
    await performAction({
      type: actionModal.type,
      connId: actionModal.connId,
      targetId: actionModal.targetId,
      targetName: actionModal.targetName,
      reason,
      note: actionNote,
      tripId,
    });
  }

  const displayRows = tab === "incoming" ? incoming : outgoing;
  const connectionRows = displayRows.filter(
    (row) => !(row.conn.connect_context === "trip" || row.conn.connect_context === "traveller" || Boolean(row.conn.trip_id))
  );
  const tripRows = displayRows.filter(
    (row) => row.conn.connect_context === "trip" || row.conn.connect_context === "traveller" || Boolean(row.conn.trip_id)
  );
  const activeRequestRows = requestKind === "connections" ? connectionRows : tripRows;
  const sortedActiveRequestRows = [...activeRequestRows].sort((a, b) => toTime(b.conn.created_at) - toTime(a.conn.created_at));
  const visibleRequestRows = sortedActiveRequestRows.slice(0, 9);
  const hasMoreRequests = sortedActiveRequestRows.length > visibleRequestRows.length;

  const renderRequestCard = ({ conn, other }: RowWithProfile) => {
    const isTrip = conn.connect_context === "trip" || conn.connect_context === "traveller" || !!conn.trip_id;
    const trip = getTripPreview(conn);
    const reasonLabel = formatReasonLabel(conn.connect_reason ?? null, reasonLabels, conn.connect_note);
    const isOtherActive = Boolean(other?.is_active_now);
    const requestTitle = isTrip
      ? trip?.purpose || (reasonLabel && reasonLabel !== "-" ? reasonLabel : "Trip request")
      : reasonLabel && reasonLabel !== "-"
        ? reasonLabel
        : "Connection request";
    const location = other?.city
      ? `${other.city}${other.country ? `, ${other.country}` : ""}`
      : "-";
    const relative = formatRelativeTime(conn.created_at);
    const tripRange = trip ? formatDateRange(trip.start_date, trip.end_date) : "";
    const statusLabel = conn.status ? conn.status.replace(/_/g, " ") : "pending";
    const isAcceptedAnimating = acceptedAnimatingId === conn.id;

    return (
        <article
          key={conn.id}
          className={[
            "relative origin-top overflow-visible rounded-2xl border border-[#313131] bg-[#171717] p-4 shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-all duration-300",
            isAcceptedAnimating
              ? "max-h-0 border-transparent p-0 opacity-0 -translate-y-2 scale-y-95"
              : "max-h-[520px] hover:-translate-y-0.5 hover:border-[#00E5FF]/35 hover:shadow-[0_0_20px_rgba(0,229,255,0.12)]",
            actionMenuId === conn.id ? "z-40" : "z-0",
          ].join(" ")}
        >
        <div
          className={[
            "absolute -top-14 -right-14 h-28 w-28 rounded-full blur-3xl",
            isTrip ? "bg-[#D500F9]/12" : "bg-[#00E5FF]/10",
          ].join(" ")}
        />
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="relative">
                <div
                  className="h-12 w-12 rounded-full border border-white/10 bg-cover bg-center"
                  style={{
                    backgroundImage: other?.avatar_url
                      ? `url(${other.avatar_url})`
                      : "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))",
                  }}
                />
                {isOtherActive ? (
                  <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[#171717] bg-green-500" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold leading-tight text-white">
                  {other?.display_name ?? "Unknown"}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/45">
                  <span>{location}</span>
                  {relative ? <span>•</span> : null}
                  {relative ? <span>{relative}</span> : null}
                  {tab === "outgoing" ? <span>•</span> : null}
                  {tab === "outgoing" ? (
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">hourglass_empty</span>
                      {statusLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="relative flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActionMenuId((prev) => (prev === conn.id ? null : conn.id))}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition hover:text-white"
              >
                <span className="material-symbols-outlined text-base">more_horiz</span>
              </button>
              {actionMenuId === conn.id ? (
                <div
                  ref={actionMenuRef}
                  className="absolute right-0 top-10 z-50 w-36 rounded-xl border border-white/10 bg-[#121414] p-1 text-xs shadow-[0_18px_36px_rgba(0,0,0,0.35)]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActionMenuId(null);
                      openActionModal("report", { conn, other });
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
                  >
                    Report
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActionMenuId(null);
                      openActionModal("block", { conn, other });
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-white/70 hover:bg-white/5 hover:text-white"
                  >
                    Block
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div
            className={[
              "relative mt-4 rounded-xl border p-3 text-[#c7d4d4]",
              isTrip ? "border-[#3a2a3a] bg-[#221a24]/80" : "border-[#2f2f2f] bg-[#232323]",
            ].join(" ")}
          >
            {isTrip ? (
              <span className="absolute bottom-2 left-0 top-2 w-[2px] rounded-r-full bg-gradient-to-b from-[#00E5FF] to-[#D500F9]" />
            ) : null}
            <div className={isTrip ? "pl-2" : ""}>
              <p className={isTrip ? "text-[13px] font-semibold text-white" : "text-sm font-semibold text-white"}>
                {requestTitle}
              </p>
              {isTrip ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#8aa6a6]">
                  {trip ? (
                    <>
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1">
                        <span className="material-symbols-outlined text-[12px]">location_on</span>
                        {trip.destination_city}, {trip.destination_country}
                      </span>
                      {tripRange ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1">
                          <span className="material-symbols-outlined text-[12px]">calendar_today</span>
                          {tripRange}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1">
                      <span className="material-symbols-outlined text-[12px]">travel_explore</span>
                      Trip details pending
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {tab === "incoming" ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => declineIncoming(conn.id)}
                disabled={busyId === conn.id || isAcceptedAnimating}
                className="rounded-full border border-white/20 bg-transparent py-2 px-4 text-[10px] font-semibold uppercase tracking-widest text-white/70 transition hover:border-white/35 hover:text-white disabled:opacity-60"
              >
                {busyId === conn.id ? "Working..." : "Decline"}
              </button>
              <button
                onClick={() => acceptIncoming(conn.id)}
                disabled={busyId === conn.id || isAcceptedAnimating}
                className="rounded-full py-2 px-4 text-[10px] font-bold uppercase tracking-widest text-white shadow-[0_10px_25px_rgba(213,0,249,0.28)] transition hover:brightness-110 disabled:opacity-60"
                style={{ backgroundImage: "linear-gradient(90deg,#00C6FF 0%,#D500F9 100%)" }}
              >
                {busyId === conn.id ? "Working..." : "Accept"}
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <button
                onClick={() => cancelOutgoing(conn.id)}
                disabled={busyId === conn.id}
                className="w-full rounded-full border border-[#2f2f2f] bg-[#232323] py-2 px-4 text-[10px] font-semibold uppercase tracking-widest text-white/70 transition hover:border-white/20 hover:text-white disabled:opacity-60"
              >
                {busyId === conn.id ? "Canceling..." : "Cancel"}
              </button>
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="font-sans min-h-screen bg-[#0A0A0A] text-white relative">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_20%_-10%,rgba(13,242,242,0.18),transparent_60%),radial-gradient(70%_55%_at_85%_0%,rgba(242,13,177,0.16),transparent_55%)]" />
      <div className="relative z-10 flex h-screen flex-col overflow-hidden">
        <Nav />

        <main className="flex h-full w-full flex-1 overflow-hidden px-4 pb-6 pt-5 sm:px-6 sm:pt-6">
          <section className="flex min-h-0 w-full flex-col">
            <div className="shrink-0 space-y-4">
              <div className="space-y-0 border-b border-white/10 pb-3">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="flex flex-wrap items-end gap-5 sm:gap-8">
                    <button
                      type="button"
                      onClick={() => setRequestKind("connections")}
                      className={[
                        "group relative flex items-center gap-2 border-b-2 pb-2 text-left transition",
                        requestKind === "connections"
                          ? "border-[#00E5FF] text-white"
                          : "border-transparent text-white/55 hover:text-white/85",
                      ].join(" ")}
                    >
                      <span className="whitespace-nowrap text-[1.35rem] font-bold leading-none tracking-tight sm:text-[1.5rem]">
                        Connection Requests
                      </span>
                      <span className="ml-1 rounded-full bg-[#00E5FF]/12 px-2.5 py-1 text-xs font-bold text-[#00E5FF]">
                        {connectionRows.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRequestKind("trips")}
                      className={[
                        "group relative flex items-center gap-2 border-b-2 pb-2 text-left transition",
                        requestKind === "trips"
                          ? "border-[#D500F9] text-white"
                          : "border-transparent text-white/55 hover:text-white/85",
                      ].join(" ")}
                    >
                      <span className="whitespace-nowrap text-[1.35rem] font-bold leading-none tracking-tight sm:text-[1.5rem]">
                        Trip Requests
                      </span>
                      <span className="ml-1 rounded-full bg-[#D500F9]/12 px-2.5 py-1 text-xs font-bold text-[#D500F9]">
                        {tripRows.length}
                      </span>
                    </button>
                  </div>

                  <div className="flex items-center gap-5">
                    <button
                      type="button"
                      onClick={() => setTab("incoming")}
                      className={[
                        "border-b-2 pb-1 text-sm font-semibold transition",
                        tab === "incoming"
                          ? "border-[#00E5FF] text-[#00E5FF]"
                          : "border-transparent text-white/60 hover:text-white",
                      ].join(" ")}
                    >
                      Incoming
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab("outgoing")}
                      className={[
                        "border-b-2 pb-1 text-sm font-semibold transition",
                        tab === "outgoing"
                          ? "border-[#00E5FF] text-[#00E5FF]"
                          : "border-transparent text-white/60 hover:text-white",
                      ].join(" ")}
                    >
                      Outgoing
                    </button>
                  </div>
                </div>

              </div>

              <div className="space-y-4">
                {lastDeclined ? (
                  <div className="toast-in flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#1f2a2a] bg-[#141717] px-4 py-3">
                    <div>
                      <p className="text-white font-semibold">
                        Declined {lastDeclined.row.other?.display_name ?? "request"}.
                      </p>
                      <p className="text-[#8aa6a6] text-sm">Undo for a few seconds if that was a mistake.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={undoDecline}
                        disabled={busyId === lastDeclined.row.conn.id}
                        className="rounded-full bg-gradient-to-r from-[#0df2f2] to-[#f20db1] px-4 py-2 text-xs font-bold text-white shadow-lg shadow-[#0df2f2]/10 hover:opacity-90 transition disabled:opacity-60"
                      >
                        {busyId === lastDeclined.row.conn.id ? "Undoing..." : "Undo"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLastDeclined(null)}
                        className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-white/60 hover:text-white hover:border-white/20 transition"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
                ) : null}
                {infoMessage ? (
                  <div className="toast-in rounded-xl border border-[#1f2a2a] bg-[#141717] p-3 text-sm text-[#8aa6a6]">
                    {infoMessage}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="relative mt-2 flex-1 overflow-y-auto scrollbar-subtle pr-1">
              <div className="pointer-events-none absolute left-0 right-0 top-0 h-8 bg-gradient-to-b from-[#0A0A0A] to-transparent" />
              <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-10 bg-gradient-to-t from-[#0A0A0A] to-transparent" />

              <div
                className={[
                  "overflow-hidden rounded-[1.75rem] border bg-[#111315]/95",
                  requestKind === "connections"
                    ? "border-[#1f3440] shadow-[0_0_0_1px_rgba(0,229,255,0.08),0_20px_50px_rgba(0,0,0,0.35)]"
                    : "border-[#3a2340] shadow-[0_0_0_1px_rgba(213,0,249,0.08),0_20px_50px_rgba(0,0,0,0.35)]",
                ].join(" ")}
              >
                <div className="p-4 md:p-5">
                  {loading ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {Array.from({ length: 9 }).map((_, idx) => (
                        <div key={`req-sk-${idx}`} className="rounded-2xl border border-[#2f2f2f] bg-[#171717] p-4 animate-pulse">
                          <div className="flex items-start gap-3">
                            <div className="h-12 w-12 rounded-full bg-white/5" />
                            <div className="flex-1 space-y-2">
                              <div className="h-4 w-40 rounded bg-white/5" />
                              <div className="h-3 w-56 rounded bg-white/5" />
                            </div>
                          </div>
                          <div className="mt-4 h-14 rounded-xl bg-white/5" />
                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="h-10 rounded-full bg-white/5" />
                            <div className="h-10 rounded-full bg-white/5" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : activeRequestRows.length === 0 ? (
                    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-[#1f2a2a] bg-[#141717] p-10 text-center">
                      <span className="text-[#8aa6a6] text-sm">
                        {requestKind === "connections"
                          ? tab === "incoming"
                            ? "No incoming connection requests."
                            : "No outgoing connection requests."
                          : tab === "incoming"
                            ? "No incoming trip requests."
                            : "No outgoing trip requests."}
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {visibleRequestRows.map(renderRequestCard)}
                    </div>
                  )}
                </div>

                {hasMoreRequests ? (
                  <div className="flex justify-center border-t border-[#1f2527] px-4 pb-6 pt-5">
                    <button className="flex items-center gap-2 text-sm text-[#7a9696] transition-colors hover:text-white">
                      Show older {requestKind === "connections" ? "connection" : "trip"} requests
                      <span className="material-symbols-outlined text-sm">expand_more</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </main>
      </div>


      {actionModal.open ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-md rounded-2xl border border-[#1f2a2a] bg-[#141515] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-white text-lg font-bold">
                  {actionModal.type === "block" ? "Block user" : "Report user"}
                </p>
                <p className="text-[#8aa6a6] text-xs mt-1">
                  {actionModal.type === "block"
                    ? "Select a reason before blocking."
                    : "Reports raise a flag for admin review. Please share what happened."}
                </p>
              </div>
              <button
                type="button"
                className="text-white/60 hover:text-white transition"
                onClick={() => setActionModal(EMPTY_ACTION_MODAL)}
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {(actionModal.type === "block" ? BLOCK_REASONS : REPORT_REASONS).map((reason) => {
                const active = actionReason === reason;
                return (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setActionReason(reason)}
                    className={[
                      "rounded-full border px-3 py-1 text-xs font-semibold transition",
                      active
                        ? "border-[#0df2f2]/40 bg-[#0df2f2]/10 text-[#0df2f2]"
                        : "border-white/10 text-white/60 hover:text-white hover:border-white/20",
                    ].join(" ")}
                  >
                    {reason}
                  </button>
                );
              })}
            </div>

            <div className="mt-4">
              <label className="text-xs text-[#8aa6a6]">Optional note</label>
              <textarea
                rows={3}
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white outline-none focus:border-white/30"
                placeholder="Short context for the admin team..."
              />
            </div>

            {actionError ? <div className="mt-3 text-xs text-red-300">{actionError}</div> : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionModal(EMPTY_ACTION_MODAL)}
                className="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/60 hover:text-white hover:border-white/20 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAction}
                disabled={actionBusy}
                className="rounded-full bg-gradient-to-r from-[#0df2f2] to-[#f20db1] px-4 py-2 text-xs font-bold text-white shadow-lg shadow-[#0df2f2]/10 hover:opacity-90 transition disabled:opacity-60"
              >
                {actionBusy ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmationDialog
        open={blockConfirm.open}
        title="Block this user?"
        description="They won't be able to send requests or messages. You can unblock anytime."
        summary={
          <div className="space-y-1 text-xs">
            <div>
              Reason: <span className="text-white">{blockConfirm.reason}</span>
            </div>
            {blockConfirm.note ? <div className="text-white/60">Note: {blockConfirm.note}</div> : null}
          </div>
        }
        confirmLabel={actionBusy ? "Blocking..." : "Confirm Block"}
        cancelLabel="Cancel"
        confirmVariant="danger"
        busy={actionBusy}
        error={actionError}
        onCancel={() => setBlockConfirm(EMPTY_BLOCK_CONFIRM)}
        onConfirm={async () => {
          setActionBusy(true);
          setActionError(null);
          await performAction({
            type: "block",
            connId: blockConfirm.connId,
            targetId: blockConfirm.targetId,
            targetName: blockConfirm.targetName,
            reason: blockConfirm.reason,
            note: blockConfirm.note,
            tripId: blockConfirm.tripId,
          });
        }}
      />

    </div>
  );
}
