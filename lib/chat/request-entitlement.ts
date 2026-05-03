/**
 * Request-linked chat entitlement helpers.
 *
 * When a hosting or activity request is accepted, a time-bounded chat window
 * is granted automatically. This window does NOT consume a normal active chat
 * slot for either party.
 *
 * Window rules:
 *   Hosting / trip request:
 *     - if start_date is within 14 days → opens immediately
 *     - otherwise → opens 14 days before start_date
 *     - expires at end of end_date (or start_date if no end_date)
 *
 *   Date-based activity (has start_at):
 *     - if start_at is within 14 days → opens immediately
 *     - otherwise → opens 14 days before start_at
 *     - expires end of that date
 *
 *   Non-date activity (no start_at):
 *     - opens immediately
 *     - expires 48 hours after acceptance
 */

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

function endOfDay(dateStr: string): Date {
  // dateStr = "YYYY-MM-DD"
  const d = new Date(`${dateStr}T23:59:59.999Z`);
  return d;
}

export function computeHostingEntitlementWindow(params: {
  acceptedAt: Date;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;   // YYYY-MM-DD
}): { opensAt: Date; expiresAt: Date } {
  const { acceptedAt, startDate, endDate } = params;
  const now = acceptedAt.getTime();

  let opensAt: Date;
  let expiresAt: Date;

  if (startDate) {
    const startMs = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const msUntilStart = startMs - now;
    if (msUntilStart <= FOURTEEN_DAYS_MS) {
      opensAt = acceptedAt;
    } else {
      opensAt = new Date(startMs - FOURTEEN_DAYS_MS);
    }
    const closingDate = endDate ?? startDate;
    expiresAt = endOfDay(closingDate);
  } else {
    // No date — open immediately, 48-hour window
    opensAt = acceptedAt;
    expiresAt = new Date(now + FORTY_EIGHT_HOURS_MS);
  }

  return { opensAt, expiresAt };
}

export function computeActivityEntitlementWindow(params: {
  acceptedAt: Date;
  startAt: string | null; // ISO timestamp or YYYY-MM-DD
  endAt: string | null;
}): { opensAt: Date; expiresAt: Date } {
  const { acceptedAt, startAt, endAt } = params;
  const now = acceptedAt.getTime();

  if (!startAt) {
    return {
      opensAt: acceptedAt,
      expiresAt: new Date(now + FORTY_EIGHT_HOURS_MS),
    };
  }

  const startMs = new Date(startAt).getTime();
  const msUntilStart = startMs - now;
  const opensAt = msUntilStart <= FOURTEEN_DAYS_MS ? acceptedAt : new Date(startMs - FOURTEEN_DAYS_MS);

  const closingTs = endAt ?? startAt;
  // Get the date part only, then end-of-day
  const dateStr = closingTs.slice(0, 10); // "YYYY-MM-DD"
  const expiresAt = endOfDay(dateStr);

  return { opensAt, expiresAt };
}
