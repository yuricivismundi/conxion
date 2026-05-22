"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export type SidebarProfilePreview = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  city: string;
  country: string;
};

export function SidebarAccordion({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-white/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between py-3 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">{title}</span>
        <svg
          className={`h-3 w-3 text-white/30 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? <div className="pb-3">{children}</div> : null}
    </div>
  );
}

export function SidebarInfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px] text-white/70">
      <span>{label}</span>
      <span className="text-right font-semibold text-white">{value}</span>
    </div>
  );
}

export function SidebarPersonCard({
  person,
  roleLabel,
  showMeta = true,
  href,
  className = "",
}: {
  person: SidebarProfilePreview;
  roleLabel?: string;
  showMeta?: boolean;
  href?: string;
  className?: string;
}) {
  const content = (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative h-10 w-10 overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
        {person.avatarUrl ? (
          <Image src={person.avatarUrl} alt={person.displayName} fill className="object-cover" sizes="40px" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm font-bold text-cyan-100">
            {person.displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{person.displayName}</p>
        {showMeta ? (
          <p className="truncate text-[11px] text-white/45">
            {roleLabel ? `${roleLabel} · ` : ""}
            {[person.city, person.country].filter(Boolean).join(", ") || "Member"}
          </p>
        ) : null}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block transition hover:opacity-90">
        {content}
      </Link>
    );
  }

  return content;
}

export function SidebarAvatarStrip({
  people,
  emptyText,
  showMeta = true,
  maxVisibleRows = 5,
}: {
  people: SidebarProfilePreview[];
  emptyText: string;
  showMeta?: boolean;
  maxVisibleRows?: number;
}) {
  if (people.length === 0) {
    return <p className="text-[12px] text-white/45">{emptyText}</p>;
  }

  return (
    <div
      className="space-y-2 overflow-y-auto pr-1"
      style={{ maxHeight: `${maxVisibleRows * 48}px` }}
    >
      {people.map((person) => (
        <SidebarPersonCard key={person.userId} person={person} showMeta={showMeta} />
      ))}
    </div>
  );
}

export function SidebarActionRow({
  icon,
  title,
  subtitle,
  onClick,
  danger,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl px-0.5 py-1.5 text-left transition ${danger ? "hover:text-red-300" : "hover:text-cyan-100"}`}
    >
      <span className={`material-symbols-outlined mt-0.5 text-[18px] ${danger ? "text-red-400/70" : "text-white/70"}`}>{icon}</span>
      <span className="min-w-0">
        <span className={`block text-[13px] font-medium ${danger ? "text-red-300/90" : "text-white"}`}>{title}</span>
        {subtitle ? <span className="block text-[11px] leading-relaxed text-white/45">{subtitle}</span> : null}
      </span>
    </button>
  );
}
