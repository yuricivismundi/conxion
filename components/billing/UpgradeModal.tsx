"use client";

import Link from "next/link";
import { getPlanDefinition, type PlanId } from "@/lib/billing/plans";
import { getUpgradeReasonContent, type UpgradeReason } from "@/lib/billing/upgrade-reasons";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type Props = {
  open: boolean;
  reason: UpgradeReason;
  onClose: () => void;
  onUpgrade: (planId: PlanId) => void;
};

export default function UpgradeModal({ open, reason, onClose, onUpgrade }: Props) {
  useBodyScrollLock(open);

  if (!open) return null;

  const content = getUpgradeReasonContent(reason);
  const plan = getPlanDefinition(content.recommendedPlan);

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/72 px-3 py-3 backdrop-blur-md sm:items-center sm:px-6">
      <div className="w-full max-w-[420px] overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(170deg,rgba(8,16,22,0.98),rgba(15,10,24,0.96))] shadow-[0_28px_90px_rgba(0,0,0,0.45)]">
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-black tracking-tight text-white leading-snug">{content.title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/75 hover:bg-white/[0.08]"
              aria-label="Close"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-3xl font-black text-white">{plan.priceLabel}</span>
            <span className="text-sm font-medium text-white/40">billed monthly</span>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            {plan.shortDescription}{" "}
            <Link href="/pricing" onClick={onClose} className="text-[#0df2f2]/70 underline-offset-2 hover:underline">
              See full plan details
            </Link>
          </p>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.05] px-4 text-sm font-semibold text-white/70 hover:bg-white/[0.08]"
            >
              Maybe later
            </button>
            <button
              type="button"
              onClick={() => onUpgrade(content.recommendedPlan)}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-4 text-sm font-semibold text-[#06121a] hover:brightness-110"
            >
              {content.ctaLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
