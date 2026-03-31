"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import PaginationControls from "@/components/PaginationControls";
import { FALLBACK_GRADIENT, getTripHeroFallbackUrl, getTripHeroStorageFolderUrl, getTripHeroStorageUrl } from "@/lib/city-hero-images";
import {
  getCachedCitiesOfCountry,
  getCachedCountriesAll,
  getCitiesOfCountry,
  getCountriesAll,
  type CountryEntry,
} from "@/lib/country-city-client";
import { supabase } from "@/lib/supabase/client";

type TripRow = {
  id?: string;
  destination_city?: string | null;
  destination_country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  purpose?: string | null;
  status?: string | null;
  note?: string | null;
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
  note: string;
  createdAt: string | null;
};

type TripFormState = {
  destinationCity: string;
  destinationCountry: string;
  startDate: string;
  endDate: string;
  purpose: string;
  note: string;
};

const DEFAULT_TRIP_PURPOSES = ["Holiday Trip", "Dance Festival", "Social Dancing", "Training / Workshops"] as const;
const TRIPS_PAGE_SIZE = 25;

const EMPTY_TRIP_FORM: TripFormState = {
  destinationCity: "",
  destinationCountry: "",
  startDate: "",
  endDate: "",
  purpose: "Dance Festival",
  note: "",
};

function formatDateCompact(value: string | null | undefined) {
  if (!value) return "TBD";
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
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
        note: row.note ?? "",
        createdAt: row.created_at ?? null,
      } satisfies TripItem;
    })
    .filter((trip): trip is TripItem => Boolean(trip))
    .sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
}

function isCompatColumnError(message: string) {
  const text = message.toLowerCase();
  return text.includes("column") || text.includes("schema cache") || text.includes("note");
}

function trimForm(form: TripFormState): TripFormState {
  return {
    destinationCity: form.destinationCity.trim(),
    destinationCountry: form.destinationCountry.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    purpose: form.purpose.trim() || "Trip",
    note: form.note.trim(),
  };
}

export default function TripsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [activeTripsPage, setActiveTripsPage] = useState(1);
  const [pastTripsPage, setPastTripsPage] = useState(1);
  const [tripForm, setTripForm] = useState<TripFormState>(EMPTY_TRIP_FORM);
  const [countriesAll, setCountriesAll] = useState<CountryEntry[]>(() => getCachedCountriesAll());
  const [citiesByCountryIso, setCitiesByCountryIso] = useState<Record<string, string[]>>({});

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      router.replace("/auth");
      return;
    }

    setUserId(authData.user.id);

    const buildQuery = (columns: string) =>
      supabase
        .from("trips")
        .select(columns)
        .eq("user_id", authData.user.id)
        .order("start_date", { ascending: true })
        .limit(200);

    let result = await buildQuery("id,destination_city,destination_country,start_date,end_date,purpose,status,note,created_at");
    if (result.error && isCompatColumnError(result.error.message)) {
      result = await buildQuery("id,destination_city,destination_country,start_date,end_date,purpose,status,created_at");
    }

    if (result.error) {
      setError(result.error.message);
      setTrips([]);
      setActiveTripsPage(1);
      setPastTripsPage(1);
      setLoading(false);
      return;
    }

    setTrips(mapTripRows((result.data ?? []) as TripRow[]));
    setActiveTripsPage(1);
    setPastTripsPage(1);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await loadTrips();
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [loadTrips]);

  const activeTrips = useMemo(() => trips.filter((trip) => trip.status === "active"), [trips]);
  const pastTrips = useMemo(() => trips.filter((trip) => trip.status !== "active"), [trips]);
  const totalActiveTripsPages = useMemo(() => Math.max(1, Math.ceil(activeTrips.length / TRIPS_PAGE_SIZE)), [activeTrips.length]);
  const totalPastTripsPages = useMemo(() => Math.max(1, Math.ceil(pastTrips.length / TRIPS_PAGE_SIZE)), [pastTrips.length]);
  const currentActiveTripsPage = Math.min(activeTripsPage, totalActiveTripsPages);
  const currentPastTripsPage = Math.min(pastTripsPage, totalPastTripsPages);
  const paginatedActiveTrips = useMemo(
    () => activeTrips.slice((currentActiveTripsPage - 1) * TRIPS_PAGE_SIZE, currentActiveTripsPage * TRIPS_PAGE_SIZE),
    [activeTrips, currentActiveTripsPage]
  );
  const paginatedPastTrips = useMemo(
    () => pastTrips.slice((currentPastTripsPage - 1) * TRIPS_PAGE_SIZE, currentPastTripsPage * TRIPS_PAGE_SIZE),
    [currentPastTripsPage, pastTrips]
  );
  const canCreate = activeTrips.length < 5;
  const selectedCountryIso = useMemo(
    () => countriesAll.find((country) => country.name === tripForm.destinationCountry)?.isoCode ?? "",
    [countriesAll, tripForm.destinationCountry]
  );
  const availableCities = useMemo(() => {
    if (!selectedCountryIso) return [];
    return citiesByCountryIso[selectedCountryIso] ?? getCachedCitiesOfCountry(selectedCountryIso);
  }, [citiesByCountryIso, selectedCountryIso]);
  const customTripPurposes = useMemo(
    () => trips.map((trip) => trip.purpose).filter((value): value is string => Boolean(value && value !== "Trip")),
    [trips]
  );
  const tripPurposeOptions = useMemo(
    () => Array.from(new Set([...DEFAULT_TRIP_PURPOSES, ...customTripPurposes])),
    [customTripPurposes]
  );

  useEffect(() => {
    let cancelled = false;

    if (countriesAll.length > 0) {
      return () => {
        cancelled = true;
      };
    }

    void getCountriesAll()
      .then((countries) => {
        if (cancelled) return;
        setCountriesAll(countries);
      })
      .catch(() => {
        if (cancelled) return;
        setCountriesAll([]);
      });

    return () => {
      cancelled = true;
    };
  }, [countriesAll.length]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedCountryIso) {
      return () => {
        cancelled = true;
      };
    }

    if (citiesByCountryIso[selectedCountryIso]?.length) {
      return () => {
        cancelled = true;
      };
    }

    const cachedCities = getCachedCitiesOfCountry(selectedCountryIso);
    if (cachedCities.length > 0) {
      return () => {
        cancelled = true;
      };
    }

    void getCitiesOfCountry(selectedCountryIso)
      .then((cities) => {
        if (cancelled) return;
        setCitiesByCountryIso((prev) => ({ ...prev, [selectedCountryIso]: cities }));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [citiesByCountryIso, selectedCountryIso]);

  function openCreateModal(prefill?: Partial<TripFormState>) {
    setTripForm({
      destinationCity: prefill?.destinationCity ?? "",
      destinationCountry: prefill?.destinationCountry ?? "",
      startDate: prefill?.startDate ?? "",
      endDate: prefill?.endDate ?? "",
      purpose: prefill?.purpose ?? DEFAULT_TRIP_PURPOSES[1],
      note: prefill?.note ?? "",
    });
    setCreateError(null);
    setCreateOpen(true);
  }

  async function createTrip() {
    const cleaned = trimForm(tripForm);
    if (!userId) {
      setCreateError("You need to be signed in to create a trip.");
      return;
    }
    if (!canCreate) {
      setCreateError("You already have the maximum of 5 active trips.");
      return;
    }
    if (!cleaned.destinationCity || !cleaned.destinationCountry) {
      setCreateError("Destination city and country are required.");
      return;
    }
    if (!cleaned.startDate || !cleaned.endDate) {
      setCreateError("Arrival and departure dates are required.");
      return;
    }
    if (cleaned.endDate < cleaned.startDate) {
      setCreateError("Departure date must be after arrival date.");
      return;
    }

    setCreateBusy(true);
    setCreateError(null);

    const payload = {
      user_id: userId,
      destination_city: cleaned.destinationCity,
      destination_country: cleaned.destinationCountry,
      start_date: cleaned.startDate,
      end_date: cleaned.endDate,
      purpose: cleaned.purpose,
      status: "active",
      note: cleaned.note || null,
    };

    let insertRes = await supabase.from("trips").insert(payload).select("id").maybeSingle();
    if (insertRes.error && isCompatColumnError(insertRes.error.message)) {
      insertRes = await supabase
        .from("trips")
        .insert({
          user_id: userId,
          destination_city: cleaned.destinationCity,
          destination_country: cleaned.destinationCountry,
          start_date: cleaned.startDate,
          end_date: cleaned.endDate,
          purpose: cleaned.purpose,
          status: "active",
        })
        .select("id")
        .maybeSingle();
    }

    if (insertRes.error) {
      setCreateError(insertRes.error.message);
      setCreateBusy(false);
      return;
    }

    setCreateBusy(false);
    setCreateOpen(false);
    setTripForm(EMPTY_TRIP_FORM);
    await loadTrips();
  }

  async function deleteTrip(trip: TripItem) {
    if (!userId) return;
    if (!window.confirm(`Delete trip to ${trip.destinationCity || trip.destinationCountry || "this destination"}?`)) return;

    setDeleteBusyId(trip.id);
    setError(null);

    const result = await supabase.from("trips").delete().eq("id", trip.id).eq("user_id", userId);
    if (result.error) {
      setError(result.error.message);
      setDeleteBusyId(null);
      return;
    }

    setDeleteBusyId(null);
    await loadTrips();
  }

  const TripCard = ({ trip, archived = false }: { trip: TripItem; archived?: boolean }) => {
    const heroUrl = getTripHeroStorageUrl(trip.destinationCountry);
    const heroStorageFallback = getTripHeroStorageFolderUrl(trip.destinationCountry);
    const heroFallback = getTripHeroFallbackUrl(trip.destinationCity, trip.destinationCountry);
    const deleteBusy = deleteBusyId === trip.id;

    return (
      <article
        className={[
          "connections-card overflow-hidden rounded-[28px] border border-white/10 bg-[#101617] transition-all duration-200",
          archived ? "opacity-80" : "hover:-translate-y-0.5 hover:border-[#00F5FF]/18 hover:shadow-[0_12px_36px_rgba(0,245,255,0.06)]",
        ].join(" ")}
      >
        <div className="p-3">
          <div className="relative min-h-[152px] overflow-hidden rounded-[22px]">
            <div className="absolute inset-0" style={{ backgroundImage: FALLBACK_GRADIENT }} />
            {(heroUrl || heroStorageFallback || heroFallback) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroUrl || heroStorageFallback || heroFallback}
                alt={`${trip.destinationCity || "Trip"} hero`}
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
                crossOrigin="anonymous"
                data-fallback-storage={heroStorageFallback || ""}
                data-fallback={heroFallback || ""}
                onError={(event) => {
                  const target = event.currentTarget;
                  const fallbackStorage = target.dataset.fallbackStorage;
                  const fallback = target.dataset.fallback;
                  if (fallbackStorage && target.src !== fallbackStorage) {
                    target.src = fallbackStorage;
                    return;
                  }
                  if (fallback && target.src !== fallback) {
                    target.src = fallback;
                  }
                }}
              />
            ) : null}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,8,10,0.12),rgba(3,8,10,0.72)_60%,rgba(3,8,10,0.88))]" />
            <div className="absolute inset-x-3 top-3 flex justify-end">
              <div className="rounded-full border border-[#00F5FF]/22 bg-[#00F5FF]/12 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#b8fbff] backdrop-blur">
                {trip.purpose || "Trip"}
              </div>
            </div>
            <div className="absolute inset-x-4 top-[56%] -translate-y-1/2 text-center">
              <div className="mx-auto max-w-[70%] text-[28px] font-extrabold tracking-tight text-[#9ef7ff] drop-shadow-[0_0_12px_rgba(0,245,255,0.26)]">
                {trip.destinationCity || "Destination"}
              </div>
              {trip.destinationCountry ? (
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.24em] text-white/72">
                  {trip.destinationCountry}
                </div>
              ) : null}
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/55 px-3 py-1.5 backdrop-blur">
                <span className="material-symbols-outlined text-[13px] text-[#00F5FF]">calendar_month</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/90">
                  {formatDateCompact(trip.startDate)} - {formatDateCompact(trip.endDate)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3 px-1 pb-1 pt-3">
            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">Description</div>
              <p className="text-sm leading-6 text-white/72">
                {trip.note || "No trip description yet."}
              </p>
            </div>

            <div className="mt-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  openCreateModal({
                    destinationCity: trip.destinationCity,
                    destinationCountry: trip.destinationCountry,
                    startDate: trip.startDate,
                    endDate: trip.endDate,
                    purpose: trip.purpose,
                    note: trip.note,
                  })
                }
                className="min-h-[38px] rounded-full border border-white/14 bg-white/[0.04] px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80 transition hover:border-white/24 hover:bg-white/[0.08] hover:text-white"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => void deleteTrip(trip)}
                disabled={deleteBusy}
                className="min-h-[38px] rounded-full border border-[#ff7b7b]/20 bg-[#ff7b7b]/8 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ffb3b3] transition hover:border-[#ff7b7b]/35 hover:bg-[#ff7b7b]/12 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteBusy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] font-sans text-white">
      <Nav />

      <main className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
        {error ? (
          <div className="mb-4 rounded-xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        {loading ? (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <div className="h-6 w-28 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-20 animate-pulse rounded bg-white/10" />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="h-10 w-full animate-pulse rounded-full border border-white/10 bg-white/5 sm:w-36" />
                <div className="h-10 w-full animate-pulse rounded-full bg-[#00F5FF]/80 sm:w-32" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={`trip-sk-${index}`} className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]">
                  <div className="h-40 animate-pulse bg-white/5" />
                  <div className="space-y-3 p-5">
                    <div className="h-5 w-3/4 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <section className="space-y-8">
            <div>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-white">Active Trips</h2>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/65">
                    {activeTrips.length} live
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                  <button
                    type="button"
                    onClick={() => openCreateModal()}
                    disabled={!canCreate}
                    className="inline-flex min-h-[38px] items-center justify-center rounded-full px-4 text-xs font-black uppercase tracking-[0.12em] text-[#0A0A0A] transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
                    style={canCreate ? { backgroundImage: "linear-gradient(90deg,#00F5FF 0%, #FF00FF 100%)" } : undefined}
                    title={canCreate ? "Create trip" : "You reached the max 5 active trips limit"}
                  >
                    Create Trip
                  </button>
                </div>
              </div>
              {activeTrips.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-7">
                  <p className="text-base font-semibold text-white">No active trips yet.</p>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">
                    Create a trip and keep the destination, dates, purpose, and description directly visible from here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {paginatedActiveTrips.map((trip) => (
                    <TripCard key={trip.id} trip={trip} />
                  ))}
                </div>
              )}
              {activeTrips.length ? (
                <PaginationControls
                  page={currentActiveTripsPage}
                  totalPages={totalActiveTripsPages}
                  totalItems={activeTrips.length}
                  pageSize={TRIPS_PAGE_SIZE}
                  itemLabel="trips"
                  onPageChange={(page) => setActiveTripsPage(Math.max(1, Math.min(page, totalActiveTripsPages)))}
                  className="pt-1"
                />
              ) : null}
            </div>

            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-white">Past Trips</h2>
                <p className="text-xs uppercase tracking-[0.14em] text-white/45">{pastTrips.length} archived</p>
              </div>
              {pastTrips.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6 text-sm text-white/60">
                  No archived trips yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {paginatedPastTrips.map((trip) => (
                    <TripCard key={trip.id} trip={trip} archived />
                  ))}
                </div>
              )}
              {pastTrips.length ? (
                <PaginationControls
                  page={currentPastTripsPage}
                  totalPages={totalPastTripsPages}
                  totalItems={pastTrips.length}
                  pageSize={TRIPS_PAGE_SIZE}
                  itemLabel="archived trips"
                  onPageChange={(page) => setPastTripsPage(Math.max(1, Math.min(page, totalPastTripsPages)))}
                  className="pt-1"
                />
              ) : null}
            </div>
          </section>
        )}
      </main>

      {createOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/78 px-0 py-0 backdrop-blur-md sm:items-center sm:px-4 sm:py-6">
          <div className="relative flex max-h-[92dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-t-[30px] border border-[#00F5FF]/16 bg-[#0e1417] text-white shadow-[0_28px_100px_rgba(0,0,0,0.55)] sm:rounded-[30px]">
            <button
              type="button"
              onClick={() => {
                setCreateOpen(false);
                setCreateError(null);
              }}
              className="absolute right-4 top-4 z-20 rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/55 transition hover:border-white/20 hover:text-white"
              aria-label="Close create trip modal"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            <div className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(0,245,255,0.12),rgba(255,0,255,0.08)_55%,rgba(255,255,255,0.03))] px-5 pb-5 pt-5 sm:px-6">
              <div className="flex items-start justify-between gap-4 pr-10">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#00F5FF]">Trips</p>
                  <h2 className="mt-2 text-[28px] font-black tracking-tight text-white">Create Trip</h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-white/68">
                    Compact publish flow with the same trip-purpose values already used in traveller discovery.
                  </p>
                </div>
                <div className="hidden rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-right sm:block">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">Active</div>
                  <div className="mt-1 text-2xl font-black text-white">{activeTrips.length}/5</div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              {createError ? (
                <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{createError}</div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.16em] text-white/55">Destination Country *</span>
                  <div className="relative">
                    <select
                      value={tripForm.destinationCountry}
                      onChange={(event) =>
                        setTripForm((prev) => ({
                          ...prev,
                          destinationCountry: event.target.value,
                          destinationCity: "",
                        }))
                      }
                      className="w-full appearance-none rounded-2xl border border-white/10 bg-[#0b1012] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/45 focus:ring-2 focus:ring-[#00F5FF]/12"
                    >
                      <option value="">Select country</option>
                      {countriesAll.map((country) => (
                        <option key={country.isoCode} value={country.name}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-white/35">
                      expand_more
                    </span>
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.16em] text-white/55">Destination City *</span>
                  <div className="relative">
                    <select
                      value={tripForm.destinationCity}
                      onChange={(event) => setTripForm((prev) => ({ ...prev, destinationCity: event.target.value }))}
                      disabled={!tripForm.destinationCountry}
                      className="w-full appearance-none rounded-2xl border border-white/10 bg-[#0b1012] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/45 focus:ring-2 focus:ring-[#00F5FF]/12 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">{tripForm.destinationCountry ? "Select city" : "Select country first"}</option>
                      {availableCities.map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-white/35">
                      expand_more
                    </span>
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.16em] text-white/55">Arrival Date *</span>
                  <input
                    type="date"
                    value={tripForm.startDate}
                    onChange={(event) => setTripForm((prev) => ({ ...prev, startDate: event.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-[#0b1012] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/45 focus:ring-2 focus:ring-[#00F5FF]/12"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.16em] text-white/55">Departure Date *</span>
                  <input
                    type="date"
                    value={tripForm.endDate}
                    onChange={(event) => setTripForm((prev) => ({ ...prev, endDate: event.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-[#0b1012] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/45 focus:ring-2 focus:ring-[#00F5FF]/12"
                  />
                </label>
              </div>

              <div className="mt-4">
                <label className="block">
                  <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.16em] text-white/55">Purpose *</span>
                  <select
                    value={tripForm.purpose}
                    onChange={(event) => setTripForm((prev) => ({ ...prev, purpose: event.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-[#0b1012] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/45 focus:ring-2 focus:ring-[#00F5FF]/12"
                  >
                    {tripPurposeOptions.map((purpose) => (
                      <option key={purpose} value={purpose}>
                        {purpose}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4">
                <label className="block">
                  <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.16em] text-white/55">Description</span>
                  <textarea
                    value={tripForm.note}
                    onChange={(event) => setTripForm((prev) => ({ ...prev, note: event.target.value }))}
                    rows={4}
                    maxLength={600}
                    placeholder="Add what this trip is for and what kind of coordination is useful."
                    className="w-full rounded-2xl border border-white/10 bg-[#0b1012] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#00F5FF]/45 focus:ring-2 focus:ring-[#00F5FF]/12"
                  />
                  <div className="mt-2 text-right text-[11px] text-white/40">{tripForm.note.length}/600</div>
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-white/10 bg-black/18 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  setCreateError(null);
                }}
                className="min-h-[44px] rounded-2xl border border-white/12 bg-white/[0.04] px-5 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createTrip}
                disabled={createBusy || !canCreate}
                className="min-h-[44px] rounded-2xl px-6 text-sm font-black uppercase tracking-[0.12em] text-[#0A0A0A] transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
                style={createBusy || !canCreate ? undefined : { backgroundImage: "linear-gradient(90deg,#00F5FF 0%, #FF00FF 100%)" }}
              >
                {createBusy ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
