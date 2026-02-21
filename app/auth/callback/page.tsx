"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Finishing sign-in...");
  const [detail, setDetail] = useState<string | null>(null);

  const debug = (() => {
    if (typeof window === "undefined") return null;
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");
    const errorDesc = searchParams.get("error_description");
    const href = window.location.href;
    const hash = window.location.hash;

    if (!href) return null;
    return [
      `href=${href}`,
      `code=${code ?? ""}`,
      `error=${errorParam ?? ""}`,
      `error_description=${errorDesc ?? ""}`,
      `hash=${hash}`,
    ].join("\n");
  })();

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- auth callback flow updates local UI state. */
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");
    const errorDesc = searchParams.get("error_description");
    const hash = typeof window !== "undefined" ? window.location.hash : "";

    if (errorParam) {
      setMessage("Sign-in failed.");
      setDetail(`${errorParam}${errorDesc ? `: ${errorDesc}` : ""}`);
      return;
    }

    (async () => {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setMessage("Sign-in failed.");
          setDetail(error.message);
          return;
        }
      } else {
        const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (!accessToken || !refreshToken) {
          setMessage("No session found in URL.");
          setDetail("Magic link missing code or token. Try opening the link in the same browser.");
          return;
        }

        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          setMessage("Sign-in failed.");
          setDetail(error.message);
          return;
        }
      }

      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !sessionData?.session) {
        setMessage("Session not found after exchange.");
        setDetail(sessionErr?.message ?? "No session returned. Try opening the magic link in the same browser.");
        return;
      }

      setMessage("Signed in. Redirecting...");
      setDetail(null);
      router.replace("/connections/requests");
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] text-white px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#161b1b]/60 p-6 text-center">
        <p className="text-sm font-semibold">{message}</p>
        {detail ? <p className="mt-2 text-xs text-white/60">{detail}</p> : null}
        {debug ? (
          <pre className="mt-4 max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-[10px] text-white/50 text-left whitespace-pre-wrap">
            {debug}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function AuthCallbackFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] text-white px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#161b1b]/60 p-6 text-center">
        <p className="text-sm font-semibold">Finishing sign-in...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthCallbackFallback />}>
      <AuthCallbackContent />
    </Suspense>
  );
}
