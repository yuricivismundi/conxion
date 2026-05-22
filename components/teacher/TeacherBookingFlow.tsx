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
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSelf, setIsSelf] = useState(false);
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
  }, [busy, isSelf, loadAvailability, note, onSubmitted, selectedAvailabilityId, serviceType, teacherUserId]);

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
        {isSelf && variant !== "inline" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-[#D4AF37]/25 bg-[#D4AF37]/[0.06] px-4 py-3 text-sm text-[#E8C875]">
            <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-[#D4AF37]">info</span>
            This is your own teacher profile. Visitors can use this flow to request private classes.
          </div>
        ) : null}
      </>
    );
  }

  function renderMonthSection(month: { label: string; cells: Array<{ key: string; date: string | null; inMonth: boolean; available: boolean }> }) {
    return (
      <section key={month.label} className="overflow-hidden rounded-2xl border border-white/[0.07]" style={{ background: "#181c20" }}>
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
        <div className="mb-1 grid grid-cols-7 gap-0.5 px-3 text-center">
          {["M", "T", "W", "T", "F", "S", "S"].map((label, i) => (
            <span key={i} className="py-1 text-[9px] font-bold uppercase tracking-widest text-white/50">{label}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5 px-3 pb-4">
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
                  "aspect-square rounded-lg text-[12px] font-bold transition-all",
                  selectedDate === cell.date
                    ? "scale-110 shadow-[0_0_16px_rgba(212,175,55,0.4)] text-[#040a0f]"
                    : cell.available
                      ? "border border-white/[0.08] bg-white/[0.04] text-white hover:border-[#D4AF37]/30 hover:bg-[#D4AF37]/[0.08] hover:text-[#E8C875]"
                      : "text-white/40 cursor-default",
                ].join(" ")}
                style={selectedDate === cell.date ? { background: "linear-gradient(135deg,#E8C875,#D4AF37)" } : undefined}
              >
                {dayNumber(cell.date)}
              </button>
            ) : (
              <div key={cell.key} className="aspect-square" />
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
        <div className="lg:hidden">
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

  function renderSlotButtons(compact = false) {
    if (!selectedDate) {
      return (
        <div className="flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-sm text-white/35">
          <span className="material-symbols-outlined text-[16px]">schedule</span>
          Choose a date to see time slots.
        </div>
      );
    }
    if (slotsForSelectedDate.length === 0) {
      return (
        <div className="flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-sm text-white/35">
          <span className="material-symbols-outlined text-[16px]">event_busy</span>
          No open slots on this date.
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {slotsForSelectedDate.map((slot) => (
          <button
            key={slot.availabilityId}
            type="button"
            onClick={() => setSelectedAvailabilityId(slot.availabilityId)}
            className={[
              "group relative w-full overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all",
              selectedAvailabilityId === slot.availabilityId
                ? "border-[#D4AF37]/45 text-white shadow-[0_0_24px_rgba(212,175,55,0.18)]"
                : "border-white/[0.07] bg-white/[0.03] text-white/70 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white",
            ].join(" ")}
            style={
              selectedAvailabilityId === slot.availabilityId
                ? { background: "linear-gradient(135deg,rgba(232,200,117,0.08),rgba(212,175,55,0.12))" }
                : undefined
            }
          >
            {selectedAvailabilityId === slot.availabilityId && (
              <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "linear-gradient(90deg,#E8C875,#D4AF37)" }} />
            )}
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black">{slot.timeLabel || `${formatShortTime(slot.startTime)} - ${formatShortTime(slot.endTime)}`}</p>
                {slot.duration ? (
                  <p className="mt-0.5 text-[11px] text-white/40">
                    {slot.duration} min
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {slot.note ? (
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/45">
                    {slot.note}
                  </span>
                ) : null}
                {selectedAvailabilityId === slot.availabilityId ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: "linear-gradient(135deg,#E8C875,#D4AF37)" }}>
                    <span className="material-symbols-outlined text-[12px] text-[#040a0f]">check</span>
                  </span>
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/[0.12] text-white/25 transition group-hover:border-white/25 group-hover:text-white/50">
                    <span className="material-symbols-outlined text-[12px]">radio_button_unchecked</span>
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
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
          className="w-full resize-none rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none transition focus:border-[#D4AF37]/30 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(212,175,55,0.08)]"
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
    return (
      <button
        type="button"
        onClick={() => void submitBooking()}
        disabled={!selectedAvailabilityId || busy || loading || isSelf}
        className={[
          "w-full rounded-2xl bg-gradient-to-r from-[#E8C875] via-[#D4AF37] to-[#B670CC] px-5 py-3 text-sm font-black text-[#040a0f] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 shadow-[0_8px_24px_rgba(212,175,55,0.15)]",
          extraClassName,
        ].join(" ")}
      >
        {busy ? "Sending..." : "Send booking request"}
      </button>
    );
  }

  if (variant === "inline") {
    return (
      <div className="p-4 sm:p-8 lg:p-10">

        <div className="space-y-6">
          {renderStateBanners()}
        </div>

        <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="space-y-6">{renderCalendarGrid()}</div>

          <aside ref={slotsRef} className="scroll-mt-6 rounded-2xl border border-white/[0.07] p-5" style={{ background: "#181c20" }}>
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
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">Selected date</p>
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
    <div className="space-y-5">
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_300px]">
        <section className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">2. Date</p>
          {renderCalendarGrid()}
        </section>

        <aside
          className="space-y-4 rounded-2xl border border-white/[0.07] p-4"
          style={{ background: "radial-gradient(circle at 50% 0%,rgba(93,216,216,0.04),transparent 60%),rgba(255,255,255,0.015)" }}
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
