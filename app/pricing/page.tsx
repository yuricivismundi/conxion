"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PlanCard from "@/components/billing/PlanCard";
import PricingFAQ from "@/components/billing/PricingFAQ";
import StripeCheckoutDialog from "@/components/billing/StripeCheckoutDialog";
import Nav from "@/components/Nav";
import { getBillingAccountState, type BillingAccountState } from "@/lib/billing/account-state";
import { createBillingCheckoutSession } from "@/lib/billing/checkout-client";
import { getPricingFaqItems } from "@/lib/billing/faq";
import { getAllPlanDefinitions, type PlanId } from "@/lib/billing/plans";
import { supabase } from "@/lib/supabase/client";
import { isPaymentVerified } from "@/lib/verification";

const STARTER_BILLING_STATE: BillingAccountState = {
  currentPlanId: "starter",
  isVerified: false,
  proRenewalLabel: null,
};

function readCheckoutMessageFromLocation() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const checkoutState = params.get("checkout");
  const plan = params.get("plan");
  if (!checkoutState) return null;

  if (checkoutState === "success") {
    return plan === "pro"
      ? "Plus is now active on your account."
      : "Your verification checkout completed. Your trust status will refresh after Stripe confirms the payment.";
  }

  if (checkoutState === "cancelled") {
    return "Checkout was closed before completion. You can try again whenever you’re ready.";
  }

  if (checkoutState === "already-owned") {
    return plan === "pro" ? "Plus is already active on this account." : "This account is already verified.";
  }

  return null;
}

export default function PricingPage() {
  const plans = useMemo(() => getAllPlanDefinitions(), []);
  const faqItems = useMemo(() => getPricingFaqItems(), []);
  const [billingState, setBillingState] = useState<BillingAccountState | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(() => readCheckoutMessageFromLocation());
  const [checkoutPlanId, setCheckoutPlanId] = useState<"verified" | "pro" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBillingState() {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!user) {
        if (!cancelled) {
          setBillingState(STARTER_BILLING_STATE);
          setBillingLoading(false);
        }
        return;
      }

      const profileRes = await supabase
        .from("profiles")
        .select("verified,verified_label")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      const isVerified = isPaymentVerified((profileRes.data ?? null) as Record<string, unknown> | null);
      setBillingState(
        getBillingAccountState({
          userMetadata: user.user_metadata,
          isVerified,
        })
      );
      setBillingLoading(false);
    }

    void loadBillingState().catch(() => {
      if (!cancelled) {
        setBillingState(STARTER_BILLING_STATE);
        setBillingLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCheckout(planId: PlanId) {
    const { data: authData } = await supabase.auth.getUser();

    if (planId === "starter") {
      window.location.assign(authData.user ? "/connections" : "/auth");
      return;
    }

    if (!authData.user) {
      window.location.assign("/auth");
      return;
    }

    setCheckoutMessage(null);
    setCheckoutPlanId(planId);
  }

  const loadCheckoutSession = useCallback(() => {
    if (!checkoutPlanId) {
      throw new Error("Choose a paid plan to continue.");
    }
    return createBillingCheckoutSession({ planId: checkoutPlanId, returnTo: "/pricing" });
  }, [checkoutPlanId]);

  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <Nav />
      <main className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_45%),radial-gradient(circle_at_top_right,rgba(217,70,239,0.14),transparent_30%)]" />
        <div className="relative mx-auto w-full max-w-[1180px] px-4 pb-20 pt-8 sm:px-6 sm:pt-10">
          <section className="py-6 text-center">
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Upgrade your Plan</h1>
            {checkoutMessage ? (
              <div className="mx-auto mt-5 max-w-[720px] rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">
                {checkoutMessage}
              </div>
            ) : null}
          </section>

          <section id="plan-grid" className="mx-auto mt-4 grid gap-5 lg:grid-cols-3">
            {billingLoading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <article
                  key={`pricing-skeleton-${index}`}
                  className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,17,22,0.94),rgba(8,12,18,0.9))] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.28)] sm:p-6"
                >
                  <div className="animate-pulse space-y-4">
                    <div className="h-6 w-28 rounded bg-white/10" />
                    <div className="h-8 w-24 rounded bg-white/10" />
                    <div className="h-4 w-full rounded bg-white/5" />
                    <div className="h-4 w-5/6 rounded bg-white/5" />
                    <div className="space-y-3 pt-4">
                      <div className="h-24 rounded-2xl border border-white/8 bg-black/20" />
                      <div className="h-24 rounded-2xl border border-white/8 bg-black/20" />
                    </div>
                    <div className="h-12 rounded-2xl bg-white/10" />
                  </div>
                </article>
              ))
            ) : (
              <>
                {plans.filter((p) => p.id === "starter" || p.id === "pro").map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    currentPlanId={billingState?.currentPlanId}
                    onSelect={(selectedPlanId) => void handleCheckout(selectedPlanId)}
                  />
                ))}

                {(() => {
                  const verifiedPlan = plans.find((p) => p.id === "verified");
                  if (!verifiedPlan || !billingState) return null;
                  const isVerified = billingState.currentPlanId === "verified" || billingState.isVerified;
                  return (
                    <article className="relative overflow-hidden rounded-[28px] border border-emerald-400/20 bg-[linear-gradient(180deg,rgba(8,22,18,0.96),rgba(6,16,14,0.92))] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.28)] sm:p-6">
                      <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(52,211,153,0.14),transparent_68%)]" />
                      <div className="relative">
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-400/70">One-time payment</p>
                        <h2 className="mt-1 text-2xl font-black tracking-tight text-white">{verifiedPlan.name}</h2>
                        <p className="mt-2 text-3xl font-black text-white">{verifiedPlan.priceLabel}</p>
                        <p className="mt-3 max-w-[34ch] text-sm leading-6 text-slate-300">{verifiedPlan.shortDescription}</p>
                      </div>

                      <div className="relative mt-6 space-y-4">
                        {verifiedPlan.featureGroups.map((group) => (
                          <section key={group.title} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/55">{group.title}</h3>
                            <ul className="mt-3 space-y-2">
                              {group.items.map((item) => (
                                <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-200">
                                  <span className="material-symbols-outlined mt-0.5 text-[16px] text-emerald-400">check_circle</span>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => !isVerified && handleCheckout("verified")}
                        disabled={isVerified}
                        className={
                          isVerified
                            ? "relative mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-300"
                            : "relative mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-300 px-4 py-3 text-sm font-semibold text-[#06121a] hover:brightness-110"
                        }
                      >
                        {isVerified ? "Verified" : verifiedPlan.ctaLabel}
                      </button>
                    </article>
                  );
                })()}
              </>
            )}
          </section>

          <section className="mt-8 grid gap-5 lg:grid-cols-2">
            <article className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,20,0.94),rgba(7,12,18,0.88))] p-5 sm:p-6">
              <h2 className="text-2xl font-black text-white">Why get Verified?</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Trust matters when meeting people and sharing spaces. Verification helps others feel confident connecting, booking you, and welcoming you when you want to request a hosting stay during dance holidays, festivals, or competitions.
              </p>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                You can still offer hosting on Starter. Verified is for dancers who want to request hosting, get hosted more confidently, teach, take paid inquiries, or simply build more trust without adding a monthly bill.
              </p>
            </article>

            <article className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(20,11,30,0.92),rgba(8,13,19,0.9))] p-5 sm:p-6">
              <h2 className="text-2xl font-black text-white">Why go Plus?</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                More reach, more control. Reach more dancers, keep more active chat threads open, create more trips and events, stand out in the community — and decide exactly who can find you.
              </p>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                Includes 60 connection requests per month, 30 active chat threads, 10 hosting offers, 3 accepted trips, 5 created trips, 5 events, 15 activity requests, more profile photos — and <span className="font-semibold text-white/70">Private mode</span> to hide yourself from Discover and search.
              </p>
              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[#0df2f2]/20 bg-[#0df2f2]/[0.06] px-4 py-3">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-[#0df2f2]" style={{ fontVariationSettings: "'FILL' 1" }}>visibility_off</span>
                <div>
                  <p className="text-sm font-semibold text-white">Private mode</p>
                  <p className="mt-0.5 text-xs leading-5 text-white/55">Enable to disappear from Discover and search.</p>
                </div>
              </div>
            </article>
          </section>

          <section className="mt-8 rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,17,24,0.94),rgba(8,12,18,0.9))] p-6 sm:p-7">
            <h2 className="text-2xl font-black text-white">Dance Tools</h2>
            <p className="mt-3 max-w-[68ch] text-sm leading-7 text-slate-300">
              Keep your private dance life organized in one place with tools to follow people, save notes, manage contacts, and track your long-term growth.
            </p>
            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              <article className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/60">People</h3>
                <p className="mt-3 text-sm leading-6 text-slate-200">
                  Follow and track the activity of your favourite dancers, and keep private personal notes about them.
                </p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/60">Contacts & growth</h3>
                <p className="mt-3 text-sm leading-6 text-slate-200">
                  Save contacts even if they are not connections, and manage your growth plan with practice logs, notes, lessons learned, and history.
                </p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/60">Goals & results</h3>
                <p className="mt-3 text-sm leading-6 text-slate-200">
                  Track competitions and wins, and keep a goal-setting tracker for what you want to learn and improve next.
                </p>
              </article>
            </div>
          </section>

          <section className="mt-8">
            <div className="mb-4">
              <h2 className="text-2xl font-black text-white">FAQ</h2>
              <p className="mt-2 max-w-[58ch] text-sm leading-6 text-slate-300">
                Clear billing rules, fair usage language, and no hidden counters for anti-spam controls.
              </p>
            </div>
            <PricingFAQ items={faqItems} />
          </section>

          <section className="mt-8 rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,17,24,0.94),rgba(11,9,19,0.9))] p-6 sm:p-7">
            <h2 className="text-3xl font-black tracking-tight text-white">Start free, upgrade when you’re ready</h2>
            <p className="mt-3 max-w-[60ch] text-sm leading-7 text-slate-300">
              Use Starter to discover dancers, travellers, and events with 5 hosting offers and 1 accepted trip per month, get Verified when you want to request hosting or unlock professional access, or go Plus when you want more reach, 10 hosting offers, 3 accepted trips, more created trips, and more events.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void handleCheckout("starter")}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/[0.08]"
              >
                Continue with Starter
              </button>
              <button
                type="button"
                onClick={() => void handleCheckout("pro")}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110"
              >
                Upgrade to Plus
              </button>
            </div>
          </section>
        </div>
      </main>

      <StripeCheckoutDialog
        open={Boolean(checkoutPlanId)}
        title={checkoutPlanId === "pro" ? "Upgrade to Plus" : "Get Verified"}
        badgeLabel={checkoutPlanId === "pro" ? "Monthly plan" : "One-time trust upgrade"}
        submitLabel={checkoutPlanId === "pro" ? "Start Plus" : "Confirm Verification"}
        onClose={() => setCheckoutPlanId(null)}
        onError={(message) => setCheckoutMessage(message)}
        onAlreadyResolved={() => {
          setCheckoutMessage(checkoutPlanId === "pro" ? "Plus is already active on this account." : "This account is already verified.");
          setCheckoutPlanId(null);
        }}
        loadSession={loadCheckoutSession}
      />
    </div>
  );
}
