"use client";

import { useMemo, useState } from "react";
import InfoPageShell from "@/components/InfoPageShell";
import { LEGAL_PROFILE } from "@/lib/legal-profile";

type CookiePrefs = {
  essential: true;
  functional: boolean;
  analytics: boolean;
  updatedAt: string;
};

const STORAGE_KEY = "conxion_cookie_preferences";
const COOKIE_KEY = "conxion_cookie_preferences";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const APP_NAME = LEGAL_PROFILE.brandName;

const DEFAULT_PREFS: CookiePrefs = {
  essential: true,
  functional: true,
  analytics: false,
  updatedAt: "",
};

function parsePrefs(raw: string | null): CookiePrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CookiePrefs>;
    if (typeof parsed.functional !== "boolean" || typeof parsed.analytics !== "boolean") return null;
    return {
      essential: true,
      functional: parsed.functional,
      analytics: parsed.analytics,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

function readCookieValue(name: string) {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  const value = match.slice(name.length + 1);
  return decodeURIComponent(value);
}

function writeCookieValue(name: string, value: string) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

function formatUpdatedAt(value: string) {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not saved yet";
  return date.toLocaleString();
}

function Toggle({
  label,
  description,
  enabled,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-xs text-slate-300">{description}</p>
        </div>
        <button
          type="button"
          onClick={onChange}
          disabled={disabled}
          aria-pressed={enabled}
          className={[
            "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition",
            enabled
              ? "border-cyan-300/50 bg-cyan-300/20 shadow-[0_0_20px_rgba(13,242,242,0.18)]"
              : "border-white/20 bg-white/5",
            disabled ? "cursor-not-allowed opacity-60" : "hover:border-white/35",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-5 w-5 transform rounded-full bg-white transition",
              enabled ? "translate-x-6 bg-cyan-100" : "translate-x-1 bg-slate-200",
            ].join(" ")}
          />
        </button>
      </div>
    </div>
  );
}

export default function CookieSettingsPage() {
  const [prefs, setPrefs] = useState<CookiePrefs>(() => {
    if (typeof window === "undefined") return DEFAULT_PREFS;
    const fromStorage = parsePrefs(localStorage.getItem(STORAGE_KEY));
    const fromCookie = parsePrefs(readCookieValue(COOKIE_KEY));
    return fromStorage ?? fromCookie ?? DEFAULT_PREFS;
  });
  const [saveMessage, setSaveMessage] = useState<string>("");

  const serializedPrefs = useMemo(
    () =>
      JSON.stringify({
        essential: true,
        functional: prefs.functional,
        analytics: prefs.analytics,
        updatedAt: prefs.updatedAt,
      }),
    [prefs]
  );

  function save(next: CookiePrefs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    writeCookieValue(COOKIE_KEY, JSON.stringify(next));
    setPrefs(next);
    setSaveMessage(`Saved ${formatUpdatedAt(next.updatedAt)}`);
  }

  function saveCurrent() {
    const next: CookiePrefs = {
      essential: true,
      functional: prefs.functional,
      analytics: prefs.analytics,
      updatedAt: new Date().toISOString(),
    };
    save(next);
  }

  function acceptAll() {
    save({
      essential: true,
      functional: true,
      analytics: true,
      updatedAt: new Date().toISOString(),
    });
  }

  function rejectNonEssential() {
    save({
      essential: true,
      functional: false,
      analytics: false,
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <InfoPageShell
      title="Cookie Settings"
      description={`Manage how ${APP_NAME} uses cookies and similar technologies for authentication, security, and product analytics.`}
    >
      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Categories</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          {APP_NAME} uses cookies and similar technologies, including browser storage, to keep the service secure, remember your
          settings, and measure optional product usage. Non-essential technologies should only run after the level of consent
          required by applicable law.
        </p>
        <div className="mt-4 grid gap-3">
          <Toggle
            label="Essential cookies"
            description="Required for security, login continuity, fraud prevention, and core service delivery. These stay on."
            enabled={true}
            onChange={() => {}}
            disabled
          />
          <Toggle
            label="Functional cookies"
            description="Remember interface, continuity, and convenience choices on this browser and device."
            enabled={prefs.functional}
            onChange={() => setPrefs((current) => ({ ...current, functional: !current.functional }))}
          />
          <Toggle
            label="Analytics cookies"
            description="Optional measurement signals that help improve product quality, performance, and feature decisions."
            enabled={prefs.analytics}
            onChange={() => setPrefs((current) => ({ ...current, analytics: !current.analytics }))}
          />
        </div>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Consent And Scope</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
          <li>Essential storage is used because the service cannot work safely without it.</li>
          <li>Functional and analytics preferences can be changed here at any time.</li>
          <li>These settings currently apply to this browser and device only. They do not automatically sync across devices.</li>
          <li>Clearing your browser storage may reset these choices.</li>
        </ul>
      </article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <h2 className="text-xl font-bold text-white">Your choices</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Preferences are stored on this browser and device so {APP_NAME} can respect your latest choice.
        </p>
        <p className="mt-1 text-xs text-slate-400">Last saved: {formatUpdatedAt(prefs.updatedAt)}</p>
        {saveMessage ? (
          <div className="mt-3 rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">{saveMessage}</div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveCurrent}
            className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
          >
            Save preferences
          </button>
          <button
            type="button"
            onClick={acceptAll}
            className="rounded-lg border border-emerald-300/35 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/20"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={rejectNonEssential}
            className="rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-semibold text-white/85 hover:border-white/35 hover:text-white"
          >
            Reject non-essential
          </button>
        </div>

        <details className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-white/80">Stored preference payload</summary>
          <pre className="mt-2 overflow-x-auto text-[11px] text-slate-300">{serializedPrefs}</pre>
        </details>
      </article>
    </InfoPageShell>
  );
}
