"use client";

const MAX_PULL = 100;
const THRESHOLD = 72;

export default function PullToRefreshIndicator({
  pullY,
  refreshing,
}: {
  pullY: number;
  refreshing: boolean;
}) {
  if (!refreshing && pullY === 0) return null;

  const progress = Math.min(1, pullY / THRESHOLD);
  const ready = pullY >= THRESHOLD;

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 top-0 z-[9800] flex items-start justify-center"
      style={{ paddingTop: refreshing ? 16 : Math.max(0, (pullY / MAX_PULL) * 56) }}
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#0c1118] shadow-lg transition-all"
        style={{ opacity: refreshing ? 1 : progress }}
      >
        {refreshing ? (
          <span
            className="material-symbols-outlined text-[18px] text-cyan-300"
            style={{ animation: "spin 0.7s linear infinite" }}
          >
            refresh
          </span>
        ) : (
          <span
            className="material-symbols-outlined text-[18px] transition-colors"
            style={{
              color: ready ? "#00F5FF" : "rgba(255,255,255,0.4)",
              transform: `rotate(${progress * 180}deg)`,
            }}
          >
            arrow_downward
          </span>
        )}
      </div>
    </div>
  );
}
