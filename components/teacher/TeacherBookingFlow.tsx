"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import {
  formatShortDate,
  formatShortTime,
  parseIsoDate,
  type TeacherBookingServiceType,
} from "@/lib/teacher-bookings";

export type TeacherBookingFlowVariant = "profile" | "chat" | "inline";

type BookingAvailabilitySlot = {
  availabilityId: string;
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number | null;
  note: string | null;
  dateLabel: string;
  timeLabel: string;
};

type Props = {
  teacherUserId: string;
  teacherName: string;
  variant: TeacherBookingFlowVariant;
  initialServiceType?: TeacherBookingServiceType;
  contextLabel?: string | null;
  onSubmitted?: (message: string) => void;
};

type AvailabilityDate = {
  date: string;
  dateLabel: string;
};

const NOTE_LIMIT = 220;
const SERVICE_OPTIONS: Array<{ id: TeacherBookingServiceType; label: string; description: string }> = [
  {
    id: "private_class",
    label: "Private class",
    description: "One-to-one teacher session based on the teacher's open availability.",
  },
];

function toLocalDate(value: string) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, parsed.day);
}

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function weekdayIndexMondayFirst(date: Date) {
  return (date.getDay() + 6) % 7;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function dayNumber(value: string) {
  const date = toLocalDate(value);
  return date ? date.getDate() : null;
}

function buildMonthCells(monthStart: Date, availableDates: Set<string>) {
  const cells: Array<{ key: string; date: string | null; inMonth: boolean; available: boolean }> = [];
  const offset = weekdayIndexMondayFirst(monthStart);
  for (let index = 0; index < offset; index += 1) {
    cells.push({ key: `pad-start-${monthStart.toISOString()}-${index}`, date: null, inMonth: false, available: false });
  }

  const cursor = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  while (cursor.getMonth() === monthStart.getMonth()) {
    const value = isoDate(cursor);
    cells.push({
      key: value,
      date: value,
      inMonth: true,
      available: availableDates.has(value),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `pad-end-${monthStart.toISOString()}-${cells.length}`, date: null, inMonth: false, available: false });
  }

  return cells;
}

function firstAvailabilityIdForDate(slots: BookingAvailabilitySlot[], date: string) {
  return slots.find((slot) => slot.date === date)?.availabilityId ?? "";
}

function serviceLabel(serviceType: TeacherBookingServiceType) {
  return SERVICE_OPTIONS.find((option) => option.id === serviceType)?.label ?? "Private class";
}

export default function TeacherBookingFlow({
  teacherUserId,
  teacherName,
  variant,
  initialServiceType = "private_class",
  contextLabel,
  onSubmitted,
}: Props) {
  const [serviceType] = useState<TeacherBookingServiceType>(initialServiceType);
  const [slots, setSlots] = useState<BookingAvailabilitySlot[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedAvailabilityId, setSelectedAvailabilityId] = useState("");
  const [requestedStartTime, setRequestedStartTime] = useState("");
  const [requestedEndTime, setRequestedEndTime] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSelf, setIsSelf] = useState(false);
  const [bookingUsage, setBookingUsage] = useState<{ used: number; limit: number | null; remaining: number | null } | null>(null);
  const selectedDateRef = useRef("");

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  const applySlots = useCallback((nextSlots: BookingAvailabilitySlot[], preferredDate?: string | null) => {
    setSlots(nextSlots);
    const nextDate =
      preferredDate && nextSlots.some((slot) => slot.date === preferredDate)
        ? preferredDate
        : nextSlots[0]?.date ?? "";
    setSelectedDate(nextDate);
    setSelectedAvailabilityId(nextDate ? firstAvailabilityIdForDate(nextSlots, nextDate) : "");
  }, []);

  const loadAvailability = useCallback(
    async (preferredDate?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/teacher-bookings/availability?teacherId=${encodeURIComponent(teacherUserId)}`);
        const result = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          slots?: BookingAvailabilitySlot[];
        } | null;
        if (!response.ok || !result?.ok) {
          throw new Error(result?.error ?? "Could not load booking availability.");
        }
        applySlots(Array.isArray(result.slots) ? result.slots : [], preferredDate);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load booking availability.");
        applySlots([], "");
      } finally {
        setLoading(false);
      }
    },
    [applySlots, teacherUserId]
  );

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setIsSelf(Boolean(data.user && data.user.id === teacherUserId));
    });
    return () => {
      cancelled = true;
    };
  }, [teacherUserId]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sessionRes = await supabase.auth.getSession();
        const accessToken = sessionRes.data.session?.access_token ?? "";
        if (!accessToken) return;
        const res = await fetch("/api/teacher-bookings/usage", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = (await res.json().catch(() => null)) as { ok?: boolean; used?: number; limit?: number | null; remaining?: number | null } | null;
        if (!cancelled && res.ok && result?.ok) {
          setBookingUsage({
            used: result.used ?? 0,
            limit: result.limit ?? null,
            remaining: result.remaining ?? null,
          });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const availableDates = useMemo<AvailabilityDate[]>(() => {
    const seen = new Set<string>();
    return slots.filter((slot) => {
      if (seen.has(slot.date)) return false;
      seen.add(slot.date);
      return true;
    }).map((slot) => ({ date: slot.date, dateLabel: slot.dateLabel || formatShortDate(slot.date) }));
  }, [slots]);

  const availableDateSet = useMemo(() => new Set(availableDates.map((item) => item.date)), [availableDates]);
  const slotsForSelectedDate = useMemo(() => slots.filter((slot) => slot.date === selectedDate), [selectedDate, slots]);
  const selectedSlot = useMemo(
    () => slotsForSelectedDate.find((slot) => slot.availabilityId === selectedAvailabilityId) ?? null,
    [selectedAvailabilityId, slotsForSelectedDate]
  );

  useEffect(() => {
    if (!selectedSlot) {
      setRequestedStartTime("");
      setRequestedEndTime("");
      return;
    }
    const windowStart = (selectedSlot.startTime ?? "").slice(0, 5);
    const windowEnd = (selectedSlot.endTime ?? "").slice(0, 5);
    setRequestedStartTime((prev) => (prev && prev >= windowStart && prev < windowEnd ? prev : windowStart));
    setRequestedEndTime((prev) => {
      if (prev && prev > windowStart && prev <= windowEnd) return prev;
      const [h, m] = windowStart.split(":").map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) {
        const proposed = h + 1;
        const candidate = `${String(proposed).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        return candidate <= windowEnd ? candidate : windowEnd;
      }
      return windowEnd;
    });
  }, [selectedSlot]);

  const calendarMonths = useMemo(() => {
    const start = startOfMonth(new Date());
    return [0, 1, 2].map((offset) => {
      const monthStart = addMonths(start, offset);
      return {
        label: monthLabel(monthStart),
        cells: buildMonthCells(monthStart, availableDateSet),
      };
    });
  }, [availableDateSet]);

  const [mobileMonthIndex, setMobileMonthIndex] = useState(0);
  const slotsRef = useRef<HTMLDivElement>(null);

  const submitBooking = useCallback(async () => {
    if (!selectedAvailabilityId || busy || isSelf) return;
    if (!requestedStartTime || !requestedEndTime || requestedEndTime <= requestedStartTime) {
      setError("Pick a valid start and end time within the available window.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token ?? "";
      if (!accessToken) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/auth?next=${encodeURIComponent(next)}`);
        return;
      }

      const response = await fetch("/api/teacher-bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          teacherId: teacherUserId,
          availabilityId: selectedAvailabilityId,
          serviceType,
          note: note.trim() || null,
          requestedStartTime,
          requestedEndTime,
        }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Could not send booking request.");
      }

      setNote("");
      await loadAvailability(selectedDateRef.current);
      if (onSubmitted) {
        onSubmitted("Booking request sent.");
      } else {
        setInfo("Booking request sent.");
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send booking request.");
    } finally {
      setBusy(false);
    }
  }, [busy, isSelf, loadAvailability, note, onSubmitted, requestedEndTime, requestedStartTime, selectedAvailabilityId, serviceType, teacherUserId]);

  function renderStateBanners() {
    return (
      <>
        {error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-200">
            <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-rose-400">error</span>
            {error}
          </div>
        ) : null}
        {info ? (
          <div className="flex items-start gap-3 rounded-2xl border border-[#5DD8D8]/30 bg-[#5DD8D8]/[0.07] px-4 py-3 text-sm text-[#5DD8D8]">
            <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px]">check_circle</span>
            {info}
          </div>
        ) : null}
        {isSelf ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-200">
            <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-amber-400">info</span>
            This is your own teacher profile. Visitors can use this flow to request private classes.
          </div>
        ) : null}
      </>
    );
  }

  function renderMonthSection(month: { label: string; cells: Array<{ key: string; date: string | null; inMonth: boolean; available: boolean }> }) {
    return (
      <section key={month.label} className="w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-white/[0.07]" style={{ background: "#181c20" }}>
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <h3 className="text-[13px] font-black tracking-tight text-white">{month.label}</h3>
          {month.cells.some((c) => c.available) ? (
            <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest" style={{ background: "rgba(93,216,216,0.1)", color: "#5DD8D8" }}>
              Available
            </span>
          ) : (
            <span className="text-[9px] uppercase tracking-widest text-white/40">No slots</span>
          )}
        </div>
        <div className="mb-1 grid w-full gap-px px-1.5 sm:gap-0.5 sm:px-3 text-center" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
          {["M", "T", "W", "T", "F", "S", "S"].map((label, i) => (
            <span key={i} className="min-w-0 py-1 text-[9px] font-bold uppercase tracking-wider text-white/50 sm:tracking-widest">{label}</span>
          ))}
        </div>
        <div className="grid w-full gap-px px-1.5 pb-3 sm:gap-0.5 sm:px-3 sm:pb-4" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
          {month.cells.map((cell) =>
            cell.date ? (
              <button
                key={cell.key}
                type="button"
                disabled={!cell.available}
                onClick={() => {
                  setSelectedDate(cell.date as string);
                  setSelectedAvailabilityId(firstAvailabilityIdForDate(slots, cell.date as string));
                  setTimeout(() => slotsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
                }}
                className={[
                  "flex h-8 min-w-0 items-center justify-center rounded-md text-[11px] font-bold transition-all sm:h-11 sm:rounded-lg sm:text-[12px] lg:h-12",
                  selectedDate === cell.date
                    ? "scale-110 shadow-[0_0_12px_rgba(93,216,216,0.35)] text-[#040a0f]"
                    : cell.available
                      ? "border border-white/[0.08] bg-white/[0.04] text-white hover:border-[#5DD8D8]/30 hover:bg-[#5DD8D8]/[0.08] hover:text-[#5DD8D8]"
                      : "text-white/40 cursor-default",
                ].join(" ")}
                style={selectedDate === cell.date ? { background: "linear-gradient(135deg,#5DD8D8,#B670CC)" } : undefined}
              >
                {dayNumber(cell.date)}
              </button>
            ) : (
              <div key={cell.key} className="h-8 min-w-0 sm:h-11 lg:h-12" />
            )
          )}
        </div>
      </section>
    );
  }

  function renderCalendarGrid() {
    if (loading) {
      return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="mb-4 h-4 w-24 animate-pulse rounded-full bg-white/[0.06]" />
              <div className="mb-2 grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }).map((_, j) => (
                  <div key={j} className="aspect-square rounded-lg bg-white/[0.04]" />
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 35 }).map((_, j) => (
                  <div key={j} className="aspect-square animate-pulse rounded-lg bg-white/[0.03]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (availableDates.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-12 text-center">
          <span className="material-symbols-outlined text-[32px] text-white/20">calendar_month</span>
          <p className="text-sm text-white/40">No open booking dates yet.</p>
        </div>
      );
    }
    return (
      <>
        {/* Mobile: single-month carousel */}
        <div className="w-full min-w-0 max-w-full lg:hidden">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMobileMonthIndex((i) => Math.max(0, i - 1))}
              disabled={mobileMonthIndex === 0}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/50 transition disabled:opacity-25 hover:text-white"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <span className="text-sm font-bold text-white">{calendarMonths[mobileMonthIndex]?.label}</span>
            <button
              type="button"
              onClick={() => setMobileMonthIndex((i) => Math.min(calendarMonths.length - 1, i + 1))}
              disabled={mobileMonthIndex === calendarMonths.length - 1}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/50 transition disabled:opacity-25 hover:text-white"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
          {calendarMonths[mobileMonthIndex] ? renderMonthSection(calendarMonths[mobileMonthIndex]) : null}
          {/* Dot indicators */}
          <div className="mt-3 flex justify-center gap-1.5">
            {calendarMonths.map((_, i) => (
              <button key={i} type="button" onClick={() => setMobileMonthIndex(i)} className={["h-1.5 rounded-full transition-all", i === mobileMonthIndex ? "w-4 bg-[#5DD8D8]" : "w-1.5 bg-white/20"].join(" ")} />
            ))}
          </div>
        </div>
        {/* Desktop: 3-column grid */}
        <div className="hidden gap-3 lg:grid lg:grid-cols-3">
          {calendarMonths.map((month) => renderMonthSection(month))}
        </div>
      </>
    );
  }

  function renderCompactDatePicker() {
    if (loading) {
      return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/45">
          Loading availability...
        </div>
      );
    }
    if (availableDates.length === 0) {
      return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/45">
          No open booking dates yet.
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {availableDates.map((dateOption) => (
          <button
            key={dateOption.date}
            type="button"
            onClick={() => {
              setSelectedDate(dateOption.date);
              setSelectedAvailabilityId(firstAvailabilityIdForDate(slots, dateOption.date));
            }}
            className={[
              "rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition-colors",
              selectedDate === dateOption.date
                ? "border-cyan-300/40 bg-cyan-300/12 text-cyan-50"
                : "border-white/[0.08] bg-white/[0.03] text-white/70 hover:border-white/15 hover:bg-white/[0.05]",
            ].join(" ")}
          >
            {dateOption.dateLabel}
          </button>
        ))}
      </div>
    );
  }

  function renderSlotButtons(_compact = false) {
    if (!selectedDate) {
      return (
        <div className="flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-sm text-white/35">
          <span className="material-symbols-outlined text-[16px]">schedule</span>
          Choose a date to see availability.
        </div>
      );
    }
    if (slotsForSelectedDate.length === 0) {
      return (
        <div className="flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-sm text-white/35">
          <span className="material-symbols-outlined text-[16px]">event_busy</span>
          No open availability on this date.
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {slotsForSelectedDate.map((slot) => {
          const isSelected = selectedAvailabilityId === slot.availabilityId;
          const windowStart = (slot.startTime ?? "").slice(0, 5);
          const windowEnd = (slot.endTime ?? "").slice(0, 5);
          const requestedMinutes = (() => {
            if (!isSelected || !requestedStartTime || !requestedEndTime) return null;
            const [sh, sm] = requestedStartTime.split(":").map(Number);
            const [eh, em] = requestedEndTime.split(":").map(Number);
            if (![sh, sm, eh, em].every(Number.isFinite)) return null;
            const diff = eh * 60 + em - (sh * 60 + sm);
            return diff > 0 ? diff : null;
          })();
          return (
            <div
              key={slot.availabilityId}
              className={[
                "relative w-full overflow-hidden rounded-2xl border px-4 py-3 transition-all",
                isSelected
                  ? "border-[#B670CC]/40 text-white shadow-[0_0_20px_rgba(182,112,204,0.15)]"
                  : "border-white/[0.07] bg-white/[0.03] text-white/70",
              ].join(" ")}
              style={
                isSelected
                  ? { background: "linear-gradient(135deg,rgba(93,216,216,0.1),rgba(182,112,204,0.12))" }
                  : undefined
              }
            >
              {isSelected && (
                <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "linear-gradient(90deg,#5DD8D8,#B670CC)" }} />
              )}
              <button
                type="button"
                onClick={() => setSelectedAvailabilityId(slot.availabilityId)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Available window</p>
                  <p className="mt-0.5 whitespace-nowrap text-sm font-black">{formatShortTime(slot.startTime)} – {formatShortTime(slot.endTime)}</p>
                  {slot.note ? (
                    <p className="mt-1.5 line-clamp-2 text-[11px] text-white/40">{slot.note}</p>
                  ) : null}
                </div>
                {isSelected ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: "linear-gradient(135deg,#5DD8D8,#B670CC)" }}>
                    <span className="material-symbols-outlined text-[12px] text-[#040a0f]">check</span>
                  </span>
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/[0.12] text-white/25">
                    <span className="material-symbols-outlined text-[12px]">radio_button_unchecked</span>
                  </span>
                )}
              </button>

              {isSelected ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">Your start</span>
                    <input
                      type="time"
                      value={requestedStartTime}
                      min={windowStart}
                      max={windowEnd}
                      onChange={(e) => setRequestedStartTime(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#5DD8D8]/40"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">Your end</span>
                    <input
                      type="time"
                      value={requestedEndTime}
                      min={requestedStartTime || windowStart}
                      max={windowEnd}
                      onChange={(e) => setRequestedEndTime(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#5DD8D8]/40"
                    />
                  </label>
                  <div className="col-span-2 flex items-center justify-between text-[11px] text-white/45">
                    <span>Pick any range within the window.</span>
                    {requestedMinutes ? (
                      <span className="font-semibold text-white/70">
                        {requestedMinutes >= 60
                          ? `${Math.floor(requestedMinutes / 60)}h${requestedMinutes % 60 ? ` ${requestedMinutes % 60}m` : ""}`
                          : `${requestedMinutes} min`}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  function renderNoteField(labelPrefix: string) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-widest text-white/60">{labelPrefix}</label>
          <span className="text-[10px] text-white/40">{Math.max(0, NOTE_LIMIT - note.length)}/{NOTE_LIMIT}</span>
        </div>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, NOTE_LIMIT))}
          rows={variant === "chat" ? 2 : 3}
          placeholder={
            variant === "chat"
              ? `Add a quick note for ${teacherName}.`
              : `Share your level, goals, or anything ${teacherName} should know.`
          }
          className="w-full resize-none rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none transition focus:border-[#5DD8D8]/25 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(93,216,216,0.06)]"
        />
        {selectedSlot ? (
          <p className="flex items-center gap-1.5 text-[11px] text-white/35">
            <span className="material-symbols-outlined text-[13px]">event</span>
            Requesting {selectedSlot.dateLabel || formatShortDate(selectedSlot.date)} at {selectedSlot.timeLabel || formatShortTime(selectedSlot.startTime)}.
          </p>
        ) : null}
      </section>
    );
  }

  function renderSubmitButton(extraClassName = "") {
    const atLimit = Boolean(bookingUsage && bookingUsage.limit !== null && (bookingUsage.remaining ?? 0) <= 0);
    return (
      <button
        type="button"
        onClick={() => void submitBooking()}
        disabled={!selectedAvailabilityId || busy || loading || isSelf || atLimit}
        className={[
          "w-full rounded-2xl bg-gradient-to-r from-[#5DD8D8] via-[#7c3aff] to-[#ff00ff] px-5 py-3 text-sm font-black text-[#040a0f] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40",
          extraClassName,
        ].join(" ")}
      >
        {busy ? "Sending..." : atLimit ? "Monthly booking limit reached" : "Send booking request"}
      </button>
    );
  }

  if (variant === "inline") {
    return (
      <div className="w-full min-w-0 max-w-full overflow-hidden p-2 sm:p-8 lg:p-10">

        <div className="space-y-6">
          {renderStateBanners()}
        </div>

        <div className="mt-6 grid w-full min-w-0 gap-8 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="min-w-0 space-y-6">{renderCalendarGrid()}</div>

          <aside ref={slotsRef} className="scroll-mt-6 min-w-0 break-words rounded-2xl border border-white/[0.07] p-5" style={{ background: "#181c20", overflowWrap: "anywhere" }}>
            {/* Back to calendar — mobile only */}
            {selectedDate && (
              <button
                type="button"
                onClick={() => { setSelectedDate(""); setSelectedAvailabilityId(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                className="mb-4 flex items-center gap-1.5 text-[11px] font-semibold text-white/40 transition hover:text-white lg:hidden"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                Back to calendar
              </button>
            )}
            <div className="mb-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">Selected date</p>
                {!isSelf && bookingUsage && bookingUsage.limit !== null ? (
                  <span className="text-[10px] tracking-wide text-white/30">
                    <span className={(bookingUsage.remaining ?? 0) <= 0 ? "text-rose-400/80" : (bookingUsage.remaining ?? 0) === 1 ? "text-amber-300/80" : "text-white/40"}>
                      {bookingUsage.remaining ?? 0}/{bookingUsage.limit}
                    </span>
                    <span className="ml-1">left this month</span>
                  </span>
                ) : null}
              </div>
              <h3 className="mt-2 text-2xl font-black text-white">
                {selectedDate ? (availableDates.find((slot) => slot.date === selectedDate)?.dateLabel ?? selectedDate) : "Choose a date"}
              </h3>
              <p className="mt-2 text-sm text-white/50">
                {selectedDate ? "Pick a time slot and send the request from here." : "Use the calendar to explore available bookable dates."}
              </p>
            </div>

            <div className="mb-5">{renderSlotButtons()}</div>
            {renderNoteField("Note")}
            <div className="mt-4">{renderSubmitButton("uppercase tracking-[0.16em]")}</div>
          </aside>
        </div>
      </div>
    );
  }

  if (variant === "chat") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-cyan-300/25 bg-cyan-300/8 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">
            {serviceLabel(serviceType)}
          </span>
          {contextLabel ? (
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
              {contextLabel}
            </span>
          ) : null}
        </div>

        {renderStateBanners()}

        <section className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">1. Date</p>
          {renderCompactDatePicker()}
        </section>

        <section className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">2. Slot</p>
          {renderSlotButtons(true)}
        </section>

        {renderNoteField("3. Note (optional)")}

        {renderSubmitButton()}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-5">
      {renderStateBanners()}

      <section className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">1. Service</p>
        {SERVICE_OPTIONS.map((option) => (
          <div
            key={option.id}
            className="relative overflow-hidden rounded-2xl border border-[#5DD8D8]/25 px-5 py-4"
            style={{ background: "linear-gradient(135deg,rgba(93,216,216,0.07) 0%,rgba(182,112,204,0.07) 100%)" }}
          >
            <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "linear-gradient(90deg,#5DD8D8,#B670CC)" }} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-white">{option.label}</p>
                <p className="mt-1 text-xs leading-5 text-white/50">{option.description}</p>
              </div>
              <span
                className="mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-[#5DD8D8]"
                style={{ background: "rgba(93,216,216,0.1)" }}
              >
                Selected
              </span>
            </div>
          </div>
        ))}
      </section>

      <div className="grid w-full min-w-0 gap-4 lg:grid-cols-[minmax(0,1.3fr)_300px]">
        <section className="min-w-0 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">2. Date</p>
          {renderCalendarGrid()}
        </section>

        <aside
          className="min-w-0 space-y-4 break-words rounded-2xl border border-white/[0.07] p-4"
          style={{ background: "radial-gradient(circle at 50% 0%,rgba(93,216,216,0.04),transparent 60%),rgba(255,255,255,0.015)", overflowWrap: "anywhere" }}
        >
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/30">3. Slot</p>
            {renderSlotButtons(true)}
          </div>

          {renderNoteField("4. Note (optional)")}
          {renderSubmitButton()}
        </aside>
      </div>
    </div>
  );
}
