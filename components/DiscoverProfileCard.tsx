"use client";

import Link from "next/link";
import VerifiedBadge from "@/components/VerifiedBadge";
import Avatar from "@/components/Avatar";

type DanceSkill = { level?: string; verified?: boolean };

type ProfileCardModel = {
  user_id: string;
  display_name: string;
  city: string;
  country: string | null;
  roles: string[];
  languages: string[];
  connections_count: number;
  dance_skills: Record<string, DanceSkill>;
  avatar_url: string | null;
  verified: boolean;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function Icon({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-7 w-7 items-center justify-center rounded-xl border border-zinc-200 bg-white text-[13px] text-zinc-700",
        className
      )}
    >
      {children}
    </span>
  );
}

function Pill({
  children,
  tone = "soft",
  className,
  title,
}: {
  children: React.ReactNode;
  tone?: "soft" | "solid";
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold",
        tone === "soft"
          ? "border-zinc-200 bg-white text-zinc-800"
          : "border-zinc-900 bg-zinc-900 text-white",
        className
      )}
    >
      {children}
    </span>
  );
}

export default function DiscoverProfileCard({
  p,
  commonStylesCount,
  busy,
  disabled,
  onZoom,
  onConnect,
}: {
  p: ProfileCardModel;
  commonStylesCount: number;
  busy: boolean;
  disabled: boolean;
  onZoom: () => void;
  onConnect: () => void;
}) {
  const skillEntries = Object.entries(p.dance_skills ?? {}).filter(([k]) => !!k);
  const topSkills = skillEntries.slice(0, 6);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition hover:shadow-md">
      {/* subtle header tint */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-red-50 to-transparent" />

      <div className="relative p-4">
        {/* TOP ROW: image (upper-left) + identity */}
        <div className="flex items-start gap-3">
          {/* Bigger image, upper-left */}
          <button
            type="button"
            onClick={onZoom}
            className="shrink-0"
            title={p.avatar_url ? "Click to enlarge" : ""}
          >
            <div className="h-40 w-40 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
  <Avatar
    src={p.avatar_url}
    alt="Avatar"
    size={160}
    className="h-40 w-40 rounded-2xl"
  />
</div>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-base font-semibold text-zinc-900">
                {p.display_name}
              </div>
              {p.verified ? <VerifiedBadge size={16} /> : null}
            </div>

            <div className="mt-0.5 text-xs text-zinc-600">
              {p.city}
              {p.country ? `, ${p.country}` : ""}
            </div>

            {/* QUICK STATS rows with icons */}
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <Icon>🤝</Icon>
                <div className="text-xs text-zinc-700">
                  <span className="font-semibold">{p.connections_count ?? 0}</span>{" "}
                  connections
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Icon>🎵</Icon>
                <div className="text-xs text-zinc-700">
                  {commonStylesCount > 0 ? (
                    <>
                      <span className="font-semibold">
                        {commonStylesCount}
                      </span>{" "}
                      styles in common
                    </>
                  ) : (
                    "No styles in common"
                  )}
                </div>
              </div>

              {(p.languages?.length ?? 0) > 0 && (
                <div className="flex items-center gap-2">
                  <Icon>🌍</Icon>
                  <div className="text-xs text-zinc-700 line-clamp-1">
                    {p.languages.slice(0, 3).join(", ")}
                    {p.languages.length > 3 ? "…" : ""}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* LOWER HALF: Roles + Dance styles */}
        <div className="mt-4 space-y-3">
          {/* Roles */}
          {(p.roles?.length ?? 0) > 0 && (
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5">🏷️</Icon>
              <div className="flex flex-wrap gap-2">
                {p.roles.slice(0, 3).map((r) => (
                  <Pill key={r} className="border-red-200 bg-red-50 text-red-800">
                    {r}
                  </Pill>
                ))}
                {p.roles.length > 3 ? (
                  <Pill className="text-zinc-600">+{p.roles.length - 3}</Pill>
                ) : null}
              </div>
            </div>
          )}

          {/* Dance styles */}
          <div className="flex items-start gap-2">
            <Icon className="mt-0.5">💃</Icon>
            <div className="flex flex-wrap gap-2">
              {topSkills.length ? (
                topSkills.map(([style, info]) => {
                  const lvl = (info?.level ?? "").toString().trim();
                  const v = !!info?.verified;

                  return (
                    <Pill
                      key={style}
                      title={lvl ? `${style} • ${lvl}` : style}
                      className={cx(
                        "bg-white",
                        v ? "border-red-200" : "border-zinc-200"
                      )}
                    >
                      <span className="capitalize">{style}</span>
                      {v ? <VerifiedBadge size={12} /> : null}
                    </Pill>
                  );
                })
              ) : (
                <span className="text-xs text-zinc-500">
                  No dance skills listed yet.
                </span>
              )}

              {skillEntries.length > topSkills.length ? (
                <Pill className="text-zinc-600">
                  +{skillEntries.length - topSkills.length}
                </Pill>
              ) : null}
            </div>
          </div>
        </div>

        {/* FIXED bottom actions */}
        <div className="mt-4 flex items-center justify-between pt-2">
          <Link
            className="text-sm font-semibold text-red-700 hover:text-red-800"
            href={`/profile/${p.user_id}`}
          >
            View
          </Link>

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
            title={disabled ? "Already interacted" : ""}
          >
            {busy ? "Sending…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}