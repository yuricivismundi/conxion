"use client";
/* eslint-disable @next/next/no-img-element */

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import { mapGroupMemberRows, mapGroupRows, type GroupMemberRecord, type GroupRecord } from "@/lib/groups/model";

type LiteProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  city: string | null;
  country: string | null;
};

export default function GroupPage() {
  return (
    <Suspense>
      <GroupDetail />
    </Suspense>
  );
}

function GroupDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupRecord | null>(null);
  const [members, setMembers] = useState<GroupMemberRecord[]>([]);
  const [profiles, setProfiles] = useState<Record<string, LiteProfile>>({});
  const [inviteCopied, setInviteCopied] = useState(false);
  const [allMembersOpen, setAllMembersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) { router.replace("/auth"); return; }
      const userId = authData.user.id;
      if (!cancelled) setMeId(userId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const [groupRes, membersRes] = await Promise.all([
        db.from("groups").select("*").eq("id", id).single(),
        db.from("group_members").select("*").eq("group_id", id),
      ]);

      if (cancelled) return;

      if (groupRes.error || !groupRes.data) {
        setError("Group not found or you don't have access.");
        setLoading(false);
        return;
      }

      const groupData = mapGroupRows([groupRes.data])[0];
      if (!groupData) { setError("Could not load group."); setLoading(false); return; }

      const memberData = mapGroupMemberRows((membersRes.data ?? []) as unknown[]);
      setGroup(groupData);
      setMembers(memberData);

      const userIds = memberData.map((m) => m.userId);
      if (userIds.length > 0) {
        const profilesRes = await supabase
          .from("profiles")
          .select("user_id, display_name, avatar_url, city, country")
          .in("user_id", userIds);
        if (!cancelled && !profilesRes.error) {
          const map: Record<string, LiteProfile> = {};
          (profilesRes.data ?? []).forEach((row) => {
            map[row.user_id] = {
              userId: row.user_id,
              displayName: row.display_name ?? "Member",
              avatarUrl: row.avatar_url ?? null,
              city: row.city ?? null,
              country: row.country ?? null,
            };
          });
          setProfiles(map);
        }
      }

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, router]);

  async function copyInviteLink() {
    if (!group?.inviteToken) return;
    const url = `${window.location.origin}/groups/join/${group.inviteToken}`;
    await navigator.clipboard.writeText(url);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2500);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05060a] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[980px] px-4 pb-24 pt-7 sm:px-6">
          <div className="animate-pulse lg:flex lg:gap-6">
            <div className="hidden lg:block lg:w-64 space-y-4 shrink-0">
              <div className="h-48 rounded-2xl bg-white/[0.04]" />
              <div className="h-32 rounded-2xl bg-white/[0.04]" />
            </div>
            <div className="flex-1 space-y-4">
              <div className="h-52 rounded-3xl bg-white/[0.04]" />
              <div className="h-24 rounded-2xl bg-white/[0.04]" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="min-h-screen bg-[#05060a] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[980px] px-4 pb-24 pt-7 sm:px-6">
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error ?? "Group not found."}
          </div>
        </main>
      </div>
    );
  }

  const isHost = group.hostUserId === meId;
  const isMember = members.some((m) => m.userId === meId);
  const memberCount = members.length;
  const hostProfile = profiles[group.hostUserId];
  const regularMembers = members.filter((m) => m.userId !== group.hostUserId);
  const shownMembers = regularMembers.slice(0, 10);

  return (
    <div className="min-h-screen bg-[#05060a] text-slate-100">
      <Nav />
      <main className="mx-auto w-full max-w-[980px] px-4 pb-24 pt-7 sm:px-6">
        <div className="lg:flex lg:items-start lg:gap-6">

          {/* ── Left sidebar ── */}
          <aside className="mb-6 shrink-0 lg:mb-0 lg:w-60 space-y-4">

            {/* My Groups link */}
            <Link href="/activity?tab=groups" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition">
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              My Groups
            </Link>

            {/* Members panel */}
            <div className="rounded-2xl border border-white/10 bg-[#0d1117] overflow-hidden">
              {/* Moderator */}
              {hostProfile && (
                <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#00F5FF]/60">Moderator</p>
                  <Link href={`/profile/${group.hostUserId}`} className="flex items-center gap-2.5 hover:opacity-80 transition">
                    {hostProfile.avatarUrl ? (
                      <img src={hostProfile.avatarUrl} alt={hostProfile.displayName} className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10">
                        <span className="material-symbols-outlined text-[14px] text-white/40">person</span>
                      </span>
                    )}
                    <span className="truncate text-sm font-semibold text-white">{hostProfile.displayName}</span>
                  </Link>
                </div>
              )}

              {/* Members list */}
              <div className="px-4 pt-3 pb-1">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/35">
                  Members · {memberCount}/{group.maxMembers}
                </p>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {shownMembers.map((member) => {
                  const p = profiles[member.userId];
                  const name = p?.displayName ?? "Member";
                  return (
                    <Link
                      key={member.id}
                      href={`/profile/${member.userId}`}
                      className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-white/[0.04] transition"
                    >
                      {p?.avatarUrl ? (
                        <img src={p.avatarUrl} alt={name} className="h-7 w-7 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10">
                          <span className="material-symbols-outlined text-[13px] text-white/40">person</span>
                        </span>
                      )}
                      <span className="truncate text-sm text-white/80">{name}</span>
                    </Link>
                  );
                })}
              </div>
              {regularMembers.length > 10 && (
                <button
                  type="button"
                  onClick={() => setAllMembersOpen(true)}
                  className="flex w-full items-center justify-center gap-1.5 border-t border-white/[0.06] px-4 py-3 text-xs font-semibold text-[#00F5FF]/70 hover:text-[#00F5FF] transition"
                >
                  <span className="material-symbols-outlined text-[14px]">expand_more</span>
                  See all {memberCount} members
                </button>
              )}
              {regularMembers.length === 0 && (
                <p className="px-4 pb-4 text-xs text-white/30">No other members yet.</p>
              )}
            </div>

            {/* Invite / access panel */}
            {isHost ? (
              <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/[0.06] p-4 space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-fuchsia-300/70">Invite members</p>
                <p className="text-xs leading-5 text-white/50">Share your private invite link — only people with the link can join.</p>
                <button
                  type="button"
                  onClick={() => void copyInviteLink()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-fuchsia-400/25 bg-fuchsia-400/10 py-2.5 text-sm font-semibold text-fuchsia-200 transition hover:bg-fuchsia-400/20"
                >
                  <span className="material-symbols-outlined text-[17px]">{inviteCopied ? "check" : "link"}</span>
                  {inviteCopied ? "Link copied!" : "Copy invite link"}
                </button>
              </div>
            ) : isMember ? (
              <div className="rounded-2xl border border-white/10 bg-[#0d1117] p-4 text-center space-y-2">
                <span className="material-symbols-outlined text-3xl text-cyan-300/60">verified</span>
                <p className="text-sm font-semibold text-white/70">You&apos;re a member</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-[#0d1117] p-4 text-center space-y-2">
                <span className="material-symbols-outlined text-3xl text-white/20">lock</span>
                <p className="text-sm font-bold text-white/60">Private group</p>
                <p className="text-xs text-white/35 leading-5">Join by invitation only. Ask a member to share the invite link.</p>
              </div>
            )}
          </aside>

          {/* ── Main content ── */}
          <div className="min-w-0 flex-1 space-y-5">

            {/* Cover + header */}
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117]">
              {group.coverUrl ? (
                <div className="h-48 sm:h-60">
                  <img src={group.coverUrl} alt={group.title} className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-32 items-center justify-center bg-[linear-gradient(135deg,rgba(0,245,255,0.07),rgba(217,70,239,0.07))]">
                  <span className="material-symbols-outlined text-[48px] text-white/10">groups</span>
                </div>
              )}
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{group.title}</h1>
                    {(group.city ?? group.country) && (
                      <p className="mt-1 flex items-center gap-1 text-sm text-white/45">
                        <span className="material-symbols-outlined text-[14px]">location_on</span>
                        {[group.city, group.country].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                  {isHost && (
                    <Link
                      href={`/groups/${group.id}/edit`}
                      className="shrink-0 rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/[0.08] transition"
                    >
                      <span className="material-symbols-outlined text-[15px] align-middle">edit</span>
                    </Link>
                  )}
                </div>

                {/* Stats row */}
                <div className="mt-4 flex flex-wrap gap-3">
                  <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60">
                    <span className="material-symbols-outlined text-[14px] text-[#00F5FF]/70">person</span>
                    {memberCount}/{group.maxMembers} members
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60">
                    <span className="material-symbols-outlined text-[14px] text-fuchsia-400/70">forum</span>
                    {group.chatMode === "discussion" ? "Open discussion" : "Broadcast only"}
                  </span>
                </div>
              </div>
            </div>

            {/* Description */}
            {group.description && (
              <div className="rounded-2xl border border-white/10 bg-[#0d1117] p-5">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/30">About this group</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">{group.description}</p>
              </div>
            )}

            {/* Members list (mobile — hidden on lg where sidebar shows) */}
            <div className="rounded-2xl border border-white/10 bg-[#0d1117] overflow-hidden lg:hidden">
              <div className="border-b border-white/[0.06] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#00F5FF]/70">Members · {memberCount}</p>
              </div>
              {members.map((member, idx) => {
                const p = profiles[member.userId];
                const name = p?.displayName ?? "Member";
                const location = [p?.city, p?.country].filter(Boolean).join(", ");
                return (
                  <Link
                    key={member.id}
                    href={`/profile/${member.userId}`}
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition ${idx !== 0 ? "border-t border-white/[0.06]" : ""}`}
                  >
                    {p?.avatarUrl ? (
                      <img src={p.avatarUrl} alt={name} className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                        <span className="material-symbols-outlined text-[16px] text-white/40">person</span>
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{name}</p>
                      {location && <p className="truncate text-xs text-white/35">{location}</p>}
                    </div>
                    {member.role === "host" && (
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-cyan-300">Admin</span>
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Non-member CTA */}
            {!isMember && !isHost && (
              <div className="rounded-2xl border border-white/10 bg-[#0d1117] p-6 text-center space-y-3">
                <span className="material-symbols-outlined text-4xl text-white/15">lock</span>
                <p className="font-bold text-white">This is a private group</p>
                <p className="text-sm text-white/45 leading-6">
                  Only members can see activity and participate.<br />Ask a member to share the invite link with you.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* All members modal */}
      {allMembersOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => setAllMembersOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <p className="font-bold text-white">All members <span className="ml-1 text-sm font-normal text-white/40">({memberCount})</span></p>
              <button
                type="button"
                onClick={() => setAllMembersOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 transition"
              >
                <span className="material-symbols-outlined text-[20px] text-white/50">close</span>
              </button>
            </div>

            {/* Moderator row */}
            {hostProfile && (
              <div className="border-b border-white/[0.06] px-5 py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#00F5FF]/60">Moderator</p>
                <Link
                  href={`/profile/${group.hostUserId}`}
                  onClick={() => setAllMembersOpen(false)}
                  className="flex items-center gap-3 hover:opacity-80 transition"
                >
                  {hostProfile.avatarUrl ? (
                    <img src={hostProfile.avatarUrl} alt={hostProfile.displayName} className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                      <span className="material-symbols-outlined text-[16px] text-white/40">person</span>
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{hostProfile.displayName}</p>
                    {(profiles[group.hostUserId]?.city ?? profiles[group.hostUserId]?.country) && (
                      <p className="truncate text-xs text-white/40">
                        {[profiles[group.hostUserId]?.city, profiles[group.hostUserId]?.country].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                </Link>
              </div>
            )}

            {/* Members list */}
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/[0.04]">
              {regularMembers.map((member) => {
                const p = profiles[member.userId];
                const name = p?.displayName ?? "Member";
                const location = [p?.city, p?.country].filter(Boolean).join(", ");
                return (
                  <Link
                    key={member.id}
                    href={`/profile/${member.userId}`}
                    onClick={() => setAllMembersOpen(false)}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.04] transition"
                  >
                    {p?.avatarUrl ? (
                      <img src={p.avatarUrl} alt={name} className="h-9 w-9 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                        <span className="material-symbols-outlined text-[16px] text-white/40">person</span>
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{name}</p>
                      {location && <p className="truncate text-xs text-white/40">{location}</p>}
                    </div>
                    <span className="material-symbols-outlined shrink-0 text-[16px] text-white/20">chevron_right</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
