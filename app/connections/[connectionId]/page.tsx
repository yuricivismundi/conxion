"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import Nav from "@/components/Nav";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { supabase } from "@/lib/supabase/client";
import { fetchVisibleConnections } from "@/lib/connections/read-model";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

type SyncStatus = "pending" | "accepted" | "declined" | "cancelled" | "completed";
type SyncType = "training" | "social_dancing" | "workshop";

type SyncItem = {
  id: string;
  connectionId: string;
  requesterId: string;
  recipientId: string;
  syncType: SyncType;
  scheduledAt: string | null;
  note: string | null;
  status: SyncStatus;
  completedAt: string | null;
  createdAt: string;
};

type MessageItem = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

type ProfileRow = {
  user_id?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  city?: string | null;
  country?: string | null;
  roles?: unknown;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function normalizeSyncType(value: string): SyncType {
  if (value === "social_dancing" || value === "workshop") return value;
  return "training";
}

function normalizeSyncStatus(value: string): SyncStatus {
  if (value === "accepted" || value === "declined" || value === "cancelled" || value === "completed") return value;
  return "pending";
}

function shouldFallbackSyncRpc(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("function") ||
    text.includes("schema cache") ||
    text.includes("relation") ||
    text.includes("column") ||
    text.includes("policy")
  );
}

export default function ConnectionDetailPage() {
  const router = useRouter();
  const params = useParams<{ connectionId: string }>();
  const connectionId = typeof params?.connectionId === "string" ? params.connectionId : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [otherName, setOtherName] = useState("Connection");
  const [otherAvatarUrl, setOtherAvatarUrl] = useState<string | null>(null);
  const [otherMeta, setOtherMeta] = useState("");
  const [connectionContext, setConnectionContext] = useState<string | null>(null);

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const [syncs, setSyncs] = useState<SyncItem[]>([]);
  const [syncBusyId, setSyncBusyId] = useState<string | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeType, setProposeType] = useState<SyncType>("training");
  const [proposeDateTime, setProposeDateTime] = useState("");
  const [proposeNote, setProposeNote] = useState("");
  const [proposeBusy, setProposeBusy] = useState(false);
  const [confirmSyncAction, setConfirmSyncAction] = useState<{
    open: boolean;
    syncId: string;
    action: "cancel" | "complete";
  }>({ open: false, syncId: "", action: "cancel" });

  const completedSync = useMemo(() => syncs.find((sync) => sync.status === "completed") ?? null, [syncs]);

  const loadData = useCallback(async () => {
    if (!connectionId) return;
    setLoading(true);
    setError(null);
    setInfo(null);

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      router.replace("/auth");
      return;
    }
    const userId = authData.user.id;
    setMeId(userId);

    const visibleRows = await fetchVisibleConnections(supabase, userId);
    const conn = visibleRows.find((row) => row.id === connectionId && row.is_accepted_visible);
    if (!conn) {
      setError("Connection not found or not accessible.");
      setLoading(false);
      return;
    }

    setConnectionContext(conn.connect_context ?? null);
    const otherUserId = conn.other_user_id;

    const [profileRes, messagesRes, syncsRes, legacySyncRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id,display_name,avatar_url,city,country,roles")
        .eq("user_id", otherUserId)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("id,sender_id,body,created_at")
        .eq("connection_id", connectionId)
        .order("created_at", { ascending: true })
        .limit(500),
      supabase
        .from("connection_syncs")
        .select("id,connection_id,requester_id,recipient_id,sync_type,scheduled_at,note,status,completed_at,created_at")
        .eq("connection_id", connectionId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("syncs").select("id,connection_id,completed_by,completed_at,note,created_at").eq("connection_id", connectionId).limit(200),
    ]);

    if (profileRes.error) {
      setError(profileRes.error.message);
      setLoading(false);
      return;
    }
    if (messagesRes.error) {
      setError(messagesRes.error.message);
      setLoading(false);
      return;
    }

    const profile = (profileRes.data ?? null) as ProfileRow | null;
    setOtherName(profile?.display_name ?? "Connection");
    setOtherAvatarUrl(profile?.avatar_url ?? null);
    setOtherMeta([profile?.city ?? "", profile?.country ?? ""].filter(Boolean).join(", "));

    setMessages(
      ((messagesRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
        senderId: typeof row.sender_id === "string" ? row.sender_id : "",
        body: typeof row.body === "string" ? row.body : "",
        createdAt: typeof row.created_at === "string" ? row.created_at : "",
      }))
    );

    if (!syncsRes.error) {
      const mapped = ((syncsRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
        connectionId: typeof row.connection_id === "string" ? row.connection_id : connectionId,
        requesterId: typeof row.requester_id === "string" ? row.requester_id : "",
        recipientId: typeof row.recipient_id === "string" ? row.recipient_id : "",
        syncType: normalizeSyncType(typeof row.sync_type === "string" ? row.sync_type : "training"),
        scheduledAt: typeof row.scheduled_at === "string" ? row.scheduled_at : null,
        note: typeof row.note === "string" ? row.note : null,
        status: normalizeSyncStatus(typeof row.status === "string" ? row.status : "pending"),
        completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
        createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
      }));
      setSyncs(mapped);
    } else if (!syncsRes.error.message.toLowerCase().includes("relation")) {
      setError(syncsRes.error.message);
      setLoading(false);
      return;
    } else {
      const legacy = (legacySyncRes.data ?? []) as Array<Record<string, unknown>>;
      const mappedLegacy: SyncItem[] = legacy.map((row) => ({
        id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
        connectionId: connectionId,
        requesterId: typeof row.completed_by === "string" ? row.completed_by : "",
        recipientId: otherUserId,
        syncType: "training",
        scheduledAt: null,
        note: typeof row.note === "string" ? row.note : null,
        status: "completed",
        completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
        createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
      }));
      setSyncs(mappedLegacy);
    }

    setLoading(false);
  }, [connectionId, router]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function sendMessage() {
    if (!chatText.trim()) return;
    setChatBusy(true);
    setError(null);

    try {
      const rpc = await supabase.rpc("send_message", {
        p_connection_id: connectionId,
        p_body: chatText.trim(),
      });
      if (rpc.error) throw new Error(rpc.error.message);
      setChatText("");
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send message.");
    } finally {
      setChatBusy(false);
    }
  }

  async function runSyncActionFallbackApi(params: {
    action: "propose" | "accept" | "decline" | "cancel" | "complete";
    syncId?: string;
    syncType?: SyncType;
    scheduledAt?: string | null;
    note?: string | null;
  }) {
    const sessionRes = await supabase.auth.getSession();
    const token = sessionRes.data.session?.access_token ?? "";
    if (!token) throw new Error("Missing auth session.");

    const res = await fetch("/api/syncs/action", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: params.action,
        syncId: params.syncId,
        connectionId,
        syncType: params.syncType,
        scheduledAt: params.scheduledAt ?? null,
        note: params.note ?? null,
      }),
    });

    const payload = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.error || "Sync action fallback failed.");
    }
  }

  async function proposeSync() {
    setProposeBusy(true);
    setError(null);
    setInfo(null);

    const scheduledAt = proposeDateTime ? new Date(proposeDateTime).toISOString() : null;
    try {
      const rpc = await supabase.rpc("propose_connection_sync", {
        p_connection_id: connectionId,
        p_sync_type: proposeType,
        p_scheduled_at: scheduledAt,
        p_note: proposeNote.trim() || null,
      });
      if (rpc.error) {
        if (!shouldFallbackSyncRpc(rpc.error.message)) throw new Error(rpc.error.message);
        await runSyncActionFallbackApi({
          action: "propose",
          syncType: proposeType,
          scheduledAt,
          note: proposeNote.trim() || null,
        });
      }
      setInfo("Sync proposed.");
      setProposeOpen(false);
      setProposeType("training");
      setProposeDateTime("");
      setProposeNote("");
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to propose sync.");
    } finally {
      setProposeBusy(false);
    }
  }

  async function runSyncAction(
    syncId: string,
    action: "accept" | "decline" | "cancel" | "complete",
    force = false
  ) {
    if (!force && (action === "cancel" || action === "complete")) {
      setConfirmSyncAction({ open: true, syncId, action });
      return;
    }

    setSyncBusyId(syncId);
    setError(null);
    setInfo(null);
    try {
      if (action === "accept" || action === "decline") {
        const rpc = await supabase.rpc("respond_connection_sync", {
          p_sync_id: syncId,
          p_action: action,
          p_note: null,
        });
        if (rpc.error) {
          if (!shouldFallbackSyncRpc(rpc.error.message)) throw new Error(rpc.error.message);
          await runSyncActionFallbackApi({ action, syncId });
        }
      } else if (action === "cancel") {
        const rpc = await supabase.rpc("cancel_connection_sync", {
          p_sync_id: syncId,
        });
        if (rpc.error) {
          if (!shouldFallbackSyncRpc(rpc.error.message)) throw new Error(rpc.error.message);
          await runSyncActionFallbackApi({ action, syncId });
        }
      } else {
        const rpc = await supabase.rpc("complete_connection_sync", {
          p_sync_id: syncId,
          p_note: null,
        });
        if (rpc.error) {
          if (!shouldFallbackSyncRpc(rpc.error.message)) throw new Error(rpc.error.message);
          await runSyncActionFallbackApi({ action, syncId });
        }
      }
      const actionLabel =
        action === "accept"
          ? "accepted"
          : action === "decline"
            ? "declined"
            : action === "cancel"
              ? "cancelled"
              : "completed";
      setInfo(`Sync ${actionLabel}.`);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update sync.");
    } finally {
      setSyncBusyId(null);
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#071316] text-white">Loading connection...</div>;
  }

  return (
    <div
      className={`${plusJakarta.className} min-h-screen bg-[radial-gradient(circle_at_top,_#10272b,_#071316_45%,_#05090b_100%)] text-white`}
    >
      <Nav />

      <main className="mx-auto w-full max-w-[1320px] px-4 pb-14 pt-7 sm:px-6 lg:px-8">
        <div className="mb-4">
          <Link href="/connections" className="text-sm text-cyan-200 hover:text-cyan-100">
            ← Back to Connections
          </Link>
        </div>

        {error ? (
          <div
            className="mb-4 rounded-xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
            data-testid="connection-sync-error"
          >
            {error}
          </div>
        ) : null}
        {info ? (
          <div
            className="mb-4 rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100"
            data-testid="connection-sync-info"
          >
            {info}
          </div>
        ) : null}

        <section className="mb-5 overflow-hidden rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 rounded-full bg-[#224949] overflow-hidden">
                {otherAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={otherAvatarUrl} alt={otherName} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div>
                <h1 className="text-2xl font-bold" data-testid="connection-detail-title">
                  {otherName}
                </h1>
                <p className="text-sm text-slate-300">{otherMeta || "Connection"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {connectionContext ? (
                <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                  {connectionContext}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setProposeOpen(true)}
                data-testid="sync-propose-open"
                className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#052328] hover:bg-cyan-200"
              >
                Propose Sync
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_1fr]">
          <article className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-4">
            <h2 className="mb-3 text-lg font-bold">Chat</h2>
            <div className="max-h-[460px] space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">No messages yet.</div>
              ) : (
                messages.map((message) => {
                  const mine = message.senderId === meId;
                  return (
                    <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={cx("max-w-[78%] rounded-xl px-3 py-2 text-sm", mine ? "bg-cyan-300 text-[#052328]" : "bg-[#224949] text-white")}>
                        <p>{message.body}</p>
                        <p className="mt-1 text-[10px] opacity-70">{formatTime(message.createdAt)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <textarea
                rows={1}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={chatBusy || !chatText.trim()}
                className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#052328] hover:bg-cyan-200 disabled:opacity-60"
              >
                {chatBusy ? "Sending..." : "Send"}
              </button>
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Sync Activities</h2>
              {completedSync ? (
                <Link
                  href={`/references?connectionId=${encodeURIComponent(connectionId)}`}
                  data-testid="sync-leave-reference"
                  className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                >
                  Leave Reference
                </Link>
              ) : null}
            </div>

            <div className="space-y-3" data-testid="sync-list">
              {syncs.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300" data-testid="sync-empty">
                  No syncs yet. Propose one to start planning.
                </div>
              ) : (
                syncs.map((sync) => {
                  const busy = syncBusyId === sync.id;
                  const isRequester = sync.requesterId === meId;
                  const isRecipient = sync.recipientId === meId;
                  return (
                    <article
                      key={sync.id}
                      className="rounded-xl border border-white/10 bg-black/20 p-3"
                      data-testid="sync-card"
                      data-sync-id={sync.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-white">{sync.syncType.replace("_", " ")}</p>
                          <p className="text-xs text-slate-400">
                            {sync.scheduledAt ? formatDateTime(sync.scheduledAt) : "Date TBD"} • {sync.status}
                          </p>
                        </div>
                        <span
                          className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase text-slate-300"
                          data-testid="sync-status"
                        >
                          {sync.status}
                        </span>
                      </div>
                      {sync.note ? <p className="mt-2 text-sm text-slate-300">{sync.note}</p> : null}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {sync.status === "pending" && isRecipient ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void runSyncAction(sync.id, "accept")}
                              data-testid="sync-action-accept"
                              className="rounded-lg bg-cyan-300 px-3 py-1.5 text-xs font-semibold text-[#052328] hover:bg-cyan-200 disabled:opacity-60"
                            >
                              {busy ? "Saving..." : "Accept"}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void runSyncAction(sync.id, "decline")}
                              data-testid="sync-action-decline"
                              className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-60"
                            >
                              {busy ? "Saving..." : "Decline"}
                            </button>
                          </>
                        ) : null}

                        {sync.status === "pending" && (isRequester || isRecipient) ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runSyncAction(sync.id, "cancel")}
                            data-testid="sync-action-cancel"
                            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-100 hover:bg-white/5 disabled:opacity-60"
                          >
                            {busy ? "Saving..." : "Cancel"}
                          </button>
                        ) : null}

                        {sync.status === "accepted" && (isRequester || isRecipient) ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runSyncAction(sync.id, "complete")}
                            data-testid="sync-action-complete"
                            className="rounded-lg border border-emerald-300/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
                          >
                            {busy ? "Saving..." : "Mark Completed"}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </article>
        </section>
      </main>

      {proposeOpen ? (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="sync-propose-modal">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0b1a1d] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Propose Sync</h3>
              <button type="button" onClick={() => setProposeOpen(false)} className="text-slate-400 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Type</span>
                <select
                  value={proposeType}
                  onChange={(e) => setProposeType(normalizeSyncType(e.target.value))}
                  data-testid="sync-propose-type"
                  className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white focus:border-cyan-300/35 focus:outline-none"
                >
                  <option value="training">Training</option>
                  <option value="social_dancing">Social Dancing</option>
                  <option value="workshop">Workshop</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Scheduled At (optional)</span>
                <input
                  type="datetime-local"
                  value={proposeDateTime}
                  onChange={(e) => setProposeDateTime(e.target.value)}
                  data-testid="sync-propose-datetime"
                  className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white focus:border-cyan-300/35 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Note (optional)</span>
                <textarea
                  rows={3}
                  value={proposeNote}
                  onChange={(e) => setProposeNote(e.target.value)}
                  data-testid="sync-propose-note"
                  className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white focus:border-cyan-300/35 focus:outline-none"
                  placeholder="Goal, place, and expectations..."
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProposeOpen(false)}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void proposeSync()}
                disabled={proposeBusy}
                data-testid="sync-propose-submit"
                className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#052328] hover:bg-cyan-200 disabled:opacity-60"
              >
                {proposeBusy ? "Saving..." : "Send Proposal"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmationDialog
        open={confirmSyncAction.open}
        title={confirmSyncAction.action === "cancel" ? "Cancel this sync?" : "Mark sync completed?"}
        description={
          confirmSyncAction.action === "cancel"
            ? "This will close the pending sync request."
            : "This unlocks the reference flow for both participants."
        }
        confirmVariant={confirmSyncAction.action === "cancel" ? "danger" : "primary"}
        confirmLabel={confirmSyncAction.action === "cancel" ? "Cancel Sync" : "Mark Completed"}
        onCancel={() => setConfirmSyncAction({ open: false, syncId: "", action: "cancel" })}
        onConfirm={() => {
          const { syncId, action } = confirmSyncAction;
          setConfirmSyncAction({ open: false, syncId: "", action: "cancel" });
          void runSyncAction(syncId, action, true);
        }}
      />
    </div>
  );
}
