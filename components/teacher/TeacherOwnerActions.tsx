"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Props = {
  profileUserId: string;
  socialProfileHref: string;
};

export default function TeacherOwnerActions({ profileUserId, socialProfileHref }: Props) {
  const [isSelf, setIsSelf] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id === profileUserId) setIsSelf(true);
    });
  }, [profileUserId]);

  if (!isSelf) return null;

  return (
    <Link
      href={socialProfileHref}
      title="Switch to social profile"
      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border border-[#0df2f2]/40 bg-[#0df2f2]/[0.08] text-[#0df2f2] transition hover:bg-[#0df2f2]/[0.15] hover:border-[#0df2f2]/60 text-xs font-semibold uppercase tracking-widest"
    >
      <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
      <span>Switch Profile</span>
    </Link>
  );
}
