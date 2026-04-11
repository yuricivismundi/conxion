"use client";

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
};

const remoteImageLoader = ({ src }: ImageLoaderProps) => src;

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

function InfoSection({ icon, iconColor, label, children }: { icon: string; iconColor?: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <span className={`material-symbols-outlined text-[13px] ${iconColor ?? "text-cyan-300"}`}>{icon}</span>
        <span className="sr-only">{label}</span>
      </div>
      {children}
    </div>
  );
}

export default function ContactSidebarPanel({
  loading,
  error,
  contact,
  canInitiateActivity = false,
  onInitiateActivity = null,
}: ContactSidebarPanelProps) {
  if (loading) return <ContactSidebarSkeleton />;

  if (error) {
    return <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>;
  }

  if (!contact) {
    return <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">Member details are available for 1:1 chats.</div>;
  }

  const hostingOpen = isHostingListingOpen(contact.canHost, contact.hostingStatus);
  const location = [contact.city, contact.country].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-5">

      {/* Hero media: bleeds to all edges — negative margin cancels parent px-4 py-5 */}
      <div className="relative aspect-[4/3] -mx-4 -mt-5 overflow-hidden bg-[#0e1a1c]">
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
      </div>

      <div className="px-1 text-center">
        <p className="text-xl font-bold leading-tight text-white">{contact.displayName}</p>
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

      {/* Invite to Activity — only when applicable */}
      {canInitiateActivity && onInitiateActivity ? (
        <button
          type="button"
          onClick={onInitiateActivity}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#6ee7f9,#d946ef)] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-[#071116] shadow-[0_12px_32px_rgba(217,70,239,0.22)] transition-opacity hover:opacity-95"
        >
          <span className="material-symbols-outlined text-[13px]">event_available</span>
          Invite to Activity
        </button>
      ) : null}

      {/* Stats */}
      <div className="flex justify-around border-y border-white/[0.06] py-4">
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

      {/* Media showcase */}
      {contact.mediaItems.filter((m) => m.status === "ready").length > 0 ? (() => {
        const readyMedia = contact.mediaItems.filter((m) => m.status === "ready").slice(0, 6);
        return (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Media</p>
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
          </div>
        );
      })() : null}

      {/* Profile info — 3-column grid matching profile overview style */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-5">
        {contact.roles.length > 0 ? (
          <InfoSection icon="person_pin" label="Roles">
            <div className="flex flex-col gap-1.5">
              {contact.roles.slice(0, 4).map((r) => (
                <span key={r} className="text-[11px] text-slate-300">{titleCase(r)}</span>
              ))}
            </div>
          </InfoSection>
        ) : null}

        {contact.danceStyles.length > 0 ? (
          <InfoSection icon="music_note" iconColor="text-fuchsia-300" label="Dance styles">
            <div className="flex flex-col gap-1.5">
              {contact.danceStyles.slice(0, 6).map((s) => (
                <span key={s} className="text-[11px] text-slate-300">{titleCase(s)}</span>
              ))}
            </div>
          </InfoSection>
        ) : null}

        {contact.interests.length > 0 ? (
          <InfoSection icon="favorite" label="Interest">
            <div className="flex flex-col gap-1.5">
              {contact.interests.slice(0, 3).map((i) => (
                <span key={i} className="text-[11px] text-slate-300">{titleCase(i)}</span>
              ))}
            </div>
          </InfoSection>
        ) : null}

        {contact.availability.length > 0 ? (
          <InfoSection icon="schedule" label="Availability">
            <div className="flex flex-col gap-1.5">
              {contact.availability.slice(0, 4).map((a) => (
                <span key={a} className="text-[11px] text-slate-300">{titleCase(a)}</span>
              ))}
            </div>
          </InfoSection>
        ) : null}

        {contact.languages.length > 0 ? (
          <InfoSection icon="language" label="Languages">
            <div className="flex flex-col gap-1.5">
              {contact.languages.slice(0, 6).map((l) => (
                <span key={l} className="text-[11px] text-slate-300">{titleCase(l)}</span>
              ))}
            </div>
          </InfoSection>
        ) : null}

        {hostingOpen ? (
          <InfoSection icon="home" label="Hosting">
            <div className="flex flex-col gap-1.5">
              {typeof contact.maxGuests === "number" ? (
                <span className="text-[11px] text-slate-300">Up to {contact.maxGuests}</span>
              ) : null}
              <span className="text-[11px] text-slate-300">{formatSleepingArrangement(contact.hostingSleepingArrangement)}</span>
              {contact.hostingLastMinuteOk ? <span className="text-[11px] text-slate-300">Last-min ok</span> : null}
              {contact.hostingKidFriendly ? <span className="text-[11px] text-slate-300">Kid friendly</span> : null}
              {contact.hostingPetFriendly ? <span className="text-[11px] text-slate-300">Pet friendly</span> : null}
            </div>
          </InfoSection>
        ) : null}
      </div>

    </div>
  );
}
