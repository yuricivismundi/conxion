"use client";

import { getRemaining } from "@/lib/billing/limits";
import { getPlanDefinition, type PlanId } from "@/lib/billing/plans";

type Props = {
  label: string;
  current: number;
  limit: number | null;
  upgradePlanId?: PlanId;
  onUpgrade?: (planId: PlanId) => void;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function UsageLimitBanner({ label, current, limit, upgradePlanId, onUpgrade }: Props) {
  if (limit === null) {
    return (
      <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{label}</p>
            <p className="mt-1 text-emerald-100/80">Unlimited on your current plan.</p>
          </div>
          <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
            Unlimited
          </span>
        </div>
      </div>
    );
  }

  const ratio = limit <= 0 ? 0 : current / limit;
  const remaining = getRemaining(limit, current);
  const state = ratio >= 1 ? "reached" : ratio >= 0.8 ? "warning" : "normal";
  const ctaLabel = upgradePlanId ? getPlanDefinition(upgradePlanId).ctaLabel : null;

  const stateStyles =
    state === "reached"
      ? "border-fuchsia-300/25 bg-fuchsia-500/10 text-fuchsia-50"
      : state === "warning"
        ? "border-amber-300/25 bg-amber-300/10 text-amber-50"
        : "border-cyan-300/20 bg-cyan-300/10 text-cyan-50";

  const badgeStyles =
    state === "reached"
      ? "border-fuchsia-300/30 bg-fuchsia-500/15 text-fuchsia-100"
      : state === "warning"
        ? "border-amber-300/30 bg-amber-300/15 text-amber-100"
        : "border-cyan-300/30 bg-cyan-300/12 text-cyan-100";

  return (
    <div className={cx("rounded-2xl border px-4 py-3", stateStyles)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">{label}</p>
          <p className="mt-1 text-sm opacity-90">
            {state === "reached"
              ? `${current} of ${limit} used. You’ve reached this limit for now.`
              : state === "warning"
                ? `${current} of ${limit} used. ${remaining} remaining this cycle.`
                : `${current} of ${limit} used. ${remaining} remaining.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]", badgeStyles)}>
            {current}/{limit}
          </span>
          {state === "reached" && upgradePlanId && onUpgrade ? (
            <button
              type="button"
              onClick={() => onUpgrade(upgradePlanId)}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-white text-sm font-semibold text-[#06121a] px-4 py-2 hover:bg-slate-100"
            >
              {ctaLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
