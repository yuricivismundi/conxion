"use client";

import Image from "next/image";
import { memo } from "react";

type AvatarProps = {
  src?: string | null;
  alt?: string;
  size?: number;
  className?: string;
  userId?: string;
};

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function getColorFromName(name: string): string {
  const colors = [
    ["#0e7490", "#164e63"], // cyan
    ["#7c3aed", "#4c1d95"], // purple
    ["#0f766e", "#134e4a"], // teal
    ["#b45309", "#78350f"], // amber
    ["#be185d", "#831843"], // pink
    ["#1d4ed8", "#1e3a8a"], // blue
    ["#15803d", "#14532d"], // green
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const pair = colors[Math.abs(hash) % colors.length];
  return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
}

const Avatar = memo(function Avatar({
  src,
  alt = "Avatar",
  size = 64,
  className = "",
}: AvatarProps) {
  const validSrc = src && !src.includes("pravatar.cc") && src !== "/no-avatar-photo" && src.startsWith("http") ? src : null;

  if (validSrc) {
    return (
      <div
        className={`relative overflow-hidden ${className}`}
        style={{ width: size, height: size }}
      >
        <Image src={validSrc} alt={alt} fill className="object-cover object-center" sizes={`${size}px`} />
      </div>
    );
  }

  const initials = getInitials(alt !== "Avatar" ? alt : "");
  const fontSize = Math.max(10, Math.round(size * 0.38));

  if (initials) {
    return (
      <div
        className={`flex items-center justify-center overflow-hidden ${className}`}
        style={{ width: size, height: size, background: getColorFromName(alt) }}
        aria-label={alt}
      >
        <span style={{ fontSize, fontWeight: 700, color: "#fff", lineHeight: 1, letterSpacing: "0.02em" }}>
          {initials}
        </span>
      </div>
    );
  }

  // Generic silhouette fallback
  return (
    <div
      className={`flex items-center justify-center overflow-hidden ${className}`}
      style={{ width: size, height: size, background: "linear-gradient(135deg,#1e293b,#0f172a)" }}
      aria-label={alt}
    >
      <svg viewBox="0 0 128 128" width={size * 0.7} height={size * 0.7} role="img" aria-hidden="true">
        <circle cx="64" cy="50" r="22" fill="rgba(255,255,255,0.35)" />
        <path d="M28 108c0-20 16-32 36-32s36 12 36 32" fill="rgba(255,255,255,0.35)" />
      </svg>
    </div>
  );
});

export default Avatar;
