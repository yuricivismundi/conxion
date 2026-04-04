export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
export const USERNAME_CHANGE_COOLDOWN_MS = USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export function getNextUsernameChangeDate(lastUpdatedAt: string | null) {
  if (!lastUpdatedAt) return null;
  const changedAt = new Date(lastUpdatedAt);
  if (Number.isNaN(changedAt.getTime())) return null;
  return new Date(changedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS).toISOString();
}

export function canChangeUsername(lastUpdatedAt: string | null) {
  const nextDate = getNextUsernameChangeDate(lastUpdatedAt);
  if (!nextDate) return true;
  return new Date(nextDate).getTime() <= Date.now();
}

function formatLongDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function getUsernameChangeCooldownMessage(lastUpdatedAt: string | null) {
  if (canChangeUsername(lastUpdatedAt)) return null;
  const nextDate = getNextUsernameChangeDate(lastUpdatedAt);
  if (!nextDate) return "You can change your username once every 30 days.";
  return `You can change your username once every 30 days. Next change: ${formatLongDate(nextDate)}.`;
}
