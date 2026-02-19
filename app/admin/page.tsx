"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import Nav from "@/components/Nav";
import VerifiedBadge from "@/components/VerifiedBadge";

type DanceSkill = { level?: string; verified?: boolean };
type DanceSkills = Record<string, DanceSkill>;

type ProfileRow = {
  user_id: string;
  display_name: string;
  city: string;
  country: string | null;

  verified: boolean;
  verified_label: string | null;

  roles: string[];
  languages: string[];
  dance_skills: DanceSkills;
};

type ProfileRowDb = {
  user_id?: string;
  display_name?: string | null;
  city?: string | null;
  country?: string | null;
  verified?: boolean | null;
  verified_label?: string | null;
  roles?: unknown;
  languages?: unknown;
  dance_skills?: unknown;
};

const isString = (value: unknown): value is string => typeof value === "string";

const STYLES = ["bachata", "salsa", "kizomba", "tango", "zouk"] as const;
const LEVELS = ["beginner", "intermediate", "advanced"] as const;

const ROLE_OPTIONS = ["Social dancer / Student", "Organiser", "DJ", "Artist", "Teacher"] as const;

// Keep this MVP-simple. Add more later.
const LANGUAGE_OPTIONS = [
  "English",
  "Spanish",
  "Italian",
  "Portuguese",
  "French",
  "German",
  "Estonian",
  "Russian",
] as const;

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // If true, admin cannot edit their own badge/fields (prevents “I verified myself” mistakes).
  const DISABLE_SELF_EDIT = true;

  // ---------- Helpers ----------
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return profiles;

    return profiles.filter((p) => {
      const hay = [
        p.display_name ?? "",
        p.city ?? "",
        p.country ?? "",
        p.user_id ?? "",
        (p.roles ?? []).join(", "),
        (p.languages ?? []).join(", "),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [q, profiles]);

  async function loadAllProfiles() {
    setMsg(null);

    const { data, error } = await supabase
      .from("profiles")
      .select("user_id,display_name,city,country,verified,verified_label,roles,languages,dance_skills")
      .order("display_name", { ascending: true })
      .limit(500);

    if (error) {
      setMsg(error.message);
      return;
    }

    const rows = (data ?? []) as ProfileRowDb[];
    const normalized: ProfileRow[] = rows.map((r) => ({
      user_id: r.user_id ?? "",
      display_name: r.display_name ?? "—",
      city: r.city ?? "—",
      country: r.country ?? null,
      verified: Boolean(r.verified),
      verified_label: r.verified_label ?? null,
      roles: Array.isArray(r.roles) ? r.roles.filter(isString) : [],
      languages: Array.isArray(r.languages) ? r.languages.filter(isString) : [],
      dance_skills:
        r.dance_skills && typeof r.dance_skills === "object" ? (r.dance_skills as DanceSkills) : {},
    }));

    setProfiles(normalized);
  }

  // ---------- Auth + Admin check ----------
  useEffect(() => {
    (async () => {
      setLoading(true);
      setAuthErr(null);

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;

      if (!user) {
        window.location.assign("/auth");
        return;
      }

      setMeId(user.id);

      const { data: admin, error: adminErr } = await supabase
        .from("admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminErr) {
        setAuthErr(adminErr.message);
        setLoading(false);
        return;
      }

      if (!admin) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setIsAdmin(true);
      await loadAllProfiles();
      setLoading(false);
    })();
  }, []);

  // ---------- Mutations ----------
  async function updateProfile(userId: string, patch: Partial<ProfileRow>) {
    setBusyUserId(userId);
    setMsg(null);

    const payload: Partial<ProfileRow> = {};

    if (typeof patch.verified === "boolean") payload.verified = patch.verified;
    if (patch.verified_label !== undefined) payload.verified_label = patch.verified_label;

    if (patch.roles !== undefined) payload.roles = patch.roles;
    if (patch.languages !== undefined) payload.languages = patch.languages;
    if (patch.dance_skills !== undefined) payload.dance_skills = patch.dance_skills;

    const { error } = await supabase.from("profiles").update(payload).eq("user_id", userId);

    setBusyUserId(null);

    if (error) {
      setMsg(error.message);
      return false;
    }

    setProfiles((prev) =>
      prev.map((p) => (p.user_id === userId ? { ...p, ...patch } as ProfileRow : p))
    );

    return true;
  }

  async function toggleVerified(userId: string, next: boolean) {
    const ok = await updateProfile(userId, {
      verified: next,
      verified_label: next ? undefined : null, // if removing badge, clear label
    });
    return ok;
  }

  async function setLabel(userId: string, label: string) {
    const normalized = label.trim().slice(0, 40);
    await updateProfile(userId, { verified_label: normalized ? normalized : null });
  }

  function toggleInArray(arr: string[], value: string) {
    const has = arr.includes(value);
    return has ? arr.filter((x) => x !== value) : [...arr, value];
  }

  async function toggleRole(userId: string, role: string) {
    const p = profiles.find((x) => x.user_id === userId);
    if (!p) return;
    const next = toggleInArray(p.roles ?? [], role);
    await updateProfile(userId, { roles: next });
  }

  async function toggleLanguage(userId: string, lang: string) {
    const p = profiles.find((x) => x.user_id === userId);
    if (!p) return;
    const next = toggleInArray(p.languages ?? [], lang);
    await updateProfile(userId, { languages: next });
  }

  async function setSkillLevel(userId: string, style: string, level: string) {
    const p = profiles.find((x) => x.user_id === userId);
    if (!p) return;

    const current = p.dance_skills ?? {};
    const next: DanceSkills = { ...current };
    next[style] = { ...(next[style] ?? {}), level: level || undefined };

    await updateProfile(userId, { dance_skills: next });
  }

  async function toggleSkillVerified(userId: string, style: string, verified: boolean) {
    const p = profiles.find((x) => x.user_id === userId);
    if (!p) return;

    const current = p.dance_skills ?? {};
    const next: DanceSkills = { ...current };
    next[style] = { ...(next[style] ?? {}), verified };

    await updateProfile(userId, { dance_skills: next });
  }

  // ---------- UI ----------
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;

  if (authErr) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] p-6 text-slate-100">
        <div className="mx-auto max-w-5xl">
          <Nav title="Admin" />
          <p className="mt-4 text-sm text-rose-100 bg-rose-500/10 border border-rose-300/35 rounded-xl p-3">{authErr}</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] p-6 text-slate-100">
        <div className="mx-auto max-w-5xl">
          <Nav title="Admin" />
          <div className="mt-6 rounded-2xl bg-[#121212] border border-white/10 p-6">
            <h1 className="text-xl font-semibold">Not allowed</h1>
            <p className="mt-2 text-slate-400">
              This page is only for admins. Add your user_id to{" "}
              <code className="px-2 py-1 rounded bg-black/25">admins</code>.
            </p>

            {meId && (
              <p className="mt-4 text-sm text-slate-400">
                Your user_id: <code className="px-2 py-1 rounded bg-black/25">{meId}</code>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-6 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <Nav title="Admin" />

        {msg && (
          <p className="mt-4 text-sm text-rose-100 bg-rose-500/10 border border-rose-300/35 rounded-xl p-3">{msg}</p>
        )}

        <div className="mt-6 rounded-2xl bg-[#121212] border border-white/10 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold">Manage profiles</h1>
              <p className="text-sm text-slate-400">
                Verify users + set roles/languages + verify per-dance style levels.
              </p>
            </div>

            <div className="flex gap-2">
              <input
                className="w-full sm:w-80 rounded-xl border border-white/15 bg-black/20 px-4 py-2 text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-cyan-300/35"
                placeholder="Search name, city, country, id..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button
                onClick={loadAllProfiles}
                className="rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-[#0A0A0A]"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {filtered.map((p) => {
              const busy = busyUserId === p.user_id;
              const isMe = meId === p.user_id;
              const locked = DISABLE_SELF_EDIT && isMe;

              return (
                <div key={p.user_id} className="rounded-2xl border border-white/10 bg-[#121212] p-5">
                  {/* Header */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-semibold truncate">{p.display_name || "—"}</div>
                        {p.verified ? <VerifiedBadge /> : null}
                        {p.verified && p.verified_label ? (
                          <span className="text-xs rounded-full border border-rose-300/35 bg-rose-500/10 px-3 py-1 text-rose-100">
                            {p.verified_label}
                          </span>
                        ) : null}
                        {locked ? (
                          <span className="text-xs rounded-full border border-white/10 bg-[#0A0A0A] px-3 py-1 text-slate-400">
                            You
                          </span>
                        ) : null}
                      </div>

                      <div className="text-sm text-slate-400">
                        {(p.city || "—") + (p.country ? `, ${p.country}` : "")}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 truncate">{p.user_id}</div>
                    </div>

                    {/* Verify controls */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        className="rounded-xl border border-white/15 bg-black/20 px-4 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-cyan-300/35 disabled:bg-black/25"
                        placeholder="Verified label (optional)"
                        defaultValue={p.verified_label ?? ""}
                        disabled={!p.verified || busy || locked}
                        onBlur={(e) => setLabel(p.user_id, e.target.value)}
                      />

                      {p.verified ? (
                        <button
                          onClick={() => toggleVerified(p.user_id, false)}
                          disabled={busy || locked}
                          className="rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-[#0A0A0A] disabled:opacity-60"
                        >
                          {busy ? "Saving…" : "Remove badge"}
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleVerified(p.user_id, true)}
                          disabled={busy || locked}
                          className="rounded-xl bg-cyan-300/20 text-white px-4 py-2 text-sm hover:bg-cyan-300/30 disabled:opacity-60"
                        >
                          {busy ? "Saving…" : "Verify"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Roles + Languages */}
                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-[#0A0A0A] p-4">
                      <div className="text-sm font-medium text-slate-200">Roles</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {ROLE_OPTIONS.map((r) => {
                          const active = (p.roles ?? []).includes(r);
                          return (
                            <button
                              key={r}
                              type="button"
                              disabled={busy || locked}
                              onClick={() => toggleRole(p.user_id, r)}
                              className={[
                                "rounded-full px-3 py-1.5 text-xs border transition",
                                active
                                  ? "bg-cyan-300/20 text-white border-cyan-300/35"
                                  : "bg-[#121212] text-slate-200 border-white/15 hover:bg-black/25",
                                busy || locked ? "opacity-60 cursor-not-allowed" : "",
                              ].join(" ")}
                            >
                              {r}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#0A0A0A] p-4">
                      <div className="text-sm font-medium text-slate-200">Languages</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {LANGUAGE_OPTIONS.map((l) => {
                          const active = (p.languages ?? []).includes(l);
                          return (
                            <button
                              key={l}
                              type="button"
                              disabled={busy || locked}
                              onClick={() => toggleLanguage(p.user_id, l)}
                              className={[
                                "rounded-full px-3 py-1.5 text-xs border transition",
                                active
                                  ? "bg-cyan-300/20 text-white border-cyan-300/35"
                                  : "bg-[#121212] text-slate-200 border-white/15 hover:bg-black/25",
                                busy || locked ? "opacity-60 cursor-not-allowed" : "",
                              ].join(" ")}
                            >
                              {l}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Dance skills */}
                  <div className="mt-4 rounded-2xl border border-white/10 bg-[#121212] p-4">
                    <div className="text-sm font-medium text-slate-200">Dance skills (per style)</div>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {STYLES.map((style) => {
                        const s = (p.dance_skills ?? {})[style] ?? {};
                        const lvl = (s.level ?? "") as string;
                        const v = !!s.verified;

                        return (
                          <div key={style} className="rounded-2xl border border-white/10 bg-[#0A0A0A] p-4">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-semibold">{style}</div>

                              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={v}
                                  disabled={busy || locked}
                                  onChange={(e) => toggleSkillVerified(p.user_id, style, e.target.checked)}
                                />
                                Level verified
                              </label>
                            </div>

                            <div className="mt-3 flex items-center gap-3">
                              <select
                                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300/35 disabled:bg-black/25"
                                value={lvl}
                                disabled={busy || locked}
                                onChange={(e) => setSkillLevel(p.user_id, style, e.target.value)}
                              >
                                <option value="">—</option>
                                {LEVELS.map((x) => (
                                  <option key={x} value={x}>
                                    {x}
                                  </option>
                                ))}
                              </select>

                              {v ? <VerifiedBadge size={18} /> : null}
                            </div>

                            <div className="mt-2 text-xs text-slate-500">
                              Tip: turn on “Level verified” only if a school/admin validated it.
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && <div className="text-slate-400">No profiles found.</div>}
          </div>
        </div>

        {/* Setup reminder */}
        <div className="mt-6 rounded-2xl bg-[#121212] border border-white/10 p-6">
          <h2 className="text-lg font-semibold">Setup (one-time)</h2>

          <ol className="mt-3 list-decimal pl-6 space-y-2 text-sm text-slate-300">
            <li>
              Create table <code className="px-2 py-1 rounded bg-black/25">admins</code> with{" "}
              <code className="px-2 py-1 rounded bg-black/25">user_id uuid primary key</code>.
            </li>
            <li>
              Add your user_id into <code className="px-2 py-1 rounded bg-black/25">admins</code>.
            </li>
            <li>
              Ensure your RLS allows admins to update:{" "}
              <code className="px-2 py-1 rounded bg-black/25">
                verified, verified_label, roles, languages, dance_skills
              </code>
              .
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
