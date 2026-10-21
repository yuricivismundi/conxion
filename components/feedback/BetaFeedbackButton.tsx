"use client";

import { BETA_WHATSAPP_URL } from "@/lib/community";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

const HIDDEN_PREFIXES = ["/auth", "/onboarding", "/admin"];

type Kind = "bug" | "idea" | "other";

const KIND_OPTIONS: Array<{ value: Kind; label: string; icon: string }> = [
  { value: "bug", label: "Something's broken", icon: "bug_report" },
  { value: "idea", label: "Idea", icon: "lightbulb" },
  { value: "other", label: "Other", icon: "chat" },
];

export default function BetaFeedbackButton() {
  const pathname = usePathname() ?? "/";
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const hidden = pathname === "/" || HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!signedIn || hidden) return null;

  async function submit() {
    if (sending || message.trim().length < 3) return;
    setSending(true);
    setStatus(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ kind, message, pageUrl: window.location.href }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !json?.ok) {
        setStatus({ tone: "error", text: json?.error ?? "Couldn't send. Try again." });
        return;
      }
      setMessage("");
      setStatus({ tone: "ok", text: "Thank you! Yuri reads every message and will follow up." });
    } catch {
      setStatus({ tone: "error", text: "Couldn't send. Check your connection and try again." });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStatus(null);
          setOpen(true);
        }}
        className="fixed bottom-24 right-3 z-[55] inline-flex items-center gap-1.5 rounded-full border border-fuchsia-300/30 bg-[#12101a]/90 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-fuchsia-100 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md transition hover:bg-[#1c1628] md:bottom-5 md:right-5"
        aria-label="Send beta feedback"
      >
        <span className="material-symbols-outlined text-[15px]">campaign</span>
        Beta · Feedback
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[96] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-md sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Beta feedback"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-[440px] rounded-[28px] border border-white/12 bg-[linear-gradient(170deg,rgba(8,16,22,0.98),rgba(15,10,24,0.96))] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-200/80">Public beta</p>
                <h2 className="mt-1 text-xl font-black tracking-tight text-white">Help us make ConXion better</h2>
                <p className="mt-1 text-sm text-slate-400">Found a bug or have an idea? Tell us. Every message is read.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/75 hover:bg-white/[0.08]"
                aria-label="Close"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {KIND_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setKind(option.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    kind === option.value
                      ? "border-transparent bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-[#06121a]"
                      : "border-white/10 bg-white/[0.03] text-slate-300 hover:text-white"
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>

            <textarea
              rows={4}
              value={message}
              maxLength={2000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={kind === "bug" ? "What happened, and what did you expect?" : "What would make ConXion better for you?"}
              className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-500">We attach the page you&apos;re on so we can find the problem.</p>

            {status ? (
              <p
                className={`mt-3 rounded-2xl border px-3 py-2.5 text-sm ${
                  status.tone === "ok"
                    ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
                    : "border-rose-300/25 bg-rose-400/10 text-rose-100"
                }`}
              >
                {status.text}
              </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {BETA_WHATSAPP_URL ? (
                <a
                  href={BETA_WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/20"
                >
                  <span className="material-symbols-outlined text-[16px]">groups</span>
                  Join beta WhatsApp
                </a>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={sending || message.trim().length < 3}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-white px-5 text-sm font-bold text-[#06121a] hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
