"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PendingRequestBanner from "@/components/requests/PendingRequestBanner";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { fetchPendingPairConflict } from "@/lib/requests/pending-pair-client";
import { supabase } from "@/lib/supabase/client";
import type { ServiceInquiryKind } from "@/lib/service-inquiries/types";

type RequestInfoModalProps = {
  open: boolean;
  recipientUserId: string;
  recipientName: string;
  recipientPhotoUrl?: string | null;
  onClose: () => void;
  onSubmitted?: (message: string) => void;
};

const NOTE_LIMIT = 220;
type InquiryUsage = { used: number; limit: number; remaining: number };

const VISIBLE_KINDS: Array<{ id: ServiceInquiryKind; label: string; icon: string }> = [
  { id: "private_class",    label: "Private classes",  icon: "school"        },
  { id: "group_class",      label: "Group classes",    icon: "groups"        },
  { id: "workshop",         label: "Workshop",         icon: "construction"  },
  { id: "organizer_collab", label: "Collaboration",    icon: "handshake"     },
  { id: "other",            label: "Other",            icon: "bolt"          },
];

function KindCard({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string;
  icon: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
        {icon}
      </span>
      <span className={`text-[12px] font-semibold leading-tight transition-colors ${selected ? "text-white" : "text-white/55 group-hover:text-white/80"}`}>
        {label}
      </span>
    </button>
  );
}

export default function RequestInfoModal({
  open,
  recipientUserId,
  recipientName,
  recipientPhotoUrl,
  onClose,
  onSubmitted,
}: RequestInfoModalProps) {
  useBodyScrollLock(open);
  const pendingWarningRequestIdRef = useRef(0);

  const [kind, setKind] = useState<ServiceInquiryKind>("private_class");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [requestedDatesText, setRequestedDatesText] = useState("");
  const [shortNote, setShortNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingWarning, setPendingWarning] = useState<string | null>(null);
  const [usage, setUsage] = useState<InquiryUsage | null>(null);
  const [isSelf, setIsSelf] = useState(false);

  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  // Reset on open + detect self
  useEffect(() => {
    if (!open) return;
    setKind("private_class");
    setCity("");
    setCountry("");
    setRequestedDatesText("");
    setShortNote("");
    setError(null);
    setPendingWarning(null);
    void supabase.auth.getUser().then(({ data }) => {
      setIsSelf(!!data.user && data.user.id === recipientUserId);
    });
  }, [open, recipientUserId]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++pendingWarningRequestIdRef.current;
    const canCommit = () => !cancelled && pendingWarningRequestIdRef.current === requestId;
    if (!open || !recipientUserId) {
      setPendingWarning(null);
      return;
    }
    void fetchPendingPairConflict(recipientUserId)
      .then((warning) => { if (canCommit()) setPendingWarning(warning); })
      .catch(() => { if (canCommit()) setPendingWarning(null); });
    return () => { cancelled = true; };
  }, [open, recipientUserId]);

  useEffect(() => {
    let cancelled = false;
    if (!open) { setUsage(null); return; }
    (async () => {
      try {
        const sessionRes = await supabase.auth.getSession();
        const accessToken = sessionRes.data.session?.access_token ?? "";
        if (!accessToken) return;
        const res = await fetch("/api/service-inquiries/usage", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = (await res.json().catch(() => null)) as { ok?: boolean; used?: number; limit?: number; remaining?: number } | null;
        if (!cancelled && res.ok && result?.ok) {
          setUsage({ used: result.used ?? 0, limit: result.limit ?? 5, remaining: result.remaining ?? 0 });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const remaining = useMemo(() => NOTE_LIMIT - shortNote.length, [shortNote.length]);
  const atLimit = Boolean(usage && usage.remaining <= 0);

  async function submitInquiry() {
    if (busy || isSelf) return;
    if (!shortNote.trim()) {
      setError("Please add a note so the teacher has context for your request.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token ?? "";
      if (!accessToken) throw new Error("Please sign in to send a request.");

      const response = await fetch("/api/service-inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          recipientUserId,
          inquiryKind: kind,
          requesterType: "individual",
          requesterMessage: shortNote.trim() || null,
          city: city.trim() || null,
          country: country.trim() || null,
          requestedDatesText: requestedDatesText.trim() || null,
        }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Could not send the request.");

      handleClose();
      onSubmitted?.("Teaching inquiry sent.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-md sm:items-center">
      <div
        className="relative flex max-h-[min(92svh,740px)] w-full max-w-[520px] flex-col overflow-hidden rounded-[28px] border border-white/[0.08] shadow-[0_32px_80px_rgba(0,0,0,0.6)] sm:rounded-[32px]"
        style={{
          background:
            "radial-gradient(circle at 15% 0%, rgba(13,204,242,0.08), transparent 45%), radial-gradient(circle at 85% 100%, rgba(217,59,255,0.08), transparent 45%), #080e14",
        }}
      >
        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/40 transition-colors hover:text-white"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>

        {/* Header */}
        <div className="flex items-center gap-4 border-b border-white/[0.07] px-6 pb-5 pt-6">
          <div
            className="h-14 w-14 shrink-0 rounded-2xl border border-white/10 bg-cover bg-center"
            style={{
              backgroundImage: recipientPhotoUrl
                ? `url(${recipientPhotoUrl})`
                : "linear-gradient(135deg, rgba(13,204,242,0.25), rgba(217,59,255,0.25))",
            }}
          />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Request info from</p>
            <h2 className="truncate text-xl font-extrabold leading-tight tracking-tight text-white">{recipientName}</h2>
            <p className="mt-0.5 text-[11px] text-white/35">What are you interested in?</p>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-4 pt-5">
          {pendingWarning ? <PendingRequestBanner message={pendingWarning} className="-mt-1" /> : null}

          {usage ? (
            <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-2 text-xs">
              <span className="text-white/35">Info requests left this month</span>
              <span className={usage.remaining <= 0 ? "font-bold text-rose-400" : usage.remaining === 1 ? "font-bold text-amber-400" : "font-semibold text-[#0df2f2]"}>
                {usage.remaining} / {usage.limit}
              </span>
            </div>
          ) : null}

          {/* Self-request warning */}
          {isSelf ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3">
              <span className="material-symbols-outlined shrink-0 text-[16px] text-amber-300">info</span>
              <p className="text-xs text-amber-200">You can&apos;t send a request to yourself.</p>
            </div>
          ) : null}

          {/* Kind grid — 3 top row, 2 bottom centred at same width */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-3 gap-2.5">
              {VISIBLE_KINDS.slice(0, 3).map((k) => (
                <KindCard key={k.id} label={k.label} icon={k.icon} selected={kind === k.id} onClick={() => setKind(k.id)} />
              ))}
            </div>
            <div className="flex justify-center gap-2.5">
              {VISIBLE_KINDS.slice(3).map((k) => (
                <div key={k.id} style={{ width: "calc((100% - 20px) / 3)" }}>
                  <KindCard label={k.label} icon={k.icon} selected={kind === k.id} onClick={() => setKind(k.id)} />
                </div>
              ))}
            </div>
          </div>

          {/* City + Country row */}
          <div className="grid grid-cols-2 gap-2.5">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-[#0df2f2]/30 focus:bg-white/[0.06]"
            />
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Country"
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-[#0df2f2]/30 focus:bg-white/[0.06]"
            />
          </div>

          {/* Date */}
          <input
            value={requestedDatesText}
            onChange={(e) => setRequestedDatesText(e.target.value)}
            placeholder="Dates (e.g. next month, 12–14 April)"
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-[#0df2f2]/30 focus:bg-white/[0.06]"
          />

          {/* Note — mandatory */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                Your note <span className="text-[#0df2f2]/60">*</span>
              </label>
              <span className="text-[10px] text-white/25">{Math.max(0, remaining)}/{NOTE_LIMIT}</span>
            </div>
            <textarea
              value={shortNote}
              onChange={(e) => setShortNote(e.target.value.slice(0, NOTE_LIMIT))}
              placeholder="Give the teacher context — what you're looking for, your level, availability…"
              rows={3}
              className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-[#0df2f2]/30 focus:bg-white/[0.06]"
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">{error}</p>
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 border-t border-white/[0.07] px-5 py-4">
          <button
            type="button"
            onClick={() => void submitInquiry()}
            disabled={busy || Boolean(pendingWarning) || atLimit || isSelf}
            className="h-12 w-full rounded-2xl text-sm font-bold tracking-wide text-[#040a0f] transition-all hover:brightness-110 hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundImage: "linear-gradient(90deg, #0df2f2 0%, #7c3aff 50%, #ff00ff 100%)" }}
          >
            {busy ? "Sending…" : "Request info"}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="h-10 w-full rounded-2xl border border-white/[0.07] text-sm font-medium text-white/35 transition-colors hover:border-white/15 hover:text-white/60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
