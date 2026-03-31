"use client";

import { useCallback, useState } from "react";
import type { UpgradeReason } from "@/lib/billing/upgrade-reasons";

export function useUpgradeModal(initialReason: UpgradeReason = "chat_limit_reached") {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<UpgradeReason>(initialReason);

  const openForReason = useCallback((nextReason: UpgradeReason) => {
    setReason(nextReason);
    setOpen(true);
  }, []);

  const closeUpgradeModal = useCallback(() => {
    setOpen(false);
  }, []);

  return {
    open,
    reason,
    openForReason,
    closeUpgradeModal,
  };
}
