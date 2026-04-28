"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";

export default function GroupJoinPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const inviteToken = typeof params?.token === "string" ? params.token : "";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function joinGroup() {
      if (!inviteToken) {
        setError("This invite link is invalid.");
        return;
      }

      try {
        const sessionRes = await supabase.auth.getSession();
        let accessToken = sessionRes.data.session?.access_token?.trim() ?? "";
        let user = sessionRes.data.session?.user ?? null;

        if (!accessToken) {
          const userRes = await supabase.auth.getUser();
          user = userRes.data.user ?? null;
          if (user) {
            const refreshed = await supabase.auth.refreshSession();
            accessToken = refreshed.data.session?.access_token?.trim() ?? "";
          }
        }

        if (!user || !accessToken) {
          router.replace(`/auth?next=${encodeURIComponent(`/groups/join/${inviteToken}`)}`);
          return;
        }

        const response = await fetch(`/api/groups/join/${encodeURIComponent(inviteToken)}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const result = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          group_id?: string;
        } | null;

        if (!response.ok || !result?.ok || !result.group_id) {
          throw new Error(result?.error ?? "Could not join this group.");
        }

        if (!cancelled) {
          router.replace(`/groups/${encodeURIComponent(result.group_id)}`);
        }
      } catch (joinError) {
        if (!cancelled) {
          setError(joinError instanceof Error ? joinError.message : "Could not join this group.");
        }
      }
    }

    void joinGroup();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, router]);

  return (
    <div className="min-h-screen bg-[#05060a] text-white">
      <Nav />
      <main className="mx-auto flex min-h-[70vh] w-full max-w-[720px] items-center px-4 py-10 sm:px-6">
        <div className="w-full rounded-3xl border border-white/10 bg-[#11141b] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-8">
          {error ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-200/80">Invite link</p>
              <h1 className="mt-3 text-2xl font-bold text-white">Couldn&apos;t join this group</h1>
              <p className="mt-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/activity?tab=groups"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.08]"
                >
                  Back to Groups
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Invite link</p>
              <h1 className="mt-3 text-2xl font-bold text-white">Joining group...</h1>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                We&apos;re verifying your invite and adding you to the group chat.
              </p>
              <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-[linear-gradient(90deg,#00F5FF_0%,#FF00FF_100%)]" />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
