export const TEACHER_BOOKING_SERVICE_TYPES = ["private_class"] as const;
export const TEACHER_BOOKING_STATUSES = ["pending", "accepted", "declined"] as const;

export type TeacherBookingServiceType = (typeof TEACHER_BOOKING_SERVICE_TYPES)[number];
export type TeacherBookingStatus = (typeof TEACHER_BOOKING_STATUSES)[number];

export function isTeacherBookingServiceType(value: unknown): value is TeacherBookingServiceType {
  return typeof value === "string" && (TEACHER_BOOKING_SERVICE_TYPES as readonly string[]).includes(value);
}

export function isTeacherBookingStatus(value: unknown): value is TeacherBookingStatus {
  return typeof value === "string" && (TEACHER_BOOKING_STATUSES as readonly string[]).includes(value);
}

export function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return { year, month, day };
}

export function parseTimeParts(value: string) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return { hour, minute, second };
}

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addMonthsClamped(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function isDateWithinNextThreeMonths(value: string, now = new Date()) {
  const parsed = parseIsoDate(value);
  if (!parsed) return false;
  const selected = new Date(parsed.year, parsed.month - 1, parsed.day);
  const min = startOfLocalDay(now);
  const max = addMonthsClamped(min, 3);
  return selected >= min && selected <= max;
}

export function isoDateWeekday(value: string) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, parsed.day).getDay();
}

export function generateWeeklyDatesWithinNextThreeMonths(anchorDate: string, now = new Date()) {
  if (!isDateWithinNextThreeMonths(anchorDate, now)) return [] as string[];
  const parsed = parseIsoDate(anchorDate);
  if (!parsed) return [] as string[];

  const min = startOfLocalDay(now);
  const max = addMonthsClamped(min, 3);
  const results: string[] = [];
  let cursor = new Date(parsed.year, parsed.month - 1, parsed.day);

  while (cursor <= max) {
    if (cursor >= min) {
      results.push(
        `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`
      );
    }
    cursor = addDays(cursor, 7);
  }

  return results;
}

export function isTimeRangeValid(startTime: string, endTime: string) {
  const start = parseTimeParts(startTime);
  const end = parseTimeParts(endTime);
  if (!start || !end) return false;
  if (end.hour < start.hour) return false;
  if (end.hour === start.hour && end.minute <= start.minute) return false;
  return true;
}

export function durationMinutesFromTimeRange(startTime: string, endTime: string) {
  const start = parseTimeParts(startTime);
  const end = parseTimeParts(endTime);
  if (!start || !end) return null;
  return end.hour * 60 + end.minute - (start.hour * 60 + start.minute);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function formatShortDate(date: string) {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(parsed.year, parsed.month - 1, parsed.day));
}

export function formatShortTime(value: string) {
  const parts = parseTimeParts(value);
  if (!parts) return value;
  const suffix = parts.hour >= 12 ? "PM" : "AM";
  const displayHour = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${displayHour}:${pad2(parts.minute)} ${suffix}`;
}

function toCalendarDateTime(date: string, time: string) {
  const parsedDate = parseIsoDate(date);
  const parsedTime = parseTimeParts(time);
  if (!parsedDate || !parsedTime) return "";
  return `${parsedDate.year}${pad2(parsedDate.month)}${pad2(parsedDate.day)}T${pad2(parsedTime.hour)}${pad2(parsedTime.minute)}${pad2(parsedTime.second)}`;
}

export function buildTeacherBookingCalendarUrl(params: {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  details?: string | null;
  location?: string | null;
}) {
  const search = new URLSearchParams({
    action: "TEMPLATE",
    text: params.title,
    dates: `${toCalendarDateTime(params.date, params.startTime)}/${toCalendarDateTime(params.date, params.endTime)}`,
  });
  if (params.details) search.set("details", params.details);
  if (params.location) search.set("location", params.location);
  return `https://calendar.google.com/calendar/render?${search.toString()}`;
}
