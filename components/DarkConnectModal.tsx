"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PendingRequestBanner from "@/components/requests/PendingRequestBanner";
import { supabase } from "@/lib/supabase/client";
import { getPlanLimits, getPlanIdFromMeta } from "@/lib/billing/limits";
import { fetchPendingPairConflict } from "@/lib/requests/pending-pair-client";
import { isPaymentVerified } from "@/lib/verification";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

// ─── Hardcoded reason list ────────────────────────────────────────────────────

type Reason = { id: string; label: string; icon: string };

const REASONS: Reason[] = [
  { id: "just_connect",        label: "Just connect",        icon: "waving_hand"       },
  { id: "social_dance",        label: "Social dance",        icon: "nightlife"          },
  { id: "practice_together",   label: "Practice together",   icon: "sports_gymnastics"  },
  { id: "find_dance_partner",  label: "Find dance partner",  icon: "person_search"      },
  { id: "attend_events",       label: "Attend events",       icon: "event_available"    },
  { id: "classes",             label: "Classes",             icon: "school"             },
  { id: "travel_hosting",      label: "Travel / hosting",    icon: "luggage"            },
  { id: "collaborate",         label: "Collaborate",         icon: "handshake"          },
];

const PENDING_REQUEST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onClose: () => void;
  targetUserId: string;
  targetName: string;
  targetPhotoUrl?: string | null;
  connectContext?: "member" | "traveller";
  tripId?: string | null;
};

// ─── Shared card ─────────────────────────────────────────────────────────────

function ReasonCard({ r, selected, onSelect }: { r: Reason; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(r.id)}
      className={`group relative flex w-full flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center transition-all duration-150 ${
        selected
          ? "border-[#0df2f2]/40 bg-gradient-to-br from-[#0df2f2]/10 to-[#d93bff]/10 shadow-[0_0_16px_rgba(13,204,242,0.12)]"
          : "border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"
      }`}
    >
      {selected && <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-[#0df2f2]/30" />}
      <span
        className={`material-symbols-outlined text-[22px] transition-colors ${selected ? "text-[#0df2f2]" : "text-white/40 group-hover:text-white/60"}`}
        style={{ fontVariationSettings: selected ? "'FILL' 1" : "'FILL' 0" }}
      >
        {r.icon}
      </span>
      <span className={`text-[12px] font-semibold leading-tight transition-colors ${selected ? "text-white" : "text-white/55 group-hover:text-white/80"}`}>
        {r.label}
      </span>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DarkConnectModal({
  open,
  onClose,
  targetUserId,
  targetName,
  targetPhotoUrl,
  connectContext = "member",
  tripId = null,
}: Props) {
  const router = useRouter();
  useBodyScrollLock(open);

  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [message, setMessage]               = useState("");
  const [messageOpen, setMessageOpen]       = useState(false);
  const [sending, setSending]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [pendingWarning, setPendingWarning] = useState<string | null>(null);
  const [requestsUsed, setRequestsUsed]     = useState<number | null>(null);
  const [requestsLimit, setRequestsLimit]   = useState<number | null>(null);
  const [isSelf, setIsSelf]                 = useState(false);

  // Reset on open/close + self-check
  useEffect(() => {
    if (!open) return;
    setSelectedReason(null);
    setMessage("");
    setMessageOpen(false);
    setError(null);
    setPendingWarning(null);
    void supabase.auth.getUser().then(({ data }) => {
      setIsSelf(!!data.user && data.user.id === targetUserId);
    });
  }, [open, targetUserId]);

  // Pending conflict check
  useEffect(() => {
    if (!open || !targetUserId) return;
    (async () => {
      try { setPendingWarning(await fetchPendingPairConflict(targetUserId)); } catch {}
    })();
  }, [open, targetUserId]);

  // Usage counter
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user) return;
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("verified,verified_label")
          .eq("user_id", user.id)
          .maybeSingle();
        const isVerified = isPaymentVerified((profileRow ?? null) as Record<string, unknown> | null);
        const planId = getPlanIdFromMeta(user.user_metadata ?? {}, isVerified);
        const limits = getPlanLimits(planId);
        setRequestsLimit(limits.connectionRequestsPerMonth);

        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const { count } = await supabase
          .from("connections")
          .select("id", { count: "exact", head: true })
          .eq("requester_id", user.id)
          .gte("created_at", monthStart.toISOString());
        setRequestsUsed(count ?? 0);
      } catch {}
    })();
  }, [open]);

  const handleClose = useCallback(() => {
    if (sending) return;
    onClose();
  }, [sending, onClose]);

  async function handleSend() {
    if (!selectedReason || sending) return;
    try {
      setSending(true);
      setError(null);

      const { data: authData } = await supabase.auth.getUser();
      const { data: sessionData } = await supabase.auth.getSession();
      const user = authData?.user;
      const accessToken = sessionData.session?.access_token ?? "";
      if (!user) throw new Error("Not authenticated");
      if (!accessToken) throw new Error("Missing auth session token");

      // Short-circuit if already connected / pending
      const { data: existing } = await supabase
        .from("connections")
        .select("id,status,created_at")
        .or(
          `and(requester_id.eq.${user.id},target_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},target_id.eq.${user.id})`
        )
        .limit(1)
        .maybeSingle();

      if (existing?.status === "accepted" && existing.id) {
        handleClose();
        router.push(`/messages?thread=${encodeURIComponent(`conn:${existing.id}`)}`);
        return;
      }
      const existingCreatedAt = existing?.created_at ? Date.parse(existing.created_at) : NaN;
      const existingPendingLive = existing?.status === "pending" && (!Number.isFinite(existingCreatedAt) || existingCreatedAt >= Date.now() - PENDING_REQUEST_WINDOW_MS);
      if (existingPendingLive) {
        throw new Error("There is already a pending connection request with this member.");
      }

      const reasonLabel = REASONS.find((r) => r.id === selectedReason)?.label ?? selectedReason;

      const response = await fetch("/api/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          requesterId: user.id,
          targetId: targetUserId,
          payload: {
            connect_context: connectContext,
            connect_reason: selectedReason,
            connect_reason_label: reasonLabel,
            connect_message: message.trim() || null,
            trip_id: tripId,
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Failed to create connection request");
      }

      handleClose();
      router.push("/messages?tab=requests");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to send request.";
      setError(msg.includes("Failed to fetch")
        ? "Network issue while sending request. Check your connection and retry."
        : msg);
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  const selectedLabel = REASONS.find((r) => r.id === selectedReason)?.label ?? null;
  const atLimit = requestsLimit !== null && requestsUsed !== null && requestsUsed >= requestsLimit;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-md sm:items-center">
      <div
        className="relative w-full max-w-[520px] overflow-hidden rounded-[28px] border border-white/[0.08] shadow-[0_32px_80px_rgba(0,0,0,0.6)] sm:rounded-[32px]"
        style={{
          background:
            "radial-gradient(circle at 15% 0%, rgba(13,204,242,0.08), transparent 45%), radial-gradient(circle at 85% 100%, rgba(217,59,255,0.08), transparent 45%), #080e14",
        }}
      >
        {/* Top-right cluster: close + counter on same row */}
        <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            {requestsLimit !== null && requestsUsed !== null && (
              <div className="flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[10px]">
                <span className={atLimit ? "font-bold text-rose-400" : requestsUsed >= requestsLimit * 0.8 ? "font-bold text-amber-400" : "font-semibold text-[#0df2f2]"}>
                  {requestsUsed}/{requestsLimit}
                </span>
                <span className="text-white/30">req/mo</span>
              </div>
            )}
            <button type="button" onClick={handleClose} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/40 hover:text-white transition-colors" aria-label="Close">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>

        {/* Header */}
        <div className="flex items-center gap-4 px-6 pt-6 pb-5 border-b border-white/[0.07]">
          <div
            className="h-14 w-14 shrink-0 rounded-2xl border border-white/10 bg-cover bg-center"
            style={{
              backgroundImage: targetPhotoUrl
                ? `url(${targetPhotoUrl})`
                : "linear-gradient(135deg, rgba(13,204,242,0.25), rgba(217,59,255,0.25))",
            }}
          />
          <div className="min-w-0 pr-20">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
              Start a ConXion with
            </p>
            <h3 className="truncate text-xl font-extrabold tracking-tight text-white leading-tight">
              {targetName}
            </h3>
            <p className="text-[11px] text-white/35 mt-0.5">What&apos;s your intention?</p>
          </div>
        </div>

        <div className="px-5 pt-5 pb-4 space-y-4">
          {/* Self warning */}
          {isSelf && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3">
              <span className="material-symbols-outlined shrink-0 text-[16px] text-amber-300">info</span>
              <p className="text-xs text-amber-200">You can&apos;t send a connection request to yourself.</p>
            </div>
          )}
          {/* Pending warning */}
          {pendingWarning && <PendingRequestBanner message={pendingWarning} />}

          {/* Intent grid — first 6 in 3-col grid, last 2 centered */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {REASONS.slice(0, 6).map((r) => <ReasonCard key={r.id} r={r} selected={selectedReason === r.id} onSelect={setSelectedReason} />)}
            </div>
            <div className="flex justify-center gap-2.5">
              {REASONS.slice(6).map((r) => (
                <div key={r.id} className="w-[calc(33.333%-5px)]">
                  <ReasonCard r={r} selected={selectedReason === r.id} onSelect={setSelectedReason} />
                </div>
              ))}
            </div>
          </div>

          {/* Dynamic preview */}
          {selectedLabel && (
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-2.5">
              <span className="material-symbols-outlined text-[14px] text-[#0df2f2] shrink-0">bolt</span>
              <p className="text-xs text-white/60">
                You want to connect to{" "}
                <span className="font-semibold text-white/90">{selectedLabel.toLowerCase()}</span>
              </p>
            </div>
          )}

          {/* Optional message */}
          {!messageOpen ? (
            <button
              type="button"
              onClick={() => setMessageOpen(true)}
              className="flex items-center gap-1.5 text-xs text-white/35 hover:text-white/60 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              Add a message
            </button>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                  Message (optional)
                </label>
                <span className="text-[10px] text-white/25">{message.length}/220</span>
              </div>
              <textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 220))}
                placeholder="Say something..."
                rows={3}
                className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-white/25 outline-none focus:border-[#0df2f2]/30 focus:bg-white/[0.06] transition"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
              {error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 border-t border-white/[0.07] px-5 py-4">
          <button
            type="button"
            disabled={!selectedReason || sending || Boolean(pendingWarning) || atLimit || isSelf}
            onClick={() => void handleSend()}
            className="h-12 w-full rounded-2xl text-sm font-bold tracking-wide text-[#040a0f] disabled:opacity-40 transition-all hover:brightness-110 hover:scale-[1.01] active:scale-[0.99]"
            style={{ backgroundImage: "linear-gradient(90deg, #0df2f2 0%, #7c3aff 50%, #ff00ff 100%)" }}
          >
            {sending ? "Sending…" : "Start ConXion"}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="h-10 w-full rounded-2xl border border-white/[0.07] text-sm font-medium text-white/35 hover:border-white/15 hover:text-white/60 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
