// FULL FILE REPLACE per instructions
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import OnboardingShell from "@/components/OnboardingShell";
import { readOnboardingDraft, writeOnboardingDraft } from "@/lib/onboardingDraft";

// ------------------------------
// Config
// ------------------------------

// Mapping provided by you (role -> interests)
// If a role is missing, we fall back to DEFAULT_INTERESTS.
const DEFAULT_INTERESTS = [
  "Dance at local socials and events",
  "Find practice partners",
  "Get tips on the local dance scene",
  "Collaborate on video projects",
  "Find buddies for workshops, socials, accommodations, or rides",
] as const;

const INTERESTS_BY_ROLE: Record<string, readonly string[]> = {
  "Social dancer / Student": [
    "Dance at local socials and events",
    "Find practice partners",
    "Get tips on the local dance scene",
    "Collaborate on video projects",
    "Find buddies for workshops, socials, accommodations, or rides",
  ],

  Organizer: [
    "Collaborate with artists/teachers for events/festivals",
    "Organize recurring local events",
    "Secure sponsorships and org collabs",
    "Offer volunteer roles for events",
    "Recruit guest dancers",
  ],

  "Studio Owner": [
    "Promote special workshops and events",
    "Organize classes and schedules",
    "Collaborate with other studio owners",
    "Secure sponsorships and hire talent",
  ],

  Promoter: [
    "Partner to promote festivals",
    "Refer artists, DJs, and teachers",
    "Co-promote local parties/socials",
    "Exchange guest lists and shoutouts",
    "Share promo materials and audiences",
  ],

  DJ: [
    "Produce new songs and tracks",
    "Collaborate on tracks or live sets",
    "Network for festival gigs",
    "DJ international and local events",
    "Feature in promo videos/socials",
  ],

  Teacher: [
    "Offer private/group lessons",
    "Teach regular classes",
    "Lead festival workshops",
    "Co-teach sessions",
    "Exchange tips, curricula, and student referrals",
  ],
};

// Levels (Master renamed)
const LEVELS = [
  "Beginner (0–3 months)",
  "Improver (3–9 months)",
  "Intermediate (9–24 months)",
  "Advanced (2+ years)",
  "Teacher/Competitor (3+ years)",
] as const;

const CORE_STYLES = ["Bachata", "Salsa", "Kizomba", "Zouk"] as const;

type CoreStyle = (typeof CORE_STYLES)[number];
type StyleLevel = (typeof LEVELS)[number] | "";

type InterestsByRole = Record<string, string[]>;

type ScrollState = {
  canLeft: boolean;
  canRight: boolean;
};

const isCoreStyle = (value: string): value is CoreStyle => CORE_STYLES.includes(value as CoreStyle);
const isStyleLevel = (value: string): value is StyleLevel => value === "" || (LEVELS as readonly string[]).includes(value);

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function normalizeRoleLabel(role: string) {
  // UX: show “Social Dancer” for Social dancer / Student
  if (role.toLowerCase().includes("social dancer")) return "Social Dancer";
  return role;
}

export default function OnboardingInterestsPage() {
  const router = useRouter();

  const [hydrated, setHydrated] = useState(false);

  // Selected roles from step 1
  const [roles, setRoles] = useState<string[]>([]);

  // Per-role interests selections
  const [interestsByRole, setInterestsByRole] = useState<InterestsByRole>({});

  // Styles + levels
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]); // store style names as strings (core + other)
  const [styleLevels, setStyleLevels] = useState<Record<string, StyleLevel>>({});

  // Other style (MVP: free text)
  const [otherStyleEnabled, setOtherStyleEnabled] = useState(false);
  const [otherStyleName, setOtherStyleName] = useState("");

  // Scroll refs per role row
  const scrollersRef = useRef<Record<string, HTMLDivElement | null>>({});
  const [scrollState, setScrollState] = useState<Record<string, ScrollState>>({});

  // ------------------------------
  // Hydrate from draft
  // ------------------------------
  /* eslint-disable react-hooks/set-state-in-effect -- hydration from persisted draft. */
  useEffect(() => {
    const d = readOnboardingDraft();

    const draftRoles: string[] = Array.isArray(d.roles) ? d.roles : [];
    setRoles(draftRoles);

    // interestsByRole (preferred)
    const dIbr = d.interestsByRole;
    if (dIbr && typeof dIbr === "object") {
      const normalized = Object.fromEntries(
        Object.entries(dIbr).map(([k, v]) => [k, Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []])
      );
      setInterestsByRole(normalized as InterestsByRole);
    } else {
      // Fallback: if only flat interests exist, don't guess assignment.
      setInterestsByRole({});
    }

    // style levels (preferred)
    const dLevels = d.styleLevels;
    if (dLevels && typeof dLevels === "object") {
      const next: Record<string, StyleLevel> = {};
      Object.entries(dLevels).forEach(([k, v]) => {
        if (typeof v === "string" && isStyleLevel(v)) next[k] = v;
      });
      setStyleLevels(next);
    }

    // selected styles
    const dStyles: string[] = Array.isArray(d.styles) ? d.styles : [];
    setSelectedStyles(dStyles);

    // other style
    const dOtherEnabled = !!d.otherStyleEnabled;
    const dOtherName = typeof d.otherStyleName === "string" ? d.otherStyleName : "";
    setOtherStyleEnabled(dOtherEnabled);
    setOtherStyleName(dOtherName);

    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Ensure interestsByRole has keys for each role (after roles hydrate)
  /* eslint-disable react-hooks/set-state-in-effect -- derived state sync. */
  useEffect(() => {
    if (!hydrated) return;
    setInterestsByRole((prev) => {
      const next: InterestsByRole = { ...prev };
      roles.forEach((r) => {
        if (!Array.isArray(next[r])) next[r] = [];
      });
      // Remove keys for roles that are no longer selected
      Object.keys(next).forEach((k) => {
        if (!roles.includes(k)) delete next[k];
      });
      return next;
    });
  }, [hydrated, roles]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist to draft
  useEffect(() => {
    if (!hydrated) return;

    const flatInterests = uniq(Object.values(interestsByRole).flat());

    // Persist "styles" as the list of selected style names
    // If Other is enabled + named, include the name; otherwise, do not include.
    const resolvedOtherName = otherStyleEnabled ? otherStyleName.trim() : "";
    const resolvedStyles = uniq(
      selectedStyles
        .filter((s) => s !== "Other")
        .concat(resolvedOtherName ? [resolvedOtherName] : [])
        .filter(Boolean)
    );

    // Clean levels for styles that are no longer selected
    const nextLevels: Record<string, StyleLevel> = { ...styleLevels };
    Object.keys(nextLevels).forEach((k) => {
      if (!resolvedStyles.includes(k)) delete nextLevels[k];
    });

    writeOnboardingDraft({
      // keep backward-compat fields
      interests: flatInterests,
      styles: resolvedStyles,

      // preferred structured fields
      interestsByRole,
      styleLevels: nextLevels,

      otherStyleEnabled,
      otherStyleName,
    });
  }, [hydrated, interestsByRole, selectedStyles, styleLevels, otherStyleEnabled, otherStyleName]);

  // ------------------------------
  // Helpers
  // ------------------------------

  const rolesToRender = useMemo(() => roles, [roles]);

  function getInterestsForRole(role: string): string[] {
    const list = INTERESTS_BY_ROLE[role] ?? DEFAULT_INTERESTS;
    // Ensure unique, stable list
    return uniq([...list]);
  }

  function toggleInterest(role: string, interest: string) {
    setInterestsByRole((prev) => {
      const current = Array.isArray(prev[role]) ? prev[role] : [];
      const nextForRole = current.includes(interest)
        ? current.filter((x) => x !== interest)
        : [...current, interest];
      return { ...prev, [role]: nextForRole };
    });
  }

  function toggleCoreStyle(style: (typeof CORE_STYLES)[number]) {
    setSelectedStyles((prev) => {
      const on = prev.includes(style);
      const next = on ? prev.filter((x) => x !== style) : [...prev, style];
      // if turning off, clear its level
      if (on) {
        setStyleLevels((lv) => {
          const cp = { ...lv };
          delete cp[style];
          return cp;
        });
      }
      return next;
    });
  }

  function setLevel(style: string, level: StyleLevel) {
    setStyleLevels((prev) => ({ ...prev, [style]: level }));
  }

  function toggleOtherStyle() {
    setOtherStyleEnabled((p) => {
      const next = !p;
      if (!next) {
        // turning off: remove other style name + level
        const name = otherStyleName.trim();
        if (name) {
          setSelectedStyles((styles) => styles.filter((s) => s !== name));
          setStyleLevels((lv) => {
            const cp = { ...lv };
            delete cp[name];
            return cp;
          });
        }
        setOtherStyleName("");
      }
      return next;
    });
  }

  // Apply other style name to selections (when user finishes typing)
  /* eslint-disable react-hooks/set-state-in-effect -- keep selection in sync with free text. */
  useEffect(() => {
    if (!hydrated) return;
    if (!otherStyleEnabled) return;

    const name = otherStyleName.trim();

    // Keep selectedStyles in sync with otherStyleName
    setSelectedStyles((prev) => {
      const withoutOld = prev.filter((s) => s !== "Other");
      // remove any previous other that no longer matches
      const cleaned = withoutOld.filter((s) => !(!!s && !isCoreStyle(s) && s !== name));
      if (!name) return cleaned;
      if (cleaned.includes(name)) return cleaned;
      return [...cleaned, name];
    });
  }, [hydrated, otherStyleEnabled, otherStyleName]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ------------------------------
  // Scroll arrows per role row
  // ------------------------------

  function computeScrollState(role: string) {
    const el = scrollersRef.current[role];
    if (!el) return;
    const left = el.scrollLeft;
    const maxLeft = el.scrollWidth - el.clientWidth;
    const canLeft = left > 2;
    const canRight = maxLeft - left > 2;

    setScrollState((prev) => ({
      ...prev,
      [role]: { canLeft, canRight },
    }));
  }

  useEffect(() => {
    if (!hydrated) return;

    const onResize = () => {
      rolesToRender.forEach((r) => computeScrollState(r));
    };

    window.addEventListener("resize", onResize);
    // compute initial
    rolesToRender.forEach((r) => computeScrollState(r));

    return () => window.removeEventListener("resize", onResize);
  }, [hydrated, rolesToRender]);

  // ------------------------------
  // Validation
  // ------------------------------

  const interestsOk = useMemo(() => {
    if (roles.length === 0) return false;
    return roles.every((r) => Array.isArray(interestsByRole[r]) && interestsByRole[r].length >= 1);
  }, [roles, interestsByRole]);

  const stylesOk = useMemo(() => {
    // must have at least one style selected with a level
    const resolvedOther = otherStyleEnabled ? otherStyleName.trim() : "";
    const coreSelected = selectedStyles.filter((s) => isCoreStyle(s));
    const resolvedStyles = uniq([...coreSelected, ...(resolvedOther ? [resolvedOther] : [])].filter(Boolean));

    if (resolvedStyles.length < 1) return false;

    // every selected style needs a level
    return resolvedStyles.every((s) => {
      const lv = styleLevels[s] ?? "";
      return typeof lv === "string" && lv.length > 0;
    });
  }, [selectedStyles, styleLevels, otherStyleEnabled, otherStyleName]);

  const canContinue = interestsOk && stylesOk;

  return (
    <OnboardingShell
      step={2}
      title="Dance DNA & Interests"
      subtitle={""}
      rightLinkLabel="Already a member?"
      rightLinkHref="/auth"
      rightLinkCta="Sign in"
    >
      <div className="space-y-10">

        {/* Dance styles FIRST */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-wider text-white/60">Dance Styles</div>
            <button
              type="button"
              onClick={() => {
                setSelectedStyles([]);
                setStyleLevels({});
                setOtherStyleEnabled(false);
                setOtherStyleName("");
              }}
              className="text-xs font-bold text-white/40 hover:text-white/70 underline underline-offset-4"
            >
              Clear all
            </button>
          </div>

          {/* Even distribution: 4 core + Other */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {CORE_STYLES.map((s) => {
              const active = selectedStyles.includes(s);
              const border = active ? "#00F5FF" : "rgba(255,255,255,0.10)";
              const color = active ? "#00F5FF" : "rgba(255,255,255,0.35)";

              return (
                <div key={s} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleCoreStyle(s)}
                    className="rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition border bg-black/20 hover:border-white/20"
                    style={{ borderColor: border, color }}
                  >
                    {s}
                  </button>

                  {active ? (
                    <select
                      className="mt-2 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-[12px] text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      value={styleLevels[s] ?? ""}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setLevel(s, isStyleLevel(nextValue) ? nextValue : "");
                      }}
                    >
                      <option value="">Level…</option>
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              );
            })}

            {/* Other (MVP: free text, max 32 chars) */}
            <div className="flex flex-col">
              <button
                type="button"
                onClick={toggleOtherStyle}
                className="rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition border bg-black/20 hover:border-white/20"
                style={{
                  borderColor: otherStyleEnabled ? "#FF00FF" : "rgba(255,255,255,0.10)",
                  color: otherStyleEnabled ? "#FF00FF" : "rgba(255,255,255,0.35)",
                }}
              >
                Other
              </button>

              {otherStyleEnabled ? (
                <>
                  <input
                    value={otherStyleName}
                    onChange={(e) => setOtherStyleName(e.target.value.slice(0, 32))}
                    placeholder="Type…"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-[12px] text-[#E0E0E0] outline-none focus:border-[#FF00FF]/60 focus:ring-1 focus:ring-[#FF00FF]/30"
                  />

                  {otherStyleName.trim() ? (
                    <select
                      className="mt-2 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-2 text-[12px] text-[#E0E0E0] outline-none focus:border-[#FF00FF]/60 focus:ring-1 focus:ring-[#FF00FF]/30"
                      value={styleLevels[otherStyleName.trim()] ?? ""}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setLevel(otherStyleName.trim(), isStyleLevel(nextValue) ? nextValue : "");
                      }}
                    >
                      <option value="">Level…</option>
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </section>

        {/* Role-based interests SECOND */}
        <section className="space-y-6">
          {roles.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-white/50">
              No roles selected. Go back to Step 1 and pick at least one role.
            </div>
          ) : null}

          {rolesToRender.map((role) => {
            const list = getInterestsForRole(role);
            const selected = interestsByRole[role] ?? [];
            const st = scrollState[role] ?? { canLeft: false, canRight: false };

            return (
              <div key={role} className="space-y-3">
                <div className="flex items-end justify-between">
                  <div className="text-sm font-semibold uppercase tracking-wider text-white/60">
                    {normalizeRoleLabel(role)}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/30 border border-white/10 px-2 py-1 rounded">
                    Select at least 1
                  </div>
                </div>

                <div className="relative">
                  <div
                    ref={(el) => {
                      scrollersRef.current[role] = el;
                    }}
                    onScroll={() => computeScrollState(role)}
                    className="flex gap-3 overflow-x-auto pb-2 pr-10 pl-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {list.map((it) => {
                      const active = selected.includes(it);
                      return (
                        <button
                          key={it}
                          type="button"
                          onClick={() => toggleInterest(role, it)}
                          className={[
                            "shrink-0 w-[70%] sm:w-[45%] md:w-[30%] rounded-2xl px-3 py-3 text-left transition border",
                            active
                              ? "border-[#00F5FF] bg-black/30 shadow-[0_0_18px_rgba(0,245,255,0.18)]"
                              : "border-white/10 bg-black/20 hover:border-white/20",
                          ].join(" ")}
                        >
                          <div className={active ? "text-[#00F5FF] font-extrabold text-[12px]" : "text-white/70 font-bold text-[12px]"}>
                            {it}
                          </div>
                          <div className={active ? "mt-1 text-[10px] text-white/70" : "mt-1 text-[10px] text-white/40"}>
                            {active ? "Selected" : "Tap to select"}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Left arrow (only when useful) */}
                  {st.canLeft ? (
                    <button
                      type="button"
                      aria-label={`Scroll ${role} interests left`}
                      onClick={() => scrollersRef.current[role]?.scrollBy({ left: -320, behavior: "smooth" })}
                      className="absolute -left-[18px] top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition"
                    >
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/30 border border-white/10">&lt;</span>
                    </button>
                  ) : null}

                  {/* Right arrow (only when useful) */}
                  {st.canRight ? (
                    <button
                      type="button"
                      aria-label={`Scroll ${role} interests right`}
                      onClick={() => scrollersRef.current[role]?.scrollBy({ left: 320, behavior: "smooth" })}
                      className="absolute right-0 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition"
                    >
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/30 border border-white/10">&gt;</span>
                    </button>
                  ) : null}
                </div>

                {selected.length > 0 ? (
                  <div className="-mt-1 text-[11px] text-white/50">
                    Selected: <span className="text-white/80">{selected.join(", ")}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>

        {/* Actions (match Step 1 style) */}
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/onboarding/profile")}
            className="shrink-0 rounded-2xl border border-white/10 bg-black/20 px-5 py-4 text-sm font-bold text-white/50 hover:text-white/80 hover:border-white/20 transition"
          >
            Back
          </button>

          <button
            type="button"
            disabled={!canContinue}
            onClick={() => router.push("/onboarding/finalize")}
            className={[
              "flex-1 rounded-2xl py-4 font-black uppercase tracking-wide transition",
              canContinue
                ? "text-[#0A0A0A] shadow-[0_0_22px_rgba(0,245,255,0.18)]"
                : "bg-white/10 text-white/40 cursor-not-allowed",
            ].join(" ")}
            style={canContinue ? { backgroundImage: "linear-gradient(90deg, #00F5FF 0%, #FF00FF 100%)" } : undefined}
          >
            Continue to Step 3
          </button>
        </div>

        {!canContinue ? (
          <div className="text-[11px] text-white/40">
            To continue: select at least 1 interest for each role, and select at least 1 dance style with a level.
          </div>
        ) : null}
      </div>
    </OnboardingShell>
  );
}
