"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  buildTeacherBookingCalendarUrl,
  formatShortDate,
  formatShortTime,
  generateWeeklyDates,
  isDateWithinNextThreeMonths,
  isTeacherBookingStatus,
  isTimeRangeValid,
  type TeacherBookingStatus,
} from "@/lib/teacher-bookings";

const REPEAT_OPTIONS = [
  { label: "No repeat — one slot only", value: 0 },
  { label: "Every week for 1 month", value: 1 },
  { label: "Every week for 2 months", value: 2 },
  { label: "Every week for 3 months", value: 3 },
] as const;

type AvailabilityRow = {
  id: string;
  teacher_id: string;
  availability_date: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
  note: string | null;
  created_at: string;
};

type BookingRow = {
  id: string;
  teacher_id: string;
  student_id: string;
  availability_id: string | null;
  service_type: string;
  session_date: string;
  session_time: string;
  duration_min: number | null;
  note: string | null;
  status: TeacherBookingStatus;
  created_at: string;
};

type Props = {
  teacherUserId: string;
  teacherName: string;
};

function statusClasses(status: TeacherBookingStatus) {
  if (status === "accepted") return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  if (status === "declined") return "border-rose-300/30 bg-rose-400/10 text-rose-100";
  return "border-amber-300/30 bg-amber-400/10 text-amber-100";
}

function AvailabilityByMonth({
  slots,
  saving,
  onRemove,
}: {
  slots: AvailabilityRow[];
  saving: boolean;
  onRemove: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = slots.reduce<{ key: string; label: string; slots: AvailabilityRow[] }[]>((acc, slot) => {
    const d = new Date(slot.availability_date + "T00:00:00");
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const existing = acc.find((g) => g.key === key);
    if (existing) { existing.slots.push(slot); } else { acc.push({ key, label, slots: [slot] }); }
    return acc;
  }, []);

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isOpen = !collapsed[group.key];
        return (
          <div key={group.key} className="rounded-xl border border-white/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setCollapsed((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-white/[0.03]"
            >
              <span className="text-sm font-semibold text-slate-200">{group.label}</span>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">{group.slots.length} slot{group.slots.length !== 1 ? "s" : ""}</span>
                <span className="material-symbols-outlined text-[16px] text-slate-500 transition-transform" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>expand_more</span>
              </div>
            </button>
            {isOpen && (
              <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
                {group.slots.map((slot) => (
                  <div key={slot.id} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-200">{new Date(slot.availability_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</p>
                        <p className="text-xs text-slate-400">{formatShortTime(slot.start_time)} – {formatShortTime(slot.end_time)}</p>
                        {slot.note ? <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{slot.note}</p> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemove(slot.id)}
                        disabled={saving}
                        className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors",
        checked ? "bg-cyan-400" : "bg-white/20",
      ].join(" ")}
    >
      <span
        className={[
          "h-6 w-6 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

export default function TeacherBookingsManager({ teacherUserId, teacherName }: Props) {
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [studentNames, setStudentNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState("");
  const [draftStartTime, setDraftStartTime] = useState("");
  const [draftEndTime, setDraftEndTime] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [draftRepeatMonths, setDraftRepeatMonths] = useState<number>(3);
  const [calendarLinks, setCalendarLinks] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadData();
  }, [teacherUserId]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [availabilityRes, bookingsRes] = await Promise.all([
        supabase
          .from("teacher_session_availability")
          .select("*")
          .eq("teacher_id", teacherUserId)
          .order("availability_date", { ascending: true })
          .order("start_time", { ascending: true }),
        supabase
          .from("teacher_session_bookings")
          .select("*")
          .eq("teacher_id", teacherUserId)
          .order("created_at", { ascending: false }),
      ]);

      if (availabilityRes.error) throw new Error(availabilityRes.error.message);
      if (bookingsRes.error) throw new Error(bookingsRes.error.message);

      const nextAvailability = ((availabilityRes.data ?? []) as AvailabilityRow[]).filter((slot) => slot.is_available);
      const nextBookings = ((bookingsRes.data ?? []) as BookingRow[]).filter((row) => isTeacherBookingStatus(row.status));

      setAvailability(nextAvailability);
      setBookings(nextBookings);

      const acceptedLinks: Record<string, string> = {};
      nextBookings.forEach((booking) => {
        if (booking.status !== "accepted") return;
        const sessionDuration = booking.duration_min ?? 60;
        const [hourText = "00", minuteText = "00"] = booking.session_time.split(":");
        const startMinutes = Number(hourText) * 60 + Number(minuteText);
        const endMinutes = startMinutes + sessionDuration;
        const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}:00`;
        acceptedLinks[booking.id] = buildTeacherBookingCalendarUrl({
          title: `${teacherName} private class`,
          date: booking.session_date,
          startTime: booking.session_time,
          endTime,
          details: booking.note ?? undefined,
        });
      });
      setCalendarLinks(acceptedLinks);

      const studentIds = Array.from(new Set(nextBookings.map((booking) => booking.student_id).filter(Boolean)));
      if (studentIds.length) {
        const profilesRes = await supabase
          .from("profiles")
          .select("user_id,display_name")
          .in("user_id", studentIds);
        if (!profilesRes.error) {
          const names: Record<string, string> = {};
          ((profilesRes.data ?? []) as Array<{ user_id: string; display_name: string | null }>).forEach((row) => {
            names[row.user_id] = row.display_name?.trim() || "Member";
          });
          setStudentNames(names);
        }
      } else {
        setStudentNames({});
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load bookings.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddAvailability() {
    setError(null);
    setInfo(null);

    if (!draftDate || !draftStartTime || !draftEndTime) {
      setError("Choose a date and time range first.");
      return;
    }
    if (!isDateWithinNextThreeMonths(draftDate)) {
      setError("Availability must be within the next 3 months.");
      return;
    }
    if (!isTimeRangeValid(draftStartTime, draftEndTime)) {
      setError("End time must be after start time.");
      return;
    }

    setSaving(true);
    try {
      const dates = draftRepeatMonths > 0
        ? generateWeeklyDates(draftDate, draftRepeatMonths)
        : [draftDate];
      const rows = dates.map((date) => ({
        teacher_id: teacherUserId,
        availability_date: date,
        start_time: draftStartTime,
        end_time: draftEndTime,
        is_available: true,
        note: draftNote.trim() || null,
      }));

      const { error: insertError } = await supabase
        .from("teacher_session_availability")
        .upsert(rows, { onConflict: "teacher_id,availability_date,start_time,end_time" });
      if (insertError) throw new Error(insertError.message);

      setDraftDate("");
      setDraftStartTime("");
      setDraftEndTime("");
      setDraftNote("");
      setInfo(draftRepeatMonths > 0 ? "Weekly private class slots added." : "Private class slot added.");
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not add availability.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisableAvailability(slotId: string) {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const { error: updateError } = await supabase
        .from("teacher_session_availability")
        .update({ is_available: false })
        .eq("id", slotId)
        .eq("teacher_id", teacherUserId);
      if (updateError) throw new Error(updateError.message);
      setInfo("Availability removed.");
      await loadData();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update availability.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(bookingId: string) {
    setRespondingId(bookingId);
    setError(null);
    setInfo(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Missing auth session. Please sign in again.");

      const response = await fetch(`/api/teacher-bookings/${encodeURIComponent(bookingId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not cancel this booking.");
      setInfo("Booking cancelled.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel booking.");
    } finally {
      setRespondingId(null);
    }
  }

  async function handleRespond(bookingId: string, action: "accept" | "decline") {
    setRespondingId(bookingId);
    setError(null);
    setInfo(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Missing auth session. Please sign in again.");

      const response = await fetch(`/api/teacher-bookings/${encodeURIComponent(bookingId)}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => null)) as {
        calendarUrl?: string | null;
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `Could not ${action} this request.`);
      }

      if (payload?.calendarUrl) {
        setCalendarLinks((prev) => ({ ...prev, [bookingId]: payload.calendarUrl as string }));
      }
      setInfo(action === "accept" ? "Booking accepted." : "Booking declined.");
      await loadData();
    } catch (respondError) {
      setError(respondError instanceof Error ? respondError.message : "Could not update booking.");
    } finally {
      setRespondingId(null);
    }
  }

  if (loading) {
    return (
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
        <div className="space-y-2">
          <div className="h-3 w-36 animate-pulse rounded-md bg-white/[0.07]" />
          <div className="h-3 w-56 animate-pulse rounded-md bg-white/[0.04]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-white/[0.06] p-4">
            <div className="h-3 w-32 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-9 animate-pulse rounded-xl bg-white/[0.05]" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-9 animate-pulse rounded-xl bg-white/[0.05]" />
              <div className="h-9 animate-pulse rounded-xl bg-white/[0.05]" />
            </div>
            <div className="h-16 animate-pulse rounded-xl bg-white/[0.05]" />
            <div className="h-9 w-24 animate-pulse rounded-xl bg-white/[0.05]" />
          </div>
          <div className="space-y-3 rounded-2xl border border-white/[0.06] p-4">
            <div className="h-3 w-28 animate-pulse rounded bg-white/[0.06]" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] p-4 space-y-2">
          <div className="h-3 w-32 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
        </div>
      </section>
    );
  }

  return (
    <section className="w-full min-w-0 max-w-full overflow-hidden border-0 p-0">

      {error ? (
        <div className="mb-4 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="mb-4 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
          {info}
        </div>
      ) : null}

      <div className="grid w-full min-w-0 gap-6 lg:gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-0 p-0 lg:rounded-2xl lg:border lg:border-white/10 lg:bg-black/20 lg:p-4">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Add private class slot</p>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            <label className="block min-w-0 col-span-2 sm:col-span-1">
              <span className="text-xs text-slate-400">Date</span>
              <input
                type="date"
                value={draftDate}
                onChange={(event) => setDraftDate(event.target.value)}
                className="mt-1.5 w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
              />
            </label>
            <label className="block min-w-0">
              <span className="text-xs text-slate-400">Start</span>
              <input
                type="time"
                value={draftStartTime}
                onChange={(event) => setDraftStartTime(event.target.value)}
                className="mt-1.5 w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
              />
            </label>
            <label className="block min-w-0">
              <span className="text-xs text-slate-400">End</span>
              <input
                type="time"
                value={draftEndTime}
                onChange={(event) => setDraftEndTime(event.target.value)}
                className="mt-1.5 w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
              />
            </label>
          </div>
          <div className="mt-3">
            <span className="text-xs text-slate-400">Repeat weekly</span>
            <select
              value={draftRepeatMonths}
              onChange={(e) => setDraftRepeatMonths(Number(e.target.value))}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
            >
              {REPEAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <label className="mt-3 block">
            <span className="text-xs text-slate-400">Note</span>
            <textarea
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value.slice(0, 280))}
              rows={3}
              placeholder="Optional details for the student"
              className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleAddAvailability()}
            disabled={saving}
            className="mt-4 rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Add slot"}
          </button>
        </div>

        <div className="min-w-0 border-0 p-0 lg:rounded-2xl lg:border lg:border-white/10 lg:bg-black/20 lg:p-4">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Available slots{availability.length > 0 ? <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">{availability.length}</span> : null}
          </p>
          {loading ? <p className="text-sm text-slate-500">Loading...</p> : null}
          {!loading && availability.length === 0 ? (
            <p className="text-sm text-slate-500">No availability added yet.</p>
          ) : null}
          <AvailabilityByMonth slots={availability} saving={saving} onRemove={(id) => void handleDisableAvailability(id)} />
        </div>
      </div>

    </section>
  );
}
