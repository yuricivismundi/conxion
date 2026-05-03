"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import CreateEventModal from "@/components/events/CreateEventModal";

function CreateEventModalEntry() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedType = searchParams.get("type");
  const editEventId = searchParams.get("edit");
  const returnTo = searchParams.get("returnTo");
  const closeTarget = returnTo || (editEventId ? "/events/my" : "/events");

  useEffect(() => {
    if (!editEventId && requestedType === "private_group") {
      router.replace("/groups/new");
    }
  }, [editEventId, requestedType, router]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />
      <main className="mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1320px] items-start justify-center px-4 py-6 sm:px-6 lg:px-8">
        <CreateEventModal
          eventId={editEventId ?? undefined}
          onClose={() => router.push(closeTarget)}
          onPublished={(eventId) => {
            router.push(`/events/${encodeURIComponent(eventId)}`);
          }}
          onSaved={() => {
            router.push(closeTarget);
          }}
        />
      </main>
    </div>
  );
}

export default function CreateEventPage() {
  return (
    <Suspense>
      <CreateEventModalEntry />
    </Suspense>
  );
}
