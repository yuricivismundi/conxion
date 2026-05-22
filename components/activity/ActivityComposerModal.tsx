"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import PendingRequestBanner from "@/components/requests/PendingRequestBanner";
import { cx } from "@/lib/cx";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_ICONS,
  LINKED_MEMBER_ACTIVITY_TYPES,
  activityTypeLabel,
  activityUsesDateRange,
  parseActivityType,
  type ActivityType,
} from "@/lib/activities/types";
import { fetchPendingPairConflictDetails } from "@/lib/requests/pending-pair-client";
import { fetchLinkedConnectionOptions, type LinkedMemberOption } from "@/lib/requests/linked-members";
import { getPlanIdFromMeta, getPlanLimits } from "@/lib/billing/limits";

type ActivityDraft = {
  activityType: ActivityType;
  note: string;
  dateMode: "none" | "set";
  startAt: string;
  endAt: string;
  linkedMemberUserId: string;
};

const DEFAULT_DRAFT: ActivityDraft = {
  activityType: "practice",
  note: "",
  dateMode: "none",
  startAt: "",
  endAt: "",
  linkedMemberUserId: "",
};

const LINKABLE_TYPES = new Set<ActivityType>(LINKED_MEMBER_ACTIVITY_TYPES);

type Props = {
  open: boolean;
  recipientUserId: string;
  recipientName: string;
  recipientAvatarUrl: string | null;
  /** If provided, used as the thread for context-based invites. Leave null for direct invites. */
  threadId?: string | null;
  connectionId?: string | null;
  onClose: () => void;
  /** Called with the resolved thread ID after a successful send */
  onSent: (threadId: string) => void;
};

export default function ActivityComposerModal({
  open,
  recipientUserId,
  recipientName,
  recipientAvatarUrl,
  threadId,
  connectionId,
  onClose,
  onSent,
}: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<ActivityDraft>(DEFAULT_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [pendingWarning, setPendingWarning] = useState<string | null>(null);
  const [pendingThreadToken, setPendingThreadToken] = useState<string | null>(null);
  const [requestsUsed, setRequestsUsed] = useState<number | null>(null);
  const [requestsLimit, setRequestsLimit] = useState<number | null>(null);
  const [linkedOptions, setLinkedOptions] = useState<LinkedMemberOption[]>([]);
  const [linkedPickerOpen, setLinkedPickerOpen] = useState(false);
  const [linkedQuery, setLinkedQuery] = useState("");

  const warningCancelRef = useRef<boolean>(false);

  const usesDateRange = useMemo(() => activityUsesDateRange(draft.activityType), [draft.activityType]);
  const supportsLinkedMember = LINKABLE_TYPES.has(draft.activityType);

  const filteredLinkedOptions = useMemo(() => {
    const q = linkedQuery.toLowerCase();
    return linkedOptions.filter(
      (o) =>
        o.userId !== recipientUserId &&
        (!q || o.displayName.toLowerCase().includes(q) || (o.city ?? "").toLowerCase().includes(q))
    );
  }, [linkedOptions, linkedQuery, recipientUserId]);

  // Load requests quota on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [authData, countRes] = await Promise.all([
          supabase.auth.getUser(),
          supabase
            .from("activities")
            .select("id", { count: "exact", head: true })
            .eq("requester_id", (await supabase.auth.getUser()).data.user?.id ?? "")
            .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
        ]);
        if (cancelled) return;
        const meta = authData.data.user?.user_metadata ?? {};
        const profileRes = await supabase
          .from("profiles")
          .select("verified")
          .eq("user_id", authData.data.user?.id ?? "")
          .maybeSingle();
        const isVerified = (profileRes.data as { verified?: boolean } | null)?.verified === true;
        const planId = getPlanIdFromMeta(meta, isVerified);
        const limits = getPlanLimits(planId);
        if (!cancelled) {
          setRequestsUsed(countRes.count ?? 0);
          setRequestsLimit(limits.activeChatThreadsPerMonth);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Load linked connection options when modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const options = await fetchLinkedConnectionOptions(supabase, recipientUserId);
        if (!cancelled) setLinkedOptions(options);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [open, recipientUserId]);

  // Check for pending pair conflict
  useEffect(() => {
    if (!open || !recipientUserId) return;
    warningCancelRef.current = false;
    (async () => {
      try {
        const details = await fetchPendingPairConflictDetails(recipientUserId);
        if (!warningCancelRef.current) {
          setPendingWarning(details?.message ?? null);
          setPendingThreadToken(details?.threadToken ?? null);
        }
      } catch {
        if (!warningCancelRef.current) { setPendingWarning(null); setPendingThreadToken(null); }
      }
    })();
    return () => { warningCancelRef.current = true; };
  }, [open, recipientUserId]);

  // Clear linked member when switching to non-linkable type
  useEffect(() => {
    if (supportsLinkedMember) return;
    setDraft((prev) => ({ ...prev, linkedMemberUserId: "" }));
    setLinkedPickerOpen(false);
    setLinkedQuery("");
  }, [supportsLinkedMember]);

  // Clear end date when switching date mode or type
  useEffect(() => {
    if (!usesDateRange && draft.endAt) {
      setDraft((prev) => ({ ...prev, endAt: "" }));
    }
  }, [draft.dateMode, draft.endAt, usesDateRange]);

  const close = useCallback(() => {
    if (busy) return;
    setDraft(DEFAULT_DRAFT);
    setError(null);
    setNoteOpen(false);
    setLinkedPickerOpen(false);
    setLinkedQuery("");
    onClose();
  }, [busy, onClose]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const startAt = draft.dateMode === "set" ? draft.startAt || null : null;
      const endAt = draft.dateMode === "set" && usesDateRange ? draft.endAt || null : null;
      if (draft.dateMode === "set" && !startAt) {
        throw new Error(usesDateRange ? "Choose a start date." : "Choose a date.");
      }
      if (draft.dateMode === "set" && usesDateRange && !endAt) {
        throw new Error("Choose an end date.");
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? "";
      if (!accessToken) throw new Error("Not authenticated.");

      const isDirectInvite = !threadId && !connectionId;

      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          threadId: threadId ?? undefined,
          connectionId: connectionId ?? undefined,
          recipientUserId,
          activityType: draft.activityType,
          note: draft.note.trim() || null,
          startAt,
          endAt,
          linkedMemberUserId: supportsLinkedMember ? draft.linkedMemberUserId || null : null,
          ...(isDirectInvite ? { directInvite: true } : {}),
        }),
      });

      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        threadId?: string | null;
        id?: string;
      } | null;

      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to send invite.");

      const resolvedThreadId = typeof json?.threadId === "string" && json.threadId ? json.threadId : threadId;
      if (!resolvedThreadId) throw new Error("Missing thread after invite was sent.");

      setDraft(DEFAULT_DRAFT);
      setNoteOpen(false);
      onClose();
      onSent(resolvedThreadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invite.");
    } finally {
      setBusy(false);
    }
  }, [draft, usesDateRange, threadId, connectionId, recipientUserId, supportsLinkedMember, onSent]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-end justify-center bg-black/70 px-2 py-2 backdrop-blur-md sm:items-center sm:px-3 sm:py-3"
      onClick={close}
    >
      <div
        data-testid="activity-composer-modal"
        className="relative w-full max-w-[520px] overflow-hidden rounded-[28px] border border-white/[0.08] shadow-[0_32px_80px_rgba(0,0,0,0.6)] sm:rounded-[32px]"
        style={{
          background:
            "radial-gradient(circle at 15% 0%, rgba(13,204,242,0.08), transparent 45%), radial-gradient(circle at 85% 100%, rgba(217,59,255,0.08), transparent 45%), #080e14",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top-right cluster */}
        <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            {requestsLimit !== null && requestsUsed !== null && (
              <div className="flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[10px]">
                <span
                  className={
                    requestsUsed >= requestsLimit
                      ? "font-bold text-rose-400"
                      : requestsUsed >= requestsLimit * 0.8
                      ? "font-bold text-amber-400"
                      : "font-semibold text-[#0df2f2]"
                  }
                >
                  {requestsUsed}/{requestsLimit}
                </span>
                <span className="text-white/30">req/mo</span>
              </div>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/40 hover:text-white transition-colors disabled:opacity-40"
              aria-label="Close"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
          {supportsLinkedMember && (filteredLinkedOptions.length > 0 || draft.linkedMemberUserId) && (
            <button
              type="button"
              onClick={() => setLinkedPickerOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/45 hover:text-white/80 transition-colors"
            >
              <span className="material-symbols-outlined text-[13px]">group_add</span>
              Add member
            </button>
          )}
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-4 border-b border-white/[0.07] sm:gap-4 sm:px-6 sm:pt-6 sm:pb-5">
          <div
            className="h-11 w-11 shrink-0 rounded-xl border border-white/10 bg-cover bg-center sm:h-14 sm:w-14 sm:rounded-2xl"
            style={{
              backgroundImage: recipientAvatarUrl
                ? `url(${recipientAvatarUrl})`
                : "linear-gradient(135deg, rgba(13,204,242,0.25), rgba(217,59,255,0.25))",
            }}
          />
          <div className="min-w-0 pr-20 sm:pr-24">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Invite to Activity</p>
            <h3 className="truncate text-lg font-extrabold tracking-tight text-white leading-tight sm:text-xl">{recipientName}</h3>
            <p className="text-[11px] text-white/35 mt-0.5">What would you like to do?</p>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="max-h-[min(55svh,520px)] overflow-y-auto overscroll-contain px-4 pt-3 pb-2 space-y-2.5 sm:max-h-[min(65svh,520px)] sm:px-5 sm:pt-5 sm:pb-4 sm:space-y-4">
          {pendingWarning ? (
            <PendingRequestBanner
              message={pendingWarning}
              ctaHref={
                pendingThreadToken
                  ? `/messages?thread=${pendingThreadToken}`
                  : recipientUserId
                  ? `/messages?to=${recipientUserId}`
                  : "/messages?tab=pending"
              }
              onCtaClick={onClose}
              className="mb-1"
            />
          ) : null}
          {error ? (
            <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">{error}</p>
          ) : null}

          {/* Activity type grid */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ACTIVITY_TYPES.map((type) => {
              const sel = draft.activityType === type;
              const icon = ACTIVITY_TYPE_ICONS[type] ?? "star";
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, activityType: type }))}
                  className={`group relative flex flex-col items-center gap-1 rounded-2xl border px-2 py-2 text-center transition-all duration-150 sm:gap-1.5 sm:py-3 ${
                    sel
                      ? "border-[#0df2f2]/40 bg-gradient-to-br from-[#0df2f2]/10 to-[#d93bff]/10 shadow-[0_0_16px_rgba(13,204,242,0.12)]"
                      : "border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"
                  }`}
                >
                  {sel && <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-[#0df2f2]/30" />}
                  <span
                    className={`material-symbols-outlined text-[17px] transition-colors sm:text-[20px] ${sel ? "text-[#0df2f2]" : "text-white/40 group-hover:text-white/60"}`}
                    style={{ fontVariationSettings: sel ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {icon}
                  </span>
                  <span className={`text-[10px] font-semibold leading-tight transition-colors ${sel ? "text-white" : "text-white/55 group-hover:text-white/80"}`}>
                    {activityTypeLabel(type)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Linked member picker */}
          {supportsLinkedMember && (draft.linkedMemberUserId || linkedPickerOpen) ? (
            <div className="space-y-2">
              {draft.linkedMemberUserId ? (() => {
                const member = linkedOptions.find((o) => o.userId === draft.linkedMemberUserId);
                return (
                  <div className="flex items-center gap-3 rounded-2xl border border-[#0df2f2]/20 bg-[linear-gradient(90deg,rgba(13,204,242,0.08),rgba(217,59,255,0.06))] px-3 py-2.5">
                    {member?.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={member.avatarUrl} alt={member.displayName} className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-[#0df2f2]/30" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(13,204,242,0.25),rgba(217,59,255,0.25))] ring-2 ring-[#0df2f2]/20 text-[#0df2f2]">
                        <span className="material-symbols-outlined text-[18px]">person</span>
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#0df2f2]/60">Added member</p>
                      <p className="truncate text-sm font-black text-white">{member?.displayName ?? "Connection"}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, linkedMemberUserId: "" }))}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/40 transition hover:border-rose-400/30 hover:bg-rose-400/10 hover:text-rose-400"
                      aria-label="Remove member"
                    >
                      <span className="material-symbols-outlined text-[15px]">close</span>
                    </button>
                  </div>
                );
              })() : null}
              {linkedPickerOpen ? (
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 space-y-2">
                  <input
                    type="text"
                    value={linkedQuery}
                    onChange={(e) => setLinkedQuery(e.target.value)}
                    placeholder="Search connection…"
                    className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-[#0df2f2]/30 transition"
                  />
                  <div className="max-h-40 space-y-1.5 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, linkedMemberUserId: "" }))}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${!draft.linkedMemberUserId ? "border-[#0df2f2]/30 bg-[#0df2f2]/8 text-white" : "border-white/[0.07] bg-transparent text-white/60 hover:text-white"}`}
                    >
                      <span>No companion</span>
                      {!draft.linkedMemberUserId ? <span className="material-symbols-outlined text-[15px] text-[#0df2f2]">check</span> : null}
                    </button>
                    {filteredLinkedOptions.map((option) => {
                      const isSelected = draft.linkedMemberUserId === option.userId;
                      return (
                        <button
                          key={option.userId}
                          type="button"
                          onClick={() => { setDraft((prev) => ({ ...prev, linkedMemberUserId: option.userId })); setLinkedPickerOpen(false); setLinkedQuery(""); }}
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${isSelected ? "border-[#0df2f2]/30 bg-[#0df2f2]/8 text-white" : "border-white/[0.07] bg-transparent text-white/70 hover:text-white"}`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{option.displayName}</span>
                            {[option.city, option.country].filter(Boolean).join(", ") ? (
                              <span className="block truncate text-xs text-white/35">{[option.city, option.country].filter(Boolean).join(", ")}</span>
                            ) : null}
                          </span>
                          {isSelected ? <span className="material-symbols-outlined text-[15px] text-[#0df2f2]">check</span> : null}
                        </button>
                      );
                    })}
                    {filteredLinkedOptions.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-white/35">No matching connections.</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Date */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, dateMode: "set" }))}
                className={`rounded-xl border px-3 py-2 text-[12px] font-semibold transition ${draft.dateMode === "set" ? "border-[#0df2f2]/40 bg-[#0df2f2]/10 text-white" : "border-white/[0.07] bg-white/[0.03] text-white/55 hover:border-white/15"}`}
              >
                Set date
              </button>
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, dateMode: "none", startAt: "", endAt: "" }))}
                className={`rounded-xl border px-3 py-2 text-[12px] font-semibold transition ${draft.dateMode === "none" ? "border-[#0df2f2]/40 bg-[#0df2f2]/10 text-white" : "border-white/[0.07] bg-white/[0.03] text-white/55 hover:border-white/15"}`}
              >
                No date
              </button>
            </div>
            {draft.dateMode === "set" && (
              <div className={`grid gap-3 ${usesDateRange ? "grid-cols-2" : "grid-cols-1"}`}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-white/40">calendar_today</span>
                  <input
                    type="date"
                    value={draft.startAt}
                    onChange={(e) => setDraft((prev) => ({ ...prev, startAt: e.target.value }))}
                    className="dark-calendar-input w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-[#0df2f2]/30 transition"
                  />
                </div>
                {usesDateRange && (
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-white/40">calendar_today</span>
                    <input
                      type="date"
                      value={draft.endAt}
                      onChange={(e) => setDraft((prev) => ({ ...prev, endAt: e.target.value }))}
                      className="dark-calendar-input w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-[#0df2f2]/30 transition"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Note */}
          {!noteOpen ? (
            <button type="button" onClick={() => setNoteOpen(true)} className="flex items-center gap-1.5 text-xs text-white/35 hover:text-white/60 transition-colors">
              <span className="material-symbols-outlined text-[14px]">add</span>
              Add a note
            </button>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Note (optional)</label>
                <span className="text-[10px] text-white/25">{draft.note.length}/600</span>
              </div>
              <textarea
                autoFocus
                rows={2}
                maxLength={600}
                value={draft.note}
                onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
                placeholder="Add context, timing, or what you want to do together."
                className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-[#0df2f2]/30 focus:bg-white/[0.06] transition sm:px-4 sm:py-3 sm:rows-3"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-1.5 border-t border-white/[0.07] px-4 py-3 sm:gap-2 sm:px-5 sm:py-4">
          <button
            type="button"
            disabled={busy || Boolean(pendingWarning)}
            onClick={() => void submit()}
            className="h-11 w-full rounded-2xl text-sm font-bold tracking-wide text-[#040a0f] disabled:opacity-40 transition-all hover:brightness-110 hover:scale-[1.01] active:scale-[0.99] sm:h-12"
            style={{ backgroundImage: "linear-gradient(90deg, #0df2f2 0%, #7c3aff 50%, #ff00ff 100%)" }}
          >
            {busy ? "Sending…" : "Send invite"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="h-9 w-full rounded-2xl border border-white/[0.07] text-sm font-medium text-white/35 hover:border-white/15 hover:text-white/60 transition-colors disabled:opacity-40 sm:h-10"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
