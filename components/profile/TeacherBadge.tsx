"use client";

import Link from "next/link";

type TeacherBadgeProps = {
  className?: string;
  /** Optional link. On profiles the badge is a tag only; the Dance Page button sits separately. */
  href?: string;
  /** Text to show: the Dance Page label (Teacher, Artist, DJ…) or the role. Defaults to "Teacher". */
  label?: string;
};

export default function TeacherBadge({ className = "", href, label = "Teacher" }: TeacherBadgeProps) {
  const sizeClass =
    label.length > 10
      ? "text-[20px] sm:text-[32px] lg:text-[42px]"
      : "text-[28px] sm:text-[44px] lg:text-[58px]";
  const textClass = `absolute right-0 top-1/2 -translate-y-1/2 select-none whitespace-nowrap bg-gradient-to-r from-[#00F5FF] via-[#58E9FF] to-[#FF00FF] bg-clip-text ${sizeClass} font-black uppercase leading-none tracking-[-0.09em] text-transparent`;

  return (
    <div
      className={[
        "relative flex min-h-[56px] items-start justify-end overflow-visible",
        href ? "" : "pointer-events-none",
        className,
      ].join(" ")}
      aria-label={label}
    >
      {href ? (
        <Link
          href={href}
          className={[textClass, "opacity-[0.18] transition-opacity hover:opacity-40"].join(" ")}
          aria-label={`View ${label} page`}
        >
          {label}
        </Link>
      ) : (
        <span aria-hidden className={[textClass, "opacity-[0.12]"].join(" ")}>
          {label}
        </span>
      )}
    </div>
  );
}
