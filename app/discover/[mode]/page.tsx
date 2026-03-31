import { redirect } from "next/navigation";

type DiscoverMode = "dancers" | "travelers" | "hosts" | "events";

type PageProps = {
  params: Promise<{ mode: string }>;
};

const MODE_ROUTES: Record<DiscoverMode, string> = {
  dancers: "/connections?mode=dancers",
  travelers: "/connections?mode=travelers",
  hosts: "/connections?mode=hosts",
  events: "/events",
};

export default async function DiscoverModePage({ params }: PageProps) {
  const resolved = await params;
  const mode = resolved.mode.toLowerCase() as DiscoverMode;
  redirect(MODE_ROUTES[mode] ?? "/discover/dancers");
}

