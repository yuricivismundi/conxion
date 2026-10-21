import { LEGAL_PROFILE } from "@/lib/legal-profile";

/** Beta testers' WhatsApp community. Override with NEXT_PUBLIC_BETA_WHATSAPP_URL. */
export const BETA_WHATSAPP_URL =
  process.env.NEXT_PUBLIC_BETA_WHATSAPP_URL || "https://chat.whatsapp.com/KN32BjHdljK2fvWgb6Bcyz";

export const SUPPORT_EMAIL = LEGAL_PROFILE.supportEmail;
