import { redirect } from "next/navigation";

type EventPublishedPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pickFirst(value: string | string[] | undefined) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

export default async function EventPublishedPage({ searchParams }: EventPublishedPageProps) {
  const resolved = searchParams ? await searchParams : {};
  const eventId = pickFirst(resolved.event).trim();

  if (eventId) {
    redirect(`/events/${encodeURIComponent(eventId)}`);
  }

  redirect("/events");
}
