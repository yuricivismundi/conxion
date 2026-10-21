"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import InviteDancersModal from "@/components/invite/InviteDancersModal";
import Nav from "@/components/Nav";
import { getPlanLimits } from "@/lib/billing/limits";
import { HOSTING_TRUST_GATE_ENABLED } from "@/lib/hosting/trust-gate";

const limits = getPlanLimits("pro");

function fmt(value: number | null, unit: string) {
  return value === null ? `Unlimited ${unit}` : `${value} ${unit}`;
}

const PERK_GROUPS: Array<{ title: string; icon: string; items: string[] }> = [
  {
    title: "Your Dance Page",
    icon: "auto_awesome",
    items: [
      "A public page you can share on Instagram, TikTok or WhatsApp",
      "Choose your label: Teacher, Artist, Performer, Competitor, DJ, Organizer…",
      "Shows your upcoming events, competition history, videos and references",
      "Teachers also get private-class booking, weekly classes and service inquiries",
    ],
  },
  {
    title: "Connect",
    icon: "diversity_3",
    items: [
      fmt(limits.connectionRequestsPerMonth, "connection requests per month"),
      fmt(limits.initiatedChatsPerMonth, "chat activations per month"),
      "Activity, trip and hosting chats are always free and don't count",
      "Private mode: hide from Discover whenever you want",
    ],
  },
  {
    title: "Travel & hosting",
    icon: "flight_takeoff",
    items: [
      fmt(limits.tripsPerMonth, "trips per month"),
      fmt(limits.tripRequestsPerMonth, "trip requests per month"),
      fmt(
        limits.hostingRequestsPerMonth,
        HOSTING_TRUST_GATE_ENABLED ? "hosting requests per month (complete profile + approved photo)" : "hosting requests per month"
      ),
      fmt(limits.hostingOffersPerMonth, "hosting offers per month"),
    ],
  },
  {
    title: "Events & groups",
    icon: "calendar_month",
    items: [
      fmt(limits.eventsPerMonth, "events per month"),
      fmt(limits.eventInvitesPerMonth, "event invites"),
      fmt(limits.privateGroupsTotal, "private groups"),
      fmt(limits.bookingRequestsPerMonth, "class booking requests per month"),
    ],
  },
  {
    title: "Profile & growth",
    icon: "person",
    items: [
      `${limits.profileVideos ?? 0} showcase videos + ${limits.profilePhotos ?? 0} showcase photos`,
      "Dance Tools: growth path, goals and competition records",
      "References from the people you dance, travel and learn with",
    ],
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Is it really free?",
    a: "Yes. While we build the community, every account gets the full product. No card, no trial, no catch.",
  },
  {
    q: "Why are there still limits?",
    a: "Limits reset every month and stop spam and fake accounts, so your inbox stays full of real dancers. Almost nobody hits them.",
  },
  {
    q: "What does Founding Member mean?",
    a: "Everyone who joins during early access keeps a Founding Member badge on their profile, and gets first access to new features. If paid plans come back, founding members will hear about it first.",
  },
  HOSTING_TRUST_GATE_ENABLED
    ? {
        q: "Why do I need a complete profile to request hosting?",
        a: "Hosts open their homes. You need a complete profile (name, bio, city, country, dance styles, role) and a profile photo approved by our team. If something needs fixing, an admin will message you.",
      }
    : {
        q: "Who can request hosting?",
        a: "Any signed-in member. Hosts decide who they accept, so a complete profile with a photo, bio and references makes a yes far more likely.",
      },
];

export default function EarlyAccessPerks() {
  const [inviteOpen, setInviteOpen] = useState(false);

  // /pricing?invite=1 (from the menu "Invite dancers") opens the invite dialog directly.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (new URLSearchParams(window.location.search).get("invite") === "1") setInviteOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="min-h-screen bg-[#05070d] text-white">
      <Nav />
      <main className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_45%),radial-gradient(circle_at_top_right,rgba(217,70,239,0.16),transparent_32%)]" />
        <div className="relative mx-auto w-full max-w-[1100px] px-4 pb-24 pt-10 sm:px-6">
          <section className="mx-auto max-w-[720px] text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-fuchsia-100">
              <span className="material-symbols-outlined text-[14px]">workspace_premium</span>
              Founding member
            </span>
            <h1 className="mt-5 text-3xl font-black tracking-tight sm:text-5xl">
              Everything is free during early access
            </h1>
            <p className="mt-4 text-base leading-7 text-slate-300">
              We&apos;re building ConXion with its first dancers. Every feature is unlocked for you. Help us grow the
              community and you&apos;ll keep your Founding Member badge for good.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/me/edit/teacher-profile"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-6 py-3 text-sm font-black uppercase tracking-widest text-[#06121a] hover:brightness-110"
              >
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                Build my Dance Page
              </Link>
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/[0.04] px-6 py-3 text-sm font-black uppercase tracking-widest text-white hover:bg-white/[0.08]"
              >
                <span className="material-symbols-outlined text-[18px]">group_add</span>
                Invite dancers
              </button>
            </div>
          </section>

          <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PERK_GROUPS.map((group) => (
              <article
                key={group.title}
                className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,17,22,0.94),rgba(8,12,18,0.9))] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.28)]"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-cyan-300">{group.icon}</span>
                  <h2 className="text-sm font-black uppercase tracking-[0.16em] text-white">{group.title}</h2>
                </div>
                <ul className="mt-4 space-y-2.5">
                  {group.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-200">
                      <span className="material-symbols-outlined mt-1 text-[16px] text-emerald-300">check_circle</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>

          <section className="mx-auto mt-16 max-w-[760px]">
            <h2 className="text-center text-xl font-black tracking-tight">Questions</h2>
            <div className="mt-6 divide-y divide-white/10 rounded-[24px] border border-white/10 bg-white/[0.02]">
              {FAQ.map((item) => (
                <details key={item.q} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white">
                    {item.q}
                    <span className="material-symbols-outlined text-[18px] text-white/40 transition group-open:rotate-180">expand_more</span>
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </main>
      <InviteDancersModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
