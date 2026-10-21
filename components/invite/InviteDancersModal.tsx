"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { INVITES_PER_REQUEST, INVITE_NOTE_MAX_CHARS, parseInviteEmails } from "@/lib/invites/limits";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type Props = {
  open: boolean;
  onClose: () => void;
};

const SHARE_TEXT = "Join me on ConXion, the community app for social dancers. Free during early access:";

const SKIP_LABELS: Record<string, string> = {
  invalid: "not a valid email",
  self: "that's your own email",
  recently_invited: "already invited recently",
  daily_limit: "daily invite limit reached",
  send_failed: "couldn't be sent",
};

export default function InviteDancersModal({ open, onClose }: Props) {
  useBodyScrollLock(open);
  const [copied, setCopied] = useState(false);
  const [emailsInput, setEmailsInput] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);

  const inviteUrl = useMemo(() => (typeof window !== "undefined" ? `${window.location.origin}/` : "https://conxion.app/"), []);
  const emails = useMemo(() => parseInviteEmails(emailsInput), [emailsInput]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    // The system share sheet is great on phones but nearly empty on desktop browsers.
    setCanNativeShare(
      typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        window.matchMedia("(pointer: coarse)").matches
    );
    void supabase.auth.getSession().then(({ data }) => setIsLoggedIn(Boolean(data.session)));
  }, [open]);

  if (!open) return null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setResult({ tone: "error", text: "Couldn't copy. Select the link and copy it manually." });
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: "Join me on ConXion", text: SHARE_TEXT, url: inviteUrl });
    } catch {
      /* cancelled */
    }
  }

  async function sendInvites() {
    if (emails.length === 0 || sending) return;
    if (emails.length > INVITES_PER_REQUEST) {
      setResult({ tone: "error", text: `You can invite up to ${INVITES_PER_REQUEST} people at a time.` });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ emails, note }),
      });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; sent?: string[]; skipped?: Array<{ email: string; reason: string }> }
        | null;
      if (!response.ok || !json?.ok) {
        setResult({ tone: "error", text: json?.error ?? "Couldn't send invites. Try again." });
        return;
      }
      const sentCount = json.sent?.length ?? 0;
      const skippedText = (json.skipped ?? [])
        .map((s) => `${s.email} (${SKIP_LABELS[s.reason] ?? s.reason})`)
        .join(", ");
      setResult({
        tone: sentCount > 0 ? "ok" : "error",
        text: [
          sentCount > 0 ? `Invite${sentCount === 1 ? "" : "s"} sent to ${sentCount} ${sentCount === 1 ? "person" : "people"}.` : "No invites sent.",
          skippedText ? `Skipped: ${skippedText}.` : "",
        ].filter(Boolean).join(" "),
      });
      if (sentCount > 0) {
        setEmailsInput("");
        setNote("");
      }
    } catch {
      setResult({ tone: "error", text: "Couldn't send invites. Check your connection and try again." });
    } finally {
      setSending(false);
    }
  }

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT} ${inviteUrl}`)}`;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/72 px-3 py-3 backdrop-blur-md sm:items-center sm:px-6"
      role="dialog"
      aria-modal="true"
      aria-label="Invite dancers"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-[30px] border border-white/12 bg-[linear-gradient(170deg,rgba(8,16,22,0.98),rgba(15,10,24,0.96))] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.45)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black tracking-tight text-white">Invite dancers</h2>
            <p className="mt-1 text-sm text-slate-400">The more dancers join, the more socials, trips and hosts you&apos;ll find.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/75 hover:bg-white/[0.08]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Link */}
        <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Your invite link</p>
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white/80">
            {inviteUrl.replace(/^https?:\/\//, "")}
          </div>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 text-sm font-semibold text-[#06121a] hover:brightness-110"
          >
            <span className="material-symbols-outlined text-[16px]">{copied ? "check" : "content_copy"}</span>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Quick share */}
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-4 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/20"
          >
            <span className="material-symbols-outlined text-[16px]">chat</span>
            WhatsApp
          </a>
          {canNativeShare ? (
            <button
              type="button"
              onClick={() => void nativeShare()}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 text-sm font-semibold text-white hover:bg-white/[0.08]"
            >
              <span className="material-symbols-outlined text-[16px]">ios_share</span>
              More apps
            </button>
          ) : null}
        </div>

        {/* Email */}
        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Invite by email</p>
          {isLoggedIn === false ? (
            <p className="mt-2 text-sm text-slate-400">
              <Link href="/auth?mode=login" className="font-semibold text-cyan-300 hover:underline">Log in</Link> to send email invites.
            </p>
          ) : (
            <>
              <textarea
                rows={2}
                value={emailsInput}
                onChange={(event) => setEmailsInput(event.target.value)}
                placeholder="friend@email.com, partner@email.com"
                className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
              />
              <input
                value={note}
                maxLength={INVITE_NOTE_MAX_CHARS}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add a personal note (optional)"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Up to {INVITES_PER_REQUEST} at a time. One email per person.</p>
                <button
                  type="button"
                  onClick={() => void sendInvites()}
                  disabled={emails.length === 0 || sending}
                  className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-bold text-[#06121a] hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[16px]">send</span>
                  {sending ? "Sending…" : emails.length > 1 ? `Send ${emails.length} invites` : "Send invite"}
                </button>
              </div>
            </>
          )}
          {result ? (
            <p
              className={`mt-3 rounded-2xl border px-3 py-2.5 text-sm ${
                result.tone === "ok"
                  ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
                  : "border-rose-300/25 bg-rose-400/10 text-rose-100"
              }`}
            >
              {result.text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
