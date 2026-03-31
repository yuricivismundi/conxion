const ACCOUNT_DEACTIVATED_AT_KEY = "account_deactivated_at";
const ACCOUNT_REACTIVATED_AT_KEY = "account_reactivated_at";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function getAccountDeactivatedAt(metadata: unknown): string | null {
  const value = asRecord(metadata)[ACCOUNT_DEACTIVATED_AT_KEY];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function buildAccountDeactivatedMetadata(deactivatedAt: string) {
  return {
    [ACCOUNT_DEACTIVATED_AT_KEY]: deactivatedAt,
    [ACCOUNT_REACTIVATED_AT_KEY]: null,
  };
}

export function buildAccountReactivatedMetadata(reactivatedAt: string) {
  return {
    [ACCOUNT_DEACTIVATED_AT_KEY]: null,
    [ACCOUNT_REACTIVATED_AT_KEY]: reactivatedAt,
  };
}
