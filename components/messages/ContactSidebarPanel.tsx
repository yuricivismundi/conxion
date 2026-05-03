"use client";

import { useState } from "react";
import Image, { type ImageLoaderProps } from "next/image";
import Link from "next/link";
import { type ReferenceContextTag } from "@/lib/activities/types";
import type { ProfileMediaItem } from "@/lib/profile-media/types";
import {
  formatSleepingArrangement,
  isHostingListingOpen,
  type HostingPreferredGuestGender,
  type HostingSleepingArrangement,
} from "@/lib/hosting/preferences";

type ContactSidebarData = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  city: string;
  country: string;
  roles: string[];
  danceStyles: string[];
  interests: string[];
  availability: string[];
  languages: string[];
  referencesTotal: number;
  referencesPositive: number;
  referencesByContext: Record<ReferenceContextTag, number>;
  tripsJoinedAccepted: number;
  hostingAccepted: number;
  connectionsCount: number;
  canHost: boolean;
  hostingStatus: string;
  maxGuests: number | null;
  hostingLastMinuteOk: boolean;
  hostingPreferredGuestGender: HostingPreferredGuestGender;
  hostingKidFriendly: boolean;
  hostingPetFriendly: boolean;
  hostingSmokingAllowed: boolean;
  hostingSleepingArrangement: HostingSleepingArrangement;
  hostingGuestShare: string | null;
  hostingTransitAccess: string | null;
  verified: boolean;
  verifiedLabel: string | null;
  mediaItems: ProfileMediaItem[];
};

type ContactSidebarPanelProps = {
  loading: boolean;
  error: string | null;
  contact: ContactSidebarData | null;
  canInitiateActivity?: boolean;
  onInitiateActivity?: (() => void) | null;
  searchQuery?: string;
  onSearch?: (q: string) => void;
  isMuted?: boolean;
  muteLabel?: string;
  onMuteFor8h?: () => void;
  onMuteFor24h?: () => void;
  onMuteForever?: () => void;
  onUnmute?: () => void;
  onReport?: () => void;
  onBlock?: () => void;
  pinnedMessages?: { id: string; text: string; senderName: string }[];
};

const remoteImageLoader = ({ src }: ImageLoaderProps) => src;

function SidebarAccordion({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-white/[0.07]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between py-3 text-left">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">{title}</span>
        <svg className={`h-3 w-3 text-white/30 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

function ContactSidebarSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="aspect-[4/3] w-full rounded-2xl bg-white/[0.06]" />
      <div className="space-y-2 px-1 text-center">
        <div className="mx-auto h-6 w-40 rounded-full bg-white/[0.08]" />
        <div className="mx-auto h-3.5 w-28 rounded-full bg-white/[0.05]" />
      </div>
      <div className="flex justify-center gap-8 px-1">
        <div className="h-10 w-16 rounded-lg bg-white/[0.05]" />
        <div className="h-10 w-16 rounded-lg bg-white/[0.05]" />
        <div className="h-10 w-16 rounded-lg bg-white/[0.05]" />
      </div>
      <div className="space-y-3 px-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-2.5">
            <div className="mt-0.5 h-4 w-4 shrink-0 rounded bg-white/[0.06]" />
            <div className="flex flex-wrap gap-1.5">
              <div className="h-5 w-20 rounded-full bg-white/[0.06]" />
              <div className="h-5 w-16 rounded-full bg-white/[0.06]" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-9 rounded-full bg-white/[0.05]" />
    </div>
  );
}

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function ContactSidebarPanel({
  loading,
  error,
  contact,
  canInitiateActivity = false,
  onInitiateActivity = null,
  searchQuery = "",
  onSearch,
  isMuted = false,
  muteLabel = "",
  onMuteFor8h,
  onMuteFor24h,
  onMuteForever,
  onUnmute,
  onReport,
  onBlock,
  pinnedMessages = [],
}: ContactSidebarPanelProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [blockConfirm, setBlockConfirm] = useState(false);
  const [muteMenuOpen, setMuteMenuOpen] = useState(false);

  if (loading) return <ContactSidebarSkeleton />;

  if (error) {
    return <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>;
  }

  if (!contact) {
    return <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">Member details are available for 1:1 chats.</div>;
  }

  const hostingOpen = isHostingListingOpen(contact.canHost, contact.hostingStatus);
  const location = [contact.city, contact.country].filter(Boolean).join(", ");
  const profileHref = `/profile/${encodeURIComponent(contact.userId)}`;
  const readyMedia = contact.mediaItems.filter((m) => m.status === "ready").slice(0, 6);

  return (
    <div className="flex flex-col">
      {/* Hero — bleeds to edges */}
      <Link
        href={profileHref}
        className="relative -mx-4 -mt-5 mb-4 block aspect-[4/3] overflow-hidden bg-[#0e1a1c] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
        aria-label={`Open ${contact.displayName}'s profile`}
      >
        {contact.avatarUrl ? (
          <Image
            src={contact.avatarUrl}
            alt={contact.displayName}
            fill
            sizes="320px"
            loader={remoteImageLoader}
            unoptimized
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="material-symbols-outlined text-[56px] text-cyan-100/20">person</span>
          </div>
        )}
      </Link>

      {/* Name + location */}
      <div className="mb-1 px-1 text-center">
        <Link href={profileHref} className="inline-block text-xl font-bold leading-tight text-white transition-colors hover:text-cyan-100">
          {contact.displayName}
        </Link>
        {location ? <p className="mt-1 text-sm text-[#90cbcb]">{location}</p> : null}
        {contact.verified ? (
          <div className="mt-2 flex justify-center">
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/35 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100">
              <span className="material-symbols-outlined text-[11px]">verified</span>
              {contact.verifiedLabel || "Verified"}
            </span>
          </div>
        ) : null}
      </div>

      {/* Invite to Activity */}
      {canInitiateActivity && onInitiateActivity ? (
        <button
          type="button"
          onClick={onInitiateActivity}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#6ee7f9,#d946ef)] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-[#071116] shadow-[0_12px_32px_rgba(217,70,239,0.22)] transition-opacity hover:opacity-95"
        >
          <span className="material-symbols-outlined text-[13px]">event_available</span>
          Invite to Activity
        </button>
      ) : null}

      {/* Stats */}
      <div className="my-4 flex justify-around border-y border-white/[0.06] py-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-white">{contact.connectionsCount}</p>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35">Connections</p>
        </div>
        <div className="w-px bg-white/[0.06]" />
        <div className="text-center">
          <p className="text-2xl font-bold text-white">{contact.referencesTotal}</p>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35">References</p>
        </div>
      </div>

      {/* Quick actions — Profile | Mute | Search */}
      <div className="mb-2 flex gap-2">
        <Link
          href={profileHref}
          className="flex flex-1 flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] font-semibold text-white/50 transition bg-white/[0.06] hover:bg-white/10 hover:text-white/80"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
          Profile
        </Link>
        {(onMuteFor8h || onMuteFor24h || onMuteForever || onUnmute) && (
          <div className="relative flex-1">
            <button
              onClick={() => setMuteMenuOpen((prev) => !prev)}
              className={["flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] font-semibold transition",
                muteMenuOpen || isMuted ? "bg-white/10 text-white/80" : "bg-white/[0.06] text-white/50 hover:bg-white/10 hover:text-white/80"].join(" ")}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              {isMuted ? "Muted" : "Mute"}
            </button>
            {muteMenuOpen ? (
              <div className="absolute left-1/2 top-full z-20 mt-2 w-36 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0b1015] px-2 py-2 shadow-[0_18px_48px_rgba(0,0,0,0.48)]">
                {isMuted && onUnmute ? (
                  <button
                    type="button"
                    onClick={() => {
                      onUnmute();
                      setMuteMenuOpen(false);
                    }}
                    className="flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-[12px] text-white/80 transition hover:text-cyan-100"
                  >
                    <span className="material-symbols-outlined text-[15px] leading-none">notifications_active</span>
                    {muteLabel ? `Unmute (${muteLabel})` : "Unmute"}
                  </button>
                ) : (
                  <>
                    {onMuteFor8h ? (
                      <button
                        type="button"
                        onClick={() => {
                          onMuteFor8h();
                          setMuteMenuOpen(false);
                        }}
                        className="flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-[12px] text-white/80 transition hover:text-cyan-100"
                      >
                        <span className="material-symbols-outlined text-[15px] leading-none">notifications_paused</span>
                        8 hours
                      </button>
                    ) : null}
                    {onMuteFor24h ? (
                      <button
                        type="button"
                        onClick={() => {
                          onMuteFor24h();
                          setMuteMenuOpen(false);
                        }}
                        className="flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-[12px] text-white/80 transition hover:text-cyan-100"
                      >
                        <span className="material-symbols-outlined text-[15px] leading-none">notifications_paused</span>
                        24 hours
                      </button>
                    ) : null}
                    {onMuteForever ? (
                      <button
                        type="button"
                        onClick={() => {
                          onMuteForever();
                          setMuteMenuOpen(false);
                        }}
                        className="flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-[12px] text-white/80 transition hover:text-cyan-100"
                      >
                        <span className="material-symbols-outlined text-[15px] leading-none">do_not_disturb_on</span>
                        Forever
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}
        {onSearch && (
          <button
            onClick={() => {
              const next = !searchOpen;
              setSearchOpen(next);
              if (!next) onSearch("");
            }}
            className={["flex flex-1 flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] font-semibold transition",
              searchOpen ? "bg-white/10 text-white/80" : "bg-white/[0.06] text-white/50 hover:bg-white/10 hover:text-white/80"].join(" ")}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
            </svg>
            Search
          </button>
        )}
      </div>

      {/* Search input */}
      {searchOpen && onSearch && (
        <div className="mb-2 space-y-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search messages…"
            autoFocus
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#0df2f2]/30"
          />
          {searchQuery && (
            <p className="px-1 text-[11px] text-white/35">Filtering by &ldquo;{searchQuery}&rdquo;</p>
          )}
        </div>
      )}

      {/* Chat info — pinned messages */}
      <SidebarAccordion title="Chat Info" defaultOpen={pinnedMessages.length > 0}>
        {pinnedMessages.length > 0 ? (
          <div className="space-y-2">
            {pinnedMessages.map((msg) => (
              <div key={msg.id} className="flex items-start gap-2 rounded-lg bg-white/[0.04] px-3 py-2.5">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-[14px] text-[#0df2f2]/60">push_pin</span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-white/50">{msg.senderName}</p>
                  <p className="truncate text-[12px] text-white/80">{msg.text}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-[12px] text-white/30">No pinned messages yet.</p>
            <p className="text-[11px] text-white/20">Use Pin message in a chat message menu to keep it here.</p>
          </div>
        )}
      </SidebarAccordion>

      {/* Media & files */}
      {readyMedia.length > 0 && (
        <SidebarAccordion title="Media & Files" defaultOpen={false}>
          <div className="grid grid-cols-3 gap-1.5">
            {readyMedia.map((item) => {
              const thumb = item.thumbnailUrl ?? item.publicUrl;
              return (
                <div key={item.id} className="relative aspect-square overflow-hidden rounded-xl bg-white/[0.04]">
                  {thumb ? (
                    <Image
                      src={thumb}
                      alt=""
                      fill
                      sizes="100px"
                      loader={remoteImageLoader}
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="material-symbols-outlined text-[20px] text-white/20">
                        {item.kind === "video" ? "play_circle" : "image"}
                      </span>
                    </div>
                  )}
                  {item.kind === "video" ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <span className="material-symbols-outlined text-[22px] text-white/70" style={{ fontVariationSettings: "'FILL' 1" }}>play_circle</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SidebarAccordion>
      )}

      {/* Profile info */}
      {(contact.roles.length > 0 || contact.danceStyles.length > 0 || contact.interests.length > 0 || hostingOpen) && (
        <SidebarAccordion title="Profile Info" defaultOpen={false}>
          <div className="grid grid-cols-3 gap-x-3 gap-y-5">
            {contact.roles.length > 0 ? (
              <div>
                <div className="mb-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px] text-cyan-300">person_pin</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {contact.roles.slice(0, 4).map((r) => (
                    <span key={r} className="text-[11px] text-slate-300">{titleCase(r)}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {contact.danceStyles.length > 0 ? (
              <div>
                <div className="mb-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px] text-fuchsia-300">music_note</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {contact.danceStyles.slice(0, 6).map((s) => (
                    <span key={s} className="text-[11px] text-slate-300">{titleCase(s)}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {contact.interests.length > 0 ? (
              <div>
                <div className="mb-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px] text-cyan-300">favorite</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {contact.interests.slice(0, 3).map((i) => (
                    <span key={i} className="text-[11px] text-slate-300">{titleCase(i)}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {hostingOpen ? (
              <div>
                <div className="mb-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px] text-cyan-300">home</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {typeof contact.maxGuests === "number" ? (
                    <span className="text-[11px] text-slate-300">Up to {contact.maxGuests}</span>
                  ) : null}
                  <span className="text-[11px] text-slate-300">{formatSleepingArrangement(contact.hostingSleepingArrangement)}</span>
                  {contact.hostingLastMinuteOk ? <span className="text-[11px] text-slate-300">Last-min ok</span> : null}
                  {contact.hostingKidFriendly ? <span className="text-[11px] text-slate-300">Kid friendly</span> : null}
                  {contact.hostingPetFriendly ? <span className="text-[11px] text-slate-300">Pet friendly</span> : null}
                </div>
              </div>
            ) : null}
          </div>
        </SidebarAccordion>
      )}

      {/* Privacy & Support */}
      <SidebarAccordion title="Privacy & Support" defaultOpen={false}>
        <div className="space-y-0.5">
          {(onMuteFor8h || onMuteFor24h || onMuteForever || onUnmute) && (
            <div className="px-3 py-2.5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/35">Mute chat</p>
              <div className="flex flex-wrap gap-2">
                {isMuted && onUnmute ? (
                  <button
                    type="button"
                    onClick={onUnmute}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-cyan-300/25 hover:text-cyan-100"
                  >
                    <span className="material-symbols-outlined text-[14px] leading-none">notifications_active</span>
                    {muteLabel ? `Unmute (${muteLabel})` : "Unmute"}
                  </button>
                ) : (
                  <>
                    {onMuteFor8h ? (
                      <button
                        type="button"
                        onClick={onMuteFor8h}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-cyan-300/25 hover:text-cyan-100"
                      >
                        <span className="material-symbols-outlined text-[14px] leading-none">notifications_paused</span>
                        8h
                      </button>
                    ) : null}
                    {onMuteFor24h ? (
                      <button
                        type="button"
                        onClick={onMuteFor24h}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-cyan-300/25 hover:text-cyan-100"
                      >
                        <span className="material-symbols-outlined text-[14px] leading-none">notifications_paused</span>
                        24h
                      </button>
                    ) : null}
                    {onMuteForever ? (
                      <button
                        type="button"
                        onClick={onMuteForever}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-cyan-300/25 hover:text-cyan-100"
                      >
                        <span className="material-symbols-outlined text-[14px] leading-none">do_not_disturb_on</span>
                        Forever
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )}
          {onBlock && (
            <>
              {blockConfirm ? (
                <div className="rounded-lg bg-rose-500/10 px-3 py-2.5">
                  <p className="mb-2 text-[12px] text-rose-200">Block {contact.displayName}? They won&apos;t be able to message you.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { onBlock(); setBlockConfirm(false); }}
                      className="flex-1 rounded-lg bg-rose-500/80 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-rose-500"
                    >
                      Confirm Block
                    </button>
                    <button
                      onClick={() => setBlockConfirm(false)}
                      className="flex-1 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-white/60 transition hover:bg-white/10"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setBlockConfirm(true)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-rose-400 transition hover:bg-white/[0.05]"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/10">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  </div>
                  <span className="text-[13px]">Block</span>
                </button>
              )}
            </>
          )}
          {onReport && (
            <button
              onClick={onReport}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-white/60 transition hover:bg-white/[0.05]"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06]">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l1.664 9.143M3 3h18M3 3L1.5 1.5M21 3l-1.664 9.143M21 3l1.5-1.5M9 21h6m-3-3v3m-6.336-9H20.34" />
                </svg>
              </div>
              <span className="text-[13px]">Report</span>
            </button>
          )}
        </div>
      </SidebarAccordion>
    </div>
  );
}
