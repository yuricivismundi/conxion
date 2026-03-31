"use client";

type TeacherBadgeProps = {
  className?: string;
};

export default function TeacherBadge({ className = "" }: TeacherBadgeProps) {
  return (
    <div
      className={[
        "pointer-events-none relative flex min-h-[56px] items-start justify-end overflow-visible",
        className,
      ].join(" ")}
      aria-label="Teacher"
    >
      <span
        aria-hidden
        className="absolute right-0 top-1/2 -translate-y-1/2 select-none bg-gradient-to-r from-[#00F5FF] via-[#58E9FF] to-[#FF00FF] bg-clip-text text-[28px] font-black uppercase leading-none tracking-[-0.09em] text-transparent opacity-[0.12] sm:text-[44px] lg:text-[58px]"
      >
        Teacher
      </span>
    </div>
  );
}
