"use client";

import { getTeacherInfoTemplateText } from "@/lib/teacher-info/types";
import { getTeacherInfoAttachment } from "@/lib/teacher-info/types";
import type { TeacherInquiryShareSnapshot } from "@/lib/service-inquiries/types";

type TeacherInquiryCardProps = {
  snapshot: TeacherInquiryShareSnapshot;
  createdAt: string;
};

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function TeacherInquiryCard({ snapshot, createdAt }: TeacherInquiryCardProps) {
  const location = [snapshot.teacherSummary.city, snapshot.teacherSummary.country].filter(Boolean).join(", ");

  return (
    <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-[26px] border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(7,20,28,0.96),rgba(24,10,28,0.92))] shadow-[0_20px_70px_rgba(0,0,0,0.35)]">
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Teacher info shared</p>
            <h3 className="mt-1 text-lg font-semibold text-white">
              {snapshot.headline || "Professional information"}
            </h3>
            <p className="mt-1 text-sm text-slate-300">
              {snapshot.teacherSummary.displayName}
              {location ? ` • ${location}` : ""}
            </p>
          </div>
          <span className="text-[11px] text-slate-400">{formatTime(createdAt || snapshot.sharedAt)}</span>
        </div>
        {snapshot.profileConfig?.introText || snapshot.introText ? (
          <p className="mt-3 text-sm leading-6 text-slate-200">{snapshot.introText || snapshot.profileConfig?.introText}</p>
        ) : null}
        {snapshot.teacherIntroNote ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">Intro note</p>
            <p className="mt-1.5 text-sm leading-6 text-slate-100">{snapshot.teacherIntroNote}</p>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-5">
        {snapshot.selectedBlocks.map((block) => {
          const attachment = getTeacherInfoAttachment(block);
          return (
          <div key={block.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-base font-semibold text-white">{block.title}</p>
            {getTeacherInfoTemplateText(block) ? <p className="mt-2 text-sm leading-6 text-slate-200">{getTeacherInfoTemplateText(block)}</p> : null}
            {attachment ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">Attachment</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{attachment.name}</p>
                    <p className="mt-1 text-xs text-slate-400">{attachment.mimeType || "File"}</p>
                  </div>
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/18"
                  >
                    Open attachment
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        )})}
      </div>
    </div>
  );
}
