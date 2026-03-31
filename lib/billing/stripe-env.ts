export function normalizeStripeEnvValue(value: string | null | undefined) {
  if (typeof value !== "string") return "";

  let normalized = value.trim();

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized.replace(/\\r/g, "").replace(/\\n/g, "").trim();
}
