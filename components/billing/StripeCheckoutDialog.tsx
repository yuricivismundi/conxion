"use client";

import { useEffect, useState } from "react";
import { loadStripe, type StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { CheckoutElementsProvider, ExpressCheckoutElement, PaymentElement, useCheckout } from "@stripe/react-stripe-js/checkout";
import { normalizeStripeEnvValue } from "@/lib/billing/stripe-env";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

export type StripeCheckoutDialogLoadResult =
  | {
      status: "ready";
      clientSecret: string;
      successDestination: string;
    }
  | {
      status: "already_owned" | "already_verified";
      returnTo: string;
    };

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  badgeLabel?: string;
  submitLabel: string;
  loadingLabel?: string;
  onClose: () => void;
  onError?: (message: string) => void;
  onAlreadyResolved?: (result: Extract<StripeCheckoutDialogLoadResult, { status: "already_owned" | "already_verified" }>) => void;
  loadSession: () => Promise<StripeCheckoutDialogLoadResult>;
};

const staticPublishableKey = normalizeStripeEnvValue(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
let cachedPublishableKey = staticPublishableKey;
let cachedStripePromise: ReturnType<typeof loadStripe> | null = staticPublishableKey ? loadStripe(staticPublishableKey) : null;

async function getStripePromise() {
  if (cachedStripePromise) return cachedStripePromise;

  if (!cachedPublishableKey) {
    const response = await fetch("/api/billing/config", { cache: "no-store" });
    const result = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: string;
          publishableKey?: string;
        }
      | null;

    const normalizedPublishableKey = normalizeStripeEnvValue(result?.publishableKey);

    if (!response.ok || !result?.ok || !normalizedPublishableKey) {
      throw new Error(result?.error ?? "Secure checkout is unavailable right now.");
    }

    cachedPublishableKey = normalizedPublishableKey;
  }

  cachedStripePromise = loadStripe(cachedPublishableKey);
  return cachedStripePromise;
}

function StripeCheckoutPanel({
  successDestination,
  submitLabel,
  onClose,
}: {
  successDestination: string;
  submitLabel: string;
  onClose: () => void;
}) {
  const checkoutState = useCheckout();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function confirmCheckout(args?: {
    expressCheckoutConfirmEvent?: StripeExpressCheckoutElementConfirmEvent;
  }) {
    if (checkoutState.type !== "success") return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      const result = await checkoutState.checkout.confirm({
        redirect: "if_required",
        ...args,
      });

      if (result.type === "error") {
        setSubmitError(result.error.message);
        return;
      }

      onClose();
      window.location.assign(successDestination);
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : "Could not confirm checkout.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkoutState.type === "loading") {
    return (
      <div className="grid min-h-[260px] place-items-center">
        <div className="grid gap-3 justify-items-center text-center text-sm text-slate-300">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-300/20 border-t-cyan-300" />
          <p>Loading secure checkout…</p>
        </div>
      </div>
    );
  }

  if (checkoutState.type === "error") {
    return (
      <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
        {checkoutState.error.message}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ExpressCheckoutElement
        options={{
          buttonHeight: 48,
          layout: { maxColumns: 1, maxRows: 3, overflow: "auto" },
          paymentMethodOrder: ["apple_pay", "google_pay", "link"],
          paymentMethods: {
            applePay: "always",
            googlePay: "always",
            link: "auto",
          },
          buttonTheme: {
            applePay: "white-outline",
            googlePay: "white",
          },
          buttonType: {
            applePay: "check-out",
            googlePay: "checkout",
          },
        }}
        onConfirm={(event) => void confirmCheckout({ expressCheckoutConfirmEvent: event })}
      />

      <div className="border-t border-white/10 pt-5">
        <PaymentElement
          options={{
            layout: "tabs",
            paymentMethodOrder: ["card", "link"],
            wallets: {
              applePay: "never",
              googlePay: "never",
            },
          }}
        />
      </div>

      {submitError ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {submitError}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/[0.08] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void confirmCheckout()}
          disabled={submitting}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? "Confirming…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

export default function StripeCheckoutDialog({
  open,
  title,
  subtitle,
  badgeLabel = "Secure checkout",
  submitLabel,
  loadingLabel = "Preparing checkout…",
  onClose,
  onError,
  onAlreadyResolved,
  loadSession,
}: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [successDestination, setSuccessDestination] = useState<string | null>(null);
  const [stripeClient, setStripeClient] = useState<Awaited<ReturnType<typeof loadStripe>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!open) return;

      setLoading(true);
      setError(null);
      setClientSecret(null);
      setSuccessDestination(null);

      try {
        const nextStripeClient = await getStripePromise();
        if (!active) return;
        setStripeClient(nextStripeClient);

        const result = await loadSession();
        if (!active) return;

        if (result.status !== "ready") {
          onAlreadyResolved?.(result);
          onClose();
          return;
        }

        setClientSecret(result.clientSecret);
        setSuccessDestination(result.successDestination);
      } catch (checkoutError: unknown) {
        if (!active) return;
        const message = checkoutError instanceof Error ? checkoutError.message : "Could not start secure checkout.";
        setError(message);
        onError?.(message);
      } finally {
        if (active) setLoading(false);
      }
    }

    if (open) {
      void run();
    } else {
      setStripeClient(null);
      setClientSecret(null);
      setSuccessDestination(null);
      setLoading(false);
      setError(null);
    }

    return () => {
      active = false;
    };
  }, [loadSession, onAlreadyResolved, onClose, onError, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/75 px-0 py-1 backdrop-blur-md sm:items-center sm:px-4 sm:py-4">
      <div className="relative flex max-h-[calc(100dvh-0.5rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[linear-gradient(180deg,#071019,#05080f)] text-white shadow-[0_40px_120px_rgba(0,0,0,0.45)] sm:max-h-[min(92dvh,860px)] sm:rounded-[30px]">
        <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_52%),radial-gradient(circle_at_top_right,rgba(217,70,239,0.16),transparent_32%)]" />

        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-black/25 p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          aria-label="Close checkout dialog"
        >
          <span className="material-symbols-outlined text-[22px] leading-none">close</span>
        </button>

        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-6 touch-pan-y [scrollbar-gutter:stable] sm:px-6 sm:pb-6 sm:pt-7 [-webkit-overflow-scrolling:touch]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/75">{badgeLabel}</p>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h2>
          {subtitle ? <p className="mt-3 max-w-[44ch] text-sm leading-7 text-slate-300">{subtitle}</p> : null}

          <div className="mt-6">
            {loading ? (
              <div className="grid min-h-[260px] place-items-center">
                <div className="grid gap-3 justify-items-center text-center text-sm text-slate-300">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-300/20 border-t-cyan-300" />
                  <p>{loadingLabel}</p>
                </div>
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : clientSecret && successDestination && stripeClient ? (
              <CheckoutElementsProvider
                stripe={stripeClient}
                options={{
                  clientSecret,
                  elementsOptions: {
                    appearance: {
                      theme: "night",
                      variables: {
                        colorPrimary: "#67e8f9",
                        colorBackground: "#081019",
                        colorText: "#f8fafc",
                        colorTextPlaceholder: "rgba(226,232,240,0.48)",
                        colorDanger: "#fb7185",
                        borderRadius: "18px",
                      },
                    },
                    loader: "auto",
                  },
                }}
              >
                <StripeCheckoutPanel
                  successDestination={successDestination}
                  submitLabel={submitLabel}
                  onClose={onClose}
                />
              </CheckoutElementsProvider>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
