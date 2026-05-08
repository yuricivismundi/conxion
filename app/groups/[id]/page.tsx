"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import Nav from "@/components/Nav";
import { useToast } from "@/components/Toast";
import { supabase } from "@/lib/supabase/client";
import { mapGroupMemberRows, mapGroupRows, type GroupMemberRecord, type GroupRecord } from "@/lib/groups/model";
import { haptic } from "@/lib/haptic";

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
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupRecord | null>(null);
  const [members, setMembers] = useState<GroupMemberRecord[]>([]);
  const [profiles, setProfiles] = useState<Record<string, LiteProfile>>({});
  const [inviteCopied, setInviteCopied] = useState(false);
  const [allMembersOpen, setAllMembersOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ id: string; senderId: string; body: string; createdAt: string }>>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const draftKey = `cx_group_draft_${id}`;
  const [msgBody, setMsgBody] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(`cx_group_draft_${id}`) ?? "";
  });
  const [msgSending, setMsgSending] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [msgActionTarget, setMsgActionTarget] = useState<{ id: string; body: string; isMe: boolean } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll-lock when members modal is open
  useEffect(() => {
    if (allMembersOpen) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }
    return () => { document.body.classList.remove("modal-open"); };
  }, [allMembersOpen]);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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

      // Load chat thread
      setMsgLoading(true);
      const threadRes = await supabase.from("threads").select("id").eq("group_id", id).maybeSingle();
      if (!cancelled && threadRes.data?.id) {
        const tid = threadRes.data.id as string;
        setThreadId(tid);
        const msgRes = await supabase
          .from("thread_messages")
          .select("id,sender_id,body,created_at")
          .eq("thread_id", tid)
          .in("status_tag", ["active", "approved"])
          .order("created_at", { ascending: true })
          .limit(50);
        if (!cancelled) {
          const rows = (msgRes.data ?? []).map((m: { id: string; sender_id: string; body: string; created_at: string }) => ({
            id: m.id, senderId: m.sender_id, body: m.body ?? "", createdAt: m.created_at,
          }));
          setMessages(rows);
          setHasMoreMessages(rows.length === 50);
        }
      }
      if (!cancelled) setMsgLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, router]);

  // Realtime subscription for group chat — scoped to this thread only
  useEffect(() => {
    if (!threadId || !meId) return;

    // Cleanup any previous channel
    if (realtimeChannelRef.current) {
      void supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const channel = supabase
      .channel(`group-chat-${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "thread_messages",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            sender_id: string;
            body: string;
            created_at: string;
            status_tag?: string;
          };
          // Skip own messages — already added optimistically on send
          if (row.sender_id === meId) return;
          // Skip soft-deleted/hidden messages
          if (row.status_tag && !["active", "approved"].includes(row.status_tag)) return;
          const incoming = {
            id: row.id,
            senderId: row.sender_id,
            body: row.body ?? "",
            createdAt: row.created_at,
          };
          setMessages((prev) => {
            // Dedup by id (safety net)
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
          // Auto-scroll if user is near the bottom
          const el = chatScrollRef.current;
          const isNearBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 180 : true;
          if (isNearBottom) {
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          }
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      realtimeChannelRef.current = null;
    };
  }, [threadId, meId]);

  async function sendMessage() {
    if (!msgBody.trim() || msgSending) return;
    if (!threadId) {
      toast("Chat thread is not available yet. Please refresh.", "error");
      return;
    }
    haptic(10);
    setMsgSending(true);
    const body = msgBody.trim();
    setMsgBody("");
    localStorage.removeItem(draftKey);
    try {
      const { data, error } = await supabase.rpc("cx_send_inbox_message", {
        p_thread_id: threadId,
        p_connection_id: null,
        p_body: body,
      });
      if (!error && data) {
        setMessages((prev) => [...prev, { id: data as string, senderId: meId ?? "", body, createdAt: new Date().toISOString() }]);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } catch { /* ignore */ } finally {
      setMsgSending(false);
    }
  }

  async function loadEarlierMessages() {
    if (!threadId || loadingEarlier || messages.length === 0) return;
    setLoadingEarlier(true);
    const oldestCreatedAt = messages[0].createdAt;
    const scrollEl = chatScrollRef.current;
    const prevScrollHeight = scrollEl?.scrollHeight ?? 0;
    try {
      const { data } = await supabase
        .from("thread_messages")
        .select("id,sender_id,body,created_at")
        .eq("thread_id", threadId)
        .in("status_tag", ["active", "approved"])
        .lt("created_at", oldestCreatedAt)
        .order("created_at", { ascending: false })
        .limit(50);
      const earlier = (data ?? []).reverse().map((m: { id: string; sender_id: string; body: string; created_at: string }) => ({
        id: m.id, senderId: m.sender_id, body: m.body ?? "", createdAt: m.created_at,
      }));
      setMessages((prev) => [...earlier, ...prev]);
      setHasMoreMessages(earlier.length === 50);
      // Restore scroll position after prepending
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight - prevScrollHeight;
      });
    } catch { /* ignore */ } finally {
      setLoadingEarlier(false);
    }
  }

  async function copyInviteLink() {
    if (!group?.inviteToken) return;
    haptic(10);
    const url = `${window.location.origin}/groups/join/${group.inviteToken}`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: group.title ?? "Group", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2500);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast("Could not copy the invite link.", "error");
    }
  }

  async function handleLeaveGroup() {
    if (!id || !meId || leavingGroup) return;
    const prevMembers = members;
    setLeavingGroup(true);
    setMembers((prev) => prev.filter((m) => m.userId !== meId));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch(`/api/groups/${encodeURIComponent(id)}/leave`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !result?.ok) {
        setMembers(prevMembers);
        toast(result?.error ?? "Could not leave group.", "error");
      } else {
        toast("You left the group.", "info");
        router.replace("/activity?tab=groups");
      }
    } catch {
      setMembers(prevMembers);
      toast("Could not leave group.", "error");
    } finally {
      setLeavingGroup(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05060a] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1220px] px-4 pb-24 pt-5 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-4">
            <div className="h-[340px] rounded-[20px] bg-white/[0.04]" />
            <div className="h-24 rounded-2xl bg-white/[0.04]" />
          </div>
        </main>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="min-h-screen bg-[#05060a] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1220px] px-4 pb-24 pt-5 sm:px-6 lg:px-8">
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
  const shownMembers = allMembersOpen ? regularMembers : regularMembers.slice(0, 8);

  return (
    <div className="min-h-screen bg-[#05060a] text-slate-100">
      <Nav />

      {/* Mobile back button */}
      <div className="flex items-center gap-2 px-4 pt-3 md:hidden">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/70 active:scale-95 transition"
        >
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </button>
        <span className="truncate text-sm font-semibold text-white/60">Groups</span>
      </div>

      <main className="pb-28 md:pb-16">

        {/* ── Hero card ── */}
        <section className="mx-auto w-full max-w-[1220px] px-4 pt-3 sm:px-6 sm:pt-5 lg:px-8">
          <div className="rounded-[20px] border border-white/8 bg-[#1b1d21] shadow-[0_20px_48px_rgba(0,0,0,0.24)]">

            {/* Cover */}
            <div className="relative overflow-hidden rounded-t-[20px]">
              {group.coverUrl ? (
                <>
                  {/* Ambient glow */}
                  <div className="pointer-events-none absolute inset-0 scale-110 blur-3xl opacity-60">
                    <Image src={group.coverUrl} alt="" aria-hidden fill className="object-cover" sizes="100vw" />
                  </div>
                  <div className="relative mx-auto" style={{ aspectRatio: "16/9", maxHeight: 380 }}>
                    <Image src={group.coverUrl} alt={group.title} fill className="object-cover" sizes="(max-width: 1220px) 100vw, 1220px" priority />
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center bg-[linear-gradient(135deg,rgba(0,245,255,0.07),rgba(217,70,239,0.09))]" style={{ height: 200 }}>
                  <span className="material-symbols-outlined text-[72px] text-white/10">groups</span>
                </div>
              )}
            </div>

            {/* Title row */}
            <div className="flex items-start justify-between gap-4 px-5 py-5">
              <div className="min-w-0">
                <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{group.title}</h1>
                {(group.city ?? group.country) && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-slate-400">
                    <span className="material-symbols-outlined text-[14px]">location_on</span>
                    {[group.city, group.country].filter(Boolean).join(", ")}
                  </p>
                )}
                {/* Stats pills */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60">
                    <span className="material-symbols-outlined text-[14px] text-cyan-400/70">group</span>
                    {memberCount}/{group.maxMembers} members
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60">
                    <span className="material-symbols-outlined text-[14px] text-fuchsia-400/70">forum</span>
                    {group.chatMode === "discussion" ? "Open discussion" : "Broadcast only"}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex shrink-0 items-center gap-2">
                {isHost && (
                  <Link
                    href={`/groups/${group.id}/edit`}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 bg-[#2d3035] text-white hover:bg-[#373a40] transition"
                    title="Edit group"
                  >
                    <span className="material-symbols-outlined text-[18px]">edit</span>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Body ── */}
        <section className="mx-auto mt-4 w-full max-w-[1220px] px-4 sm:px-6 lg:px-8">
          <div className="lg:flex lg:items-start lg:gap-6">

            {/* ── Main ── */}
            <div className="min-w-0 flex-1 space-y-4">

              {/* Inline chat thread */}
              {(isHost || isMember) && (
                <div className="overflow-hidden rounded-[20px] border border-white/8 bg-[#1b1d21]">
                  <div className="flex items-center justify-between border-b border-white/8 px-5 py-3.5">
                    <h2 className="text-[17px] font-bold text-white">
                      {group.chatMode === "discussion" ? "Discussion" : "Updates"}
                    </h2>
                  </div>

                  {/* Messages */}
                  <div ref={chatScrollRef} className="flex max-h-[420px] min-h-[180px] flex-col gap-3 overflow-y-auto px-5 py-4">
                    {!msgLoading && hasMoreMessages && (
                      <button
                        type="button"
                        onClick={() => void loadEarlierMessages()}
                        disabled={loadingEarlier}
                        className="self-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                      >
                        {loadingEarlier ? "Loading…" : "Load earlier messages"}
                      </button>
                    )}
                    {msgLoading ? (
                      <div className="flex flex-col gap-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className={`flex gap-2 ${i % 2 === 0 ? "" : "flex-row-reverse"}`}>
                            <div className="h-8 w-8 shrink-0 rounded-full bg-white/[0.06] animate-pulse" />
                            <div className="h-10 w-[55%] rounded-2xl bg-white/[0.06] animate-pulse" />
                          </div>
                        ))}
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-center">
                        <span className="material-symbols-outlined text-[36px] text-slate-600">forum</span>
                        <p className="mt-2 text-sm text-slate-500">No messages yet. Start the conversation!</p>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isMe = msg.senderId === meId;
                        const p = profiles[msg.senderId];
                        const name = p?.displayName ?? "Member";
                        return (
                          <div key={msg.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[#121722]">
                              {p?.avatarUrl ? (
                                <Image src={p.avatarUrl} alt={name} fill className="object-cover" sizes="32px" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-cyan-100">
                                  {name.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div className={`flex max-w-[72%] flex-col gap-0.5 ${isMe ? "items-end" : "items-start"}`}>
                              {!isMe && <span className="px-1 text-[11px] text-slate-500">{name}{msg.senderId === group.hostUserId ? <span className="ml-1 text-[10px] font-semibold text-cyan-300/70">· Admin</span> : null}</span>}
                              <div
                                className={`rounded-2xl px-3.5 py-2 text-[14px] leading-snug whitespace-pre-wrap break-words select-none ${isMe ? "bg-[linear-gradient(90deg,#00c8cc,#b430d8)] text-white rounded-br-sm" : "bg-white/[0.07] text-slate-100 rounded-bl-sm"}`}
                                onContextMenu={(e) => { e.preventDefault(); setMsgActionTarget({ id: msg.id, body: msg.body, isMe }); }}
                                onTouchStart={() => { longPressTimerRef.current = setTimeout(() => setMsgActionTarget({ id: msg.id, body: msg.body, isMe }), 500); }}
                                onTouchEnd={() => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; } }}
                                onTouchMove={() => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; } }}
                              >
                                {msg.body}
                              </div>
                              <span className="px-1 text-[11px] text-slate-600">
                                {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Composer */}
                  {(isHost || (isMember && group.chatMode === "discussion")) && (
                    <div className="border-t border-white/8 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
                      <div className="flex items-end gap-2">
                        <textarea
                          rows={2}
                          maxLength={2000}
                          value={msgBody}
                          onChange={(e) => { const v = e.target.value.slice(0, 2000); setMsgBody(v); localStorage.setItem(draftKey, v); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
                          }}
                          placeholder="Write a message…"
                          className="flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void sendMessage()}
                          disabled={!msgBody.trim() || msgSending || !threadId}
                          aria-label="Send message"
                          className="h-10 w-10 shrink-0 rounded-xl bg-[linear-gradient(90deg,#00F5FF,#FF00FF)] flex items-center justify-center text-[#071116] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                        >
                          <span className="material-symbols-outlined text-[18px]">send</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* About */}
              {group.description && (
                <div className="rounded-[20px] border border-white/8 bg-[#1b1d21] p-5">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">About this group</p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{group.description}</p>
                </div>
              )}

              {/* Members (mobile) */}
              <div className="rounded-[20px] border border-white/8 bg-[#1b1d21] overflow-hidden lg:hidden">
                <div className="border-b border-white/[0.06] px-5 py-3.5 flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-cyan-400/70">Members · {memberCount}</p>
                </div>
                {members.slice(0, 8).map((member, idx) => {
                  const p = profiles[member.userId];
                  const name = p?.displayName ?? "Member";
                  const location = [p?.city, p?.country].filter(Boolean).join(", ");
                  return (
                    <Link
                      key={member.id}
                      href={`/profile/${member.userId}`}
                      className={`flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition ${idx !== 0 ? "border-t border-white/[0.05]" : ""}`}
                    >
                      {p?.avatarUrl ? (
                        <Image src={p.avatarUrl} alt={name} width={36} height={36} className="rounded-full object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                          <span className="material-symbols-outlined text-[16px] text-white/40">person</span>
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{name}</p>
                        {location && <p className="truncate text-xs text-slate-500">{location}</p>}
                      </div>
                      {member.role === "host" && (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-cyan-300">Admin</span>
                      )}
                    </Link>
                  );
                })}
                {memberCount > 8 && (
                  <button
                    type="button"
                    onClick={() => setAllMembersOpen(true)}
                    className="flex w-full items-center justify-center gap-1.5 border-t border-white/[0.06] px-5 py-3 text-xs font-semibold text-cyan-400/70 hover:text-cyan-300 transition"
                  >
                    See all {memberCount} members
                  </button>
                )}
              </div>

              {/* Non-member CTA */}
              {!isMember && !isHost && (
                <div className="rounded-[20px] border border-white/8 bg-[#1b1d21] p-8 text-center space-y-3">
                  <span className="material-symbols-outlined text-4xl text-white/15">lock</span>
                  <p className="font-bold text-white">This is a private group</p>
                  <p className="text-sm text-slate-500 leading-6">
                    Only members can see activity and participate.<br />Ask a member to share the invite link.
                  </p>
                </div>
              )}
            </div>

            {/* ── Right sidebar ── */}
            <aside className="mt-4 shrink-0 space-y-4 lg:mt-0 lg:w-[280px]">

              {/* Members panel */}
              <div className="rounded-[20px] border border-white/8 bg-[#1b1d21] overflow-hidden hidden lg:block">
                <div className="border-b border-white/[0.06] px-5 py-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-cyan-400/70">Members · {memberCount}/{group.maxMembers}</p>
                </div>

                {/* Host */}
                {hostProfile && (
                  <div className="border-b border-white/[0.06] px-5 py-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Moderator</p>
                    <Link href={`/profile/${group.hostUserId}`} className="flex items-center gap-2.5 hover:opacity-80 transition">
                      {hostProfile.avatarUrl ? (
                        <Image src={hostProfile.avatarUrl} alt={hostProfile.displayName} width={32} height={32} className="rounded-full object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10">
                          <span className="material-symbols-outlined text-[14px] text-white/40">person</span>
                        </span>
                      )}
                      <span className="truncate text-sm font-semibold text-white">{hostProfile.displayName}</span>
                    </Link>
                  </div>
                )}

                {/* Member list */}
                <div className="divide-y divide-white/[0.04]">
                  {shownMembers.map((member) => {
                    const p = profiles[member.userId];
                    const name = p?.displayName ?? "Member";
                    return (
                      <Link
                        key={member.id}
                        href={`/profile/${member.userId}`}
                        className="flex items-center gap-2.5 px-5 py-2.5 hover:bg-white/[0.03] transition"
                      >
                        {p?.avatarUrl ? (
                          <Image src={p.avatarUrl} alt={name} width={28} height={28} className="shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10">
                            <span className="material-symbols-outlined text-[13px] text-white/40">person</span>
                          </span>
                        )}
                        <span className="truncate text-sm text-slate-300">{name}</span>
                      </Link>
                    );
                  })}
                </div>

                {regularMembers.length > 8 && (
                  <button
                    type="button"
                    onClick={() => setAllMembersOpen(true)}
                    className="flex w-full items-center justify-center gap-1.5 border-t border-white/[0.06] px-5 py-3 text-xs font-semibold text-cyan-400/70 hover:text-cyan-300 transition"
                  >
                    See all {memberCount} members
                  </button>
                )}
                {regularMembers.length === 0 && (
                  <p className="px-5 pb-4 pt-2 text-xs text-slate-600">No other members yet.</p>
                )}
              </div>

              {/* Invite / status panel */}
              {isHost ? (
                <div className="rounded-[20px] border border-fuchsia-400/20 bg-fuchsia-500/[0.06] p-5 space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-fuchsia-300/70">Invite members</p>
                  <p className="text-xs leading-5 text-slate-500">Share your private invite link — only people with the link can join.</p>
                  <button
                    type="button"
                    onClick={() => void copyInviteLink()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,rgba(0,245,255,0.15),rgba(217,70,239,0.15))] border border-fuchsia-400/25 py-2.5 text-sm font-semibold text-fuchsia-200 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/70"
                  >
                    <span className="material-symbols-outlined text-[17px]">{inviteCopied ? "check" : "link"}</span>
                    {inviteCopied ? "Link copied!" : "Copy invite link"}
                  </button>
                </div>
              ) : isMember ? (
                <div className="rounded-[20px] border border-white/8 bg-[#1b1d21] p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[22px] text-cyan-300">verified</span>
                    <p className="text-sm font-semibold text-slate-300">You&apos;re a member</p>
                  </div>
                  <button
                    type="button"
                    disabled={leavingGroup}
                    onClick={() => void handleLeaveGroup()}
                    className="w-full rounded-xl border border-rose-400/20 bg-rose-500/[0.07] py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/[0.14] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
                  >
                    {leavingGroup ? "Leaving…" : "Leave group"}
                  </button>
                </div>
              ) : (
                <div className="rounded-[20px] border border-white/8 bg-[#1b1d21] p-5 text-center space-y-2">
                  <span className="material-symbols-outlined text-3xl text-white/20">lock</span>
                  <p className="text-sm font-bold text-slate-400">Private group</p>
                  <p className="text-xs text-slate-600 leading-5">Join by invitation only.</p>
                </div>
              )}
            </aside>
          </div>
        </section>
      </main>

      {/* Message action sheet */}
      {msgActionTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setMsgActionTarget(null)}
        >
          <div className="sheet-up w-full max-w-sm overflow-hidden rounded-t-[28px] border border-white/10 bg-[#0f1116] pb-safe" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <p className="line-clamp-2 text-sm text-slate-400">{msgActionTarget.body}</p>
            </div>
            <div className="py-2">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-5 py-3.5 text-sm font-medium text-white hover:bg-white/[0.05] active:bg-white/[0.08] transition"
                onClick={() => { navigator.clipboard?.writeText(msgActionTarget.body).catch(() => {}); setMsgActionTarget(null); toast("Copied to clipboard", "success"); }}
              >
                <span className="material-symbols-outlined text-[20px] text-slate-400">content_copy</span>
                Copy message
              </button>
              {msgActionTarget.isMe && (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-sm font-medium text-rose-300 hover:bg-rose-500/[0.08] active:bg-rose-500/[0.12] transition"
                  onClick={() => setMsgActionTarget(null)}
                >
                  <span className="material-symbols-outlined text-[20px]">delete</span>
                  Delete (coming soon)
                </button>
              )}
              {!msgActionTarget.isMe && (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-sm font-medium text-slate-400 hover:bg-white/[0.05] active:bg-white/[0.08] transition"
                  onClick={() => setMsgActionTarget(null)}
                >
                  <span className="material-symbols-outlined text-[20px]">flag</span>
                  Report message
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* All members modal — bottom sheet on mobile, centered on sm+ */}
      {allMembersOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setAllMembersOpen(false)}
        >
          <div
            className="sheet-up w-full max-w-md overflow-hidden rounded-t-[28px] border border-white/10 bg-[#0a0c13] shadow-2xl sm:rounded-[28px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle — mobile only */}
            <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <p className="font-bold text-white">All members <span className="ml-1 text-sm font-normal text-slate-500">({memberCount})</span></p>
              <button
                type="button"
                onClick={() => setAllMembersOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-white/8 hover:text-white transition"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            {hostProfile && (
              <div className="border-b border-white/[0.06] px-5 py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-cyan-400/60">Moderator</p>
                <Link href={`/profile/${group.hostUserId}`} onClick={() => setAllMembersOpen(false)} className="flex items-center gap-3 hover:opacity-80 transition">
                  {hostProfile.avatarUrl ? (
                    <Image src={hostProfile.avatarUrl} alt={hostProfile.displayName} width={36} height={36} className="rounded-full object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                      <span className="material-symbols-outlined text-[16px] text-white/40">person</span>
                    </span>
                  )}
                  <p className="truncate text-sm font-semibold text-white">{hostProfile.displayName}</p>
                </Link>
              </div>
            )}
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/[0.04] pb-safe">
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
                      <Image src={p.avatarUrl} alt={name} width={36} height={36} className="shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                        <span className="material-symbols-outlined text-[16px] text-white/40">person</span>
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{name}</p>
                      {location && <p className="truncate text-xs text-slate-500">{location}</p>}
                    </div>
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
