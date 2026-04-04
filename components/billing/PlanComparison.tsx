"use client";

import { getPlanLimits } from "@/lib/billing/limits";
import type { PlanDefinition, PlanId } from "@/lib/billing/plans";
import { cx } from "@/lib/cx";

type Props = {
  plans: PlanDefinition[];
  currentPlanId?: PlanId | null;
};

type ComparisonRow = {
  label: string;
  values: Record<PlanId, string>;
};

type ComparisonSection = {
  title: string;
  rows: ComparisonRow[];
};

const COMPARISON_SECTIONS: ComparisonSection[] = [
  {
    title: "Chats and profile",
    rows: [
      {
        label: "Active chat threads",
        values: {
          starter: String(getPlanLimits("starter").activeChatThreadsPerMonth ?? "Unlimited"),
          verified: String(getPlanLimits("verified").activeChatThreadsPerMonth ?? "Unlimited"),
          pro: String(getPlanLimits("pro").activeChatThreadsPerMonth ?? "Unlimited"),
        },
      },
      {
        label: "Connection requests per month",
        values: {
          starter: `${getPlanLimits("starter").connectionRequestsPerMonth} (${getPlanLimits("starter").firstMonthConnectionRequestsPerMonth} in first month)`,
          verified: `${getPlanLimits("verified").connectionRequestsPerMonth} (${getPlanLimits("verified").firstMonthConnectionRequestsPerMonth} in first month)`,
          pro: String(getPlanLimits("pro").connectionRequestsPerMonth ?? "Unlimited"),
        },
      },
      {
        label: "Hosting offers sent per month",
        values: {
          starter: String(getPlanLimits("starter").hostingOffersPerMonth ?? "Unlimited"),
          verified: String(getPlanLimits("verified").hostingOffersPerMonth ?? "Unlimited"),
          pro: String(getPlanLimits("pro").hostingOffersPerMonth ?? "Unlimited"),
        },
      },
      {
        label: "Showcase videos",
        values: {
          starter: String(getPlanLimits("starter").profileVideos ?? "Unlimited"),
          verified: String(getPlanLimits("verified").profileVideos ?? "Unlimited"),
          pro: String(getPlanLimits("pro").profileVideos ?? "Unlimited"),
        },
      },
      {
        label: "Profile photos",
        values: {
          starter: String(getPlanLimits("starter").profilePhotos ?? "Unlimited"),
          verified: String(getPlanLimits("verified").profilePhotos ?? "Unlimited"),
          pro: String(getPlanLimits("pro").profilePhotos ?? "Unlimited"),
        },
      },
      {
        label: "Replies to incoming messages",
        values: {
          starter: "Unlimited",
          verified: "Unlimited",
          pro: "Unlimited",
        },
      },
      {
        label: "Class and hosting information requests",
        values: {
          starter: "Included",
          verified: "Included",
          pro: "Included",
        },
      },
    ],
  },
  {
    title: "Trust and access",
    rows: [
      {
        label: "Verified badge",
        values: {
          starter: "Not included",
          verified: "Included",
          pro: "Add Verified separately",
        },
      },
      {
        label: "Hosting access",
        values: {
          starter: "Requires Verified",
          verified: "Included",
          pro: "Requires Verified",
        },
      },
      {
        label: "Teacher / artist profile",
        values: {
          starter: "Requires Verified",
          verified: "Included",
          pro: "Requires Verified",
        },
      },
      {
        label: "Service inquiries",
        values: {
          starter: "Requires Verified",
          verified: "Included",
          pro: "Requires Verified",
        },
      },
    ],
  },
  {
    title: "Visibility and extras",
    rows: [
      {
        label: "Discovery visibility",
        values: {
          starter: "Standard",
          verified: "Standard",
          pro: "Boosted",
        },
      },
      {
        label: "Shown before free users",
        values: {
          starter: "No",
          verified: "No",
          pro: "Yes",
        },
      },
      {
        label: "Priority support",
        values: {
          starter: "No",
          verified: "No",
          pro: "Included",
        },
      },
      {
        label: "Featured boosts access",
        values: {
          starter: "No",
          verified: "No",
          pro: "Early access",
        },
      },
    ],
  },
];


export default function PlanComparison({ plans, currentPlanId }: Props) {
  return (
    <div className="space-y-4">
      {COMPARISON_SECTIONS.map((section) => (
        <section key={section.title} className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h3 className="text-lg font-bold text-white">{section.title}</h3>
          <div className="mt-4 space-y-3">
            {section.rows.map((row) => (
              <article key={row.label} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <p className="text-sm font-semibold text-white">{row.label}</p>
                <div className="mt-3 grid gap-2">
                  {plans.map((plan) => (
                    <div
                      key={`${row.label}-${plan.id}`}
                      className={cx(
                        "flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-sm",
                        currentPlanId === plan.id
                          ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-50"
                          : "border-white/8 bg-white/[0.03] text-slate-200"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{plan.name}</span>
                        {currentPlanId === plan.id ? (
                          <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                            Current
                          </span>
                        ) : null}
                      </div>
                      <span className="text-right text-sm text-slate-200">{row.values[plan.id]}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {section.title === "Chats and profile" ? (
            <p className="mt-4 text-xs leading-5 text-slate-400">
              Service inquiries and hosting requests do not count as active chat threads. Events remain free.
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
