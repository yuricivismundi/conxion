"use client";

import { memo, useId } from "react";

const VerifiedBadge = memo(function VerifiedBadge({
  size = 18,
  className = "",
  label,
  showLabel = false,
  title,
}: {
  size?: number;
  className?: string;
  label?: string | null;
  showLabel?: boolean;
  title?: string;
}) {
  const uid = useId();
  const gradId = `vbg-${uid}`;

  return (
    <span className={["inline-flex items-center gap-1.5", className].join(" ")} title={title}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-label="Verified"
        role="img"
        style={{ verticalAlign: "-2px", flexShrink: 0 }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0df2f2" />
            <stop offset="100%" stopColor="#ff00ff" />
          </linearGradient>
        </defs>
        {/* 8-point star badge */}
        <path
          fill={`url(#${gradId})`}
          d="M12 2.2l2.3 2.3 3.2-.2.5 3.1 2.9 1.3-1.7 2.7 1.7 2.7-2.9 1.3-.5 3.1-3.2-.2L12 21.8l-2.3-2.3-3.2.2-.5-3.1-2.9-1.3 1.7-2.7-1.7-2.7 2.9-1.3.5-3.1 3.2.2L12 2.2z"
        />
        {/* check */}
        <path
          fill="#fff"
          d="M10.2 13.3 8.4 11.5 7.3 12.6l2.9 2.9 6.5-6.5-1.1-1.1-5.4 5.4z"
        />
      </svg>

      {showLabel && (label ?? "Verified") ? (
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)" }}
        >
          {label ?? "Verified"}
        </span>
      ) : null}
    </span>
  );
});

export default VerifiedBadge;
