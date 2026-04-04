export type LegalProfile = {
  brandName: string;
  serviceDomain: string;
  operatorName: string;
  privacyEmail: string;
  supportEmail: string;
  postalAddressLines: string[];
  postalCountry: string | null;
  governingLaw: string | null;
  jurisdiction: string | null;
};

// Replace these values once the registered entity, service address, and dispute forum are finalized.
export const LEGAL_PROFILE: LegalProfile = {
  brandName: "ConXion",
  serviceDomain: "conxion.social",
  operatorName: "Yuri Bucio",
  privacyEmail: "privacy@conxion.app",
  supportEmail: "support@conxion.social",
  postalAddressLines: ["Liivalaia 40", "Tallinn"],
  postalCountry: "Estonia",
  governingLaw: null,
  jurisdiction: null,
};

export function hasPublishedPostalAddress() {
  return LEGAL_PROFILE.postalAddressLines.length > 0;
}

export function formatPublishedPostalAddress() {
  const parts = [...LEGAL_PROFILE.postalAddressLines];
  if (LEGAL_PROFILE.postalCountry) parts.push(LEGAL_PROFILE.postalCountry);
  return parts.join(", ");
}
