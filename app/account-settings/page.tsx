"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import Nav from "@/components/Nav";
import { buildAccountDeactivatedMetadata } from "@/lib/auth/account-status";
import { supabase } from "@/lib/supabase/client";
import { isPaymentVerified } from "@/lib/verification";

type MeProfile = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
  verified: boolean;
  roles: string[];
};

type BlockedMember = {
  connectionId: string;
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
  blockedAt: string;
};

type MyReport = {
  id: string;
  targetUserId: string | null;
  targetDisplayName: string;
  reason: string;
  status: string;
  createdAt: string;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(row: Record<string, unknown>, key: string, fallback = "") {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function pickNullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isMissingTableError(message: string | undefined) {
  if (!message) return false;
  const lower = message.toLowerCase();
  if (lower.includes("could not find the table")) return true;
  if (lower.includes("schema cache") && (lower.includes("table") || lower.includes("relation"))) return true;
  if (lower.includes("column") && lower.includes("does not exist")) return false;
  return (lower.includes("table") && lower.includes("does not exist")) || (lower.includes("relation") && lower.includes("does not exist"));
}

function formatRelative(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "Just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AccountSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [me, setMe] = useState<MeProfile | null>(null);
  const [blockedMembers, setBlockedMembers] = useState<BlockedMember[]>([]);
  const [reports, setReports] = useState<MyReport[]>([]);
  const [busyBlockedConnectionId, setBusyBlockedConnectionId] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function callConnectionAction(payload: {
    connId?: string;
    action: "unblock";
  }) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? "";
    if (!accessToken) throw new Error("Missing auth session token.");

    const response = await fetch("/api/connections/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !result?.ok) throw new Error(result?.error ?? `Failed to ${payload.action}.`);
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setWarning(null);

      // Use cached session first to avoid occasional getUser network races that can
      // bounce users away from account settings.
      const [sessionRes, authRes] = await Promise.all([
        supabase.auth.getSession(),
        supabase.auth.getUser(),
      ]);
      const user = sessionRes.data.session?.user ?? authRes.data.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      if (cancelled) return;

      const profileRes = await supabase
        .from("profiles")
        .select("user_id,display_name,city,country,avatar_url,verified,verified_label,roles")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profileRes.error || !profileRes.data) {
        if (!cancelled) {
          setError(profileRes.error?.message ?? "Could not load your profile.");
          setLoading(false);
        }
        return;
      }

      const meRow = asRecord(profileRes.data);
      const isVerified = isPaymentVerified(meRow);
      setMe({
        userId: user.id,
        displayName: pickString(meRow, "display_name", "Member"),
        city: pickString(meRow, "city"),
        country: pickString(meRow, "country"),
        avatarUrl: pickNullableString(meRow, "avatar_url"),
        verified: isVerified,
        roles: Array.isArray(meRow.roles) ? meRow.roles.filter((item): item is string => typeof item === "string") : [],
      });

      const [blockedRes, reportsRes] = await Promise.all([
        supabase
          .from("connections")
          .select("id,requester_id,target_id,blocked_by,updated_at,status")
          .eq("status", "blocked")
          .eq("blocked_by", user.id)
          .or(`requester_id.eq.${user.id},target_id.eq.${user.id}`)
          .order("updated_at", { ascending: false })
          .limit(80),
        supabase
          .from("reports")
          .select("id,target_user_id,reason,status,created_at")
          .eq("reporter_id", user.id)
          .order("created_at", { ascending: false })
          .limit(80),
      ]);

      const warnings: string[] = [];

      const blockedRows = blockedRes.error ? [] : ((blockedRes.data ?? []) as unknown[]);
      if (blockedRes.error && !isMissingTableError(blockedRes.error.message)) {
        warnings.push(`Blocked members could not be loaded: ${blockedRes.error.message}`);
      } else if (blockedRes.error) {
        warnings.push("Blocked members table is not available yet.");
      }

      const reportRows = reportsRes.error ? [] : ((reportsRes.data ?? []) as unknown[]);
      if (reportsRes.error && !isMissingTableError(reportsRes.error.message)) {
        warnings.push(`Reports could not be loaded: ${reportsRes.error.message}`);
      } else if (reportsRes.error) {
        warnings.push("Reports table is not available yet.");
      }

      const blockedPartnerIds = blockedRows
        .map((raw) => {
          const row = asRecord(raw);
          const requesterId = pickString(row, "requester_id");
          const targetId = pickString(row, "target_id");
          if (requesterId === user.id) return targetId;
          if (targetId === user.id) return requesterId;
          return "";
        })
        .filter(Boolean);

      const reportTargetIds = reportRows.map((raw) => pickString(asRecord(raw), "target_user_id")).filter(Boolean);
      const lookupIds = Array.from(new Set([...blockedPartnerIds, ...reportTargetIds]));

      const profilesById = new Map<string, { displayName: string; city: string; country: string; avatarUrl: string | null }>();
      if (lookupIds.length > 0) {
        const peopleRes = await supabase
          .from("profiles")
          .select("user_id,display_name,city,country,avatar_url")
          .in("user_id", lookupIds);

        if (!peopleRes.error) {
          for (const raw of (peopleRes.data ?? []) as unknown[]) {
            const row = asRecord(raw);
            const id = pickString(row, "user_id");
            if (!id) continue;
            profilesById.set(id, {
              displayName: pickString(row, "display_name", "Member"),
              city: pickString(row, "city"),
              country: pickString(row, "country"),
              avatarUrl: pickNullableString(row, "avatar_url"),
            });
          }
        }
      }

      const mappedBlocked = blockedRows.map((raw) => {
        const row = asRecord(raw);
        const requesterId = pickString(row, "requester_id");
        const targetId = pickString(row, "target_id");
        const partnerId = requesterId === user.id ? targetId : targetId === user.id ? requesterId : "";
        const partner = profilesById.get(partnerId);
        return {
          connectionId: pickString(row, "id"),
          userId: partnerId,
          displayName: partner?.displayName ?? "Member",
          city: partner?.city ?? "",
          country: partner?.country ?? "",
          avatarUrl: partner?.avatarUrl ?? null,
          blockedAt: pickString(row, "updated_at"),
        } satisfies BlockedMember;
      });

      const mappedReports = reportRows.map((raw) => {
        const row = asRecord(raw);
        const targetUserId = pickNullableString(row, "target_user_id");
        const partner = targetUserId ? profilesById.get(targetUserId) : null;
        return {
          id: pickString(row, "id"),
          targetUserId,
          targetDisplayName: partner?.displayName ?? "Member",
          reason: pickString(row, "reason", "No reason"),
          status: pickString(row, "status", "open"),
          createdAt: pickString(row, "created_at"),
        } satisfies MyReport;
      });

      if (cancelled) return;
      setBlockedMembers(mappedBlocked);
      setReports(mappedReports);
      setWarning(warnings.length > 0 ? warnings.join(" ") : null);
      setLoading(false);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleUnblockMember = async (connectionId: string) => {
    setBusyBlockedConnectionId(connectionId);
    setError(null);
    try {
      await callConnectionAction({ connId: connectionId, action: "unblock" });
      setBlockedMembers((prev) => prev.filter((item) => item.connectionId !== connectionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unblock member.");
    } finally {
      setBusyBlockedConnectionId(null);
    }
  };

  const handleDeactivateAccount = async () => {
    const confirmed = window.confirm(
      "Deactivate this account now? Signing in again later will reactivate it automatically."
    );
    if (!confirmed) return;

    setDeactivating(true);
    setError(null);

    try {
      const deactivatedAt = new Date().toISOString();
      const updateRes = await supabase.auth.updateUser({
        data: buildAccountDeactivatedMetadata(deactivatedAt),
      });
      if (updateRes.error) throw updateRes.error;

      const signOutRes = await supabase.auth.signOut({ scope: "local" });
      if (signOutRes.error) {
        console.warn("[account-settings] local sign out after deactivation failed", signOutRes.error.message);
      }

      router.replace("/auth?deactivated=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not deactivate your account.");
      setDeactivating(false);
    }
  };

  const handleLogOut = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore sign-out errors and continue with redirect.
    }
    window.location.assign("/auth");
  };

  const locationLabel = [me?.city, me?.country].filter(Boolean).join(", ") || "Location not set";
  const profileHref = me ? `/profile/${me.userId}` : "/me/edit";

  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {warning ? (
          <div className="mb-4 rounded-2xl border border-amber-300/35 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">{warning}</div>
        ) : null}

        {loading ? (
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-[#0b1a1d]/70 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="h-[72px] w-[72px] animate-pulse rounded-full bg-white/10" />
                  <div className="min-w-0 space-y-2">
                    <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
                    <div className="h-9 w-52 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
                  </div>
                </div>
                <div className="h-10 w-full animate-pulse rounded-xl bg-white/10 sm:w-40" />
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <article key={index} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
                  <div className="h-6 w-36 animate-pulse rounded bg-white/10" />
                  <div className="mt-3 h-4 w-64 animate-pulse rounded bg-white/10" />
                  <div className="mt-5 h-14 animate-pulse rounded-xl bg-black/20" />
                  <div className="mt-4 h-11 w-36 animate-pulse rounded-xl bg-white/10" />
                </article>
              ))}
            </section>

            <section className="grid gap-6 2xl:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <article key={index} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
                  <div className="h-6 w-32 animate-pulse rounded bg-white/10" />
                  <div className="mt-4 space-y-3">
                    {Array.from({ length: 3 }).map((__, rowIndex) => (
                      <div key={rowIndex} className="h-16 animate-pulse rounded-xl bg-black/20" />
                    ))}
                  </div>
                </article>
              ))}
            </section>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-[#0b1a1d]/70 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <Avatar
                    src={me?.avatarUrl ?? null}
                    alt={me?.displayName ?? "Member"}
                    size={72}
                    className="h-[72px] w-[72px] rounded-full border-2 border-white/20"
                  />
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/90">Account Settings</p>
                    <h1 className="truncate text-3xl font-black text-white">{me?.displayName ?? "Member"}</h1>
                    <p className="truncate text-sm text-slate-200/90">{locationLabel}</p>
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[180px]">
                  <Link
                    href={profileHref}
                    className="rounded-xl border border-white/20 bg-black/30 px-4 py-2 text-center text-sm font-semibold text-white/90 hover:bg-black/45"
                  >
                    View my profile
                  </Link>
                  <Link
                    href="/me/edit"
                    className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 text-center text-sm font-semibold text-[#06121a] hover:brightness-110 sm:hidden"
                  >
                    Edit profile
                  </Link>
                  <button
                    type="button"
                    onClick={() => void handleLogOut()}
                    disabled={loggingOut}
                    className="rounded-xl border border-white/20 bg-black/30 px-4 py-2 text-center text-sm font-semibold text-white/90 hover:bg-black/45 disabled:cursor-not-allowed disabled:opacity-60 sm:hidden"
                  >
                    {loggingOut ? "Logging out..." : "Log out"}
                  </button>
                </div>
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
              <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
                <h2 className="text-lg font-bold text-white">Access & Recovery</h2>
                <p className="mt-2 text-sm text-slate-400">Manage login recovery and account access options in one place.</p>
                <div className="mt-4 space-y-3">
                  <Link
                    href="/auth/recovery"
                    className="flex items-center justify-between rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-sm text-white hover:bg-black/40"
                  >
                    <span>Recover account access</span>
                    <span className="material-symbols-outlined text-[18px] text-cyan-300">arrow_forward</span>
                  </Link>
                  <Link
                    href="/account-settings/data-requests"
                    className="flex items-center justify-between rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-sm text-white hover:bg-black/40"
                  >
                    <span>Privacy & data requests</span>
                    <span className="material-symbols-outlined text-[18px] text-cyan-300">arrow_forward</span>
                  </Link>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                    Password login is disabled. ConXion uses secure magic-link and OTP login only.
                  </div>
                  <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
                    If you deactivate your account below, signing in again will reactivate it automatically.
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeactivateAccount()}
                    disabled={deactivating}
                    className="w-full rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100 hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deactivating ? "Deactivating..." : "Deactivate account"}
                  </button>
                </div>
              </article>

              <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
                <h2 className="text-lg font-bold text-white">Safety</h2>
                <p className="mt-2 text-sm text-slate-400">Review your blocked members and reports.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Blocked members</p>
                    <p className="mt-1 text-2xl font-bold text-white">{blockedMembers.length}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Reports submitted</p>
                    <p className="mt-1 text-2xl font-bold text-white">{reports.length}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Link
                    href="/connections/requests"
                    className="rounded-lg border border-white/20 bg-black/30 px-3 py-1.5 text-center text-sm font-semibold text-white/90 hover:bg-black/45"
                  >
                    Manage connections
                  </Link>
                  <Link
                    href="/safety-center"
                    className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-center text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20"
                  >
                    Open Safety Center
                  </Link>
                  <Link
                    href="/support"
                    className="rounded-lg border border-white/20 bg-black/30 px-3 py-1.5 text-center text-sm font-semibold text-white/90 hover:bg-black/45"
                  >
                    Contact support
                  </Link>
                </div>
              </article>
            </section>

            <section className="grid gap-6 2xl:grid-cols-2">
              <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
                <h3 className="text-base font-bold text-white">Blocked Members</h3>
                {blockedMembers.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-6 text-center text-sm text-slate-500">
                    You have not blocked any members.
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {blockedMembers.slice(0, 10).map((item) => (
                      <div key={item.connectionId} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/25 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar src={item.avatarUrl} alt={item.displayName} size={34} className="h-[34px] w-[34px] rounded-full border border-white/15" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{item.displayName}</p>
                            <p className="truncate text-xs text-slate-400">
                              {[item.city, item.country].filter(Boolean).join(", ") || "Location not set"}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">{formatRelative(item.blockedAt)}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleUnblockMember(item.connectionId)}
                          disabled={busyBlockedConnectionId === item.connectionId}
                          className="w-full shrink-0 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-50 sm:w-auto"
                        >
                          {busyBlockedConnectionId === item.connectionId ? "Unblocking..." : "Unblock"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </article>

              <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
                <h3 className="text-base font-bold text-white">My Reports</h3>
                <div className="mt-3">
                  <Link
                    href="/support"
                    className="inline-flex rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                  >
                    Open support cases
                  </Link>
                </div>
                {reports.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-6 text-center text-sm text-slate-500">
                    No reports submitted yet.
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {reports.slice(0, 10).map((item) => (
                      <div key={item.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-white">Reported: {item.targetDisplayName}</p>
                          <span className="rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                            {item.status}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">{item.reason}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatRelative(item.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </section>

          </div>
        )}
      </main>
    </div>
  );
}
