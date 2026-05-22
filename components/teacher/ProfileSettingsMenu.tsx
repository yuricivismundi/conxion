"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Props = {
  profileUserId: string;
  teacherProfileEnabled?: boolean;
};

export default function ProfileSettingsMenu({ profileUserId, teacherProfileEnabled = false }: Props) {
  const [isSelf, setIsSelf] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return;
      const userId = data.user?.id ?? null;
      if (userId !== profileUserId) return;
      setIsSelf(true);
      try {
        const { data: admin, error: adminErr } = await supabase
          .from("admins")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (!cancelled) setIsAdmin(Boolean(admin) && !adminErr);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profileUserId]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("[profile-settings-menu] Sign out failed:", err);
    }
    window.location.href = "/";
  }

  if (!isSelf) return null;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Profile settings"
        className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-full border border-white/15 bg-white/[0.04] text-white/70 transition hover:bg-white/[0.08] hover:border-white/25 hover:text-white text-[10px] font-medium uppercase tracking-wider"
      >
        <span className="material-symbols-outlined text-[13px]">settings</span>
        <span>Settings</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-40 w-52 rounded-2xl border border-white/10 bg-[#121414] p-1 text-sm shadow-[0_20px_45px_rgba(0,0,0,0.45)]"
        >
          <Link
            href="/me/edit"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
            onClick={() => setOpen(false)}
          >
            Profile settings
          </Link>
          {teacherProfileEnabled ? (
            <Link
              href="/me/edit/teacher-profile"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
              onClick={() => setOpen(false)}
            >
              Teacher profile settings
            </Link>
          ) : null}
          <Link
            href="/account-settings"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
            onClick={() => setOpen(false)}
          >
            Account settings
          </Link>
          <Link
            href="/pricing"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
            onClick={() => setOpen(false)}
          >
            Upgrade your plan
          </Link>
          <Link
            href="/notifications"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
            onClick={() => setOpen(false)}
          >
            Notifications
          </Link>
          {isAdmin ? (
            <Link
              href="/admin/space"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5 hover:text-white"
              onClick={() => setOpen(false)}
            >
              Admin Console
            </Link>
          ) : null}
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-white/70 hover:bg-white/5 hover:text-white"
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
