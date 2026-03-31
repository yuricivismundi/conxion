export const REFERENCE_REPORT_REASON_OPTIONS = [
  "This reference is spam or commercial activity",
  "I want to dispute the content of this reference",
  "This reference makes me feel unsafe or threatened",
  "This reference is harassment or abuse",
  "This reference appears to be impersonation or fake activity",
] as const;

export type ReferenceReportReason = (typeof REFERENCE_REPORT_REASON_OPTIONS)[number];
