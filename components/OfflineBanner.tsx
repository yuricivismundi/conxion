"use client";

import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    function handleOnline() { setOffline(false); }
    function handleOffline() { setOffline(true); }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // Sync with current state in case it was already offline on mount
    setOffline(!navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 left-1/2 z-[9000] -translate-x-1/2 rounded-full border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-200 shadow-lg backdrop-blur-sm md:bottom-6"
    >
      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-400" />
      You&apos;re offline — reconnecting…
    </div>
  );
}
