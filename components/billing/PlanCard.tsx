"use client";

import type { PlanDefinition, PlanId } from "@/lib/billing/plans";

type Props = {
  plan: PlanDefinition;
  currentPlanId?: PlanId | null;
  onSelect?: (planId: PlanId) => void;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function PlanCard({ plan, currentPlanId, onSelect }: Props) {
  const isCurrent = currentPlanId === plan.id;
  const usePremiumCta = plan.isRecommended || plan.id === "verified";

  return (
    <article
      className={cx(
        "relative overflow-hidden rounded-[28px] border p-5 shadow-[0_22px_60px_rgba(0,0,0,0.28)] sm:p-6",
        plan.isRecommended
          ? "border-cyan-300/30 bg-[linear-gradient(180deg,rgba(15,27,35,0.98),rgba(17,11,30,0.92))]"
          : "border-white/10 bg-[linear-gradient(180deg,rgba(12,17,22,0.94),rgba(8,12,18,0.9))]"
      )}
    >
      <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_68%)]" />

      <div className="relative flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white">{plan.name}</h2>
          <p className="mt-2 text-3xl font-black text-white">{plan.priceLabel}</p>
          <p className="mt-3 max-w-[34ch] text-sm leading-6 text-slate-300">{plan.shortDescription}</p>
        </div>
      </div>

      <div className="relative mt-6 space-y-4">
        {plan.featureGroups.map((group) => (
          <section key={group.title} className="rounded-2xl border border-white/8 bg-black/20 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/55">{group.title}</h3>
            <ul className="mt-3 space-y-2">
              {group.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-200">
                  <span className="material-symbols-outlined mt-0.5 text-[16px] text-cyan-300">check_circle</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onSelect?.(plan.id)}
        disabled={isCurrent}
        className={cx(
          "relative mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition",
          isCurrent
            ? "cursor-default border border-white/10 bg-white/[0.05] text-white/45"
            : usePremiumCta
              ? "bg-gradient-to-r from-cyan-300 to-fuchsia-500 text-[#06121a] hover:brightness-110"
              : "border border-white/14 bg-white/[0.06] text-white hover:bg-white/[0.1]"
        )}
      >
        {isCurrent ? "Your plan" : plan.ctaLabel}
      </button>
    </article>
  );
}
