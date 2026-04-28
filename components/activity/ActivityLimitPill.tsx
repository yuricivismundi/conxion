import Link from "next/link";

type ActivityLimitPillProps = {
  label: string;
  current: number;
  limit: number | null;
  compact?: boolean;
  upgradeHint?: string;
};

export default function ActivityLimitPill({ label, current, limit, compact = false, upgradeHint }: ActivityLimitPillProps) {
  const reached = limit !== null && current >= limit;
  const fallbackHint = `Upgrade to Plus to add more ${label.toLowerCase()}.`;

  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">{label}</span>
      <span className={reached ? "text-[11px] font-bold text-[#FFC6FA]" : "text-[11px] font-bold text-[#00F5FF]/70"}>
        {current}/{limit ?? "∞"}
      </span>
      {reached ? (
        <Link
          href="/pricing"
          title={upgradeHint ?? fallbackHint}
          className="rounded-full bg-[linear-gradient(90deg,#00F5FF,#FF00FF)] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#071116] transition hover:scale-[1.02] hover:shadow-[0_0_18px_rgba(0,245,255,0.2)]"
        >
          Upgrade to Plus
        </Link>
      ) : null}
    </div>
  );
}
