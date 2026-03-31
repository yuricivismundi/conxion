"use client";

import VerificationCheckoutModal from "@/components/verification/VerificationCheckoutModal";
import { type VerificationResumePayload } from "@/lib/verification-client";

type Props = {
  open: boolean;
  returnTo?: string;
  resumePayload?: VerificationResumePayload | null;
  onClose: () => void;
  onError?: (message: string) => void;
  onAlreadyVerified?: () => void;
};

export default function VerificationRequiredDialog({
  open,
  returnTo,
  resumePayload,
  onClose,
  onError,
  onAlreadyVerified,
}: Props) {
  return (
    <VerificationCheckoutModal
      open={open}
      returnTo={returnTo}
      resumePayload={resumePayload}
      onClose={onClose}
      onError={onError}
      onAlreadyVerified={onAlreadyVerified}
    />
  );
}
