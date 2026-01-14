import Image from "next/image";

type AvatarProps = {
  src?: string | null;
  alt?: string;
  size?: number;
  className?: string;

  // optional (so your existing calls don't error)
  userId?: string;
};

export default function Avatar({
  src,
  alt = "Avatar",
  size = 64,
  className = "",
}: AvatarProps) {
  if (src) {
    return (
      <div
        className={`relative overflow-hidden bg-zinc-100 border border-zinc-200 ${className}`}
        style={{ width: size, height: size }}
      >
        <Image src={src} alt={alt} fill className="object-cover" sizes={`${size}px`} />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center border border-red-200 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 128 128" width={size} height={size} role="img" aria-label="Default avatar">
        <defs>
          <linearGradient id="avatarRed" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#b91c1c" />
          </linearGradient>
        </defs>

        <circle cx="64" cy="64" r="64" fill="url(#avatarRed)" />
        <circle cx="64" cy="50" r="20" fill="#ffffff" />
        <path d="M32 104c0-18 16-28 32-28s32 10 32 28" fill="#ffffff" />
      </svg>
    </div>
  );
}