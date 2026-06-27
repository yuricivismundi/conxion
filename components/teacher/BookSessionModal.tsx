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
      : "Pick a bookable date and slot, then send the request.";

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center sm:px-3 sm:py-3">
      <div
        className={[
          "relative flex max-h-[100svh] w-full flex-col overflow-hidden border-0 sm:max-h-[min(92svh,760px)] sm:rounded-[32px] sm:border sm:border-white/[0.08] sm:shadow-[0_32px_80px_rgba(0,0,0,0.6)]",
          mode === "chat" ? "sm:max-w-[460px]" : "sm:max-w-[980px]",
        ].join(" ")}
        style={{
          background:
            "radial-gradient(circle at 15% 0%, rgba(13,204,242,0.08), transparent 45%), radial-gradient(circle at 85% 100%, rgba(217,59,255,0.08), transparent 45%), #080e14",
        }}
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-white/35 transition-all hover:border-white/20 hover:text-white"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>

        <div className="relative overflow-hidden border-b border-white/[0.06] px-6 pb-5 pt-6">
          <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "linear-gradient(90deg,#0df2f2,#d93bff)" }} />
          <div className="flex items-center gap-4">
            <div
              className="h-[60px] w-[60px] shrink-0 rounded-2xl border border-white/[0.12] bg-cover bg-center shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
              style={{
                backgroundImage: teacherPhotoUrl
                  ? `url(${teacherPhotoUrl})`
                  : "linear-gradient(135deg, rgba(13,204,242,0.3), rgba(217,59,255,0.3))",
              }}
            />
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">{eyebrow}</p>
              <h2 className="mt-0.5 truncate text-[22px] font-black leading-tight tracking-tight text-white">{title}</h2>
              <p className="mt-0.5 text-[11px] text-white/35">{description}</p>
            </div>
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
