"use client";

import Image, { type ImageLoaderProps } from "next/image";
import Link from "next/link";
import { type ReferenceContextTag } from "@/lib/activities/types";
import {
  formatGuestGenderPreference,
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
};

type ContactSidebarPanelProps = {
  loading: boolean;
  error: string | null;
  contact: ContactSidebarData | null;
  canInitiateActivity?: boolean;
  onInitiateActivity?: (() => void) | null;
  referencePromptLabel?: string | null;
  onOpenReferences?: (() => void) | null;
  latestSubmittedReferenceLabel?: string | null;
};

const remoteImageLoader = ({ src }: ImageLoaderProps) => src;

function ContactSidebarSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="rounded-2xl border border-white/10 bg-[linear-gradient(155deg,rgba(10,22,24,0.95),rgba(12,14,18,0.98))] p-4">
        <div className="mx-auto h-40 w-40 rounded-full border-2 border-white/10 bg-white/[0.06]" />
        <div className="mt-4 text-center">
          <div className="mx-auto h-7 w-40 rounded-full bg-white/[0.08]" />
          <div className="mx-auto mt-2 h-4 w-28 rounded-full bg-white/[0.06]" />
          <div className="mt-3 flex justify-center gap-2">
            <div className="h-6 w-24 rounded-full bg-white/[0.06]" />
            <div className="h-6 w-28 rounded-full bg-white/[0.06]" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/25 px-2 py-2">
            <div className="mx-auto h-3 w-20 rounded-full bg-white/[0.06]" />
            <div className="mx-auto mt-2 h-6 w-10 rounded-full bg-white/[0.08]" />
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-2 py-2">
            <div className="mx-auto h-3 w-20 rounded-full bg-white/[0.06]" />
            <div className="mx-auto mt-2 h-6 w-10 rounded-full bg-white/[0.08]" />
          </div>
        </div>
        <div className="mt-4 h-10 rounded-full bg-white/[0.06]" />
        <div className="mt-2 h-10 rounded-full bg-white/[0.05]" />
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
        <div className="h-3 w-28 rounded-full bg-white/[0.08]" />
        <div>
          <div className="h-3 w-16 rounded-full bg-white/[0.06]" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <div className="h-6 w-20 rounded-full bg-white/[0.06]" />
            <div className="h-6 w-24 rounded-full bg-white/[0.06]" />
            <div className="h-6 w-16 rounded-full bg-white/[0.06]" />
          </div>
        </div>
        <div>
          <div className="h-3 w-20 rounded-full bg-white/[0.06]" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <div className="h-6 w-18 rounded-full bg-white/[0.06]" />
            <div className="h-6 w-16 rounded-full bg-white/[0.06]" />
            <div className="h-6 w-20 rounded-full bg-white/[0.06]" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="h-3 w-14 rounded-full bg-white/[0.06]" />
            <div className="mt-2 h-4 w-full rounded-full bg-white/[0.06]" />
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="h-3 w-20 rounded-full bg-white/[0.06]" />
            <div className="mt-2 h-4 w-4/5 rounded-full bg-white/[0.06]" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
        <div className="h-3 w-24 rounded-full bg-white/[0.08]" />
        <div className="space-y-2">
          <div className="h-11 rounded-xl bg-white/[0.05]" />
          <div className="h-11 rounded-xl bg-white/[0.05]" />
          <div className="h-20 rounded-xl bg-white/[0.05]" />
        </div>
      </div>
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

function sumContextCounts(contact: ContactSidebarData, keys: ReferenceContextTag[]) {
  return keys.reduce((total, key) => total + (contact.referencesByContext[key] ?? 0), 0);
}

export default function ContactSidebarPanel({
  loading,
  error,
  contact,
  canInitiateActivity = false,
  onInitiateActivity = null,
  referencePromptLabel = null,
  onOpenReferences = null,
  latestSubmittedReferenceLabel = null,
}: ContactSidebarPanelProps) {
  if (loading) {
    return <ContactSidebarSkeleton />;
  }

  if (error) {
    return <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>;
  }

  if (!contact) {
    return <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">Member details are available for 1:1 chats.</div>;
  }

  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-[linear-gradient(155deg,rgba(10,22,24,0.95),rgba(12,14,18,0.98))] p-4">
        <div className="mx-auto relative h-40 w-40 overflow-hidden rounded-full border-2 border-cyan-300/40 bg-[#1a3436]">
          {contact.avatarUrl ? (
            <Image
              src={contact.avatarUrl}
              alt={contact.displayName}
              fill
              sizes="160px"
              loader={remoteImageLoader}
              unoptimized
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-cyan-100/80">
              <span className="material-symbols-outlined" style={{ fontSize: 42 }}>
                person
              </span>
            </div>
          )}
        </div>
        <div className="mt-4 text-center">
          <p className="text-2xl font-bold text-white leading-tight">{contact.displayName}</p>
          <p className="mt-1 text-sm text-cyan-100/80">{[contact.city, contact.country].filter(Boolean).join(", ") || "Location not set"}</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            {contact.verified ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100">
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                  verified
                </span>
                {contact.verifiedLabel || "Verified"}
              </span>
            ) : null}
            <span
              className={[
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                isHostingListingOpen(contact.canHost, contact.hostingStatus)
                  ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                  : "border-white/20 bg-white/[0.05] text-slate-300",
              ].join(" ")}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                home
              </span>
              {isHostingListingOpen(contact.canHost, contact.hostingStatus)
                ? `Hosting${typeof contact.maxGuests === "number" ? ` • up to ${contact.maxGuests}` : ""}`
                : "Not hosting"}
            </span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 text-center sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/25 px-2 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">Connections</p>
            <p className="mt-1 text-lg font-bold text-white">{contact.connectionsCount}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-2 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">References</p>
            <p className="mt-1 text-lg font-bold text-white">{contact.referencesTotal}</p>
          </div>
        </div>
        {canInitiateActivity && onInitiateActivity ? (
          <button
            type="button"
            onClick={onInitiateActivity}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#6ee7f9,#d946ef)] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-[#071116] shadow-[0_12px_32px_rgba(217,70,239,0.22)] transition-opacity hover:opacity-95"
          >
            <span className="material-symbols-outlined text-[13px]">event_available</span>
            Invite to Activity
          </button>
        ) : null}
        <Link
          href={`/profile/${contact.userId}`}
          className={`${canInitiateActivity && onInitiateActivity ? "mt-2" : "mt-4"} inline-flex w-full items-center justify-center rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/20`}
        >
          View profile
        </Link>
        {referencePromptLabel && onOpenReferences ? (
          <button
            type="button"
            onClick={onOpenReferences}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/18"
          >
            <span className="material-symbols-outlined text-[13px]">rate_review</span>
            Add {referencePromptLabel} reference
          </button>
        ) : latestSubmittedReferenceLabel ? (
          <div className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-100">
            <span className="material-symbols-outlined text-[13px]">check_circle</span>
            {latestSubmittedReferenceLabel} reference submitted
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/90">Profile snapshot</p>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">Roles</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {contact.roles.length ? (
              contact.roles.slice(0, 4).map((role) => (
                <span key={`role-${role}`} className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-200">
                  {titleCase(role)}
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-400">No roles shared.</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">Dance styles</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {contact.danceStyles.length ? (
              contact.danceStyles.slice(0, 6).map((style) => (
                <span key={`style-${style}`} className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100">
                  {titleCase(style)}
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-400">No styles listed.</span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">Interest</p>
            <p className="mt-1 text-sm text-slate-100">{contact.interests.length ? contact.interests.slice(0, 2).join(" · ") : "Not shared"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">Availability</p>
            <p className="mt-1 text-sm text-slate-100">{contact.availability.length ? contact.availability.slice(0, 2).join(" · ") : "Not shared"}</p>
          </div>
        </div>
      </div>

      {isHostingListingOpen(contact.canHost, contact.hostingStatus) ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/90">Hosting details</p>
          <div className="grid gap-2 text-sm text-slate-200">
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <span className="text-slate-400">Max guests</span>
              <span className="font-semibold text-white">{contact.maxGuests ?? 1}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <span className="text-slate-400">Last-minute requests</span>
              <span className="font-semibold text-white">{contact.hostingLastMinuteOk ? "Yes" : "No"}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <span className="text-slate-400">Preferred guest gender</span>
              <span className="font-semibold text-white">{formatGuestGenderPreference(contact.hostingPreferredGuestGender)}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { label: "Kid friendly", value: contact.hostingKidFriendly },
                { label: "Pet friendly", value: contact.hostingPetFriendly },
                { label: "Smoking allowed", value: contact.hostingSmokingAllowed },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
                  <p className="mt-1 font-semibold text-white">{item.value ? "Yes" : "No"}</p>
                </div>
              ))}
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.08em] text-slate-500">Sleeping arrangement</p>
                <p className="mt-1 font-semibold text-white">{formatSleepingArrangement(contact.hostingSleepingArrangement)}</p>
              </div>
            </div>
            {contact.hostingGuestShare ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3">
                <p className="text-[10px] uppercase tracking-[0.08em] text-slate-500">What I can share with guests</p>
                <p className="mt-1 text-sm leading-6 text-slate-100">{contact.hostingGuestShare}</p>
              </div>
            ) : null}
            {contact.hostingTransitAccess ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3">
                <p className="text-[10px] uppercase tracking-[0.08em] text-slate-500">Public transportation access</p>
                <p className="mt-1 text-sm leading-6 text-slate-100">{contact.hostingTransitAccess}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/90">Languages</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {contact.languages.length ? (
            contact.languages.slice(0, 6).map((language) => (
              <span key={`lang-${language}`} className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-200">
                {titleCase(language)}
              </span>
            ))
          ) : (
            <span className="text-xs text-slate-400">No languages listed.</span>
          )}
        </div>
      </div>
    </>
  );
}
