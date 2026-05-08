"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// localStorage keys (per user so multi-account works)
const dismissedKey = (uid: string) => `cx_first_steps_dismissed_v1_${uid}`;
export const discoverVisitedKey = (uid: string) => `cx_first_steps_discover_v1_${uid}`;

type StepStatus = "done" | "pending";

type Steps = {
  profile: StepStatus;
  discover: StepStatus;
  event: StepStatus;
  request: StepStatus;
};

const STEP_META: Array<{
  key: keyof Steps;
  title: string;
  hint: string;
  cta: string;
  href: string;
  icon: string;
}> = [
  {
    key: "profile",
    title: "Complete your profile",
    hint: "Add a photo, your city, and at least one dance style.",
    cta: "Edit profile",
    href: "/me/edit",
    icon: "person",
  },
  {
    key: "discover",
    title: "Discover dancers",
    hint: "Browse the community and find people who share your style.",
    cta: "Explore",
    href: "/connections",
    icon: "explore",
  },
  {
    key: "event",
    title: "Save or join an event",
    hint: "Show interest or request access to an upcoming event.",
    cta: "Browse events",
    href: "/events",
    icon: "event",
  },
  {
    key: "request",
    title: "Send your first request",
    hint: "Connect with a dancer, join a trip, or send an activity invite.",
    cta: "Find connections",
    href: "/connections",
    icon: "group_add",
  },
];

export default function FirstStepsCard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [steps, setSteps] = useState<Steps | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user || cancelled) return;
      const uid = auth.user.id;
      setUserId(uid);

      if (typeof window !== "undefined" && localStorage.getItem(dismissedKey(uid))) {
        setDismissed(true);
        return;
      }

      // Parallel lightweight queries
      const [profileRes, eventRes, connRes, tripReqRes, hostReqRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("avatar_url,city,dance_styles")
          .eq("user_id", uid)
          .maybeSingle(),
        supabase
          .from("event_members")
          .select("event_id", { count: "exact", head: true })
          .eq("user_id", uid)
          .limit(1),
        supabase
          .from("connections")
          .select("requester_id", { count: "exact", head: true })
          .eq("requester_id", uid)
          .limit(1),
        supabase
          .from("trip_requests")
          .select("id", { count: "exact", head: true })
          .eq("requester_id", uid)
          .limit(1),
        supabase
          .from("hosting_requests")
          .select("id", { count: "exact", head: true })
          .eq("requester_id", uid)
          .limit(1),
      ]);

      if (cancelled) return;

      const p = profileRes.data as { avatar_url?: string | null; city?: string | null; dance_styles?: unknown } | null;
      const profileDone =
        !!p?.avatar_url &&
        !!(typeof p?.city === "string" && p.city.trim()) &&
        Array.isArray(p?.dance_styles) && (p.dance_styles as unknown[]).length > 0;

      const discoverDone =
        typeof window !== "undefined" &&
        localStorage.getItem(discoverVisitedKey(uid)) === "1";

      const eventDone = (eventRes.count ?? 0) > 0;
      const requestDone =
        (connRes.count ?? 0) > 0 ||
        (tripReqRes.count ?? 0) > 0 ||
        (hostReqRes.count ?? 0) > 0;

      const next: Steps = {
        profile: profileDone ? "done" : "pending",
        discover: discoverDone ? "done" : "pending",
        event: eventDone ? "done" : "pending",
        request: requestDone ? "done" : "pending",
      };

      // If all done, hide after a brief moment
      const allDone = Object.values(next).every((s) => s === "done");
      if (allDone) {
        setDismissed(true);
        return;
      }

      setSteps(next);
    })();
    return () => { cancelled = true; };
  }, []);

  function dismiss() {
    if (userId) localStorage.setItem(dismissedKey(userId), "1");
    setDismissed(true);
  }

  if (dismissed || !steps) return null;

  const doneCount = Object.values(steps).filter((s) => s === "done").length;
  const total = STEP_META.length;
  const pct = Math.round((doneCount / total) * 100);

  return (
    <section
      className="relative overflow-hidden rounded-[24px] border border-white/[0.07]"
      style={{
        background:
          "radial-gradient(circle at 0% 0%, rgba(0,245,255,0.06) 0%, transparent 50%), radial-gradient(circle at 100% 100%, rgba(255,0,255,0.06) 0%, transparent 50%), #0c1018",
      }}
    >
      {/* Brand gradient top bar */}
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: "linear-gradient(90deg,#00F5FF,#FF00FF)" }}
      />

      <div className="px-5 pb-5 pt-5 sm:px-6 sm:pb-6">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="flex items-center gap-3 text-left"
              aria-expanded={!collapsed}
            >
              <div className="flex flex-col gap-1">
                <h2 className="text-[15px] font-black leading-snug text-white">Start your ConXion</h2>
                <p className="text-[11px] text-white/40">
                  {doneCount}/{total} complete — Complete these first steps to unlock the full experience.
                </p>
              </div>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Progress ring / counter */}
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
              <span
                className="text-[12px] font-black"
                style={{
                  background: "linear-gradient(135deg,#00F5FF,#FF00FF)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {doneCount}/{total}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/30 transition hover:text-white"
              aria-label={collapsed ? "Expand" : "Collapse"}
            >
              <span className="material-symbols-outlined text-[16px]">
                {collapsed ? "expand_more" : "expand_less"}
              </span>
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/20 transition hover:text-white/60"
              aria-label="Dismiss"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg,#00F5FF,#FF00FF)",
            }}
          />
        </div>

        {/* Steps */}
        {!collapsed && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {STEP_META.map((meta, idx) => {
              const done = steps[meta.key] === "done";
              return (
                <div
                  key={meta.key}
                  className={[
                    "relative flex items-start gap-3 rounded-2xl border p-3.5 transition-all",
                    done
                      ? "border-[#00F5FF]/15 bg-[#00F5FF]/[0.04]"
                      : "border-white/[0.06] bg-white/[0.025] hover:border-white/[0.1]",
                  ].join(" ")}
                >
                  {/* Step number / check */}
                  <div
                    className={[
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black transition-all",
                      done
                        ? "shadow-[0_0_12px_rgba(0,245,255,0.3)] text-[#040a0f]"
                        : "border border-white/10 bg-white/[0.04] text-white/35",
                    ].join(" ")}
                    style={done ? { background: "linear-gradient(135deg,#00F5FF,#FF00FF)" } : undefined}
                  >
                    {done ? (
                      <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        check
                      </span>
                    ) : (
                      idx + 1
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className={["text-[13px] font-black leading-snug", done ? "text-white/50 line-through" : "text-white"].join(" ")}>
                      {meta.title}
                    </p>
                    {!done && (
                      <p className="mt-0.5 text-[11px] leading-snug text-white/35">{meta.hint}</p>
                    )}
                  </div>

                  {!done && (
                    <Link
                      href={meta.href}
                      className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold text-white/60 transition hover:border-white/20 hover:text-white"
                    >
                      {meta.cta}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
