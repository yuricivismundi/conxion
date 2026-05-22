import { useMemo } from "react";

export type MessagingSummaryState = {
  monthlyActivationRemaining: number | null;
  monthlyUsed: number;
  monthlyLimit: number;
  activationLimitReached: boolean;
};

export function useMessagingSummary(messagingSummary: { monthlyLimit: number; monthlyUsed: number } | null): MessagingSummaryState {
  return useMemo(() => {
    if (!messagingSummary) {
      return {
        monthlyActivationRemaining: null,
        monthlyUsed: 0,
        monthlyLimit: 0,
        activationLimitReached: false,
      };
    }

    const remaining = Math.max(0, messagingSummary.monthlyLimit - messagingSummary.monthlyUsed);
    return {
      monthlyActivationRemaining: remaining,
      monthlyUsed: messagingSummary.monthlyUsed,
      monthlyLimit: messagingSummary.monthlyLimit,
      activationLimitReached: remaining === 0,
    };
  }, [messagingSummary?.monthlyLimit, messagingSummary?.monthlyUsed]);
}
