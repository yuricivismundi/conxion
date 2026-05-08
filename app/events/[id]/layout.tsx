import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";

type Props = { params: Promise<{ id: string }>; children: React.ReactNode };

async function fetchEventMeta(id: string) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const client = createClient(url, key);
    const { data } = await client
      .from("events")
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
  const event = await fetchEventMeta(id);
  if (!event) return { title: "Event — ConXion" };

  const location = [event.city, event.country].filter(Boolean).join(", ");
  const description = event.description
    ? event.description.slice(0, 160)
    : location
      ? `${event.title} in ${location}`
      : event.title;

  const images = event.cover_url ? [{ url: event.cover_url, width: 1200, height: 630, alt: event.title }] : [];

  return {
    title: `${event.title} — ConXion`,
    description,
    openGraph: {
      title: event.title,
      description,
      images,
      type: "website",
    },
    twitter: {
      card: images.length ? "summary_large_image" : "summary",
      title: event.title,
      description,
      images: images.map((i) => i.url),
    },
  };
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
