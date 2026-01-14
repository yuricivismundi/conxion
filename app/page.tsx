"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding`,
      },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSent(true);
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border border-zinc-200">
        <h1 className="text-2xl font-semibold text-zinc-900">WITH</h1>
        <p className="mt-2 text-zinc-600">Connect. Dance. Discover.</p>

        {!sent ? (
          <form onSubmit={sendMagicLink} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-zinc-700">
              Email
              <input
                className="mt-1 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
              />
            </label>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
                {error}
              </p>
            )}

            <button
              disabled={loading}
              className="w-full rounded-xl bg-red-700 text-white py-3 font-medium hover:bg-red-800 disabled:opacity-60"
              type="submit"
            >
              {loading ? "Sending…" : "Send magic link"}
            </button>
          </form>
        ) : (
          <div className="mt-6 rounded-xl bg-zinc-50 border border-zinc-200 p-4">
            <p className="text-zinc-800 font-medium">Check your email</p>
            <p className="text-zinc-600 text-sm mt-1">
              We sent you a login link. Open it on this device to continue.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}