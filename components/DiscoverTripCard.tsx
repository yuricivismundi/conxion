// /components/DiscoverTripCard.tsx
"use client";

import VerifiedBadge from "@/components/VerifiedBadge";
import Avatar from "@/components/Avatar";

type TripPurpose = "Holiday Trip" | "Dance Festival";
type TripStatus = "active" | "inactive";

export type TripCardTrip = {
  id: string;
  user_id: string;
  status: TripStatus;

  destination_country: string;
  destination_city: string;
  start_date: string; // ISO yyyy-mm-dd
  end_date: string;   // ISO yyyy-mm-dd
  purpose: TripPurpose;

  display_name: string;
  roles: string[];
  languages: string[];

  avatar_url: string | null;
  verified: boolean;
  verified_label: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatDateShort(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function Pill({
  children,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "red" | "dark";
  title?: string;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] leading-none whitespace-nowrap";
  const toneCls =
    tone === "dark"
      ? "border-zinc-800 bg-zinc-900 text-white"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <span title={title} className={`${base} ${toneCls}`}>
      {children}
    </span>
  );
}

export default function DiscoverTripCard({
  t,
  busy,
  disabled,
  onZoom,
  onView,
  onConnect,
}: {
  t: TripCardTrip;
  busy: boolean;
  disabled: boolean;
  onZoom: () => void;
  onView: () => void;
  onConnect: () => void;
}) {
  const tripLine = `${t.destination_city}, ${t.destination_country} • ${formatDateShort(t.start_date)} → ${formatDateShort(t.end_date)}`;

  return (
    <div className="relative rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm hover:shadow-md transition">
      {/* IMAGE — top left */}
      <button
        type="button"
        onClick={onZoom}
        className="absolute top-4 left-4"
        title={t.avatar_url ? "Click to enlarge" : ""}
      >
        <div className="h-[96px] w-[96px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
          <Avatar
            src={t.avatar_url}
            alt="Avatar"
            size={96}
            className="h-full w-full object-cover"
          />
        </div>
      </button>

      {/* CONTENT */}
      <div className="pl-[116px] min-h-[96px]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-[15px] font-semibold text-zinc-900">
                {t.display_name}
              </div>
              {t.verified && <VerifiedBadge size={16} />}
            </div>

            <div className="mt-0.5 text-xs text-zinc-600 truncate">{tripLine}</div>
          </div>
        </div>

        {/* Meta pills */}
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill tone="dark">✈️ {t.purpose}</Pill>

          <Pill tone="neutral" title="This connection comes from a published trip">
            🧳 Trip
          </Pill>

          {t.languages?.slice(0, 2).map((l) => (
            <Pill key={l}>🌍 {l}</Pill>
          ))}
          {t.languages?.length > 2 ? <Pill>+{t.languages.length - 2} langs</Pill> : null}
        </div>

        {/* Roles */}
        {t.roles?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {t.roles.slice(0, 2).map((r) => (
              <span
                key={r}
                className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-800"
              >
                {r}
              </span>
            ))}
            {t.roles.length > 2 ? (
              <span className="text-[11px] text-zinc-500">+{t.roles.length - 2} more</span>
            ) : null}
          </div>
        )}
      </div>

      {/* FOOTER ACTIONS */}
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onView}
          className="text-sm font-semibold text-red-700 hover:text-red-800"
        >
          View
        </button>

        <button
          type="button"
          onClick={onConnect}
          disabled={busy || disabled}
          className={cx(
            "rounded-xl px-4 py-2 text-sm font-semibold",
            busy || disabled
              ? "bg-zinc-200 text-zinc-600 cursor-not-allowed"
              : "bg-red-700 text-white hover:bg-red-800"
          )}
        >
          {busy ? "Sending…" : "Connect"}
        </button>
      </div>
    </div>
  );
}