"use client";

import { useState, useCallback } from "react";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type Props = {
  open: boolean;
  teacherUserId: string;
  teacherName: string;
  teacherPhotoUrl?: string | null;
  onClose: () => void;
};

type Step = "form" | "sent" | "error";

export default function GuestBookingModal({ open, teacherUserId, teacherName, teacherPhotoUrl, onClose }: Props) {
  useBodyScrollLock(open);

  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [datePref, setDatePref] = useState("");

  const reset = useCallback(() => {
    setStep("form");
    setBusy(false);
    setErrorMsg(null);
    setName("");
    setEmail("");
    setMessage("");
    setDatePref("");
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSubmit = useCallback(async () => {
    if (busy) return;
    setErrorMsg(null);

    if (!name.trim()) { setErrorMsg("Please enter your name."); return; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErrorMsg("Please enter a valid email."); return; }

    setBusy(true);
    try {
      const res = await fetch("/api/teacher-bookings/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId: teacherUserId,
          guestName: name.trim(),
          guestEmail: email.trim().toLowerCase(),
          message: message.trim() || null,
          datePref: datePref.trim() || null,
          serviceType: "private_class",
        }),
      });
      const result = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !result?.ok) throw new Error(result?.error ?? "Could not send request. Please try again.");
      setStep("sent");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStep("error");
    } finally {
      setBusy(false);
    }
  }, [busy, name, email, message, datePref, teacherUserId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center sm:px-3 sm:py-3">
      <div
        className="relative flex max-h-[100svh] w-full flex-col overflow-hidden border-0 sm:max-h-[min(92svh,600px)] sm:max-w-[480px] sm:rounded-[32px] sm:border sm:border-white/[0.08] sm:shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
        style={{ background: "radial-gradient(circle at 15% 0%,rgba(13,204,242,0.08),transparent 45%),radial-gradient(circle at 85% 100%,rgba(217,59,255,0.08),transparent 45%),#080e14" }}
      >
        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-white/35 transition hover:border-white/20 hover:text-white"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>

        {/* Header */}
        <div className="relative overflow-hidden border-b border-white/[0.06] px-6 pb-5 pt-6">
          <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "linear-gradient(90deg,#0df2f2,#d93bff)" }} />
          <div className="flex items-center gap-4">
            <div
              className="h-[56px] w-[56px] shrink-0 rounded-2xl border border-white/[0.12] bg-cover bg-center"
              style={{ backgroundImage: teacherPhotoUrl ? `url(${teacherPhotoUrl})` : "linear-gradient(135deg,rgba(13,204,242,0.3),rgba(217,59,255,0.3))" }}
            />
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">Book a session with</p>
              <h2 className="mt-0.5 truncate text-[20px] font-black leading-tight text-white">{teacherName}</h2>
              <p className="mt-0.5 text-[11px] text-white/35">No account needed — confirm via email</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-5">

          {step === "form" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Your name <span className="text-rose-400">*</span></label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="First and last name"
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#0df2f2]/40 focus:ring-1 focus:ring-[#0df2f2]/20"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Email <span className="text-rose-400">*</span></label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#0df2f2]/40 focus:ring-1 focus:ring-[#0df2f2]/20"
                />
                <p className="text-[11px] text-white/30">We'll send a magic link to confirm your booking.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Preferred date / time</label>
                <input
                  type="text"
                  value={datePref}
                  onChange={(e) => setDatePref(e.target.value)}
                  placeholder="e.g. Any weekday evening, Jun 20–25…"
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#0df2f2]/40 focus:ring-1 focus:ring-[#0df2f2]/20"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Message to teacher</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell them about your level, goals, questions…"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#0df2f2]/40 focus:ring-1 focus:ring-[#0df2f2]/20"
                />
              </div>

              {errorMsg && (
                <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{errorMsg}</p>
              )}

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={busy}
                className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-bold text-[#0A0A0A] transition hover:opacity-90 disabled:opacity-50"
                style={{ backgroundImage: "linear-gradient(135deg,#0df2f2,#ff00ff)" }}
              >
                {busy ? (
                  <><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0A0A0A]/30 border-t-[#0A0A0A]" /> Sending…</>
                ) : (
                  <><span className="material-symbols-outlined text-[18px]">send</span> Send booking request</>
                )}
              </button>

              <p className="text-center text-[11px] text-white/25">
                Already have an account?{" "}
                <a href={`/auth?next=/connections?mode=teachers`} className="text-[#0df2f2]/70 hover:text-[#0df2f2] underline underline-offset-2">
                  Log in to book
                </a>
              </p>
            </div>
          )}

          {step === "sent" && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#0df2f2]/10">
                <span className="material-symbols-outlined text-[36px] text-[#0df2f2]">mark_email_read</span>
              </div>
              <h3 className="text-[18px] font-bold text-white">Check your inbox!</h3>
              <p className="text-sm text-white/50 max-w-[320px]">
                We've sent a confirmation link to <strong className="text-white">{email}</strong>. Click it to verify your email and complete the booking with {teacherName}.
              </p>
              <p className="text-[11px] text-white/30">The link expires in 48 hours. Check your spam folder if you don't see it.</p>
              <button
                type="button"
                onClick={handleClose}
                className="mt-2 rounded-full border border-white/10 px-6 py-2.5 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:text-white"
              >
                Close
              </button>
            </div>
          )}

          {step === "error" && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10">
                <span className="material-symbols-outlined text-[36px] text-rose-400">error</span>
              </div>
              <h3 className="text-[18px] font-bold text-white">Something went wrong</h3>
              <p className="text-sm text-white/50">{errorMsg}</p>
              <button
                type="button"
                onClick={() => { setStep("form"); setErrorMsg(null); }}
                className="mt-2 rounded-full border border-white/10 px-6 py-2.5 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:text-white"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
