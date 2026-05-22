import { useMemo } from "react";

export type ThreadActivationState = {
  entitlementActive: boolean;
  chatActivationRecorded: boolean;
  chatActivationExpired: boolean;
  activationWindowLive: boolean;
  optimisticActivationLive: boolean;
  chatActivated: boolean;
  activeActivationEnd: Date | null;
};

export function useThreadActivation({
  activeIsArchived,
  effectiveMessagingState,
  entitlementActive,
  chatActivationRecorded,
  activationWindowLive,
  optimisticActivationLive,
  hasCompletedActivityContext,
  hasHistoricalFreeText,
  optimisticActivation,
  activeMeta,
  activeThreadEntitlement,
  activeMessages,
  chatActivationExpired,
}: {
  activeIsArchived: boolean;
  effectiveMessagingState: "active" | "inactive" | "archived";
  entitlementActive: boolean;
  chatActivationRecorded: boolean;
  activationWindowLive: boolean;
  optimisticActivationLive: boolean;
  hasCompletedActivityContext: boolean;
  hasHistoricalFreeText: boolean;
  optimisticActivation: { activationEnd: string } | null;
  activeMeta: { activatedAt?: string; activationCycleEnd?: string; messagingState?: string } | null;
  activeThreadEntitlement: { expiresAt: string } | null;
  activeMessages: Array<{ createdAt?: string }>;
  chatActivationExpired: boolean;
}): ThreadActivationState {
  const chatActivated = useMemo(
    () =>
      !activeIsArchived &&
      (
        entitlementActive ||
        hasCompletedActivityContext ||
        (effectiveMessagingState === "active" &&
          (optimisticActivationLive || (chatActivationRecorded ? activationWindowLive : hasHistoricalFreeText)))
      ),
    [
      activeIsArchived,
      entitlementActive,
      hasCompletedActivityContext,
      effectiveMessagingState,
      optimisticActivationLive,
      chatActivationRecorded,
      activationWindowLive,
      hasHistoricalFreeText,
    ]
  );

  const activeActivationEnd = useMemo(() => {
    const explicit =
      optimisticActivation?.activationEnd ||
      activeMeta?.activationCycleEnd ||
      (entitlementActive ? activeThreadEntitlement?.expiresAt ?? null : null) ||
      null;
    if (explicit) return new Date(explicit);

    // Legacy threads: derive end from activatedAt or last message + 30 days
    if (chatActivated) {
      const anchor =
        activeMeta?.activatedAt || activeMessages[activeMessages.length - 1]?.createdAt || null;
      if (anchor) {
        const date = new Date(anchor);
        date.setDate(date.getDate() + 30);
        return date;
      }
    }

    return null;
  }, [
    optimisticActivation?.activationEnd,
    activeMeta?.activationCycleEnd,
    activeMeta?.activatedAt,
    entitlementActive,
    activeThreadEntitlement?.expiresAt,
    chatActivated,
    activeMessages,
  ]);

  return {
    entitlementActive,
    chatActivationRecorded,
    chatActivationExpired,
    activationWindowLive,
    optimisticActivationLive,
    chatActivated,
    activeActivationEnd,
  };
}
