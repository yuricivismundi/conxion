import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import DancePage, { generateMetadata as generateDancePageMetadata } from "@/app/profile/[id]/teacher/page";
import { normalizeProfileUsernameInput } from "@/lib/profile-username";

// Pretty, shareable Dance Page URL: /u/<username>/dance
// (same page as /profile/<id>/teacher, which keeps working for old links).

type Params = { username: string };

async function resolveUserId(rawUsername: string): Promise<string | null> {
  const username = normalizeProfileUsernameInput(decodeURIComponent(rawUsername));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!username || !url || !anon) return null;
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await client.from("profiles").select("user_id").eq("username", username).maybeSingle();
  return typeof data?.user_id === "string" ? data.user_id : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { username } = await params;
  const userId = await resolveUserId(username);
  if (!userId) return { title: "Dance Page — ConXion" };
  return generateDancePageMetadata({ params: Promise.resolve({ id: userId }) });
}

export default async function DancePageByUsername({ params }: { params: Promise<Params> }) {
  const { username } = await params;
  const userId = await resolveUserId(username);
  if (!userId) notFound();
  return <DancePage params={Promise.resolve({ id: userId })} />;
}
