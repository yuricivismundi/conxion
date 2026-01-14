"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import VerifiedBadge from "@/components/VerifiedBadge";
import Image from "next/image";

type DanceSkill = { level?: string; verified?: boolean };
type DanceSkills = Record<string, DanceSkill>;

type TripPurpose = "Holiday Trip" | "Dance Festival";

type TripStatus = "active" | "inactive";

type Trip = {
  id: string;
  user_id: string;
  destination_country: string;
  destination_city: string;
  start_date: string; // ISO date
  end_date: string; // ISO date
  purpose: TripPurpose;
  status?: TripStatus | null;
  created_at?: string | null;
};

type Profile = {
  user_id: string;
  display_name: string;
  city: string;
  country: string | null;
  nationality: string | null;

  roles: string[];
  languages: string[];
  interests: string[];
  availability: string[];

  dance_skills: DanceSkills;

  instagram_handle: string | null;
  whatsapp_handle: string | null;
  youtube_url: string | null;

  avatar_url: string | null;

  verified: boolean;
  verified_label: string | null;
};

const STYLE_ORDER = ["bachata", "salsa", "kizomba", "tango", "zouk"] as const;

function titleCase(s: string) {
  if (!s) return s;
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// --- simple inline icons (no deps) ---
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

function prettyUrl(u: string) {
  try {
    const url = new URL(u.startsWith("http") ? u : `https://${u}`);
    return (url.hostname + url.pathname).replace(/\/$/, "");
  } catch {
    return u;
  }
}

function toIsoDate(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "";
  return x.toISOString().slice(0, 10);
}

function formatDateShort(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

export default function MePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsTab, setTripsTab] = useState<"active" | "inactive">("active");

  const locationText = useMemo(() => {
    if (!me) return "—";
    const parts = [me.city, me.country].filter(Boolean);
    return parts.length ? parts.join(", ") : "—";
  }, [me]);

  const skillsList = useMemo(() => {
    const skills = me?.dance_skills ?? {};
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
  }, [me?.dance_skills]);

  const profileIssues = useMemo(() => {
    if (!me) return [] as string[];
    const issues: string[] = [];

    if (!me.avatar_url || me.avatar_url.trim().length < 10) issues.push("Add a profile photo");
    if (!me.country || me.country.trim().length < 2) issues.push("Set your country");
    if (!me.city || me.city.trim().length < 1) issues.push("Set your city");
    if (!me.roles?.length) issues.push("Select at least 1 role");
    if (!me.languages?.length) issues.push("Select at least 1 language");
    if (!me.interests?.length) issues.push("Select at least 1 interest");

    const danceSkills = me.dance_skills ?? {};
    const keys = Object.keys(danceSkills);
    if (!keys.length) issues.push("Add at least 1 dance style");

    return issues;
  }, [me]);

  const activeTrips = useMemo(() => {
    return (trips ?? []).filter((t) => (t.status ?? "active") !== "inactive").slice(0, 4);
  }, [trips]);

  const inactiveTrips = useMemo(() => {
    return (trips ?? []).filter((t) => (t.status ?? "active") === "inactive").slice(0, 4);
  }, [trips]);

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

      const { data, error } = await supabase
        .from("profiles")
        .select(
          [
            "user_id",
            "display_name",
            "city",
            "country",
            "nationality",
            "roles",
            "languages",
            "interests",
            "availability",
            "dance_skills",
            "instagram_handle",
            "whatsapp_handle",
            "youtube_url",
            "avatar_url",
            "verified",
            "verified_label",
          ].join(",")
        )
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      if (!data) {
        router.replace("/onboarding");
        return;
      }

      const row: any = data;
      const normalized: Profile = {
        ...row,
        roles: Array.isArray(row.roles) ? row.roles : [],
        languages: Array.isArray(row.languages) ? row.languages : [],
        interests: Array.isArray(row.interests) ? row.interests : [],
        availability: Array.isArray(row.availability) ? row.availability : [],
        dance_skills: (row.dance_skills ?? {}) as DanceSkills,
        verified: !!row.verified,
      };

      setMe(normalized);

      // Trips (max 4 total enforced in DB; here we just display)
      const { data: tripsData, error: tripsErr } = await supabase
        .from("trips")
        .select(["id", "user_id", "destination_country", "destination_city", "start_date", "end_date", "purpose", "status", "created_at"].join(","))
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (tripsErr) {
        // Non-fatal: profile page still works
        console.warn("Failed to load trips:", tripsErr.message);
        setTrips([]);
      } else {
        const list = (tripsData ?? []).map((t: any) => ({
          id: t.id,
          user_id: t.user_id,
          destination_country: t.destination_country ?? "",
          destination_city: t.destination_city ?? "",
          start_date: toIsoDate(t.start_date),
          end_date: toIsoDate(t.end_date),
          purpose: (t.purpose ?? "Holiday Trip") as TripPurpose,
          status: (t.status ?? "active") as any,
          created_at: t.created_at ?? null,
        })) as Trip[];
        setTrips(list);
      }

      setLoading(false);
    })();
  }, [router]);

  const igText = useMemo(() => {
    const h = (me?.instagram_handle ?? "").trim().replaceAll(" ", "");
    if (!h) return "Not set";
    return h.startsWith("@") ? h : `@${h}`;
  }, [me?.instagram_handle]);

  const waText = useMemo(() => {
    const h = (me?.whatsapp_handle ?? "").trim();
    return h ? h : "Not set";
  }, [me?.whatsapp_handle]);

  const ytText = useMemo(() => {
    const u = (me?.youtube_url ?? "").trim();
    return u ? prettyUrl(u) : "Not set";
  }, [me?.youtube_url]);

  const igLink = useMemo(() => {
    const h = (me?.instagram_handle ?? "").trim().replaceAll(" ", "");
    if (!h) return null;
    const handle = h.startsWith("@") ? h.slice(1) : h;
    return `https://instagram.com/${handle}`;
  }, [me?.instagram_handle]);

  const ytLink = useMemo(() => {
    const u = (me?.youtube_url ?? "").trim();
    if (!u) return null;
    return u.startsWith("http") ? u : `https://${u}`;
  }, [me?.youtube_url]);

  const waLink = useMemo(() => {
    const v = (me?.whatsapp_handle ?? "").trim();
    if (!v) return null;
    // Keep it simple: if it looks like digits, allow wa.me, otherwise leave as text-only
    const digits = v.replace(/[^\d]/g, "");
    if (digits.length >= 8) return `https://wa.me/${digits}`;
    return null;
  }, [me?.whatsapp_handle]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-5xl">
        <Nav />

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>
        )}

        <div className="mt-6 rounded-3xl bg-white border border-zinc-200 p-6 sm:p-8">
          {/* Top row */}
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-6">
              <div className="relative h-28 w-28 sm:h-32 sm:w-32 overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-100 flex items-center justify-center shrink-0">
                {me?.avatar_url ? (
                  <Image src={me.avatar_url} alt="Avatar" fill className="object-cover" sizes="128px" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-zinc-400 text-sm">No photo</div>
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-2xl sm:text-3xl font-semibold truncate">{me?.display_name ?? "—"}</div>
                  {!!me?.verified && <VerifiedBadge size={18} className="ml-1" />}
                </div>

                <div className="mt-1 text-zinc-700">{locationText}</div>

                <div className="mt-2 text-sm text-zinc-700 flex flex-wrap gap-3">
                  <span className="inline-flex items-center gap-2">
                    🌍 <span className="text-zinc-600">Nationality:</span>{" "}
                    <span className="font-medium">{me?.nationality ?? "—"}</span>
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => router.push("/me/edit")}
              className="rounded-full bg-red-700 text-white px-7 py-3 text-base font-medium hover:bg-red-800 shrink-0"
            >
              Edit
            </button>
          </div>

          {/* Dance skills */}
          <div className="mt-8">
            <div className="text-sm font-medium text-zinc-700">Dance skills</div>

            {skillsList.length ? (
              <div className="mt-3 flex flex-wrap gap-3">
                {skillsList.map((x) => (
                  <span
                    key={x.style}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm"
                  >
                    <span className="font-medium">{titleCase(x.style)}</span>
                    <span className="text-zinc-400">•</span>
                    <span className="text-zinc-700">{x.level || "—"}</span>
                    {x.verified ? <VerifiedBadge size={14} className="ml-1" /> : null}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-sm text-zinc-600">No dance skills yet.</div>
            )}
          </div>

          {/* Trips */}
          <div className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-zinc-700">Trips</div>
                <div className="mt-1 text-xs text-zinc-500">Max 4 trips total (active + inactive). You can reuse and edit them.</div>
              </div>

              <button
                type="button"
                onClick={() => router.push("/me/trips")}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Manage trips
              </button>
            </div>

            <div className="mt-3 inline-flex items-center rounded-xl border border-zinc-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setTripsTab("active")}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  tripsTab === "active" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-50"
                )}
              >
                Active ({activeTrips.length})
              </button>
              <button
                type="button"
                onClick={() => setTripsTab("inactive")}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  tripsTab === "inactive" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-50"
                )}
              >
                Inactive ({inactiveTrips.length})
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(tripsTab === "active" ? activeTrips : inactiveTrips).map((t) => (
                <div key={t.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900 truncate">
                        {t.destination_city}, {t.destination_country}
                      </div>
                      <div className="mt-1 text-xs text-zinc-600">
                        {formatDateShort(t.start_date)} → {formatDateShort(t.end_date)}
                        <span className="mx-2 text-zinc-300">•</span>
                        {t.purpose}
                      </div>
                    </div>

                    <span
                      className={cx(
                        "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                        (t.status ?? "active") === "inactive"
                          ? "border-zinc-200 bg-white text-zinc-700"
                          : "border-red-200 bg-red-50 text-red-800"
                      )}
                    >
                      {(t.status ?? "active") === "inactive" ? "Inactive" : "Active"}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => router.push(`/me/trips?edit=${t.id}`)}
                      className="text-sm font-semibold text-red-700 hover:text-red-800"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => router.push(`/me/trips?duplicate=${t.id}`)}
                      className="text-sm font-semibold text-zinc-700 hover:text-zinc-900"
                    >
                      Reuse
                    </button>
                  </div>
                </div>
              ))}

              {(tripsTab === "active" ? activeTrips : inactiveTrips).length === 0 && (
                <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600 sm:col-span-2">
                  No {tripsTab} trips yet.
                  <button
                    type="button"
                    onClick={() => router.push("/me/trips")}
                    className="ml-2 font-semibold text-red-700 hover:text-red-800"
                  >
                    Create one
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Cards grid */}
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
              <div className="font-medium flex items-center gap-2">🎭 Roles</div>
              <div className="mt-2 text-zinc-700 text-sm">{me?.roles?.length ? me.roles.join(", ") : "—"}</div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
              <div className="font-medium flex items-center gap-2">🗣️ Languages</div>
              <div className="mt-2 text-zinc-700 text-sm">{me?.languages?.length ? me.languages.join(", ") : "—"}</div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
              <div className="font-medium flex items-center gap-2">✨ Interests</div>
              <div className="mt-2 text-zinc-700 text-sm">{me?.interests?.length ? me.interests.join(", ") : "—"}</div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
              <div className="font-medium flex items-center gap-2">🕒 Availability</div>
              <div className="mt-2 text-zinc-700 text-sm">
                {me?.availability?.length ? me.availability.join(", ") : "—"}
              </div>
            </div>

            {/* Contacts */}
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 sm:col-span-2">
              <div className="font-medium flex items-center gap-2">📇 Contacts</div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white border border-zinc-200 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <InstagramIcon className="h-5 w-5 text-red-700" />
                    <span className="sr-only">Instagram</span>
                  </div>
                  <div className="mt-2 text-xs text-zinc-500">Locked for others</div>
                  {igLink ? (
                    <a className="mt-1 block text-sm font-medium text-zinc-900 hover:underline" href={igLink} target="_blank" rel="noreferrer">
                      {igText}
                    </a>
                  ) : (
                    <div className="mt-1 text-sm font-medium text-zinc-900">{igText}</div>
                  )}
                </div>

                <div className="rounded-xl bg-white border border-zinc-200 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <WhatsAppIcon className="h-5 w-5 text-red-700" />
                    <span className="sr-only">WhatsApp</span>
                  </div>
                  <div className="mt-2 text-xs text-zinc-500">Locked for others</div>
                  {waLink ? (
                    <a className="mt-1 block text-sm font-medium text-zinc-900 hover:underline" href={waLink} target="_blank" rel="noreferrer">
                      {waText}
                    </a>
                  ) : (
                    <div className="mt-1 text-sm font-medium text-zinc-900">{waText}</div>
                  )}
                </div>

                <div className="rounded-xl bg-white border border-zinc-200 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <YouTubeIcon className="h-5 w-5 text-red-700" />
                    <span className="sr-only">YouTube</span>
                  </div>
                  <div className="mt-2 text-xs text-zinc-500">Locked for others</div>
                  {ytLink ? (
                    <a className="mt-1 block text-sm font-medium text-zinc-900 hover:underline truncate" href={ytLink} target="_blank" rel="noreferrer">
                      {ytText}
                    </a>
                  ) : (
                    <div className="mt-1 text-sm font-medium text-zinc-900 truncate">{ytText}</div>
                  )}
                </div>
              </div>

              <div className="mt-3 text-xs text-zinc-500">
                Contacts are visible to <span className="font-medium">you</span>. Other users unlock them only after mutual connection.
              </div>
            </div>
          </div>

          {profileIssues.length > 0 && (
            <div className="mt-8 rounded-2xl border border-yellow-300 bg-yellow-50 px-6 py-5">
              <div className="text-sm font-semibold text-yellow-900">Profile not ready for Discover</div>
              <div className="mt-1 text-sm text-yellow-900">
                Fix these to show up in Discover:
              </div>
              <ul className="mt-2 list-disc pl-5 text-sm text-yellow-900">
                {profileIssues.slice(0, 6).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => router.push("/me/edit")}
                className="mt-4 rounded-full bg-red-700 text-white px-6 py-2 text-sm font-medium hover:bg-red-800"
              >
                Complete profile
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}