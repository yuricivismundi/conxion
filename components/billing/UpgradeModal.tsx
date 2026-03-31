"use client";

import { getPlanDefinition, type PlanId } from "@/lib/billing/plans";
import { getUpgradeReasonContent, type UpgradeReason } from "@/lib/billing/upgrade-reasons";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type Props = {
  open: boolean;
  reason: UpgradeReason;
  onClose: () => void;
  onUpgrade: (planId: PlanId) => void;
};

function badgeLabel(planId: PlanId) {
  if (planId === "verified") return "One-time";
  if (planId === "pro") return "Monthly";
  return "Free";
}

export default function UpgradeModal({ open, reason, onClose, onUpgrade }: Props) {
  useBodyScrollLock(open);

  if (!open) return null;

  const content = getUpgradeReasonContent(reason);
  const plan = getPlanDefinition(content.recommendedPlan);

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/72 px-3 py-3 backdrop-blur-md sm:items-center sm:px-6">
      <div className="flex max-h-[calc(100dvh-0.75rem)] w-full max-w-[420px] flex-col overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(170deg,rgba(8,16,22,0.98),rgba(15,10,24,0.96))] shadow-[0_28px_90px_rgba(0,0,0,0.45)] sm:max-h-[min(88dvh,720px)]">
        <div className="min-h-0 overflow-y-auto overscroll-contain">
        <div className="border-b border-white/10 px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                {badgeLabel(plan.id)}
              </span>
              <h2 className="mt-4 text-2xl font-black tracking-tight text-white">{content.title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/75 hover:bg-white/[0.08]"
              aria-label="Close upgrade dialog"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">{content.body}</p>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/55">Recommended plan</p>
                <h3 className="mt-2 text-xl font-bold text-white">{plan.name}</h3>
                <p className="mt-1 text-sm text-cyan-100">{plan.priceLabel}</p>
              </div>
              <span className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
                {badgeLabel(plan.id)}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">{plan.shortDescription}</p>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.08]"
            >
              Maybe later
            </button>
            <button
              type="button"
              onClick={() => onUpgrade(content.recommendedPlan)}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110"
            >
              {content.ctaLabel}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
