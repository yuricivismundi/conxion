import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { readPublicAppUrl } from "@/lib/public-app-url";

type Props = { params: Promise<{ id: string }>; children: React.ReactNode };

async function fetchProfileMeta(id: string) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const client = createClient(url, key);
    const { data } = await client
      .from("profiles")
      .select("display_name, bio, avatar_url, city, country")
      .eq("user_id", id)
      .maybeSingle();
    return data as { display_name?: string; bio?: string; avatar_url?: string; city?: string; country?: string } | null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const profile = await fetchProfileMeta(id);
  const appUrl = readPublicAppUrl();

  if (!profile?.display_name) return { title: "Profile — ConXion" };

  const name = profile.display_name;
  const location = [profile.city, profile.country].filter(Boolean).join(", ");
  const description = profile.bio
    ? profile.bio.slice(0, 160)
    : location
      ? `${name} · ${location} on ConXion`
      : `${name} on ConXion`;

  const images = profile.avatar_url
    ? [{ url: profile.avatar_url, width: 400, height: 400, alt: name }]
    : [];

  return {
    title: `${name} — ConXion`,
    description,
    alternates: { canonical: `${appUrl}/profile/${id}` },
    openGraph: {
      title: `${name} — ConXion`,
      description,
      images,
      type: "profile",
    },
    twitter: {
      card: images.length ? "summary" : "summary",
      title: `${name} — ConXion`,
      description,
      images: images.map((i) => i.url),
    },
  };
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
