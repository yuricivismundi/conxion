"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import OnboardingShell from "@/components/OnboardingShell";
import {
  clearOnboardingDraft,
  readOnboardingDraft,
  writeOnboardingDraft,
} from "@/lib/onboardingDraft";

const AVAIL = [
  { key: "weekdays", title: "Weekdays" },
  { key: "weekends", title: "Weekends" },
  { key: "daytime", title: "Daytime" },
  { key: "evenings", title: "Evenings" },
  { key: "travel", title: "Travel for Events" },
  { key: "rather_not_say", title: "I’d rather not say" },
] as const;

type AvailKey = (typeof AVAIL)[number]["key"];

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

  const [avail, setAvail] = useState<Record<AvailKey, boolean>>({
    weekdays: true,
    weekends: true,
    daytime: false,
    evenings: false,
    travel: false,
    rather_not_say: false,
  });

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const d = readOnboardingDraft();

    if (Array.isArray(d.langs) && d.langs.length) {
      // Keep only known languages (menu-only)
      const next = d.langs.filter((x): x is Language => (LANGUAGES as readonly string[]).includes(x));
      if (next.length) setLangs(next);
    }

    if (d.avail && typeof d.avail === "object") {
      // Keep only known availability keys
      const next: Record<AvailKey, boolean> = { ...avail };
      (Object.keys(next) as AvailKey[]).forEach((k) => {
        next[k] = Boolean((d.avail as any)[k]);
      });
      setAvail(next);
    }

    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeOnboardingDraft({ langs, avail });
  }, [hydrated, langs, avail]);

  const canAddMoreLanguages = langs.length < 3;

  function addLang() {
    const v = langPick;
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={langPick}
                onChange={(e) => setLangPick((e.target.value as Language) || "")}
                disabled={!canAddMoreLanguages}
                className="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:opacity-50"
              >
                <option value="">{canAddMoreLanguages ? "Select a language…" : "Max 3 languages"}</option>
                {LANGUAGES.filter((l) => !langs.includes(l)).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={addLang}
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

            <div className="mt-2 text-[11px] text-white/35">Select up to 3.</div>
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
            disabled={!canComplete}
            onClick={() => {
              // TODO: write to Supabase + set onboarding_complete
              clearOnboardingDraft();
              router.push("/connections");
            }}
            className={
              canComplete
                ? "flex-1 rounded-2xl py-4 font-black uppercase tracking-wide text-[#0A0A0A] shadow-[0_0_28px_rgba(0,245,255,0.22)]"
                : "flex-1 rounded-2xl py-4 font-black uppercase tracking-wide bg-white/10 text-white/40 cursor-not-allowed"
            }
            style={
              canComplete
                ? { backgroundImage: "linear-gradient(90deg, #00F5FF 0%, #FF00FF 100%)" }
                : undefined
            }
          >
            Complete Profile
          </button>
        </div>

        {!hasAvailability ? (
          <div className="mt-3 text-center text-xs text-white/35">Please select at least one availability option.</div>
        ) : null}
      </div>
    </OnboardingShell>
  );
}