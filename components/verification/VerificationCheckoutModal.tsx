"use client";

import StripeCheckoutDialog from "@/components/billing/StripeCheckoutDialog";
import {
  createVerificationCheckoutSession,
  type VerificationResumePayload,
} from "@/lib/verification-client";

type Props = {
  open: boolean;
  onClose: () => void;
  returnTo?: string;
  resumePayload?: VerificationResumePayload | null;
  onError?: (message: string) => void;
  onAlreadyVerified?: () => void;
};

export default function VerificationCheckoutModal({
  open,
  onClose,
  returnTo,
  resumePayload,
  onError,
  onAlreadyVerified,
}: Props) {
  return (
    <StripeCheckoutDialog
      open={open}
      title="Get Verified"
      badgeLabel="One-time trust upgrade"
      submitLabel="Confirm Verification"
      loadingLabel="Preparing verification checkout…"
      onClose={onClose}
      onError={onError}
      onAlreadyResolved={(result) => {
        onAlreadyVerified?.();
        onClose();
        window.location.assign(result.returnTo);
      }}
      loadSession={() => createVerificationCheckoutSession({ returnTo, resumePayload })}
    />
  );
}
