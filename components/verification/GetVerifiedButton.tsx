"use client";

import { type ReactNode, useState } from "react";
import VerificationCheckoutModal from "@/components/verification/VerificationCheckoutModal";
import { type VerificationResumePayload } from "@/lib/verification-client";

type Props = {
  className?: string;
  label?: string;
  children?: ReactNode;
  returnTo?: string;
  resumePayload?: VerificationResumePayload | null;
  disabled?: boolean;
  onAlreadyVerified?: () => void;
  onError?: (message: string) => void;
};

export default function GetVerifiedButton({
  className,
  label = "Get Verified",
  children,
  returnTo,
  resumePayload,
  disabled = false,
  onAlreadyVerified,
  onError,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={className}>
        {children ?? label}
      </button>

      <VerificationCheckoutModal
        open={open}
        returnTo={returnTo}
        resumePayload={resumePayload}
        onClose={() => setOpen(false)}
        onError={onError}
        onAlreadyVerified={onAlreadyVerified}
      />
    </>
  );
}
