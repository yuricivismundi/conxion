"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getPlanLimits } from "@/lib/billing/limits";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type ConnectReason = {
  id: string;
  label: string;
  role: string;
  sort_order?: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  targetUserId: string;
  targetName: string;
  targetPhotoUrl?: string | null;
  connectContext?: "member" | "traveller";
  tripId?: string | null;
};

function MSIcon({ name, className }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className ?? ""}`}>{name}</span>;
}

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

  const [reasons, setReasons] = useState<ConnectReason[]>([]);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [reasonQuery, setReasonQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingWarning, setPendingWarning] = useState<string | null>(null);
  const [requestsUsed, setRequestsUsed] = useState<number | null>(null);
  const [requestsLimit, setRequestsLimit] = useState<number | null>(null);

  // Check for existing pending request when modal opens
  useEffect(() => {
    if (!open || !targetUserId) return;
    setPendingWarning(null);

    (async () => {
      try {
        const { data: authUser } = await supabase.auth.getUser();
        const userId = authUser?.user?.id;
        if (!userId) return;

        const { data: existing } = await supabase
          .from("connections")
          .select("id,status,requester_id")
          .or(
            `and(requester_id.eq.${userId},target_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},target_id.eq.${userId})`
          )
          .limit(1)
          .maybeSingle();

        if (existing?.status === "pending") {
          const direction = existing.requester_id === userId ? "You already sent" : "You received";
          setPendingWarning(`${direction} a pending connection request with this member.`);
        } else if (existing?.status === "accepted") {
          setPendingWarning("You are already connected with this member.");
        }
      } catch {}
    })();
  }, [open, targetUserId]);

  // Fetch connect reasons when modal opens
  useEffect(() => {
    if (!open) return;
    setSelectedReason(null);
    setReasonQuery("");
    setError(null);

    (async () => {
      try {
        const contexts =
          connectContext === "traveller"
            ? ["traveller", "trip", "member"]
            : ["member"];
        const { data, error: err } = await supabase
          .from("connect_reasons")
          .select("id,label,role,sort_order")
          .eq("active", true)
          .in("context", contexts)
          .order("sort_order");
        if (!err) setReasons(data ?? []);
      } catch {
        setReasons([]);
      }
    })();
  }, [open, connectContext]);

  // Fetch usage counters when modal opens
  useEffect(() => {
    if (!open) return;

    (async () => {
      try {
        const { data: authUser } = await supabase.auth.getUser();
        const user = authUser?.user;
        if (!user) return;

        const meta = user.user_metadata ?? {};
        const isPro = meta.billing_plan === "pro" || meta.subscription_status === "active";
        const planId = isPro ? "pro" : "starter";
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

  const selectedReasonObj = useMemo(
    () => reasons.find((r) => r.id === selectedReason) ?? null,
    [selectedReason, reasons]
  );

  const visibleReasons = useMemo(() => {
    const q = reasonQuery.trim().toLowerCase();
    return reasons
      .filter((r) => {
        if (!q) return true;
        return `${r.label} ${r.role}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.label.localeCompare(b.label));
  }, [reasonQuery, reasons]);

  const handleClose = useCallback(() => {
    if (sending) return;
    setSelectedReason(null);
    setReasonQuery("");
    setError(null);
    onClose();
  }, [sending, onClose]);

  async function handleSend() {
    if (!selectedReason || sending) return;

    try {
      setSending(true);
      setError(null);

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? "";

      if (authError || !user) throw authError ?? new Error("Not authenticated");
      if (!accessToken) throw new Error("Missing auth session token");

      // Check existing connection
      const { data: existing, error: existingErr } = await supabase
        .from("connections")
        .select("id,status,requester_id,target_id")
        .or(
          `and(requester_id.eq.${user.id},target_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},target_id.eq.${user.id})`
        )
        .limit(1)
        .maybeSingle();

      if (existingErr) throw existingErr;

      if (existing?.status === "accepted" || existing?.status === "pending") {
        if (existing.status === "accepted" && existing.id) {
          handleClose();
          router.push(`/messages/${existing.id}`);
          return;
        }
        throw new Error("There is already a pending connection request with this member. Open Requests in Messages to continue.");
      }

      // Create request
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
            connect_reason_role: selectedReasonObj?.role ?? null,
            trip_id: tripId,
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Failed to create connection request");
      }

      handleClose();
      router.push("/messages?tab=requests");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to send request.";
      setError(
        message.includes("Failed to fetch")
          ? "Network issue while sending request. Check your connection and retry."
          : message
      );
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-md sm:items-center">
      <div
        className="relative w-full max-w-[480px] overflow-hidden rounded-[28px] border border-white/8 bg-[#080e14] shadow-[0_32px_80px_rgba(0,0,0,0.5)] sm:rounded-[32px]"
        style={{ background: "radial-gradient(circle at top left, rgba(13,204,242,0.07), transparent 40%), radial-gradient(circle at bottom right, rgba(217,59,255,0.07), transparent 40%), #080e14" }}
      >
        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/50 hover:text-white transition"
          aria-label="Close"
        >
          <MSIcon name="close" className="text-[18px]" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-4 px-6 pt-6 pb-5 border-b border-white/8">
          <div className="shrink-0">
            <div
              className="h-14 w-14 rounded-2xl overflow-hidden border border-white/10"
              style={{
                backgroundImage: targetPhotoUrl
                  ? `url(${targetPhotoUrl})`
                  : "linear-gradient(135deg, rgba(13,204,242,0.3), rgba(217,59,255,0.3))",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Connect with</p>
            <h3 className="truncate text-lg font-extrabold tracking-tight text-white">{targetName}</h3>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Pending request warning */}
          {pendingWarning && (
            <div className="flex items-center gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-200">
              <span className="material-symbols-outlined text-[16px] text-amber-400 shrink-0">warning</span>
              <span>{pendingWarning}</span>
            </div>
          )}

          {/* Usage counter */}
          {requestsLimit !== null && requestsUsed !== null && (
            <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5 text-xs">
              <span className="text-white/40">Requests this month</span>
              <span className={
                requestsUsed >= requestsLimit
                  ? "font-bold text-rose-400"
                  : requestsUsed >= requestsLimit * 0.8
                    ? "font-bold text-amber-400"
                    : "font-semibold text-[#0df2f2]"
              }>
                {requestsUsed} / {requestsLimit}
              </span>
            </div>
          )}

          {/* Reason — menu with optional search */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Reason to connect</label>
            <div className="relative mt-2">
              <span className="material-symbols-outlined pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[17px] text-white/25">search</span>
              <input
                value={reasonQuery}
                onChange={(e) => {
                  setReasonQuery(e.target.value);
                  setSelectedReason(null);
                }}
                placeholder="Filter reasons..."
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-4 py-2.5 text-sm text-white outline-none focus:border-[#0df2f2]/40 focus:bg-white/[0.06] transition"
              />
            </div>
            <div className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-[#0b1219]">
              {visibleReasons.length === 0 ? (
                <p className="px-4 py-3 text-sm text-white/40">No matches</p>
              ) : (
                visibleReasons.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelectedReason(r.id);
                      setReasonQuery("");
                    }}
                    className={`w-full px-4 py-2.5 text-left text-sm transition flex items-center justify-between gap-3 ${
                      selectedReason === r.id
                        ? "bg-[#0df2f2]/10 text-[#0df2f2]"
                        : "text-white/80 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <span>{r.label}</span>
                    <span className="shrink-0 text-[11px] text-white/30">{r.role}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-rose-400">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 border-t border-white/8 px-6 py-5">
          <button
            type="button"
            disabled={!selectedReason || sending}
            onClick={() => void handleSend()}
            className="w-full h-13 rounded-2xl font-bold text-sm text-[#040a0f] disabled:opacity-40 transition hover:brightness-110"
            style={{ backgroundImage: "linear-gradient(90deg,#0df2f2 0%, #ff00ff 100%)" }}
          >
            {sending ? "Sending..." : "Send Request"}
          </button>

          <button
            type="button"
            onClick={handleClose}
            className="w-full h-10 rounded-2xl border border-white/8 text-white/40 text-sm font-medium hover:text-white/70 hover:border-white/15 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
