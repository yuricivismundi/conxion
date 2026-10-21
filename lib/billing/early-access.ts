/**
 * Early access: while Conxion is building its first community, every account
 * gets the full product for free (Plus-level limits, Dance Page, private mode,
 * extra photos). Usage limits still apply to prevent abuse.
 *
 * Turn off by setting NEXT_PUBLIC_EARLY_ACCESS=false (paid plans + Stripe
 * checkout come back unchanged). The DB-side limit functions have their own
 * switch: public.app_settings key 'early_access' — see
 * scripts/sql/2026-10-20_early_access_free.sql.
 */
export const EARLY_ACCESS_ENABLED = process.env.NEXT_PUBLIC_EARLY_ACCESS !== "false";

/** Accounts created on or before this date keep the Founding Member badge forever. */
export const FOUNDING_MEMBER_CUTOFF = process.env.NEXT_PUBLIC_FOUNDING_MEMBER_CUTOFF ?? "2027-06-30T23:59:59Z";

export const EARLY_ACCESS_LABEL = "Founding member";
export const EARLY_ACCESS_SHORT = "Free during early access";

export function isFoundingMember(accountCreatedAt: string | null | undefined) {
  if (!accountCreatedAt) return false;
  const created = new Date(accountCreatedAt).getTime();
  const cutoff = new Date(FOUNDING_MEMBER_CUTOFF).getTime();
  if (Number.isNaN(created) || Number.isNaN(cutoff)) return false;
  return created <= cutoff;
}

/** Shown when a user hits a usage cap during early access (instead of an upsell). */
export const FAIR_USE_HINT =
  "You've reached this month's fair-use limit. It resets next month and keeps Conxion spam-free.";

/** Returns the paid upsell copy normally, or the fair-use copy during early access. */
export function paidUpgradeHint(paidHint: string) {
  return EARLY_ACCESS_ENABLED ? FAIR_USE_HINT : paidHint;
}
