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
          <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}
        {info ? (
          <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
            {info}
          </div>
        ) : null}
        {isSelf ? (
          <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            This is your own teacher profile. Visitors can use this flow to request private classes.
          </div>
        ) : null}
      </>
    );
  }

  function renderCalendarGrid() {
    if (loading) {
      return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-10 text-center text-sm text-white/45">
          Loading availability...
        </div>
      );
    }
    if (availableDates.length === 0) {
      return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-10 text-center text-sm text-white/45">
          No open booking dates yet.
        </div>
      );
    }
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {calendarMonths.map((month) => (
          <section key={month.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">{month.label}</h3>
              <span className="text-[10px] uppercase tracking-[0.16em] text-white/30">Available</span>
            </div>
            <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-white/25">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {month.cells.map((cell) =>
                cell.date ? (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => {
                      setSelectedDate(cell.date as string);
                      setSelectedAvailabilityId(firstAvailabilityIdForDate(slots, cell.date as string));
                    }}
                    className={[
                      "aspect-square rounded-xl border text-sm font-semibold transition-colors",
                      selectedDate === cell.date
                        ? "border-cyan-300/45 bg-cyan-300/16 text-cyan-50"
                        : cell.available
                          ? "border-white/10 bg-white/[0.03] text-white hover:border-white/20 hover:bg-white/[0.06]"
                          : "border-transparent bg-black/20 text-white/20",
                    ].join(" ")}
                  >
                    {dayNumber(cell.date)}
                  </button>
                ) : (
                  <div key={cell.key} className="aspect-square rounded-xl" />
                )
              )}
            </div>
          </section>
        ))}
      </div>
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
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/45">
          Choose a date to see time slots.
        </div>
      );
    }
    if (slotsForSelectedDate.length === 0) {
      return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-white/45">
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
              "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
              selectedAvailabilityId === slot.availabilityId
                ? "border-fuchsia-300/40 bg-fuchsia-300/12 text-white"
                : compact
                  ? "border-white/[0.08] bg-white/[0.03] text-white/70 hover:border-white/15 hover:bg-white/[0.05]"
                  : "border-white/10 bg-black/20 text-zinc-300 hover:border-white/20 hover:bg-black/30",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{slot.timeLabel || `${formatShortTime(slot.startTime)} - ${formatShortTime(slot.endTime)}`}</p>
                {slot.duration ? <p className="mt-0.5 text-xs text-white/45">{slot.duration} min</p> : null}
              </div>
              {slot.note ? (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/55">
                  {slot.note}
                </span>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    );
  }

  function renderNoteField(labelPrefix: string) {
    return (
      <section className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">{labelPrefix}</label>
          <span className="text-[10px] text-white/25">{Math.max(0, NOTE_LIMIT - note.length)}/{NOTE_LIMIT}</span>
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
          className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-[#0df2f2]/30 focus:bg-white/[0.06]"
        />
        {selectedSlot ? (
          <p className="text-xs text-white/40">
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
          "w-full rounded-2xl bg-gradient-to-r from-[#0df2f2] via-[#7c3aff] to-[#ff00ff] px-5 py-3 text-sm font-black text-[#040a0f] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40",
          extraClassName,
        ].join(" ")}
      >
        {busy ? "Sending..." : "Send booking request"}
      </button>
    );
  }

  if (variant === "inline") {
    return (
      <div className="mb-24 rounded-2xl bg-zinc-950 p-8 sm:p-10">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-black text-4xl tracking-tighter text-white">Private Class Availability</h2>
            <p className="mt-3 text-zinc-500">Check bookable dates for the next 3 months and send a request directly.</p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-100">
            {serviceLabel(serviceType)}
          </span>
        </div>

        <div className="space-y-6">
          {renderStateBanners()}
        </div>

        <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="space-y-6">{renderCalendarGrid()}</div>

          <aside className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Selected date</p>
              <h3 className="mt-2 text-2xl font-black text-white">
                {selectedDate ? (availableDates.find((slot) => slot.date === selectedDate)?.dateLabel ?? selectedDate) : "Choose a date"}
              </h3>
              <p className="mt-2 text-sm text-zinc-500">
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

      <section className="space-y-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">1. Service</p>
        {SERVICE_OPTIONS.map((option) => (
          <div
            key={option.id}
            className="rounded-2xl border border-[#0df2f2]/40 bg-gradient-to-br from-[#0df2f2]/10 to-[#d93bff]/10 px-4 py-4 shadow-[0_0_16px_rgba(13,204,242,0.12)]"
          >
            <p className="text-sm font-semibold text-white">{option.label}</p>
            <p className="mt-1 text-xs leading-5 text-white/55">{option.description}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_280px]">
        <section className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">2. Date</p>
          {renderCalendarGrid()}
        </section>

        <aside className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">3. Slot</p>
            <div className="mt-2">{renderSlotButtons(true)}</div>
          </div>

          {renderNoteField("4. Note (optional)")}
          {renderSubmitButton()}
        </aside>
      </div>
    </div>
  );
}
