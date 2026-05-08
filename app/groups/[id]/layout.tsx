import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

type Props = { params: Promise<{ id: string }>; children: React.ReactNode };

async function fetchGroupMeta(id: string) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const client = createClient(url, key);
    const { data } = await client
      .from("groups")
      .select("title, description, cover_url, city, country")
      .eq("id", id)
      .maybeSingle();
    return data as { title: string; description?: string; cover_url?: string; city?: string; country?: string } | null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const group = await fetchGroupMeta(id);
  if (!group) return { title: "Group — ConXion" };

  const location = [group.city, group.country].filter(Boolean).join(", ");
  const description = group.description
    ? group.description.slice(0, 160)
    : location
      ? `${group.title} in ${location}`
      : group.title;

  const images = group.cover_url ? [{ url: group.cover_url, width: 1200, height: 630, alt: group.title }] : [];

  return {
    title: `${group.title} — ConXion`,
    description,
    openGraph: {
      title: group.title,
      description,
      images,
      type: "website",
    },
    twitter: {
      card: images.length ? "summary_large_image" : "summary",
      title: group.title,
      description,
      images: images.map((i) => i.url),
    },
  };
}

export default function GroupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
