"use client";

import { getPlanDefinition, type PlanId } from "@/lib/billing/plans";

type Props = {
  currentPlanId: PlanId | null;
  isVerified: boolean;
  renewalLabel?: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function CurrentPlanSummary({ currentPlanId, isVerified, renewalLabel }: Props) {
  const resolvedPlanId = currentPlanId ?? "starter";
  const plan = getPlanDefinition(resolvedPlanId);

  return (
    <article className="rounded-[28px] border border-white/10 bg-[linear-gradient(170deg,rgba(12,20,26,0.96),rgba(10,13,22,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/70">Current plan</p>
          <h2 className="mt-2 text-xl font-black tracking-tight text-white sm:text-2xl">{plan.name}</h2>
          <p className="mt-1 text-sm text-cyan-100">{plan.priceLabel}</p>
          {renewalLabel ? <p className="mt-2 text-sm text-slate-300">{renewalLabel}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <span
            className={cx(
              "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
              resolvedPlanId === "pro"
                ? "border-fuchsia-300/25 bg-fuchsia-500/10 text-fuchsia-100"
                : resolvedPlanId === "verified"
                  ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                  : "border-white/12 bg-white/[0.05] text-white/70"
            )}
          >
            {resolvedPlanId === "pro" ? "Monthly" : resolvedPlanId === "verified" ? "One-time" : "Free"}
          </span>
          <span
            className={cx(
              "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
              isVerified
                ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                : "border-white/12 bg-white/[0.05] text-white/70"
            )}
          >
            {isVerified ? "Verified" : "Not verified"}
          </span>
        </div>
      </div>
    </article>
  );
}
