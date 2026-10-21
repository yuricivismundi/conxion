"use client";

import Link from "next/link";
import VerificationCheckoutModal from "@/components/verification/VerificationCheckoutModal";
import { EARLY_ACCESS_ENABLED } from "@/lib/billing/early-access";
import {
  HOSTING_TRUST_CHECKLIST,
  HOSTING_TRUST_GATE_ENABLED,
  HOSTING_TRUST_REQUIREMENT_LABELS,
  PHOTO_REQUIREMENTS,
  type HostingTrustRequirement,
} from "@/lib/hosting/trust-gate";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { type VerificationResumePayload } from "@/lib/verification-client";

type Props = {
  open: boolean;
  returnTo?: string;
  resumePayload?: VerificationResumePayload | null;
  onClose: () => void;
  onError?: (message: string) => void;
  onAlreadyVerified?: () => void;
  /** Early access: which trust requirements are still missing (all are listed when omitted). */
  missing?: HostingTrustRequirement[];
};


function HostingTrustDialog({ open, onClose, missing }: { open: boolean; onClose: () => void; missing?: HostingTrustRequirement[] }) {
  useBodyScrollLock(open);
  if (!open) return null;
  const pending = new Set<HostingTrustRequirement>(missing ?? HOSTING_TRUST_CHECKLIST);
  const missingPhoto = PHOTO_REQUIREMENTS.find((req) => pending.has(req)) ?? null;

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/72 px-3 py-3 backdrop-blur-md sm:items-center sm:px-6">
      <div className="w-full max-w-[420px] overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(170deg,rgba(8,16,22,0.98),rgba(15,10,24,0.96))] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.45)]">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-black leading-snug tracking-tight text-white">Complete your profile to request hosting</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/75 hover:bg-white/[0.08]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Hosts open their homes, so requesting hosting needs a complete profile with a photo approved by our team:
        </p>
        <ul className="mt-4 space-y-2.5">
          {HOSTING_TRUST_CHECKLIST.map((req) => {
            const isPhotoRow = req === "photo";
            const done = missing ? (isPhotoRow ? missingPhoto === null : !pending.has(req)) : false;
            const label = HOSTING_TRUST_REQUIREMENT_LABELS[isPhotoRow && missingPhoto ? missingPhoto : req];
            return (
              <li key={req} className="flex items-start gap-2.5 text-sm">
                <span
                  className={`material-symbols-outlined mt-0.5 text-[18px] ${done ? "text-emerald-300" : "text-white/35"}`}
                >
                  {done ? "check_circle" : "radio_button_unchecked"}
                </span>
                <span className={done ? "text-white/50 line-through" : "text-white/85"}>
                  {label}
                </span>
              </li>
            );
          })}
        </ul>
        {missingPhoto === "photo_pending" ? (
          <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2.5 text-xs leading-5 text-amber-100">
            Your photo is in the review queue. You&apos;ll get a message as soon as an admin approves it or sends feedback.
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/me/edit"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-3 text-sm font-bold text-[#06121a] hover:brightness-110"
          >
            Complete my profile
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl py-3 text-sm font-semibold text-slate-400 transition hover:text-white"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VerificationRequiredDialog({
  open,
  returnTo,
  resumePayload,
  onClose,
  onError,
  onAlreadyVerified,
  missing,
}: Props) {
  if (EARLY_ACCESS_ENABLED) {
    // Emergency login-only mode: nothing to gate, so nothing to show.
    if (!HOSTING_TRUST_GATE_ENABLED) return null;
    return <HostingTrustDialog open={open} onClose={onClose} missing={missing} />;
  }

  return (
    <VerificationCheckoutModal
      open={open}
      returnTo={returnTo}
      resumePayload={resumePayload}
      onClose={onClose}
      onError={onError}
      onAlreadyVerified={onAlreadyVerified}
    />
  );
}
