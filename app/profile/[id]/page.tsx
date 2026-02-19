// /app/profile/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import VerifiedBadge from "@/components/VerifiedBadge";
import Avatar from "@/components/Avatar";
import { deriveConnectionState, isBlockedConnection } from "@/lib/connections/visibility";
import { fetchVisibleConnections } from "@/lib/connections/read-model";

type DanceSkill = { level?: string; verified?: boolean };
type DanceSkills = Record<string, DanceSkill>;

type Profile = {
  user_id: string;
  display_name: string;
  city: string;
  country: string | null;

  roles: string[];
  languages: string[];
  dance_skills: DanceSkills;

  // contacts
  instagram_handle: string | null;
  whatsapp_handle: string | null;
  youtube_url: string | null;

  avatar_url: string | null;

  verified: boolean | null;
  verified_label: string | null;
};

type ProfileRow = {
  user_id?: string;
  display_name?: string | null;
  city?: string;
  country?: string | null;
  roles?: unknown;
  languages?: unknown;
  dance_skills?: unknown;
  instagram_handle?: string | null;
  whatsapp_handle?: string | null;
  youtube_url?: string | null;
  avatar_url?: string | null;
  verified?: boolean | null;
  verified_label?: string | null;
};

type ConnectionRow = {
  id: string;
  status: "pending" | "accepted" | "blocked";
  requester_id: string;
  target_id: string;
  blocked_by?: string | null;
};

type ConnectionState =
  | { status: "none" }
  | { status: "pending"; role: "requester" | "target"; id: string }
  | { status: "accepted"; id: string }
  | { status: "blocked"; id: string };

type ReferenceFilter = "all" | "sync" | "trip" | "event";

type ReferenceRow = {
  id: string;
  author_id: string;
  recipient_id: string;
  sentiment: "positive" | "neutral" | "negative";
  body: string;
  context: string | null;
  entity_type: string | null;
  created_at: string;
  reply_text: string | null;
};

type ReferenceRowDb = {
  id?: string;
  author_id?: string;
  recipient_id?: string;
  sentiment?: string;
  body?: string | null;
  context?: string | null;
  entity_type?: string | null;
  created_at?: string;
  reply_text?: string | null;
};

const STYLE_ORDER = ["bachata", "salsa", "kizomba", "tango", "zouk"] as const;

function titleCase(s: string) {
  if (!s) return s;
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const isString = (value: unknown): value is string => typeof value === "string";

function prettyUrl(u: string) {
  try {
    const url = new URL(u.startsWith("http") ? u : `https://${u}`);
    return (url.hostname + url.pathname).replace(/\/$/, "");
  } catch {
    return u;
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function sentimentBadgeClasses(sentiment: ReferenceRow["sentiment"]) {
  if (sentiment === "positive") return "border-green-200 bg-green-50 text-green-700";
  if (sentiment === "negative") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

// --- inline icons (no deps) ---
function InstagramIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9A3.5 3.5 0 0 0 20 16.5v-9A3.5 3.5 0 0 0 16.5 4h-9ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5.6-2.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z" />
    </svg>
  );
}

function WhatsAppIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 2a9.6 9.6 0 0 0-8.3 14.4L2.8 22l5.8-1.8A9.6 9.6 0 1 0 12 2Zm0 2a7.6 7.6 0 0 1 0 15.2c-1.3 0-2.6-.3-3.7-1l-.3-.2-3.4 1 1.1-3.2-.2-.3A7.6 7.6 0 0 1 12 4Zm4.4 10.6c-.2-.1-1.2-.6-1.4-.7-.2-.1-.4-.1-.6.1-.2.2-.7.7-.9.9-.2.2-.3.2-.6.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.4.1-.5l.4-.5c.1-.2.1-.3.2-.5 0-.2 0-.3-.1-.5-.1-.1-.6-1.5-.8-2-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.2-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.7 2.7 4.1 3.8.6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.2-.5 1.4-1 .2-.5.2-.9.1-1-.1-.1-.2-.1-.4-.2Z" />
    </svg>
  );
}

function YouTubeIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8ZM10.2 15.3V8.7L15.9 12l-5.7 3.3Z" />
    </svg>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const profileId = params.id;

  const [meId, setMeId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<ConnectionState>({ status: "none" });

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [references, setReferences] = useState<ReferenceRow[]>([]);
  const [referenceFilter, setReferenceFilter] = useState<ReferenceFilter>("all");
  const [referenceAuthors, setReferenceAuthors] = useState<Record<string, string>>({});

  const canReveal = state.status === "accepted";

  const skillsList = useMemo(() => {
    const skills = profile?.dance_skills ?? {};
    const keys = Object.keys(skills);
    if (keys.length === 0) return [];

    const ordered: string[] = [];
    for (const s of STYLE_ORDER) if (skills[s]) ordered.push(s);
    for (const s of keys) if (!ordered.includes(s)) ordered.push(s);

    return ordered.map((style) => ({
      style,
      level: skills[style]?.level ?? "",
      verified: !!skills[style]?.verified,
    }));
  }, [profile?.dance_skills]);

  const igText = useMemo(() => {
    const h = (profile?.instagram_handle ?? "").trim().replaceAll(" ", "");
    if (!h) return "Not set";
    return h.startsWith("@") ? h : `@${h}`;
  }, [profile?.instagram_handle]);

  const waText = useMemo(() => {
    const h = (profile?.whatsapp_handle ?? "").trim();
    return h ? h : "Not set";
  }, [profile?.whatsapp_handle]);

  const ytText = useMemo(() => {
    const u = (profile?.youtube_url ?? "").trim();
    return u ? prettyUrl(u) : "Not set";
  }, [profile?.youtube_url]);

  const igLink = useMemo(() => {
    const handle = (profile?.instagram_handle ?? "").trim().replaceAll(" ", "");
    if (!handle) return null;
    const h = handle.startsWith("@") ? handle.slice(1) : handle;
    return `https://instagram.com/${h}`;
  }, [profile?.instagram_handle]);

  const ytLink = useMemo(() => {
    const u = (profile?.youtube_url ?? "").trim();
    if (!u) return null;
    return u.startsWith("http") ? u : `https://${u}`;
  }, [profile?.youtube_url]);

  const waLink = useMemo(() => {
    const v = (profile?.whatsapp_handle ?? "").trim();
    if (!v) return null;
    const digits = v.replace(/[^\d]/g, "");
    if (digits.length >= 8) return `https://wa.me/${digits}`;
    return null;
  }, [profile?.whatsapp_handle]);

  const filteredReferences = useMemo(() => {
    if (referenceFilter === "all") return references;
    return references.filter((row) => {
      const context = (row.entity_type ?? row.context ?? "connection").toLowerCase();
      if (referenceFilter === "sync") return context === "sync";
      if (referenceFilter === "trip") return context === "trip";
      if (referenceFilter === "event") return context === "event";
      return true;
    });
  }, [referenceFilter, references]);

  const referenceCounts = useMemo(() => {
    return references.reduce(
      (acc, row) => {
        if (row.sentiment === "positive") acc.positive += 1;
        if (row.sentiment === "neutral") acc.neutral += 1;
        if (row.sentiment === "negative") acc.negative += 1;
        return acc;
      },
      { positive: 0, neutral: 0, negative: 0 }
    );
  }, [references]);

  async function refreshConnectionState(myUserId: string) {
    let rows: ConnectionRow[] = [];
    try {
      const visibleRows = await fetchVisibleConnections(supabase, myUserId);
      rows = visibleRows
        .map((row) => ({
          id: row.id,
          status: row.status as "pending" | "accepted" | "blocked",
          requester_id: row.requester_id,
          target_id: row.target_id,
          blocked_by: row.blocked_by,
        }))
        .filter((row) => {
          const pairA = row.requester_id === myUserId && row.target_id === profileId;
          const pairB = row.requester_id === profileId && row.target_id === myUserId;
          return pairA || pairB;
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connection state.");
      return;
    }

    setState(deriveConnectionState(rows, myUserId, profileId));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      setMeId(user.id);

      // connections check first
      let rows: ConnectionRow[] = [];
      try {
        const visibleRows = await fetchVisibleConnections(supabase, user.id);
        rows = visibleRows
          .map((row) => ({
            id: row.id,
            status: row.status as "pending" | "accepted" | "blocked",
            requester_id: row.requester_id,
            target_id: row.target_id,
            blocked_by: row.blocked_by,
          }))
          .filter((row) => {
            const pairA = row.requester_id === user.id && row.target_id === profileId;
            const pairB = row.requester_id === profileId && row.target_id === user.id;
            return pairA || pairB;
          });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load connections.");
        setLoading(false);
        return;
      }
      if (rows.some((r) => isBlockedConnection(r))) {
        router.replace("/connections");
        return;
      }

      if (profileId === user.id) setState({ status: "accepted", id: "self" });
      else setState(deriveConnectionState(rows, user.id, profileId));

      // fetch profile
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select(
          [
            "user_id",
            "display_name",
            "city",
            "country",
            "roles",
            "languages",
            "dance_skills",
            "instagram_handle",
            "whatsapp_handle",
            "youtube_url",
            "avatar_url",
            "verified",
            "verified_label",
          ].join(",")
        )
        .eq("user_id", profileId)
        .maybeSingle();

      if (profErr) {
        setError(profErr.message);
        setLoading(false);
        return;
      }

      const row = (prof ?? null) as ProfileRow | null;
      const normalized = row
        ? ({
            user_id: row.user_id ?? "",
            display_name: row.display_name ?? "—",
            city: row.city ?? "—",
            country: row.country ?? null,
            roles: Array.isArray(row.roles) ? row.roles.filter(isString) : [],
            languages: Array.isArray(row.languages) ? row.languages.filter(isString) : [],
            dance_skills:
              row.dance_skills && typeof row.dance_skills === "object"
                ? (row.dance_skills as DanceSkills)
                : {},
            instagram_handle: row.instagram_handle ?? null,
            whatsapp_handle: row.whatsapp_handle ?? null,
            youtube_url: row.youtube_url ?? null,
            avatar_url: row.avatar_url ?? null,
            verified: Boolean(row.verified),
            verified_label: row.verified_label ?? null,
          } as Profile)
        : null;

      setProfile(normalized);
      setLoading(false);
    })();
  }, [profileId, router]);

  useEffect(() => {
    let cancelled = false;

    async function loadReferences() {
      if (!meId) return;
      setReferencesLoading(true);

      const referencesRes = await supabase
        .from("references")
        .select("id,author_id,recipient_id,sentiment,body,context,entity_type,created_at,reply_text")
        .eq("recipient_id", profileId)
        .order("created_at", { ascending: false })
        .limit(150);

      if (referencesRes.error) {
        if (!cancelled) {
          setReferences([]);
          setReferenceAuthors({});
          setReferencesLoading(false);
        }
        return;
      }

      const rows: ReferenceRow[] = [];
      ((referencesRes.data ?? []) as ReferenceRowDb[]).forEach((row) => {
        const id = row.id ?? "";
        const authorId = row.author_id ?? "";
        const recipientId = row.recipient_id ?? "";
        const createdAt = row.created_at ?? "";
        const sentiment = row.sentiment;
        if (!id || !authorId || !recipientId || !createdAt) return;
        if (sentiment !== "positive" && sentiment !== "neutral" && sentiment !== "negative") return;

        rows.push({
          id,
          author_id: authorId,
          recipient_id: recipientId,
          sentiment,
          body: row.body ?? "",
          context: row.context ?? null,
          entity_type: row.entity_type ?? null,
          created_at: createdAt,
          reply_text: row.reply_text ?? null,
        });
      });

      const authorIds = Array.from(new Set(rows.map((row) => row.author_id))).filter(Boolean);
      const authorsMap: Record<string, string> = {};
      if (authorIds.length > 0) {
        const authorsRes = await supabase.from("profiles").select("user_id,display_name").in("user_id", authorIds);
        if (!authorsRes.error) {
          ((authorsRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
            const userId = typeof row.user_id === "string" ? row.user_id : "";
            if (!userId) return;
            authorsMap[userId] = typeof row.display_name === "string" && row.display_name.trim().length > 0 ? row.display_name : "Member";
          });
        }
      }

      if (!cancelled) {
        setReferences(rows);
        setReferenceAuthors(authorsMap);
        setReferencesLoading(false);
      }
    }

    void loadReferences();

    return () => {
      cancelled = true;
    };
  }, [meId, profileId]);

  async function connect() {
    if (!meId) return;
    setBusy(true);
    setError(null);

    const { data: existing, error: exErr } = await supabase
      .from("connections")
      .select("id,status")
      .eq("requester_id", profileId)
      .eq("target_id", meId)
      .maybeSingle();

    if (exErr) {
      setBusy(false);
      setError(exErr.message);
      return;
    }

    if (existing && existing.status === "pending") {
      try {
        await callConnectionAction({ connId: existing.id, action: "accept" });
      } catch (err) {
        setBusy(false);
        return setError(err instanceof Error ? err.message : "Failed to accept request.");
      }
      setBusy(false);
      await refreshConnectionState(meId);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? "";
    if (!accessToken) {
      setBusy(false);
      setError("Missing auth session. Please sign in again.");
      return;
    }

    try {
      const response = await fetch("/api/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          requesterId: meId,
          targetId: profileId,
          payload: {
            connect_context: "member",
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      setBusy(false);
      if (!response.ok || !result?.ok) return setError(result?.error ?? "Failed to send request");
      await refreshConnectionState(meId);
    } catch (err) {
      setBusy(false);
      return setError(err instanceof Error ? err.message : "Failed to send request");
    }
  }

  async function callConnectionAction(payload: {
    connId?: string;
    action: "accept" | "decline" | "undo_decline" | "cancel" | "block" | "report";
    targetUserId?: string;
    reason?: string;
    note?: string;
    context?: "connection" | "trip" | "message" | "profile" | "reference";
    contextId?: string | null;
  }) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? "";
    if (!accessToken) throw new Error("Missing auth session token");

    const response = await fetch("/api/connections/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error ?? `Failed to ${payload.action}`);
    }
  }

  async function accept() {
    if (!meId) return;
    if (state.status !== "pending" || state.role !== "target") return;

    setBusy(true);
    setError(null);

    try {
      await callConnectionAction({ connId: state.id, action: "accept" });
    } catch (err) {
      setBusy(false);
      return setError(err instanceof Error ? err.message : "Failed to accept request.");
    }
    setBusy(false);

    await refreshConnectionState(meId);
  }

  async function decline() {
    if (!meId) return;
    if (state.status !== "pending" || state.role !== "target") return;

    setBusy(true);
    setError(null);

    try {
      await callConnectionAction({ connId: state.id, action: "decline" });
    } catch (err) {
      setBusy(false);
      return setError(err instanceof Error ? err.message : "Failed to decline request.");
    }
    setBusy(false);

    setState({ status: "none" });
  }

  async function block() {
    if (!meId) return;

    setBusy(true);
    setError(null);

    try {
      if ("id" in state && state.id) {
        await callConnectionAction({ connId: state.id, action: "block" });
      } else {
        await callConnectionAction({ action: "block", targetUserId: profileId });
      }
    } catch (err) {
      setBusy(false);
      return setError(err instanceof Error ? err.message : "Failed to block user.");
    }
    setBusy(false);
    await refreshConnectionState(meId);
    router.replace("/connections");
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  if (!profile) return <div className="min-h-screen flex items-center justify-center">Profile not found.</div>;

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-2xl">
        <Nav />

        <div className="rounded-2xl bg-white border border-zinc-200 p-8">
          <button onClick={() => router.back()} className="text-sm text-red-700 underline">
            Back
          </button>

          <div className="mt-4 flex items-center gap-4">
            {/* FIX: Avatar component - no userId prop */}
            <Avatar src={profile.avatar_url} alt="Avatar" size={80} className="rounded-2xl" />

            <div className="flex-1 min-w-0">
              <h1 className="flex items-center gap-2">
                <span className="text-2xl font-semibold truncate">{profile.display_name}</span>
                {!!profile.verified && <VerifiedBadge size={18} className="ml-1" />}
              </h1>

              <p className="text-zinc-600">
                {profile.city}
                {profile.country ? `, ${profile.country}` : ""}
              </p>
            </div>
          </div>

          {error && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>
          )}

          {/* Dance skills */}
          <div className="mt-5">
            <div className="text-sm font-medium text-zinc-700">Dance skills</div>

            {skillsList.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {skillsList.map((x) => (
                  <span
                    key={x.style}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm"
                  >
                    <span className="font-medium">{titleCase(x.style)}</span>
                    <span className="text-zinc-500">•</span>
                    <span className="text-zinc-700">{x.level || "—"}</span>
                    {x.verified ? <VerifiedBadge size={16} className="ml-1" /> : null}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-zinc-600">No dance skills listed.</div>
            )}
          </div>

          {/* Roles / Languages */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="font-medium flex items-center gap-2 text-sm">🎭 Roles</div>
              <div className="mt-2 text-sm text-zinc-700">
                {(profile.roles ?? []).length ? profile.roles.join(", ") : "—"}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="font-medium flex items-center gap-2 text-sm">🗣️ Languages</div>
              <div className="mt-2 text-sm text-zinc-700">
                {(profile.languages ?? []).length ? profile.languages.join(", ") : "—"}
              </div>
            </div>
          </div>

          {/* Actions */}
          {profile.user_id !== meId && (
            <div className="mt-6 flex flex-wrap gap-2">
              {state.status === "none" && (
                <button
                  onClick={connect}
                  disabled={busy}
                  className="rounded-xl bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800 disabled:opacity-60"
                >
                  {busy ? "Sending…" : "Connect"}
                </button>
              )}

              {state.status === "pending" && state.role === "requester" && (
                <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-2 text-sm text-zinc-700">
                  Request pending…
                </div>
              )}

              {state.status === "pending" && state.role === "target" && (
                <>
                  <button
                    onClick={decline}
                    disabled={busy}
                    className="rounded-xl border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
                  >
                    Decline
                  </button>
                  <button
                    onClick={accept}
                    disabled={busy}
                    className="rounded-xl bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800 disabled:opacity-60"
                  >
                    Accept
                  </button>
                </>
              )}

              {state.status === "accepted" && (
                <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">
                  Connected ✅
                </div>
              )}

              {state.status !== "blocked" && (
                <button
                  onClick={block}
                  disabled={busy}
                  className="rounded-xl border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
                >
                  Block
                </button>
              )}
            </div>
          )}

          {/* Contacts: locked unless accepted */}
          <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
            <div className="font-medium flex items-center gap-2 text-sm">📇 Contacts</div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-white border border-zinc-200 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <InstagramIcon className="h-5 w-5 text-red-700" />
                  <span className="sr-only">Instagram</span>
                </div>

                {!canReveal ? (
                  <div className="mt-3 text-sm text-zinc-500">Locked</div>
                ) : igLink ? (
                  <a className="mt-3 block text-sm font-medium text-zinc-900 hover:underline" href={igLink} target="_blank" rel="noreferrer">
                    {igText}
                  </a>
                ) : (
                  <div className="mt-3 text-sm font-medium text-zinc-900">{igText}</div>
                )}
              </div>

              <div className="rounded-xl bg-white border border-zinc-200 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <WhatsAppIcon className="h-5 w-5 text-red-700" />
                  <span className="sr-only">WhatsApp</span>
                </div>

                {!canReveal ? (
                  <div className="mt-3 text-sm text-zinc-500">Locked</div>
                ) : waLink ? (
                  <a className="mt-3 block text-sm font-medium text-zinc-900 hover:underline" href={waLink} target="_blank" rel="noreferrer">
                    {waText}
                  </a>
                ) : (
                  <div className="mt-3 text-sm font-medium text-zinc-900">{waText}</div>
                )}
              </div>

              <div className="rounded-xl bg-white border border-zinc-200 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <YouTubeIcon className="h-5 w-5 text-red-700" />
                  <span className="sr-only">YouTube</span>
                </div>

                {!canReveal ? (
                  <div className="mt-3 text-sm text-zinc-500">Locked</div>
                ) : ytLink ? (
                  <a className="mt-3 block text-sm font-medium text-zinc-900 hover:underline truncate" href={ytLink} target="_blank" rel="noreferrer">
                    {ytText}
                  </a>
                ) : (
                  <div className="mt-3 text-sm font-medium text-zinc-900 truncate">{ytText}</div>
                )}
              </div>
            </div>

            {!canReveal && (
              <div className="mt-3 text-xs text-zinc-500">
                Contacts unlock after mutual connection.
              </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-zinc-900">References</div>
                <div className="mt-1 text-xs text-zinc-500">
                  Positive {referenceCounts.positive} • Neutral {referenceCounts.neutral} • Negative {referenceCounts.negative}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {([
                  { key: "all", label: "All" },
                  { key: "sync", label: "Sync" },
                  { key: "trip", label: "Trip" },
                  { key: "event", label: "Event" },
                ] as const).map((filterItem) => {
                  const selected = referenceFilter === filterItem.key;
                  return (
                    <button
                      key={filterItem.key}
                      type="button"
                      onClick={() => setReferenceFilter(filterItem.key)}
                      className={cx(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        selected
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900"
                      )}
                    >
                      {filterItem.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {referencesLoading ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Loading references...</div>
              ) : filteredReferences.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">No references for this filter.</div>
              ) : (
                filteredReferences.map((reference) => {
                  const author = referenceAuthors[reference.author_id] ?? "Member";
                  const contextLabel = (reference.entity_type ?? reference.context ?? "connection").toUpperCase();

                  return (
                    <article key={reference.id} className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-zinc-900">{author}</div>
                        <div className="flex items-center gap-2">
                          <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", sentimentBadgeClasses(reference.sentiment))}>
                            {reference.sentiment}
                          </span>
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                            {contextLabel}
                          </span>
                          <span className="text-xs text-zinc-500">{formatDate(reference.created_at)}</span>
                        </div>
                      </div>

                      <p className="mt-2 text-sm leading-relaxed text-zinc-800">{reference.body}</p>

                      {reference.reply_text ? (
                        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
                          <span className="font-semibold text-zinc-900">Reply:</span> {reference.reply_text}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
