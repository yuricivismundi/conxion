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

const STYLES = ["bachata", "salsa", "kizomba", "tango", "zouk"] as const;

const ROLES = ["Social dancer / Student", "Organiser", "DJ", "Artist", "Teacher"] as const;

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

const INTERESTS = [
  "Practice / Dance Partner",
  "Video Collabs",
  "Social Dance Party",
  "Festival Travel Buddy",
  "Private Lessons",
  "Group lessons",
] as const;

const AVAILABILITY = ["Week Days", "Weekends", "Evenings", "Day Time"] as const;

type DanceSkill = {
  level?: (typeof LEVELS)[number] | "";
  verified?: boolean; // admin can set later
};

type Profile = {
  user_id: string;
  display_name: string;
  city: string;
  country: string | null;
  nationality: string | null;

  // keep for compatibility / filtering
  dance_styles: string[];
  dance_skills: Record<string, DanceSkill>;

  roles: string[];
  languages: string[];
  interests: string[];
  availability: string[];

  instagram_handle: string | null;
  whatsapp_handle: string | null; // NEW
  youtube_url: string | null; // NEW

  avatar_url: string | null;
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
  const [danceSkills, setDanceSkills] = useState<Record<string, DanceSkill>>({});

  const [roles, setRoles] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [langPick, setLangPick] = useState<string>("");

  const [interests, setInterests] = useState<string[]>([]);
  const [availability, setAvailability] = useState<string[]>([]);

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

  const selectedStyles = useMemo(() => Object.keys(danceSkills), [danceSkills]);

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

      const p = data as any as Profile;

      setDisplayName(p.display_name ?? "");
      setCountry(p.country ?? "");
      setCity(p.city ?? "");
      setNationality(p.nationality ?? "");

      // Prefer dance_skills, fallback to dance_styles (older users)
      const ds: Record<string, DanceSkill> = (p as any).dance_skills ?? {};
      if (ds && Object.keys(ds).length > 0) {
        setDanceSkills(ds);
      } else {
        const styles = (p.dance_styles ?? []) as string[];
        const fallback: Record<string, DanceSkill> = {};
        styles.forEach((s) => (fallback[s] = { level: "" }));
        setDanceSkills(fallback);
      }

      setRoles(p.roles ?? []);
      setLanguages(p.languages ?? []);
      setInterests((p as any).interests ?? []);
      setAvailability((p as any).availability ?? []);

      // Contacts
      setInstagramHandle(p.instagram_handle ?? "");
      setWhatsappHandle((p as any).whatsapp_handle ?? ""); // NEW
      setYoutubeUrl((p as any).youtube_url ?? ""); // NEW

      setAvatarUrl(p.avatar_url ?? null);

      setLoading(false);
    })();
  }, [router]);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  function toggleStyle(style: string) {
    setDanceSkills((prev) => {
      const next = { ...prev };
      if (next[style]) delete next[style];
      else next[style] = { level: "" };
      return next;
    });
  }

  function setStyleLevel(style: string, level: "" | (typeof LEVELS)[number]) {
    setDanceSkills((prev) => ({
      ...prev,
      [style]: { ...(prev[style] ?? {}), level },
    }));
  }

  function addLanguage(value: string) {
    const v = value.trim();
    if (!v) return;
    if (languages.length >= 3) return;
    if (languages.includes(v)) return;
    setLanguages((prev) => [...prev, v]);
    setLangPick("");
  }

  function removeLanguage(value: string) {
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
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
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

    const payload: any = {
      display_name: displayName.trim(),
      country: country.trim() || null,
      city: city.trim(),
      nationality: nationality.trim() || null,

      dance_styles,
      dance_skills: danceSkills,

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

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;

  const canAddMoreLanguages = languages.length < 3;

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white border border-zinc-200 p-8">
        <Nav title="Edit profile" />

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>
        )}

        {/* Bigger photo + smaller name */}
        <div className="mt-6 flex items-start gap-5">
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-32 w-32 overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-100">
              {avatarUrl ? (
                <Image src={avatarUrl} alt="Avatar" fill className="object-cover" sizes="128px" />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-zinc-500 text-sm">No photo</div>
              )}
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50">
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

            {!avatarUrl && <div className="text-xs text-zinc-600">Tip: profiles with a photo get more connections.</div>}
          </div>

          <div className="flex-1">
            <label className="block text-sm font-medium text-zinc-700">
              Display name
              <input
                className="mt-1 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
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

            <label className="mt-4 block text-sm font-medium text-zinc-700">
              Nationality (optional)
              <input
                className="mt-1 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500"
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
            <div className="text-sm font-medium text-zinc-700">Dance styles + level</div>

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
                        ? "bg-red-700 text-white border-red-700"
                        : "bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-50",
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
                    className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div className="font-medium text-zinc-900 capitalize">{style}</div>

                    <select
                      className="w-64 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500"
                      value={(danceSkills[style]?.level ?? "") as any}
                      onChange={(e) => setStyleLevel(style, e.target.value as any)}
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
                <div className="text-xs text-zinc-500">Tip: set the level for each style you want to be discovered for.</div>
              </div>
            )}
          </div>

          {/* Roles */}
          <div>
            <div className="text-sm font-medium text-zinc-700">Roles</div>
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
                      active ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-50",
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
            <div className="text-sm font-medium text-zinc-700">Interests</div>
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
                      active ? "bg-red-700 text-white border-red-700" : "bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-50",
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
            <div className="text-sm font-medium text-zinc-700">Availability</div>
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
                      active ? "bg-red-700 text-white border-red-700" : "bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-50",
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
              <div className="text-sm font-medium text-zinc-700">Languages</div>
              <div className="text-xs text-zinc-500">Max 3</div>
            </div>

            <div className="mt-2 flex gap-2">
              <select
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500 disabled:bg-zinc-100"
                value={langPick}
                onChange={(e) => setLangPick(e.target.value)}
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
                  canAddMoreLanguages && langPick ? "bg-red-700 text-white hover:bg-red-800" : "bg-zinc-200 text-zinc-600 cursor-not-allowed",
                ].join(" ")}
                disabled={!canAddMoreLanguages || !langPick}
                onClick={() => addLanguage(langPick)}
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
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
                    title="Remove"
                  >
                    {l} <span className="text-zinc-500">×</span>
                  </button>
                ))
              ) : (
                <div className="text-sm text-zinc-600">No languages selected.</div>
              )}
            </div>
          </div>

          {/* CONTACTS (NEW) */}
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
            <div className="text-sm font-medium text-zinc-900">Contacts</div>
            <div className="text-xs text-zinc-600 mt-1">
              These will be hidden for other users until mutual connection.
            </div>

            <div className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-zinc-700">
                Instagram
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500"
                  value={instagramHandle}
                  onChange={(e) => setInstagramHandle(e.target.value)}
                  placeholder="@yourhandle"
                />
              </label>

              <label className="block text-sm font-medium text-zinc-700">
                WhatsApp (phone or handle)
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500"
                  value={whatsappHandle}
                  onChange={(e) => setWhatsappHandle(e.target.value)}
                  placeholder="+34 600 000 000"
                />
              </label>

              <label className="block text-sm font-medium text-zinc-700">
                YouTube (url)
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtube.com/@yourchannel"
                />
              </label>
            </div>
          </div>

          <button
            disabled={saving || uploading}
            className="w-full rounded-xl bg-red-700 text-white py-3 font-medium hover:bg-red-800 disabled:opacity-60"
            type="submit"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}