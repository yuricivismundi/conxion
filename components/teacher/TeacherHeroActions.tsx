"use client";

import { useState } from "react";
import DarkConnectModal from "@/components/DarkConnectModal";
import BookSessionModal from "@/components/teacher/BookSessionModal";
import RequestInfoModal from "@/components/teacher/RequestInfoModal";

type Props = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  variant?: "hero" | "cta";
};

export default function TeacherHeroActions({ userId, displayName, avatarUrl, variant = "hero" }: Props) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [requestInfoOpen, setRequestInfoOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingSuccessMsg, setBookingSuccessMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (variant === "cta") {
    return (
      <>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setBookingOpen(true)}
            className="inline-block rounded-full bg-gradient-to-r from-[#c1fffe] to-[#ff51fa] px-12 py-5 text-base font-black uppercase tracking-widest text-zinc-900 shadow-[0_0_50px_rgba(255,81,250,0.3)] transition-transform hover:scale-105"
          >
            {bookingSuccessMsg ?? "Book Session"}
          </button>
          <button
            type="button"
            onClick={() => setRequestInfoOpen(true)}
            className="inline-block rounded-full border border-white/20 bg-white/[0.04] px-8 py-5 text-sm font-black uppercase tracking-widest text-white transition hover:bg-white/[0.08]"
          >
            {successMsg ?? "Request Information Package"}
          </button>
        </div>

        <RequestInfoModal
          open={requestInfoOpen}
          recipientUserId={userId}
          recipientName={displayName}
          onClose={() => setRequestInfoOpen(false)}
          onSubmitted={(msg) => {
            setSuccessMsg(msg);
            setRequestInfoOpen(false);
          }}
        />

        <BookSessionModal
          open={bookingOpen}
          teacherUserId={userId}
          teacherName={displayName}
          onClose={() => setBookingOpen(false)}
          onSubmitted={(msg) => {
            setBookingSuccessMsg(msg);
            setBookingOpen(false);
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 pt-6">
        <button
          type="button"
          onClick={() => setBookingOpen(true)}
          className="bg-gradient-to-r from-[#c1fffe] to-[#ff51fa] text-zinc-900 px-8 py-4 rounded-full font-black uppercase text-sm tracking-widest flex items-center gap-2 hover:scale-105 transition-transform shadow-[0_0_30px_rgba(193,255,254,0.3)]"
        >
          {bookingSuccessMsg ?? "Book Session"}
          <span className="material-symbols-outlined text-[18px]">event_available</span>
        </button>

        {/* Request Info — gradient fill */}
        <button
          type="button"
          onClick={() => setRequestInfoOpen(true)}
          className="bg-gradient-to-r from-[#c1fffe] to-[#ff51fa] text-zinc-900 px-8 py-4 rounded-full font-black uppercase text-sm tracking-widest flex items-center gap-2 hover:scale-105 transition-transform shadow-[0_0_30px_rgba(193,255,254,0.3)]"
        >
          Request Info
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>

        {/* Connect — outlined, no gradient */}
        <button
          type="button"
          onClick={() => setConnectOpen(true)}
          className="border border-white/30 hover:border-white/60 bg-transparent text-white px-8 py-4 rounded-full font-black uppercase text-sm tracking-widest transition-all hover:bg-white/5"
        >
          Connect
        </button>
      </div>

      <DarkConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        targetUserId={userId}
        targetName={displayName}
        targetPhotoUrl={avatarUrl}
      />

      <RequestInfoModal
        open={requestInfoOpen}
        recipientUserId={userId}
        recipientName={displayName}
        recipientPhotoUrl={avatarUrl}
        onClose={() => setRequestInfoOpen(false)}
        onSubmitted={(msg) => {
          setSuccessMsg(msg);
          setRequestInfoOpen(false);
        }}
      />

      <BookSessionModal
        open={bookingOpen}
        teacherUserId={userId}
        teacherName={displayName}
        onClose={() => setBookingOpen(false)}
        onSubmitted={(msg) => {
          setBookingSuccessMsg(msg);
          setBookingOpen(false);
        }}
      />
    </>
  );
}
