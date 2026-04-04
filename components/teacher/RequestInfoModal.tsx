"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PendingRequestBanner from "@/components/requests/PendingRequestBanner";
import { fetchPendingPairConflict } from "@/lib/requests/pending-pair-client";
import { supabase } from "@/lib/supabase/client";
import {
  SERVICE_INQUIRY_KIND_LABELS,
  SERVICE_INQUIRY_KINDS,
  type ServiceInquiryKind,
  type ServiceInquiryRequesterType,
} from "@/lib/service-inquiries/types";

type RequestInfoModalProps = {
  open: boolean;
  recipientUserId: string;
  recipientName: string;
  onClose: () => void;
  onSubmitted?: (message: string) => void;
};

const NOTE_LIMIT = 220;
type InquiryUsage = { used: number; limit: number; remaining: number };

export default function RequestInfoModal({
  open,
  recipientUserId,
  onClose,
  onSubmitted,
}: RequestInfoModalProps) {
  const pendingWarningRequestIdRef = useRef(0);
  const [kind, setKind] = useState<ServiceInquiryKind>("private_class");
  const [shortNote, setShortNote] = useState("");
  const [city, setCity] = useState("");
  const [requestedDatesText, setRequestedDatesText] = useState("");
  const [requesterType, setRequesterType] = useState<ServiceInquiryRequesterType>("individual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingWarning, setPendingWarning] = useState<string | null>(null);
  const [usage, setUsage] = useState<InquiryUsage | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPendingWarning() {
      const requestId = ++pendingWarningRequestIdRef.current;
      const canCommit = () => !cancelled && pendingWarningRequestIdRef.current === requestId;
      if (!open || !recipientUserId) {
        if (canCommit()) setPendingWarning(null);
        return;
      }

      setError(null);
      setBusy(false);

      try {
        const warning = await fetchPendingPairConflict(recipientUserId);
        if (canCommit()) setPendingWarning(warning);
      } catch {
        if (canCommit()) setPendingWarning(null);
      }
    }

    void loadPendingWarning();

    return () => {
      cancelled = true;
    };
  }, [open, recipientUserId]);

  useEffect(() => {
    let cancelled = false;

    async function loadUsage() {
      if (!open) {
        if (!cancelled) setUsage(null);
        return;
      }
      try {
        const sessionRes = await supabase.auth.getSession();
        const accessToken = sessionRes.data.session?.access_token ?? "";
        if (!accessToken) {
          if (!cancelled) setUsage(null);
          return;
        }
        const response = await fetch("/api/service-inquiries/usage", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const result = (await response.json().catch(() => null)) as
          | { ok?: boolean; used?: number; limit?: number; remaining?: number }
          | null;
        if (!cancelled && response.ok && result?.ok) {
          setUsage({
            used: typeof result.used === "number" ? result.used : 0,
            limit: typeof result.limit === "number" ? result.limit : 5,
            remaining: typeof result.remaining === "number" ? result.remaining : 0,
          });
        }
      } catch {
        if (!cancelled) setUsage(null);
      }
    }

    void loadUsage();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const remaining = useMemo(() => NOTE_LIMIT - shortNote.length, [shortNote.length]);

  async function submitInquiry() {
    if (busy) return;
    if (!shortNote.trim()) {
      setError("Please add a short note so the teacher has context.");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token ?? "";
      if (!accessToken) {
        throw new Error("Please sign in to send a request.");
      }

      const response = await fetch("/api/service-inquiries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          recipientUserId,
          inquiryKind: kind,
          requesterType,
          requesterMessage: shortNote,
          city,
          requestedDatesText,
        }),
      });

      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Could not send the request.");
      }

      setShortNote("");
      setCity("");
      setRequestedDatesText("");
      setRequesterType("individual");
      setKind("private_class");
      onClose();
      onSubmitted?.("Teaching inquiry sent.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 px-3 py-4 backdrop-blur sm:items-center">
      <div className="flex max-h-[min(92svh,760px)] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border border-white/12 bg-[#071017] shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="mt-1 text-xl font-bold text-white">Teaching services request</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 overscroll-contain">
          {pendingWarning ? (
            <PendingRequestBanner
              message={pendingWarning}
              className="-mt-1"
            />
          ) : null}
          {usage ? (
            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/8 px-4 py-3 text-sm text-cyan-50">
              Info requests left this month: <span className="font-semibold">{usage.remaining}</span> of {usage.limit}
            </div>
          ) : null}

          <div>
            <p className="text-sm font-semibold text-white">What are you interested in?</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {SERVICE_INQUIRY_KINDS.map((value) => {
                const active = kind === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setKind(value)}
                    className={[
                      "rounded-2xl border px-4 py-3 text-left transition-colors",
                      active
                        ? "border-cyan-300/35 bg-cyan-300/14 text-cyan-50"
                        : "border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    <span className="block text-sm font-semibold">{SERVICE_INQUIRY_KIND_LABELS[value]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-white">Requester type</span>
              <select
                value={requesterType}
                onChange={(event) => setRequesterType(event.target.value as ServiceInquiryRequesterType)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none ring-0"
              >
                <option value="individual">Individual</option>
                <option value="organizer">Organizer</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-white">City</span>
              <input
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Tallinn"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none"
              />
            </label>
          </div>

          <label className="block">
                <span className="text-sm font-semibold text-white">Requested dates</span>
            <input
              value={requestedDatesText}
              onChange={(event) => setRequestedDatesText(event.target.value)}
              placeholder="Next month, 12-14 April, or flexible"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none"
            />
          </label>

          <label className="block">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-white">Short note *</span>
              <span className={`text-xs ${remaining < 0 ? "text-rose-200" : "text-slate-400"}`}>{Math.max(0, remaining)}/{NOTE_LIMIT}</span>
            </div>
            <textarea
              value={shortNote}
              onChange={(event) => setShortNote(event.target.value.slice(0, NOTE_LIMIT))}
              maxLength={NOTE_LIMIT}
              rows={4}
              placeholder="Looking for 2 private bachata classes in Tallinn next month."
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-white placeholder:text-slate-500 outline-none"
            />
          </label>

          {error ? <div className="rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/12 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submitInquiry()}
            disabled={busy || remaining < 0 || !shortNote.trim() || Boolean(pendingWarning)}
            className="rounded-2xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-3 text-sm font-semibold text-[#06121a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Sending..." : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}
