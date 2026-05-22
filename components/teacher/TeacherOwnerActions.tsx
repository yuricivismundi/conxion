"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Props = {
  profileUserId: string;
  socialProfileHref: string;
  size?: "default" | "compact";
};

export default function TeacherOwnerActions({ profileUserId, socialProfileHref, size = "default" }: Props) {
  const [isSelf, setIsSelf] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id === profileUserId) setIsSelf(true);
    });
  }, [profileUserId]);

  if (!isSelf) return null;

  const isCompact = size === "compact";

  return (
    <Link
      href={socialProfileHref}
      title="Switch to social profile"
      className={
        isCompact
          ? "inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full border border-[#5DD8D8]/25 bg-[#5DD8D8]/[0.05] text-[#5DD8D8]/80 transition hover:bg-[#5DD8D8]/[0.1] hover:border-[#5DD8D8]/40 hover:text-[#5DD8D8] text-[10px] font-medium uppercase tracking-wider"
          : "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border border-[#5DD8D8]/40 bg-[#5DD8D8]/[0.08] text-[#5DD8D8] transition hover:bg-[#5DD8D8]/[0.15] hover:border-[#5DD8D8]/60 text-xs font-semibold uppercase tracking-widest"
      }
    >
      <span className={isCompact ? "material-symbols-outlined text-[13px]" : "material-symbols-outlined text-[18px]"}>swap_horiz</span>
      <span>Switch Profile</span>
    </Link>
  );
}
