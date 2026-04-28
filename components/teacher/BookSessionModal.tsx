"use client";

import { useCallback } from "react";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import TeacherBookingFlow from "@/components/teacher/TeacherBookingFlow";
import type { TeacherBookingServiceType } from "@/lib/teacher-bookings";

type BookSessionModalProps = {
  open: boolean;
  teacherUserId: string;
  teacherName: string;
  teacherPhotoUrl?: string | null;
  mode?: "profile" | "chat";
  initialServiceType?: TeacherBookingServiceType;
  contextLabel?: string | null;
  onClose: () => void;
  onSubmitted?: (message: string) => void;
};

export default function BookSessionModal({
  open,
  teacherUserId,
  teacherName,
  teacherPhotoUrl,
  mode = "profile",
  initialServiceType = "private_class",
  contextLabel,
  onClose,
  onSubmitted,
}: BookSessionModalProps) {
  useBodyScrollLock(open);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  const title = mode === "chat" ? `Book ${teacherName}` : teacherName;
  const eyebrow = mode === "chat" ? "Book a session in chat" : "Book a session with";
  const description =
    mode === "chat"
      ? "Teacher is already selected. Pick a date and slot, then send the request."
      : "Select a service, bookable date, and slot.";

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-md sm:items-center">
      <div
        className={[
          "relative flex max-h-[min(92svh,760px)] w-full flex-col overflow-hidden rounded-[28px] border border-white/[0.08] shadow-[0_32px_80px_rgba(0,0,0,0.6)] sm:rounded-[32px]",
          mode === "chat" ? "max-w-[460px]" : "max-w-[980px]",
        ].join(" ")}
        style={{
          background:
            "radial-gradient(circle at 15% 0%, rgba(13,204,242,0.08), transparent 45%), radial-gradient(circle at 85% 100%, rgba(217,59,255,0.08), transparent 45%), #080e14",
        }}
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/40 transition-colors hover:text-white"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>

        <div className="flex items-center gap-4 border-b border-white/[0.07] px-6 pb-5 pt-6">
          <div
            className="h-14 w-14 shrink-0 rounded-2xl border border-white/10 bg-cover bg-center"
            style={{
              backgroundImage: teacherPhotoUrl
                ? `url(${teacherPhotoUrl})`
                : "linear-gradient(135deg, rgba(13,204,242,0.25), rgba(217,59,255,0.25))",
            }}
          />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">{eyebrow}</p>
            <h2 className="truncate text-xl font-extrabold leading-tight tracking-tight text-white">{title}</h2>
            <p className="mt-0.5 text-[11px] text-white/35">{description}</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-5">
          <TeacherBookingFlow
            teacherUserId={teacherUserId}
            teacherName={teacherName}
            variant={mode === "chat" ? "chat" : "profile"}
            initialServiceType={initialServiceType}
            contextLabel={contextLabel}
            onSubmitted={(message) => {
              onSubmitted?.(message);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
