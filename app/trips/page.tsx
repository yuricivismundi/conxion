"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

type TripRow = {
  id?: string;
  destination_city?: string | null;
  destination_country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  purpose?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type TripItem = {
  id: string;
  destinationCity: string;
  destinationCountry: string;
  startDate: string;
  endDate: string;
  purpose: string;
  status: string;
  createdAt: string | null;
};

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function mapTripRows(rows: TripRow[]): TripItem[] {
  return rows
    .map((row) => {
      const id = row.id ?? "";
      if (!id) return null;
      return {
        id,
        destinationCity: row.destination_city ?? "",
        destinationCountry: row.destination_country ?? "",
        startDate: row.start_date ?? "",
        endDate: row.end_date ?? "",
        purpose: row.purpose ?? "Trip",
        status: row.status ?? "active",
        createdAt: row.created_at ?? null,
      } satisfies TripItem;
    })
    .filter((trip): trip is TripItem => Boolean(trip))
    .sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
}

export default function TripsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        router.replace("/auth");
        return;
      }

      const result = await supabase
        .from("trips")
        .select("id,destination_city,destination_country,start_date,end_date,purpose,status,created_at")
        .eq("user_id", authData.user.id)
        .order("start_date", { ascending: true })
        .limit(200);

      if (result.error) {
        if (!cancelled) {
          setError(result.error.message);
          setTrips([]);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setTrips(mapTripRows((result.data ?? []) as TripRow[]));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const activeTrips = useMemo(() => trips.filter((trip) => trip.status === "active"), [trips]);
  const pastTrips = useMemo(() => trips.filter((trip) => trip.status !== "active"), [trips]);
  const canCreate = activeTrips.length < 5;

  return (
    <div
      className={`${plusJakarta.className} min-h-screen bg-[radial-gradient(circle_at_top,_#10272b,_#071316_45%,_#05090b_100%)] text-white`}
    >
      <Nav />

      <main className="mx-auto w-full max-w-[1220px] px-4 pb-14 pt-7 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-black text-white">My Trips</h1>
            <p className="mt-1 text-sm text-slate-300">Manage your active travel plans and incoming requests.</p>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
              Active: {activeTrips.length}/5
            </span>
            <Link
              href="/connections?tab=travellers"
              className={[
                "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                canCreate
                  ? "bg-cyan-300 text-[#052328] hover:bg-cyan-200"
                  : "bg-white/10 text-slate-400 pointer-events-none cursor-not-allowed",
              ].join(" ")}
              aria-disabled={!canCreate}
              title={canCreate ? "Create trip" : "You reached the max 5 active trips limit"}
            >
              Create Trip
            </Link>
          </div>
        </header>

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        {loading ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">Loading trips...</div>
        ) : null}

        {!loading ? (
          <section className="space-y-8">
            <div>
              <h2 className="mb-3 text-lg font-bold text-white">Active Trips</h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {activeTrips.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
                    No active trips yet.
                  </div>
                ) : (
                  activeTrips.map((trip) => (
                    <article key={trip.id} className="rounded-2xl border border-white/10 bg-[#0b1a1d]/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-cyan-200">{trip.purpose}</p>
                      <h3 className="mt-1 text-xl font-bold text-white">
                        {[trip.destinationCity, trip.destinationCountry].filter(Boolean).join(", ")}
                      </h3>
                      <p className="mt-1 text-sm text-slate-300">
                        {formatDate(trip.startDate)} - {formatDate(trip.endDate)}
                      </p>
                      <div className="mt-4 flex gap-2">
                        <Link
                          href={`/trips/${trip.id}`}
                          className="rounded-lg bg-cyan-300 px-3 py-1.5 text-sm font-semibold text-[#052328] hover:bg-cyan-200"
                        >
                          Open
                        </Link>
                        <span className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100">
                          {trip.status}
                        </span>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-bold text-white">Past Trips</h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {pastTrips.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
                    No archived trips yet.
                  </div>
                ) : (
                  pastTrips.map((trip) => (
                    <article key={trip.id} className="rounded-2xl border border-white/10 bg-black/20 p-4 opacity-80">
                      <p className="text-xs uppercase tracking-wide text-slate-400">{trip.purpose}</p>
                      <h3 className="mt-1 text-lg font-bold text-white">
                        {[trip.destinationCity, trip.destinationCountry].filter(Boolean).join(", ")}
                      </h3>
                      <p className="mt-1 text-sm text-slate-400">
                        {formatDate(trip.startDate)} - {formatDate(trip.endDate)}
                      </p>
                      <div className="mt-4">
                        <Link
                          href={`/trips/${trip.id}`}
                          className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5"
                        >
                          View Details
                        </Link>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
