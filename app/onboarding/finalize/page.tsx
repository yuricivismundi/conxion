"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import OnboardingShell from "@/components/OnboardingShell";
import SearchableMobileSelect from "@/components/SearchableMobileSelect";
import {
  clearOnboardingDraft,
  type OnboardingDraft,
  readOnboardingDraft,
  writeOnboardingDraft,
} from "@/lib/onboardingDraft";
import { getAvatarStorageUrl } from "@/lib/avatar-storage";
import { normalizeInterests } from "@/lib/interests";
import { normalizeUsername } from "@/lib/username/normalize";
import { mapUsernameServerError, validateUsernameFormat } from "@/lib/username/validate";
import { supabase } from "@/lib/supabase/client";

const AVAIL = [
  { key: "weekdays", title: "Weekdays" },
  { key: "weekends", title: "Weekends" },
  { key: "daytime", title: "Daytime" },
  { key: "evenings", title: "Evenings" },
  { key: "travel", title: "Travel for events" },
  { key: "rather_not_say", title: "I’d rather not say" },
] as const;

type AvailKey = (typeof AVAIL)[number]["key"];
type DanceSkillPayload = {
  level: string;
};

const DEFAULT_AVAIL: Record<AvailKey, boolean> = {
  weekdays: true,
  weekends: true,
  daytime: false,
  evenings: false,
  travel: false,
  rather_not_say: false,
};

const AVAILABILITY_LABELS: Record<AvailKey, string> = {
  weekdays: "Weekdays",
  weekends: "Weekends",
  daytime: "Daytime",
  evenings: "Evenings",
  travel: "Travel for events",
  rather_not_say: "Rather not say",
};

const DEFAULT_LEVEL = "Improver (3–9 months)";
const CORE_STYLE_KEYS = new Set(["bachata", "salsa", "kizomba", "zouk", "tango"]);

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function buildDanceSkills(draft: OnboardingDraft): Record<string, DanceSkillPayload> {
  const styles = toStringArray(draft.styles);
  const styleLevels =
    draft.styleLevels && typeof draft.styleLevels === "object"
      ? (draft.styleLevels as Record<string, unknown>)
      : {};

  const result: Record<string, DanceSkillPayload> = {};

  for (const style of styles) {
    const normalizedStyle = style.trim().toLowerCase();
    if (!normalizedStyle) continue;
    const rawLevel = styleLevels[style];
    const normalizedLevel = typeof rawLevel === "string" && rawLevel.trim().length > 0 ? rawLevel.trim() : DEFAULT_LEVEL;
    result[normalizedStyle] = { level: normalizedLevel };
  }

  return result;
}

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

export default function OnboardingFinalizePage() {
  const router = useRouter();

  const [langs, setLangs] = useState<Language[]>(["English", "Spanish"]);
  const [langPick, setLangPick] = useState<"" | Language>("");

  const [avail, setAvail] = useState<Record<AvailKey, boolean>>(DEFAULT_AVAIL);

  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- hydration from persisted draft. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authRes = await supabase.auth.getUser();
      const user = authRes.data.user;
      if (!user) {
        router.replace("/auth");
        return;
      }

      const d = readOnboardingDraft();
      const draftAgeConfirmed = d.ageConfirmed === true;
      const metadataAgeConfirmed = Boolean(user.user_metadata?.age_confirmed_at || user.user_metadata?.age_confirmed === true);
      if (!draftAgeConfirmed && !metadataAgeConfirmed) {
        router.replace("/onboarding/age");
        return;
      }

      const draftRoles = toStringArray(d.roles);
      if (draftRoles.length === 0) {
        router.replace("/onboarding/profile");
        return;
      }

      const draftStyles = toStringArray(d.styles);
      if (draftStyles.length === 0) {
        router.replace("/onboarding/interests");
        return;
      }

      if (cancelled) return;

      if (Array.isArray(d.langs) && d.langs.length) {
        // Keep only known languages (menu-only)
        const next = d.langs.filter((x): x is Language => (LANGUAGES as readonly string[]).includes(x));
        if (next.length) setLangs(next);
      }

      if (d.avail && typeof d.avail === "object") {
        // Keep only known availability keys
        const next: Record<AvailKey, boolean> = { ...DEFAULT_AVAIL };
        const incoming = d.avail as Record<string, boolean>;
        (Object.keys(next) as AvailKey[]).forEach((k) => {
          next[k] = Boolean(incoming[k]);
        });
        setAvail(next);
      }

      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;
    writeOnboardingDraft({ langs, avail });
  }, [hydrated, langs, avail]);

  const canAddMoreLanguages = langs.length < 5;

  function addLang(nextValue?: Language | "") {
    const v = nextValue ?? langPick;
    if (!v) return;
    if (!canAddMoreLanguages) return;
    if (langs.includes(v)) return;
    setLangs((p) => [...p, v]);
    setLangPick("");
  }

  function removeLang(v: Language) {
    setLangs((p) => p.filter((x) => x !== v));
  }

  const hasAvailability = useMemo(() => Object.values(avail).some(Boolean), [avail]);
  const canComplete = langs.length > 0 && hasAvailability;

  if (!hydrated) {
    return (
      <OnboardingShell
        step={3}
        title="Communication & Availability"
        subtitle=""
        rightLinkLabel=""
        rightLinkHref="/auth"
        rightLinkCta=""
      >
        <div className="animate-pulse space-y-8">
          <section className="space-y-4">
            <div className="h-4 w-28 rounded bg-white/5" />
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="h-12 rounded-xl bg-white/5" />
            </div>
          </section>
          <section className="space-y-4">
            <div className="h-4 w-36 rounded bg-white/5" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="h-14 rounded-2xl bg-white/5" />
              <div className="h-14 rounded-2xl bg-white/5" />
              <div className="h-14 rounded-2xl bg-white/5" />
              <div className="h-14 rounded-2xl bg-white/5" />
            </div>
          </section>
          <div className="h-14 rounded-2xl bg-white/5" />
        </div>
      </OnboardingShell>
    );
  }

  async function completeProfile() {
    if (!canComplete || saving) return;

    setSaveError(null);
    setSaving(true);

    try {
      const authRes = await supabase.auth.getUser();
      const user = authRes.data.user;
      if (!user) {
        router.replace("/auth");
        return;
      }

      const draft = readOnboardingDraft();
      const displayName = typeof draft.displayName === "string" ? draft.displayName.trim() : "";
      const username = normalizeUsername(typeof draft.username === "string" ? draft.username : "");
      const country = typeof draft.country === "string" ? draft.country.trim() : "";
      const city = typeof draft.city === "string" ? draft.city.trim() : "";
      const roles = toStringArray(draft.roles);

      const languages = Array.from(new Set(langs.map((item) => item.trim()).filter((item) => item.length > 0)));
      const interestsFlat = toStringArray(draft.interests);
      const structuredInterestMap =
        draft.interestsByRole && typeof draft.interestsByRole === "object"
          ? (draft.interestsByRole as Record<string, unknown>)
          : {};
      const interestsStructured = Object.values(structuredInterestMap).flatMap((value) => toStringArray(value));
      const interests = normalizeInterests([...interestsFlat, ...interestsStructured]);
      const availability = (Object.entries(avail) as Array<[AvailKey, boolean]>)
        .filter(([, enabled]) => enabled)
        .map(([key]) => AVAILABILITY_LABELS[key]);

      const danceSkills = buildDanceSkills(draft);
      const danceStyles = Object.keys(danceSkills);
      const hasOtherStyle =
        Boolean(draft.otherStyleEnabled) || danceStyles.some((styleKey) => !CORE_STYLE_KEYS.has(styleKey));

      if (displayName.length < 2) {
        throw new Error("Display name is missing. Please complete Step 1 again.");
      }
      const usernameValidation = validateUsernameFormat(username);
      if (!usernameValidation.valid) {
        throw new Error(usernameValidation.error ?? "Username must be between 3 and 20 characters.");
      }
      if (city.length < 1 || country.length < 2) {
        throw new Error("City or country is missing. Please complete Step 1 again.");
      }
      if (roles.length < 1) {
        throw new Error("Please select at least one role.");
      }
      if (languages.length < 1) {
        throw new Error("Please add at least one language.");
      }
      if (availability.length < 1) {
        throw new Error("Please select at least one availability option.");
      }
      if (danceStyles.length < 1) {
        throw new Error("Please select at least one dance style and level in Step 2.");
      }

      const avatarPath = typeof draft.avatarPath === "string" && draft.avatarPath.trim() ? draft.avatarPath.trim() : null;
      const avatarStatus =
        draft.avatarStatus === "approved" || draft.avatarStatus === "rejected" || draft.avatarStatus === "pending"
          ? draft.avatarStatus
          : "pending";
      const avatarUrl = getAvatarStorageUrl(avatarPath);

      const upsertRes = await supabase.from("profiles").upsert(
        {
          user_id: user.id,
          auth_user_id: user.id,
          display_name: displayName,
          username: usernameValidation.normalizedUsername,
          city,
          country,
          roles,
          languages,
          interests,
          availability,
          dance_styles: danceStyles,
          dance_skills: danceSkills,
          has_other_style: hasOtherStyle,
          avatar_path: avatarPath,
          avatar_status: avatarStatus,
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        },
        { onConflict: "user_id" }
      );

      if (upsertRes.error) {
        throw new Error(mapUsernameServerError(upsertRes.error.message));
      }

      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token ?? "";
      if (accessToken) {
        await fetch("/api/onboarding/welcome-email", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }).catch(() => null);
      }

      clearOnboardingDraft();
      router.replace("/auth/success?next=%2Fconnections&context=onboarding");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not complete onboarding.";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <OnboardingShell
      step={3}
      title="Communication & Availability"
      subtitle=""
      rightLinkLabel=""
      rightLinkHref="/auth"
      rightLinkCta=""
    >
      <div className="space-y-8">
        {/* Languages */}
        <section>
          <div className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3">Languages</div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="sm:hidden">
              <SearchableMobileSelect
                label="Language"
                value=""
                options={LANGUAGES.filter((l) => !langs.includes(l))}
                placeholder={canAddMoreLanguages ? "Search languages..." : "Max 5 languages"}
                searchPlaceholder="Search languages..."
                disabled={!canAddMoreLanguages}
                emptyMessage="No languages left to add."
                onSelect={(value) => addLang(value as Language)}
                buttonClassName="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-left text-sm text-[#E0E0E0] outline-none disabled:opacity-50"
              />
            </div>

            <div className="hidden flex-col gap-3 sm:flex sm:flex-row sm:items-center">
              <select
                value={langPick}
                onChange={(e) => setLangPick((e.target.value as Language) || "")}
                disabled={!canAddMoreLanguages}
                className="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:opacity-50"
              >
                <option value="">{canAddMoreLanguages ? "Select a language…" : "Max 5 languages"}</option>
                {LANGUAGES.filter((l) => !langs.includes(l)).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => addLang()}
                disabled={!canAddMoreLanguages || !langPick}
                className={
                  !canAddMoreLanguages || !langPick
                    ? "w-full sm:w-auto rounded-xl px-5 py-3 text-xs font-bold bg-white/10 text-white/40 cursor-not-allowed"
                    : "w-full sm:w-auto rounded-xl px-5 py-3 text-xs font-bold border border-white/10 text-white/70 hover:text-white hover:border-white/20"
                }
              >
                Add
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {langs.length ? (
                langs.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => removeLang(l)}
                    className="rounded-full bg-[#00F5FF] px-4 py-1.5 text-sm font-bold text-[#121212] hover:opacity-90"
                    title="Remove"
                  >
                    {l} <span className="ml-1">×</span>
                  </button>
                ))
              ) : (
                <div className="text-sm text-white/40">No languages selected.</div>
              )}
            </div>

            <div className="mt-2 text-[11px] text-white/35">Select up to 5.</div>
          </div>
        </section>

        {/* Availability */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-wider text-white/60">Availability</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/30 border border-white/10 px-2 py-1 rounded">
              Select at least one
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {AVAIL.map((a) => {
              const on = !!avail[a.key];
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAvail((p) => ({ ...p, [a.key]: !p[a.key] }))}
                  className={[
                    "rounded-xl px-3 py-4 text-sm font-semibold transition border text-center",
                    on
                      ? "border-[#00F5FF] text-[#E0E0E0] bg-black/25 shadow-[inset_0_0_10px_rgba(0,245,255,0.12)]"
                      : "border-white/10 text-white/40 bg-black/20 hover:border-white/20",
                  ].join(" ")}
                >
                  <div className={on ? "font-bold text-white" : "font-bold text-white/70"}>{a.title}</div>
                </button>
              );
            })}
          </div>
        </section>

        {saveError ? (
          <div className="rounded-xl border border-rose-300/35 bg-rose-500/10 p-3 text-sm text-rose-100">{saveError}</div>
        ) : null}

        {/* Actions */}
        <div className="flex items-center gap-4 border-t border-white/5 pt-6">
          <button
            type="button"
            onClick={() => router.push("/onboarding/interests")}
            className="shrink-0 font-bold text-white/40 hover:text-white/70 transition"
          >
            Back
          </button>

          <button
            type="button"
            disabled={!canComplete || saving}
            onClick={() => {
              void completeProfile();
            }}
            className={
              canComplete && !saving
                ? "flex-1 rounded-2xl py-4 font-black uppercase tracking-wide text-[#0A0A0A] shadow-[0_0_28px_rgba(0,245,255,0.22)]"
                : "flex-1 rounded-2xl py-4 font-black uppercase tracking-wide bg-white/10 text-white/40 cursor-not-allowed"
            }
            style={
              canComplete && !saving
                ? { backgroundImage: "linear-gradient(90deg, #00F5FF 0%, #FF00FF 100%)" }
                : undefined
            }
          >
            {saving ? "Completing…" : "Complete profile"}
          </button>
        </div>

        {!hasAvailability ? (
          <div className="mt-3 text-center text-xs text-white/35">Please select at least one availability option.</div>
        ) : null}
      </div>
    </OnboardingShell>
  );
}
