"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Nav from "@/components/Nav";
import CountryCitySelect from "@/components/CountryCitySelect";

const LEVELS = [
  "Beginner (0–3 months)",
  "Improver (3–9 months)",
  "Intermediate (9–24 months)",
  "Advanced (2+ years)",
  "Master (teacher/competitor - 3+ years)",
] as const;

type Level = (typeof LEVELS)[number];

const STYLES = ["bachata", "salsa", "kizomba", "tango", "zouk"] as const;
type Style = (typeof STYLES)[number];

const ROLES = ["Social dancer / Student", "Organiser", "DJ", "Artist", "Teacher"] as const;
type Role = (typeof ROLES)[number];

const LANGUAGES = [
  "English",
  "Spanish",
  "Italian",
  "Estonian",
  "French",
  "German",
  "Portuguese",
  "Russian",
  "Ukrainian",
  "Polish",
  "Swedish",
  "Finnish",
] as const;
type Language = (typeof LANGUAGES)[number];

const INTERESTS = [
  "Practice / Dance Partner",
  "Video Collabs",
  "Social Dance Party",
  "Festival Travel Buddy",
  "Private Lessons",
  "Group lessons",
] as const;
type Interest = (typeof INTERESTS)[number];

const AVAILABILITY = ["Week Days", "Weekends", "Evenings", "Day Time"] as const;
type Availability = (typeof AVAILABILITY)[number];

type DanceSkill = {
  level?: Level | "";
  verified?: boolean; // admin can set later
};

type Profile = {
  user_id: string;
  display_name: string;
  city: string;
  country: string | null;
  nationality: string | null;

  // keep for compatibility / filtering
  dance_styles: string[] | null;
  dance_skills: Record<string, DanceSkill> | null;

  roles: Role[] | null;
  languages: Language[] | null;
  interests: Interest[] | null;
  availability: Availability[] | null;

  instagram_handle: string | null;
  whatsapp_handle: string | null; // NEW
  youtube_url: string | null; // NEW

  avatar_url: string | null;
};

type ProfileUpdate = {
  display_name: string;
  country: string | null;
  city: string;
  nationality: string | null;
  dance_styles: string[];
  dance_skills: Record<string, DanceSkill>;
  roles: Role[];
  languages: Language[];
  interests: Interest[];
  availability: Availability[];
  instagram_handle: string | null;
  whatsapp_handle: string | null;
  youtube_url: string | null;
};

export default function EditMePage() {
  const router = useRouter();

  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [nationality, setNationality] = useState("");

  // per-style skills map
  const [danceSkills, setDanceSkills] = useState<Partial<Record<Style, DanceSkill>>>({});

  const [roles, setRoles] = useState<Role[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [langPick, setLangPick] = useState<Language | "">("");

  const [interests, setInterests] = useState<Interest[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);

  // Contacts
  const [instagramHandle, setInstagramHandle] = useState("");
  const [whatsappHandle, setWhatsappHandle] = useState(""); // NEW
  const [youtubeUrl, setYoutubeUrl] = useState(""); // NEW

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const normalizedIg = useMemo(() => {
    const raw = instagramHandle.trim().replaceAll(" ", "");
    return raw.startsWith("@") ? raw.slice(1) : raw;
  }, [instagramHandle]);

  const normalizedWa = useMemo(() => whatsappHandle.trim(), [whatsappHandle]);
  const normalizedYt = useMemo(() => youtubeUrl.trim(), [youtubeUrl]);

  const selectedStyles = useMemo(() => Object.keys(danceSkills) as Style[], [danceSkills]);

  const isLevel = (value: string): value is Level => LEVELS.includes(value as Level);
  const isRole = (value: string): value is Role => ROLES.includes(value as Role);
  const isLanguage = (value: string): value is Language => LANGUAGES.includes(value as Language);
  const isInterest = (value: string): value is Interest => INTERESTS.includes(value as Interest);
  const isAvailability = (value: string): value is Availability => AVAILABILITY.includes(value as Availability);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) return router.replace("/auth");

      setMeId(user.id);

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
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

      const p = data as Profile;

      setDisplayName(p.display_name ?? "");
      setCountry(p.country ?? "");
      setCity(p.city ?? "");
      setNationality(p.nationality ?? "");

      // Prefer dance_skills, fallback to dance_styles (older users)
      const ds: Record<string, DanceSkill> = p.dance_skills ?? {};
      if (ds && Object.keys(ds).length > 0) {
        setDanceSkills(ds);
      } else {
        const styles = p.dance_styles ?? [];
        const fallback: Partial<Record<Style, DanceSkill>> = {};
        styles.forEach((s) => {
          if (STYLES.includes(s as Style)) fallback[s as Style] = { level: "" };
        });
        setDanceSkills(fallback);
      }

      setRoles((p.roles ?? []).filter(isRole));
      setLanguages((p.languages ?? []).filter(isLanguage));
      setInterests((p.interests ?? []).filter(isInterest));
      setAvailability((p.availability ?? []).filter(isAvailability));

      // Contacts
      setInstagramHandle(p.instagram_handle ?? "");
      setWhatsappHandle(p.whatsapp_handle ?? ""); // NEW
      setYoutubeUrl(p.youtube_url ?? ""); // NEW

      setAvatarUrl(p.avatar_url ?? null);

      setLoading(false);
    })();
  }, [router]);

  function toggle<T extends string>(list: T[], setList: (v: T[]) => void, value: T) {
    setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  function toggleStyle(style: Style) {
    setDanceSkills((prev) => {
      const next = { ...prev };
      if (next[style]) delete next[style];
      else next[style] = { level: "" };
      return next;
    });
  }

  function setStyleLevel(style: Style, level: "" | Level) {
    setDanceSkills((prev) => ({
      ...prev,
      [style]: { ...(prev[style] ?? {}), level },
    }));
  }

  function addLanguage(value: Language) {
    const v = value;
    if (!v) return;
    if (languages.length >= 3) return;
    if (languages.includes(v)) return;
    setLanguages((prev) => [...prev, v]);
    setLangPick("");
  }

  function removeLanguage(value: Language) {
    setLanguages((prev) => prev.filter((x) => x !== value));
  }

  async function onPickFile(file: File) {
    if (!meId) return;
    setError(null);
    setUploading(true);

    try {
      if (!file.type.startsWith("image/")) throw new Error("Please upload an image.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Max size is 5MB.");

      const ext = file.name.split(".").pop() || "jpg";
      const path = `${meId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = data.publicUrl;

      const { error: dbErr } = await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("user_id", meId);
      if (dbErr) throw dbErr;

      setAvatarUrl(publicUrl);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Upload failed";
      setError(message);
    } finally {
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!meId) return;

    if (!country || !city) {
      setError("Please select your country and city.");
      return;
    }

    if (selectedStyles.length === 0) {
      setError("Please select at least one dance style.");
      return;
    }

    setSaving(true);
    setError(null);

    // Keep dance_styles in sync for easy filtering
    const dance_styles = selectedStyles;

    const payload: ProfileUpdate = {
      display_name: displayName.trim(),
      country: country.trim() || null,
      city: city.trim(),
      nationality: nationality.trim() || null,

      dance_styles,
      dance_skills: danceSkills as Record<string, DanceSkill>,

      roles,
      languages,
      interests,
      availability,

      instagram_handle: normalizedIg || null,

      // NEW contacts
      whatsapp_handle: normalizedWa || null,
      youtube_url: normalizedYt || null,
    };

    const { error } = await supabase.from("profiles").update(payload).eq("user_id", meId);

    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.replace("/me");
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#11252a,_#071316_46%,_#05090b_100%)] text-slate-100">
        <Nav title="Profile Settings" />
        <div className="mx-auto flex min-h-[60vh] max-w-[1180px] items-center justify-center px-6">
          <div className="rounded-2xl border border-white/10 bg-[#0d171a]/85 px-6 py-4 text-sm text-slate-300">
            Loading profile...
          </div>
        </div>
      </div>
    );
  }

  const canAddMoreLanguages = languages.length < 3;

  return (
    <div
      className="min-h-screen bg-[radial-gradient(circle_at_top,_#11252a,_#071316_46%,_#05090b_100%)] text-slate-100"
      data-testid="profile-edit-page"
    >
      <Nav title="Profile Settings" />
      <main className="mx-auto max-w-[1180px] px-4 pb-16 pt-7 sm:px-6">
        <section className="rounded-3xl border border-white/10 bg-[#0b1418]/86 p-6 shadow-[0_22px_70px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-8">
          <header className="mb-6 border-b border-white/10 pb-4">
            <h1 className="text-2xl font-extrabold tracking-tight text-white" data-testid="profile-edit-title">
              Profile Settings
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              Keep your dancer card fresh so connections, trips, and references stay high quality.
            </p>
          </header>

        {error && (
            <p
              className="mb-4 rounded-xl border border-rose-300/35 bg-rose-500/10 p-3 text-sm text-rose-100"
              data-testid="profile-edit-error"
            >
              {error}
            </p>
        )}

        {/* Bigger photo + smaller name */}
        <div className="mt-2 flex items-start gap-5">
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-32 w-32 overflow-hidden rounded-3xl border border-white/10 bg-black/25">
              {avatarUrl ? (
                <Image src={avatarUrl} alt="Avatar" fill className="object-cover" sizes="128px" />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-slate-500 text-sm">No photo</div>
              )}
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-[#0A0A0A]">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onPickFile(file);
                }}
              />
              {uploading ? "Uploading…" : "Upload photo"}
            </label>

            {!avatarUrl && <div className="text-xs text-slate-400">Tip: profiles with a photo get more connections.</div>}
          </div>

          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-300">
              Display name
              <input
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-cyan-300/35"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                data-testid="profile-edit-display-name"
              />
            </label>

            <div className="mt-4">
              <CountryCitySelect
                value={{ country, city }}
                onChange={(v) => {
                  setCountry(v.country);
                  setCity(v.city);
                }}
              />
            </div>

            <label className="mt-4 block text-sm font-medium text-slate-300">
              Nationality (optional)
              <input
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-cyan-300/35"
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                placeholder="Mexican"
              />
            </label>
          </div>
        </div>

        <form onSubmit={save} className="mt-8 space-y-6">
          {/* Dance styles + per-style level */}
          <div>
            <div className="text-sm font-medium text-slate-300">Dance styles + level</div>

            <div className="mt-2 flex flex-wrap gap-2">
              {STYLES.map((s) => {
                const active = !!danceSkills[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStyle(s)}
                    className={[
                      "rounded-full px-4 py-2 text-sm border transition",
                      active
                        ? "bg-cyan-300/20 text-white border-cyan-300/35"
                        : "bg-[#121212] text-slate-200 border-white/15 hover:bg-[#0A0A0A]",
                    ].join(" ")}
                  >
                    {s}
                  </button>
                );
              })}
            </div>

            {selectedStyles.length > 0 && (
              <div className="mt-4 space-y-3">
                {selectedStyles.map((style) => (
                  <div
                    key={style}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0A0A0A] p-4"
                  >
                    <div className="font-medium text-white capitalize">{style}</div>

                    <select
                      className="w-64 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300/35"
                      value={danceSkills[style]?.level ?? ""}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setStyleLevel(style, nextValue === "" || isLevel(nextValue) ? nextValue : "");
                      }}
                    >
                      <option value="">Select level</option>
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <div className="text-xs text-slate-500">Tip: set the level for each style you want to be discovered for.</div>
              </div>
            )}
          </div>

          {/* Roles */}
          <div>
            <div className="text-sm font-medium text-slate-300">Roles</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {ROLES.map((r) => {
                const active = roles.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggle(roles, setRoles, r)}
                    className={[
                      "rounded-full px-4 py-2 text-sm border transition",
                      active ? "bg-cyan-300/20 text-white border-cyan-300/35" : "bg-[#121212] text-slate-200 border-white/15 hover:bg-[#0A0A0A]",
                    ].join(" ")}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interests */}
          <div>
            <div className="text-sm font-medium text-slate-300">Interests</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {INTERESTS.map((x) => {
                const active = interests.includes(x);
                return (
                  <button
                    key={x}
                    type="button"
                    onClick={() => toggle(interests, setInterests, x)}
                    className={[
                      "rounded-full px-4 py-2 text-sm border transition",
                      active ? "bg-cyan-300/20 text-white border-cyan-300/35" : "bg-[#121212] text-slate-200 border-white/15 hover:bg-[#0A0A0A]",
                    ].join(" ")}
                  >
                    {x}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Availability */}
          <div>
            <div className="text-sm font-medium text-slate-300">Availability</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {AVAILABILITY.map((x) => {
                const active = availability.includes(x);
                return (
                  <button
                    key={x}
                    type="button"
                    onClick={() => toggle(availability, setAvailability, x)}
                    className={[
                      "rounded-full px-4 py-2 text-sm border transition",
                      active ? "bg-cyan-300/20 text-white border-cyan-300/35" : "bg-[#121212] text-slate-200 border-white/15 hover:bg-[#0A0A0A]",
                    ].join(" ")}
                  >
                    {x}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Languages (max 3) */}
          <div>
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-300">Languages</div>
              <div className="text-xs text-slate-500">Max 3</div>
            </div>

            <div className="mt-2 flex gap-2">
              <select
                className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-cyan-300/35 disabled:bg-black/25"
                value={langPick}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setLangPick(nextValue === "" || LANGUAGES.includes(nextValue as Language) ? (nextValue as Language | "") : "");
                }}
                disabled={!canAddMoreLanguages}
              >
                <option value="">{canAddMoreLanguages ? "Select a language…" : "Max reached"}</option>
                {LANGUAGES.filter((l) => !languages.includes(l)).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className={[
                  "rounded-xl px-4 py-3 text-sm font-medium",
                  canAddMoreLanguages && langPick ? "bg-cyan-300/20 text-white hover:bg-cyan-300/30" : "bg-white/10 text-slate-400 cursor-not-allowed",
                ].join(" ")}
                disabled={!canAddMoreLanguages || !langPick}
                onClick={() => {
                  if (!langPick) return;
                  addLanguage(langPick);
                }}
              >
                Add
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {languages.length ? (
                languages.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => removeLanguage(l)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm hover:bg-[#0A0A0A]"
                    title="Remove"
                  >
                    {l} <span className="text-slate-500">×</span>
                  </button>
                ))
              ) : (
                <div className="text-sm text-slate-400">No languages selected.</div>
              )}
            </div>
          </div>

          {/* CONTACTS (NEW) */}
          <div className="rounded-2xl border border-white/10 bg-[#0A0A0A] p-5">
            <div className="text-sm font-medium text-white">Contacts</div>
            <div className="text-xs text-slate-400 mt-1">
              These will be hidden for other users until mutual connection.
            </div>

            <div className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-slate-300">
                Instagram
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-cyan-300/35"
                  value={instagramHandle}
                  onChange={(e) => setInstagramHandle(e.target.value)}
                  placeholder="@yourhandle"
                />
              </label>

              <label className="block text-sm font-medium text-slate-300">
                WhatsApp (phone or handle)
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-cyan-300/35"
                  value={whatsappHandle}
                  onChange={(e) => setWhatsappHandle(e.target.value)}
                  placeholder="+34 600 000 000"
                />
              </label>

              <label className="block text-sm font-medium text-slate-300">
                YouTube (url)
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-cyan-300/35"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtube.com/@yourchannel"
                />
              </label>
            </div>
          </div>

          <button
            disabled={saving || uploading}
            className="w-full rounded-xl bg-cyan-300/20 text-white py-3 font-medium hover:bg-cyan-300/30 disabled:opacity-60"
            type="submit"
            data-testid="profile-edit-save"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
        </section>
      </main>
    </div>
  );
}
