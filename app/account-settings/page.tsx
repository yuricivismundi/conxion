"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import StripeCheckoutDialog from "@/components/billing/StripeCheckoutDialog";
import Nav from "@/components/Nav";
import { buildAccountDeactivatedMetadata } from "@/lib/auth/account-status";
import { createBillingCheckoutSession } from "@/lib/billing/checkout-client";
import { supabase } from "@/lib/supabase/client";
import { isPaymentVerified } from "@/lib/verification";
import { getPlanIdFromMeta } from "@/lib/billing/limits";

type MeProfile = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  avatarUrl: string | null;
  verified: boolean;
  roles: string[];
  canHost: boolean;
  hostingStatus: string;
  teacherProfileEnabled: boolean;
  visibility: "public" | "private";
  isPlusUser: boolean;
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

function SettingRow({
  icon,
  label,
  description,
  children,
}: {
  icon: string;
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-white/[0.06] last:border-0">
      <div className="flex items-start gap-3 min-w-0">
        <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-white/30">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/90">{label}</p>
          {description ? <p className="mt-0.5 text-xs text-white/40">{description}</p> : null}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ enabled, onChange, busy }: { enabled: boolean; onChange: (v: boolean) => void; busy?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => !busy && onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ${
        busy ? "opacity-50 cursor-not-allowed" : ""
      } ${enabled ? "border-[#0df2f2] bg-[#0df2f2]/20" : "border-white/20 bg-white/[0.05]"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full shadow transition-transform duration-200 mt-px ${
          enabled ? "translate-x-5 bg-[#0df2f2]" : "translate-x-0.5 bg-white/30"
        }`}
      />
    </button>
  );
}

function SectionHeader({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="material-symbols-outlined text-[16px] text-cyan-300">{icon}</span>
      <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">{label}</h2>
    </div>
  );
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
  const [busyVisibility, setBusyVisibility] = useState<string | null>(null);
  const [blockedPage, setBlockedPage] = useState(0);
  const [checkoutPlanId, setCheckoutPlanId] = useState<"pro" | null>(null);
  const BLOCKED_PAGE_SIZE = 10;

  async function callConnectionAction(payload: { connId?: string; action: "unblock" }) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? "";
    if (!accessToken) throw new Error("Missing auth session token.");
    const response = await fetch("/api/connections/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
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

      const [sessionRes, authRes] = await Promise.all([
        supabase.auth.getSession(),
        supabase.auth.getUser(),
      ]);
      const user = sessionRes.data.session?.user ?? authRes.data.user;
      if (!user) { router.replace("/auth"); return; }
      if (cancelled) return;

      const [profileRes, teacherRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id,display_name,city,country,avatar_url,verified,verified_label,roles,can_host,hosting_status")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("teacher_profiles")
          .select("teacher_profile_enabled")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      if (profileRes.error || !profileRes.data) {
        if (!cancelled) {
          setError(profileRes.error?.message ?? "Could not load your profile.");
          setLoading(false);
        }
        return;
      }

      const meRow = asRecord(profileRes.data);
      const isVerified = isPaymentVerified(meRow);
      const planId = getPlanIdFromMeta(user.user_metadata ?? {}, isVerified);
      const isPlusUser = planId === "pro";
      const teacherRow = teacherRes.data ? asRecord(teacherRes.data) : null;

      // visibility column may not exist yet — fetch separately and fail gracefully
      let profileVisibility: "public" | "private" = "public";
      const visRes = await supabase
        .from("profiles")
        .select("visibility")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!visRes.error && visRes.data) {
        const v = (visRes.data as Record<string, unknown>).visibility;
        if (v === "private") profileVisibility = "private";
      }

      setMe({
        userId: user.id,
        displayName: pickString(meRow, "display_name", "Member"),
        city: pickString(meRow, "city"),
        country: pickString(meRow, "country"),
        avatarUrl: pickNullableString(meRow, "avatar_url"),
        verified: isVerified,
        roles: Array.isArray(meRow.roles) ? meRow.roles.filter((r): r is string => typeof r === "string") : [],
        canHost: meRow.can_host === true,
        hostingStatus: pickString(meRow, "hosting_status", "inactive"),
        teacherProfileEnabled: teacherRow?.teacher_profile_enabled === true,
        visibility: profileVisibility,
        isPlusUser,
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
      if (blockedRes.error && !isMissingTableError(blockedRes.error.message))
        warnings.push(`Blocked members: ${blockedRes.error.message}`);

      const reportRows = reportsRes.error ? [] : ((reportsRes.data ?? []) as unknown[]);
      if (reportsRes.error && !isMissingTableError(reportsRes.error.message))
        warnings.push(`Reports: ${reportsRes.error.message}`);

      const blockedPartnerIds = blockedRows.map((raw) => {
        const row = asRecord(raw);
        const rid = pickString(row, "requester_id");
        const tid = pickString(row, "target_id");
        return rid === user.id ? tid : tid === user.id ? rid : "";
      }).filter(Boolean);

      const reportTargetIds = reportRows.map((raw) => pickString(asRecord(raw), "target_user_id")).filter(Boolean);
      const lookupIds = Array.from(new Set([...blockedPartnerIds, ...reportTargetIds]));
      const profilesById = new Map<string, { displayName: string; city: string; country: string; avatarUrl: string | null }>();

      if (lookupIds.length > 0) {
        const peopleRes = await supabase.from("profiles").select("user_id,display_name,city,country,avatar_url").in("user_id", lookupIds);
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
        const rid = pickString(row, "requester_id");
        const tid = pickString(row, "target_id");
        const partnerId = rid === user.id ? tid : tid === user.id ? rid : "";
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
    return () => { cancelled = true; };
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

  const handleToggleHosting = async (enabled: boolean) => {
    if (!me) return;
    setBusyVisibility("hosting");
    setError(null);
    try {
      const { error: err } = await supabase
        .from("profiles")
        .update({
          can_host: enabled,
          hosting_status: enabled ? (me.hostingStatus === "inactive" ? "available" : me.hostingStatus) : "inactive",
        })
        .eq("user_id", me.userId);
      if (err) throw err;
      setMe((prev) => prev ? { ...prev, canHost: enabled, hostingStatus: enabled ? (prev.hostingStatus === "inactive" ? "available" : prev.hostingStatus) : "inactive" } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update hosting visibility.");
    } finally {
      setBusyVisibility(null);
    }
  };

  const handleToggleTeacher = async (enabled: boolean) => {
    if (!me) return;
    setBusyVisibility("teacher");
    setError(null);
    try {
      const { error: err } = await supabase
        .from("teacher_profiles")
        .upsert({ user_id: me.userId, teacher_profile_enabled: enabled }, { onConflict: "user_id" });
      if (err) throw err;
      setMe((prev) => prev ? { ...prev, teacherProfileEnabled: enabled } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update teacher profile visibility.");
    } finally {
      setBusyVisibility(null);
    }
  };

  const handleToggleVisibility = async (privateMode: boolean) => {
    if (!me) return;
    setBusyVisibility("visibility");
    setError(null);
    try {
      const { error: err } = await supabase
        .from("profiles")
        .update({ visibility: privateMode ? "private" : "public" })
        .eq("user_id", me.userId);
      if (err) {
        if (isMissingTableError(err.message) || err.message.toLowerCase().includes("does not exist")) {
          setError("Private mode is not available yet — the visibility column has not been added to the database.");
          return;
        }
        throw err;
      }
      setMe((prev) => prev ? { ...prev, visibility: privateMode ? "private" : "public" } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update visibility.");
    } finally {
      setBusyVisibility(null);
    }
  };

  const handleDeactivateAccount = async () => {
    const confirmed = window.confirm("Deactivate this account now? Signing in again later will reactivate it automatically.");
    if (!confirmed) return;
    setDeactivating(true);
    setError(null);
    try {
      const deactivatedAt = new Date().toISOString();
      const updateRes = await supabase.auth.updateUser({ data: buildAccountDeactivatedMetadata(deactivatedAt) });
      if (updateRes.error) throw updateRes.error;
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      router.replace("/auth?deactivated=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not deactivate your account.");
      setDeactivating(false);
    }
  };

  const handleLogOut = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await supabase.auth.signOut(); } catch {}
    window.location.assign("/auth");
  };

  const loadCheckoutSession = async () => {
    if (!checkoutPlanId) {
      throw new Error("Choose a paid plan to continue.");
    }
    return createBillingCheckoutSession({ planId: checkoutPlanId, returnTo: "/account-settings" });
  };

  const locationLabel = [me?.city, me?.country].filter(Boolean).join(", ") || "Location not set";

  if (loading) {
    return (
      <div className="min-h-screen bg-[#06070b] text-slate-100">
        <Nav />
        <main className="mx-auto w-full max-w-[860px] px-4 pb-16 pt-6 sm:px-6">
          <div className="space-y-5 animate-pulse">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-white/[0.05]" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-28 rounded-full bg-white/[0.06]" />
                <div className="h-7 w-44 rounded-full bg-white/[0.08]" />
                <div className="h-3 w-32 rounded-full bg-white/[0.05]" />
              </div>
              <div className="hidden sm:flex flex-col gap-2">
                <div className="h-9 w-28 rounded-xl bg-white/[0.05]" />
                <div className="h-9 w-24 rounded-xl bg-white/[0.04]" />
              </div>
            </div>
            <div className="rounded-3xl border border-white/[0.04] bg-white/[0.02] p-5">
              <div className="mb-4 h-3 w-24 rounded-full bg-white/[0.06]" />
              <div className="space-y-4">
                <div className="h-14 rounded-2xl bg-white/[0.04]" />
                <div className="h-14 rounded-2xl bg-white/[0.04]" />
                <div className="h-14 rounded-2xl bg-white/[0.04]" />
                <div className="h-14 rounded-2xl bg-white/[0.04]" />
              </div>
            </div>
            <div className="rounded-3xl border border-white/[0.04] bg-white/[0.02] p-5">
              <div className="mb-4 h-3 w-16 rounded-full bg-white/[0.06]" />
              <div className="h-24 rounded-2xl bg-white/[0.04]" />
              <div className="mt-4 space-y-3">
                <div className="h-10 rounded-xl bg-white/[0.035]" />
                <div className="h-10 rounded-xl bg-white/[0.035]" />
                <div className="h-10 rounded-xl bg-white/[0.035]" />
              </div>
            </div>
            <div className="rounded-3xl border border-white/[0.04] bg-white/[0.02] p-5">
              <div className="mb-4 h-3 w-32 rounded-full bg-white/[0.06]" />
              <div className="space-y-4">
                <div className="h-14 rounded-2xl bg-white/[0.04]" />
                <div className="h-14 rounded-2xl bg-white/[0.04]" />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="mx-auto w-full max-w-[860px] px-4 pb-20 pt-6 sm:px-6">
        {error ? (
          <div className="mb-5 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {warning ? (
          <div className="mb-5 rounded-2xl border border-amber-300/35 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">{warning}</div>
        ) : null}

        <div className="space-y-8">

          {/* ── Hero header ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-4">
            <div
              className="h-16 w-16 shrink-0 rounded-full border-2 border-white/15 bg-white/[0.06] bg-cover bg-center"
              style={me?.avatarUrl ? { backgroundImage: `url(${me.avatarUrl})` } : undefined}
            >
              {!me?.avatarUrl ? (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="material-symbols-outlined text-[28px] text-white/30">person</span>
                </div>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Account Settings</p>
              <h1 className="truncate text-2xl font-black text-white">{me?.displayName ?? "Member"}</h1>
              <p className="text-xs text-white/40">{locationLabel}</p>
            </div>
            <div className="hidden sm:flex flex-col gap-2 shrink-0">
              <Link href={me ? `/profile/${me.userId}` : "/me/edit"} className="rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/70 hover:text-white transition-colors text-center">
                View profile
              </Link>
              <button type="button" onClick={() => void handleLogOut()} disabled={loggingOut} className="rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/50 hover:text-white/80 transition-colors disabled:opacity-50">
                {loggingOut ? "Logging out…" : "Log out"}
              </button>
            </div>
          </div>

          {/* ── Visibility ──────────────────────────────────────────────── */}
          <div>
            <SectionHeader icon="visibility" label="Visibility" />
            <div className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 divide-y divide-white/[0.05]">
              <SettingRow
                icon="school"
                label="Teacher profile"
                description="Show your teacher profile tab to other members"
              >
                <Toggle
                  enabled={me?.teacherProfileEnabled ?? false}
                  onChange={(v) => void handleToggleTeacher(v)}
                  busy={busyVisibility === "teacher"}
                />
              </SettingRow>
              <SettingRow
                icon="home"
                label="Hosting"
                description="List yourself as available to host dancers"
              >
                <Toggle
                  enabled={me?.canHost ?? false}
                  onChange={(v) => void handleToggleHosting(v)}
                  busy={busyVisibility === "hosting"}
                />
              </SettingRow>
              {me?.isPlusUser ? (
                <SettingRow
                  icon="visibility_off"
                  label="Private mode"
                  description="Only people you interact with can see you"
                >
                  <Toggle
                    enabled={me?.visibility === "private"}
                    onChange={(v) => void handleToggleVisibility(v)}
                    busy={busyVisibility === "visibility"}
                  />
                </SettingRow>
              ) : (
                <div className="flex items-center justify-between gap-4 py-4 border-b border-white/[0.06]">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-white/20">visibility_off</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white/40">Private mode</p>
                        <span className="rounded-full border border-[#0df2f2]/30 bg-[#0df2f2]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#0df2f2]">Plus</span>
                      </div>
                      <p className="mt-0.5 text-xs text-white/25">Only people you interact with can see you</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCheckoutPlanId("pro")}
                    className="shrink-0 rounded-lg border border-[#0df2f2]/30 bg-[#0df2f2]/[0.06] px-3 py-1.5 text-xs font-semibold text-[#0df2f2] hover:bg-[#0df2f2]/10 transition-colors"
                  >
                    Upgrade to Plus
                  </button>
                </div>
              )}
              <SettingRow
                icon="manage_accounts"
                label="Edit full profile"
                description="Update your profile details, photos, and settings"
              >
                <Link href="/me/edit" className="text-xs text-cyan-300 hover:text-cyan-100 transition-colors">
                  Edit →
                </Link>
              </SettingRow>
            </div>
          </div>

          {/* ── Safety ──────────────────────────────────────────────────── */}
          <div>
            <SectionHeader icon="shield" label="Safety" />
            <div className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 divide-y divide-white/[0.05]">
              {/* Stats */}
              <div className="flex gap-6 py-4">
                <div>
                  <p className="text-2xl font-black text-white">{blockedMembers.length}</p>
                  <p className="text-[10px] uppercase tracking-widest text-white/35">Blocked</p>
                </div>
                <div className="w-px bg-white/[0.06]" />
                <div>
                  <p className="text-2xl font-black text-white">{reports.length}</p>
                  <p className="text-[10px] uppercase tracking-widest text-white/35">Reports</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Link href="/safety-center" className="rounded-lg border border-cyan-300/25 bg-cyan-300/8 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/15 transition-colors">
                    Safety Center
                  </Link>
                  <Link href="/support" className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60 hover:text-white transition-colors">
                    Support
                  </Link>
                </div>
              </div>

              {/* Blocked members list */}
              {blockedMembers.length > 0 ? (
                <div className="py-4 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-3">Blocked members</p>
                  {blockedMembers.slice(blockedPage * BLOCKED_PAGE_SIZE, (blockedPage + 1) * BLOCKED_PAGE_SIZE).map((item) => (
                    <div key={item.connectionId} className="flex items-center gap-3">
                      <Avatar src={item.avatarUrl} alt={item.displayName} size={32} className="h-8 w-8 rounded-full border border-white/10 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-white/80">{item.displayName}</p>
                        <p className="text-xs text-white/35">{[item.city, item.country].filter(Boolean).join(", ") || "—"} · {formatRelative(item.blockedAt)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleUnblockMember(item.connectionId)}
                        disabled={busyBlockedConnectionId === item.connectionId}
                        className="shrink-0 rounded-lg border border-white/15 px-3 py-1 text-xs text-white/50 hover:text-white disabled:opacity-40 transition-colors"
                      >
                        {busyBlockedConnectionId === item.connectionId ? "…" : "Unblock"}
                      </button>
                    </div>
                  ))}
                  {blockedMembers.length > BLOCKED_PAGE_SIZE ? (
                    <div className="flex items-center justify-between pt-2">
                      <p className="text-[10px] text-white/30">{blockedPage * BLOCKED_PAGE_SIZE + 1}–{Math.min((blockedPage + 1) * BLOCKED_PAGE_SIZE, blockedMembers.length)} of {blockedMembers.length}</p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={blockedPage === 0}
                          onClick={() => setBlockedPage((p) => p - 1)}
                          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/50 hover:text-white disabled:opacity-30 transition-colors"
                        >← Prev</button>
                        <button
                          type="button"
                          disabled={(blockedPage + 1) * BLOCKED_PAGE_SIZE >= blockedMembers.length}
                          onClick={() => setBlockedPage((p) => p + 1)}
                          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/50 hover:text-white disabled:opacity-30 transition-colors"
                        >Next →</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="py-4 text-xs text-white/30">No blocked members.</div>
              )}

              {/* Reports list */}
              {reports.length > 0 ? (
                <div className="py-4 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-3">My reports</p>
                  {reports.slice(0, 10).map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white/80">Reported: {item.targetDisplayName}</p>
                        <p className="text-xs text-white/40">{item.reason} · {formatRelative(item.createdAt)}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold ${
                        item.status === "resolved" ? "bg-emerald-300/10 text-emerald-300" :
                        item.status === "reviewing" ? "bg-amber-300/10 text-amber-300" :
                        "bg-white/[0.05] text-white/40"
                      }`}>
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* ── Access & Recovery ───────────────────────────────────────── */}
          <div>
            <SectionHeader icon="lock" label="Access & Recovery" />
            <div className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 divide-y divide-white/[0.05]">
              <SettingRow icon="link" label="Recover account access" description="Magic-link and OTP login only — no passwords">
                <Link href="/auth/recovery" className="text-xs text-cyan-300 hover:text-cyan-100 transition-colors">Open →</Link>
              </SettingRow>
              <SettingRow icon="privacy_tip" label="Privacy rights & contact" description="Data requests and GDPR contact">
                <Link href="/account-settings/data-requests" className="text-xs text-cyan-300 hover:text-cyan-100 transition-colors">Open →</Link>
              </SettingRow>
            </div>
          </div>

          {/* ── Danger zone ─────────────────────────────────────────────── */}
          <div>
            <SectionHeader icon="warning" label="Danger Zone" />
            <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] px-5">
              <SettingRow
                icon="person_off"
                label="Deactivate account"
                description="Signing in again will reactivate your account automatically"
              >
                <button
                  type="button"
                  onClick={() => void handleDeactivateAccount()}
                  disabled={deactivating}
                  className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-400/20 disabled:opacity-50 transition-colors"
                >
                  {deactivating ? "Deactivating…" : "Deactivate"}
                </button>
              </SettingRow>
            </div>
          </div>

          {/* Mobile log out */}
          <div className="sm:hidden">
            <button
              type="button"
              onClick={() => void handleLogOut()}
              disabled={loggingOut}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3 text-sm font-semibold text-white/50 hover:text-white/80 transition-colors disabled:opacity-50"
            >
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>

        </div>
      </main>
      <StripeCheckoutDialog
        open={Boolean(checkoutPlanId)}
        title="Upgrade to Plus"
        badgeLabel="Monthly plan"
        submitLabel="Start Plus"
        onClose={() => setCheckoutPlanId(null)}
        loadSession={loadCheckoutSession}
        onAlreadyResolved={() => {
          setCheckoutPlanId(null);
          setWarning("Plus is already active on this account.");
        }}
      />
    </div>
  );
}
