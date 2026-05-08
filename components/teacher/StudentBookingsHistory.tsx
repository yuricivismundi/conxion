"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatShortDate, formatShortTime, type TeacherBookingStatus } from "@/lib/teacher-bookings";
import Link from "next/link";

type BookingRow = {
  id: string;
  teacher_id: string;
  student_id: string;
  service_type: string;
  session_date: string;
  session_time: string;
  duration_min: number | null;
  note: string | null;
  status: TeacherBookingStatus;
  created_at: string;
  accepted_at: string | null;
  declined_at: string | null;
};

type TeacherProfile = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
};

function StatusBadge({ status }: { status: TeacherBookingStatus }) {
  if (status === "accepted")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
        <span className="material-symbols-outlined text-[12px]">check_circle</span>
        Accepted
      </span>
    );
  if (status === "declined")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/30 bg-rose-400/10 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
        <span className="material-symbols-outlined text-[12px]">cancel</span>
        Declined
      </span>
    );
  if (status === "cancelled")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-zinc-400/30 bg-zinc-400/10 px-2 py-0.5 text-[11px] font-semibold text-zinc-400">
        <span className="material-symbols-outlined text-[12px]">block</span>
        Cancelled
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
      <span className="material-symbols-outlined text-[12px]">schedule</span>
      Pending
    </span>
  );
}

export default function StudentBookingsHistory() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [teachers, setTeachers] = useState<Record<string, TeacherProfile>>({});
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
    });
  }, []);

  const load = useCallback(async (accessToken: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/teacher-bookings", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as { ok: boolean; bookings?: BookingRow[]; teacherProfiles?: TeacherProfile[] };
      if (json.ok && json.bookings) {
        setBookings(json.bookings);
        const map: Record<string, TeacherProfile> = {};
        for (const p of json.teacherProfiles ?? []) map[p.user_id] = p;
        setTeachers(map);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  async function handleCancel(bookingId: string) {
    if (!token) return;
    setCancellingId(bookingId);
    try {
      const res = await fetch(`/api/teacher-bookings/${bookingId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (json.ok) {
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, status: "cancelled" as TeacherBookingStatus } : b))
        );
      }
    } finally {
      setCancellingId(null);
    }
  }

  const active = bookings.filter((b) => b.status === "pending" || b.status === "accepted");
  const past = bookings.filter((b) => b.status === "declined" || b.status === "cancelled");

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.04]" />
        ))}
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] py-10 text-center">
        <span className="material-symbols-outlined text-[32px] text-white/20">calendar_today</span>
        <p className="text-sm text-white/40">No booking requests yet</p>
      </div>
    );
  }

  function BookingCard({ booking }: { booking: BookingRow }) {
    const teacher = teachers[booking.teacher_id];
    const canCancel = booking.status === "pending" || booking.status === "accepted";
    return (
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
        {booking.status === "accepted" && (
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[#00F5FF] to-[#FF00FF]" />
        )}
        <div className="flex items-start gap-3">
          <Link href={`/profile/${booking.teacher_id}`} className="shrink-0">
            {teacher?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={teacher.avatar_url}
                alt={teacher.display_name ?? "Teacher"}
                className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06]">
                <span className="material-symbols-outlined text-[20px] text-white/30">person</span>
              </div>
            )}
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/profile/${booking.teacher_id}`}
                className="text-sm font-semibold text-white/90 hover:text-white"
              >
                {teacher?.display_name ?? "Teacher"}
              </Link>
              <StatusBadge status={booking.status} />
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/50">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">calendar_month</span>
                {formatShortDate(booking.session_date)}
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">schedule</span>
                {formatShortTime(booking.session_time)}
                {booking.duration_min ? ` · ${booking.duration_min} min` : ""}
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">fitness_center</span>
                {booking.service_type}
              </span>
            </div>

            {booking.note && (
              <p className="mt-1.5 text-xs text-white/40 line-clamp-2">{booking.note}</p>
            )}
          </div>

          {canCancel && (
            <button
              type="button"
              onClick={() => void handleCancel(booking.id)}
              disabled={cancellingId === booking.id}
              className="shrink-0 rounded-xl border border-rose-400/25 bg-rose-400/[0.06] px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-400/12 disabled:opacity-50"
            >
              {cancellingId === booking.id ? "Cancelling…" : "Cancel"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {active.length > 0 && (
        <div className="space-y-2">
          {active.map((b) => (
            <BookingCard key={b.id} booking={b} />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none list-none text-xs text-white/35 hover:text-white/60">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px] transition-transform group-open:rotate-90">
                chevron_right
              </span>
              Past requests ({past.length})
            </span>
          </summary>
          <div className="mt-2 space-y-2">
            {past.map((b) => (
              <BookingCard key={b.id} booking={b} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
