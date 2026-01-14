// /app/profile/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import VerifiedBadge from "@/components/VerifiedBadge";
import Avatar from "@/components/Avatar";

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

type ConnectionRow = {
  id: string;
  status: "pending" | "accepted" | "blocked";
  requester_id: string;
  target_id: string;
};

type ConnectionState =
  | { status: "none" }
  | { status: "pending"; role: "requester" | "target"; id: string }
  | { status: "accepted"; id: string }
  | { status: "blocked"; id: string };

const STYLE_ORDER = ["bachata", "salsa", "kizomba", "tango", "zouk"] as const;

function titleCase(s: string) {
  if (!s) return s;
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function prettyUrl(u: string) {
  try {
    const url = new URL(u.startsWith("http") ? u : `https://${u}`);
    return (url.hostname + url.pathname).replace(/\/$/, "");
  } catch {
    return u;
  }
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

  async function refreshConnectionState(myUserId: string) {
    const { data, error } = await supabase
      .from("connections")
      .select("id,status,requester_id,target_id")
      .or(
        `and(requester_id.eq.${myUserId},target_id.eq.${profileId}),and(requester_id.eq.${profileId},target_id.eq.${myUserId})`
      );

    if (error) {
      setError(error.message);
      return;
    }

    const rows = (data ?? []) as ConnectionRow[];
    if (rows.length === 0) return setState({ status: "none" });

    const accepted = rows.find((r) => r.status === "accepted");
    if (accepted) return setState({ status: "accepted", id: accepted.id });

    const blocked = rows.find((r) => r.status === "blocked");
    if (blocked) return setState({ status: "blocked", id: blocked.id });

    const incoming = rows.find((r) => r.status === "pending" && r.target_id === myUserId);
    if (incoming) return setState({ status: "pending", role: "target", id: incoming.id });

    const outgoing = rows.find((r) => r.status === "pending" && r.requester_id === myUserId);
    if (outgoing) return setState({ status: "pending", role: "requester", id: outgoing.id });

    setState({ status: "none" });
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
      const { data: connRows, error: connErr } = await supabase
        .from("connections")
        .select("id,status,requester_id,target_id")
        .or(
          `and(requester_id.eq.${user.id},target_id.eq.${profileId}),and(requester_id.eq.${profileId},target_id.eq.${user.id})`
        );

      if (connErr) {
        setError(connErr.message);
        setLoading(false);
        return;
      }

      const rows = (connRows ?? []) as ConnectionRow[];
      if (rows.some((r) => r.status === "blocked")) {
        router.replace("/discover");
        return;
      }

      if (profileId === user.id) setState({ status: "accepted", id: "self" });
      else if (rows.length === 0) setState({ status: "none" });
      else {
        const accepted = rows.find((r) => r.status === "accepted");
        if (accepted) setState({ status: "accepted", id: accepted.id });
        else {
          const incoming = rows.find((r) => r.status === "pending" && r.target_id === user.id);
          if (incoming) setState({ status: "pending", role: "target", id: incoming.id });
          else {
            const outgoing = rows.find((r) => r.status === "pending" && r.requester_id === user.id);
            if (outgoing) setState({ status: "pending", role: "requester", id: outgoing.id });
            else setState({ status: "none" });
          }
        }
      }

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

      const row: any = prof ?? null;
      const normalized = row
        ? ({
            ...row,
            roles: Array.isArray(row.roles) ? row.roles : [],
            languages: Array.isArray(row.languages) ? row.languages : [],
            dance_skills: (row.dance_skills ?? {}) as DanceSkills,
            verified: !!row.verified,
          } as Profile)
        : null;

      setProfile(normalized);
      setLoading(false);
    })();
  }, [profileId, router]);

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
      const { error: accErr } = await supabase.from("connections").update({ status: "accepted" }).eq("id", existing.id);
      setBusy(false);
      if (accErr) return setError(accErr.message);
      await refreshConnectionState(meId);
      return;
    }

    const { error } = await supabase.from("connections").insert({
      requester_id: meId,
      target_id: profileId,
      status: "pending",
    });

    setBusy(false);
    if (error) return setError(error.message);
    await refreshConnectionState(meId);
  }

  async function accept() {
    if (!meId) return;
    if (state.status !== "pending" || state.role !== "target") return;

    setBusy(true);
    setError(null);

    const { error } = await supabase.from("connections").update({ status: "accepted" }).eq("id", state.id);

    setBusy(false);
    if (error) return setError(error.message);

    await refreshConnectionState(meId);
  }

  async function decline() {
    if (!meId) return;
    if (state.status !== "pending" || state.role !== "target") return;

    setBusy(true);
    setError(null);

    const { error } = await supabase.from("connections").delete().eq("id", state.id);

    setBusy(false);
    if (error) return setError(error.message);

    setState({ status: "none" });
  }

  async function block() {
    if (!meId) return;

    setBusy(true);
    setError(null);

    const { error: insErr } = await supabase.from("connections").insert({
      requester_id: meId,
      target_id: profileId,
      status: "blocked",
    });

    if (insErr) {
      const { error: updErr } = await supabase
        .from("connections")
        .update({ status: "blocked" })
        .or(
          `and(requester_id.eq.${meId},target_id.eq.${profileId}),and(requester_id.eq.${profileId},target_id.eq.${meId})`
        );

      setBusy(false);
      if (updErr) return setError(updErr.message);
      await refreshConnectionState(meId);
      return;
    }

    setBusy(false);
    await refreshConnectionState(meId);
    router.replace("/discover");
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
        </div>
      </div>
    </div>
  );
}