"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

const DISMISSED_KEY = "cx_profile_nudge_dismissed_v1";

type ProfileFields = {
  display_name: string | null;
  avatar_url: string | null;
  city: string | null;
  country: string | null;
  dance_skills: unknown;
  roles: unknown;
};

function calcCompletion(p: ProfileFields): number {
  let done = 0;
  if (p.display_name?.trim()) done++;
  if (p.avatar_url) done++;
  if (p.city?.trim()) done++;
  if (p.country?.trim()) done++;
  const skills = p.dance_skills && typeof p.dance_skills === "object" ? Object.keys(p.dance_skills) : [];
  if (skills.length > 0) done++;
  const roles = Array.isArray(p.roles) ? p.roles : [];
  if (roles.length > 0) done++;
  return Math.round((done / 6) * 100);
}

export default function ProfileCompletionNudge() {
  const [pct, setPct] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(DISMISSED_KEY)) {
      setDismissed(true);
      return;
    }
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("profiles")
        .select("display_name,avatar_url,city,country,dance_skills,roles")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (!data) return;
      const completion = calcCompletion(data as ProfileFields);
      if (completion < 100) setPct(completion);
    })();
  }, []);

  if (dismissed || pct === null || pct >= 100) return null;

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-cyan-300/15 bg-[#0c1118] px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">Your profile is {pct}% complete</p>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundImage: "linear-gradient(90deg,#00F5FF,#FF00FF)" }}
          />
        </div>
      </div>
      <Link
        href="/me/edit"
        className="shrink-0 rounded-lg bg-[linear-gradient(135deg,#00F5FF,#FF00FF)] px-3 py-1.5 text-xs font-bold text-[#071116]"
      >
        Finish setup
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => { localStorage.setItem(DISMISSED_KEY, "1"); setDismissed(true); }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-white"
      >
        <span className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  );
}
