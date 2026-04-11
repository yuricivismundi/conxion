"use client";

import Link from "next/link";

type TeacherBadgeProps = {
  className?: string;
  href?: string;
};

export default function TeacherBadge({ className = "", href }: TeacherBadgeProps) {
  const textClass =
    "absolute right-0 top-1/2 -translate-y-1/2 select-none bg-gradient-to-r from-[#00F5FF] via-[#58E9FF] to-[#FF00FF] bg-clip-text text-[28px] font-black uppercase leading-none tracking-[-0.09em] text-transparent sm:text-[44px] lg:text-[58px]";

  return (
    <div
      className={[
        "relative flex min-h-[56px] items-start justify-end overflow-visible",
        href ? "" : "pointer-events-none",
        className,
      ].join(" ")}
      aria-label="Teacher"
    >
      {href ? (
        <Link
          href={href}
          className={[textClass, "opacity-[0.18] transition-opacity hover:opacity-40"].join(" ")}
          aria-label="View teacher profile"
        >
          Teacher
        </Link>
      ) : (
        <span
          aria-hidden
          className={[textClass, "opacity-[0.12]"].join(" ")}
        >
          Teacher
        </span>
      )}
    </div>
  );
}
