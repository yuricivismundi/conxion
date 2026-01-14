export default function VerifiedBadge({
  size = 18,
  className = "",
  label,
  showLabel = false,
}: {
  size?: number;
  className?: string;
  label?: string | null;
  showLabel?: boolean;
}) {
  return (
    <span className={["inline-flex items-center gap-2", className].join(" ")}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-label="Verified"
        role="img"
        style={{ verticalAlign: "-2px" }}
      >
        {/* 8-point star badge */}
        <path
          fill="#b91c1c" // red-700
          d="M12 2.2l2.3 2.3 3.2-.2.5 3.1 2.9 1.3-1.7 2.7 1.7 2.7-2.9 1.3-.5 3.1-3.2-.2L12 21.8l-2.3-2.3-3.2.2-.5-3.1-2.9-1.3 1.7-2.7-1.7-2.7 2.9-1.3.5-3.1 3.2.2L12 2.2z"
        />
        {/* check */}
        <path
          fill="#fff"
          d="M10.2 13.3 8.4 11.5 7.3 12.6l2.9 2.9 6.5-6.5-1.1-1.1-5.4 5.4z"
        />
      </svg>

      {showLabel && (label ?? "Verified") ? (
        <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
          {label ?? "Verified"}
        </span>
      ) : null}
    </span>
  );
}