"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import CreateEventModal from "@/components/events/CreateEventModal";

function CreateEventModalEntry() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedType = searchParams.get("type");

  useEffect(() => {
    if (requestedType === "private_group") {
      router.replace("/groups/new");
    }
  }, [requestedType, router]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />
      <main className="mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1320px] items-start justify-center px-4 py-6 sm:px-6 lg:px-8">
        <CreateEventModal
          onClose={() => router.push("/events")}
          onPublished={(eventId) => {
            router.push(`/events/${encodeURIComponent(eventId)}`);
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
