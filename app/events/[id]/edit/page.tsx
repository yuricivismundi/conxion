"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DismissibleBanner } from "@/components/DismissibleBanner";
import { useParams, useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import EventCoverCropDialog from "@/components/events/EventCoverCropDialog";
import {
  getCachedCitiesOfCountry,
  getCachedCountriesAll,
  getCitiesOfCountry,
  getCountriesAll,
  type CountryEntry,
} from "@/lib/country-city-client";
import { mapEventRows } from "@/lib/events/model";
import { validateEventCoverSourceFile } from "@/lib/events/cover-upload";
import { buildOsmEmbedUrl, type OsmGeocodeResult } from "@/lib/maps/osm";
import { supabase } from "@/lib/supabase/client";

type EventLinkDraft = {
  label: string;
  url: string;
  type: string;
};

const MIN_DESCRIPTION_LENGTH = 32;
const MAX_DESCRIPTION_LENGTH = 1600;
const MAX_TITLE_LENGTH = 96;
const MAX_VENUE_NAME_LENGTH = 120;
const MAX_VENUE_ADDRESS_LENGTH = 180;
const QUICK_DURATION_HOURS = [2, 3, 4, 6];

function fileExtension(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName) return fromName;
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function toIsoOrNull(localDateTime: string) {
  if (!localDateTime) return null;
  const parsed = new Date(localDateTime);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatLocalDateTimeValue(date: Date) {
  const pad = (v: number) => String(v).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function isoToLocalDateTimeValue(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localDatePart(value: string) {
  return value.split("T")[0] ?? "";
}

function localTimePart(value: string) {
  return value.split("T")[1]?.slice(0, 5) ?? "";
}

function mergeLocalDateTime(datePart: string, timePart: string) {
  if (!datePart) return "";
  return `${datePart}T${(timePart || "00:00").slice(0, 5)}`;
}

function shiftLocalDateTimeByHours(value: string, hours: number) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatLocalDateTimeValue(new Date(parsed.getTime() + hours * 60 * 60 * 1000));
}

function resolveCountryEntry(countries: CountryEntry[], value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  return (
    countries.find((entry) => entry.name.trim().toLowerCase() === normalized) ??
    countries.find((entry) => entry.isoCode.trim().toLowerCase() === normalized) ??
    null
  );
}

function exactStreetAddress(result: OsmGeocodeResult) {
  const parts = [result.address.road, result.address.houseNumber].filter(Boolean);
  return parts.join(" ").trim();
}

export default function EditEventPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = typeof params?.id === "string" ? params.id : "";

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [countriesAll, setCountriesAll] = useState<CountryEntry[]>(() => getCachedCountriesAll());
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const countryNames = useMemo(() => countriesAll.map((entry) => entry.name), [countriesAll]);

  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("Social");
  const [stylesInput, setStylesInput] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const selectedCountryEntry = useMemo(() => resolveCountryEntry(countriesAll, country), [countriesAll, country]);
  const selectedCountryIso = selectedCountryEntry?.isoCode ?? "";
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [endsAtLocal, setEndsAtLocal] = useState("");
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null);
  const [statusMode, setStatusMode] = useState<"published" | "draft">("published");
  const [hasCapacity, setHasCapacity] = useState(false);
  const [capacity, setCapacity] = useState<number | "">("");
  const [links, setLinks] = useState<EventLinkDraft[]>([]);
  const [locationResults, setLocationResults] = useState<OsmGeocodeResult[]>([]);
  const [locationSearchBusy, setLocationSearchBusy] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<OsmGeocodeResult | null>(null);
  const [locationSearchFeedback, setLocationSearchFeedback] = useState<string | null>(null);

  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const trimmedDescription = description.trim();
  const descriptionLength = trimmedDescription.length;
  const locationSearchQuery = [venueName, venueAddress, city, country].map((value) => value.trim()).filter(Boolean).join(", ");
  const cityMenuOptions = useMemo(() => cityOptions.slice(0, 500), [cityOptions]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!eventId) {
          router.replace("/events");
          return;
        }

        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr || !authData.user) {
          router.replace("/auth");
          return;
        }

        const userId = authData.user.id;
        setMeId(userId);

        const [{ data: sessionData }, eventRes] = await Promise.all([
          supabase.auth.getSession(),
          supabase.from("events").select("*").eq("id", eventId).maybeSingle(),
        ]);

        if (cancelled) return;

        setAccessToken(sessionData.session?.access_token ?? null);

        if (countriesAll.length === 0) {
          const fetchedCountries = await getCountriesAll();
          if (!cancelled && fetchedCountries.length > 0) setCountriesAll(fetchedCountries);
        }

        if (eventRes.error) {
          setError(eventRes.error.message);
          return;
        }

        const event = mapEventRows(eventRes.data ? [eventRes.data] : [])[0] ?? null;
        if (!event) {
          setError("Event not found.");
          return;
        }

        if (event.hostUserId !== userId) {
          setError("Only the host can edit this event.");
          return;
        }

        setTitle(event.title);
        setDescription(event.description ?? "");
        setEventType(event.eventType);
        setStylesInput(event.styles.join(", "));
        setVisibility(event.visibility);
        setCity(event.city);
        setCountry(event.country);
        setVenueName(event.venueName ?? "");
        setVenueAddress(event.venueAddress ?? "");
        setStartsAtLocal(isoToLocalDateTimeValue(event.startsAt));
        setEndsAtLocal(isoToLocalDateTimeValue(event.endsAt));
        setCoverUrl(event.coverUrl ?? "");
        setStatusMode(event.status === "draft" ? "draft" : "published");
        setHasCapacity(typeof event.capacity === "number");
        setCapacity(typeof event.capacity === "number" ? event.capacity : "");
        setLinks(
          event.links.length
            ? event.links.map((item) => ({ label: item.label, url: item.url, type: item.type }))
            : []
        );
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : "Could not load event editor.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [countriesAll.length, eventId, router]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCountryIso) {
      setCityOptions([]);
      return;
    }

    const cached = getCachedCitiesOfCountry(selectedCountryIso);
    if (cached.length) setCityOptions(cached);

    (async () => {
      const fetched = await getCitiesOfCountry(selectedCountryIso);
      if (!cancelled) {
        setCityOptions(fetched);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCountryIso]);

  useEffect(() => {
    if (!country || countriesAll.length === 0) return;
    const resolved = resolveCountryEntry(countriesAll, country);
    if (resolved && resolved.name !== country) {
      setCountry(resolved.name);
    }
  }, [countriesAll, country]);

  const isValidWindow = useMemo(() => {
    const start = toIsoOrNull(startsAtLocal);
    const end = toIsoOrNull(endsAtLocal);
    return Boolean(start && end && start < end);
  }, [endsAtLocal, startsAtLocal]);

  const canPublish = useMemo(() => {
    return Boolean(
      title.trim() &&
        eventType.trim() &&
        city.trim() &&
        country.trim() &&
        venueName.trim() &&
        startsAtLocal &&
        endsAtLocal &&
        isValidWindow &&
        descriptionLength >= MIN_DESCRIPTION_LENGTH &&
        descriptionLength <= MAX_DESCRIPTION_LENGTH
    );
  }, [city, country, descriptionLength, endsAtLocal, eventType, isValidWindow, startsAtLocal, title, venueName]);

  const canSaveDraft = useMemo(() => {
    return Boolean(title.trim() && city.trim() && country.trim() && startsAtLocal && endsAtLocal && isValidWindow);
  }, [city, country, endsAtLocal, isValidWindow, startsAtLocal, title]);

  function resetLocationSearchState() {
    setLocationResults([]);
    setSelectedLocation(null);
    setLocationSearchFeedback(null);
  }

  async function onPickCover(file: File | null) {
    if (!file) return;
    if (!meId) {
      setError("Missing user session. Please sign in again.");
      return;
    }

    setError(null);
    setInfo(null);
    try {
      validateEventCoverSourceFile(file);
      setPendingCoverFile(file);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Cover upload failed.");
    }
  }

  async function uploadPreparedCover(preparedFile: File) {
    if (!meId) {
      throw new Error("Missing user session. Please sign in again.");
    }

    setError(null);
    setInfo(null);
    setUploadingCover(true);
    try {
      const ext = fileExtension(preparedFile);
      const path = `${meId}/event-cover-${crypto.randomUUID()}.${ext}`;
      const bucket = "avatars";

      const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, preparedFile, { upsert: true });
      if (uploadErr) throw uploadErr;

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      const publicUrl = data.publicUrl;
      if (!publicUrl) throw new Error("Could not resolve cover URL.");

      setCoverUrl(publicUrl);
      setPendingCoverFile(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Cover upload failed.";
      setError(message);
      throw e instanceof Error ? e : new Error(message);
    } finally {
      setUploadingCover(false);
    }
  }

  async function submitEvent(nextStatus: "published" | "draft") {
    if (!eventId) return;
    if (!accessToken) {
      setError("Missing auth session. Please sign in again.");
      return;
    }
    if (uploadingCover) {
      setError("Please wait for cover upload to finish.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setInfo(null);

    const startsAt = toIsoOrNull(startsAtLocal);
    const endsAt = toIsoOrNull(endsAtLocal);
    const requiresFullPublishFields = nextStatus === "published";

    if (!title.trim() || !city.trim() || !country.trim() || !startsAt || !endsAt) {
      setSubmitting(false);
      setError(
        requiresFullPublishFields
          ? "Title, venue, city, country, and valid start/end date-time are required."
          : "Title, city, country, and valid start/end date-time are required to save a draft."
      );
      return;
    }
    if (startsAt >= endsAt) {
      setSubmitting(false);
      setError("Event end time must be after start time.");
      return;
    }
    if (requiresFullPublishFields && !venueName.trim()) {
      setSubmitting(false);
      setError("Venue name is required before publishing.");
      return;
    }
    if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
      setSubmitting(false);
      setError(`Description must stay under ${MAX_DESCRIPTION_LENGTH} characters.`);
      return;
    }
    if (requiresFullPublishFields && !trimmedDescription) {
      setSubmitting(false);
      setError("Description is required before publishing.");
      return;
    }
    if (requiresFullPublishFields && trimmedDescription.length < MIN_DESCRIPTION_LENGTH) {
      setSubmitting(false);
      setError(`Description must be at least ${MIN_DESCRIPTION_LENGTH} characters.`);
      return;
    }

    const cleanedLinks = links
      .map((item) => ({
        label: item.label.trim() || "Link",
        url: item.url.trim(),
        type: item.type.trim() || "link",
      }))
      .filter((item) => item.url);

    const styles = stylesInput
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)
      .slice(0, 12);

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: trimmedDescription,
          eventType,
          styles,
          visibility,
          city: city.trim(),
          country: country.trim(),
          venueName: venueName.trim(),
          venueAddress: venueAddress.trim(),
          startsAt,
          endsAt,
          capacity: hasCapacity && typeof capacity === "number" ? capacity : null,
          coverUrl: coverUrl.trim(),
          links: cleanedLinks,
          status: nextStatus,
        }),
      });

      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; event_id?: string } | null;
      if (!response.ok || !json?.ok) {
        setSubmitting(false);
        setError(json?.error ?? "Failed to update event.");
        return;
      }

      setStatusMode(nextStatus);

      if (nextStatus === "published") {
        router.push(`/events/${encodeURIComponent(json?.event_id ?? eventId)}`);
        return;
      }

      setSubmitting(false);
      setInfo("Draft saved.");
    } catch {
      setSubmitting(false);
      setError("Could not save event. Check your connection and try again.");
    }
  }

  async function lookupAddress() {
    if (locationSearchQuery.length < 5) {
      setError("Add venue or address details first.");
      return;
    }

    setLocationSearchBusy(true);
    setLocationSearchFeedback(null);
    setInfo(null);

    try {
      const searchParams = new URLSearchParams({
        q: locationSearchQuery,
        venue: venueName.trim(),
        address: venueAddress.trim(),
        city: city.trim(),
        country: country.trim(),
        countryCode: selectedCountryIso,
      });
      const response = await fetch(`/api/geocode/search?${searchParams.toString()}`, { cache: "no-store" });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; results?: OsmGeocodeResult[] } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error ?? "Could not locate this address.");
      }

      const results = Array.isArray(json.results) ? json.results : [];
      setLocationResults(results);
      setSelectedLocation(results[0] ?? null);

      if (results[0]) {
        const resolvedStreet = exactStreetAddress(results[0]);
        if (resolvedStreet) setVenueAddress(resolvedStreet);
        const resolvedCity =
          results[0].address.city ??
          results[0].address.town ??
          results[0].address.village ??
          results[0].address.municipality ??
          results[0].address.county;
        if (resolvedCity) setCity(resolvedCity);
        if (results[0].address.country) setCountry(results[0].address.country);
        setLocationSearchFeedback(`Found ${results.length} possible match${results.length === 1 ? "" : "es"}. Select the exact place below.`);
      } else {
        setLocationSearchFeedback("No exact match yet. Try street + number without the venue name, or confirm the city and country first.");
      }
    } catch (lookupError) {
      setLocationResults([]);
      setSelectedLocation(null);
      setLocationSearchFeedback(lookupError instanceof Error ? lookupError.message : "Could not locate this address.");
    } finally {
      setLocationSearchBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070c] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[980px] px-4 pb-24 pt-7 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-6">
            <div className="h-16 rounded-2xl bg-white/[0.04]" />
            <div className="h-[840px] rounded-3xl bg-white/[0.04]" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05070c] text-slate-100">
      <Nav />

      <main className="mx-auto w-full max-w-[980px] px-4 pb-14 pt-7 sm:px-6 lg:px-8">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Edit Event</h1>
          <p className="mt-2 text-slate-300">Use the same premium event builder flow to update covers, location, and timing.</p>
        </header>

        <div className="mb-5 space-y-2">
          <DismissibleBanner message={error} tone="error" onDismiss={() => setError(null)} />
          <DismissibleBanner message={info} tone="info" onDismiss={() => setInfo(null)} />
        </div>

        <div className="space-y-8 rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(0,245,255,0.08),transparent_35%),linear-gradient(180deg,rgba(11,18,25,0.96),rgba(5,7,12,0.98))] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.36)] sm:p-8">
          <section className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Event Cover</h2>
                <p className="text-sm text-slate-400">Upload it once, then zoom and position the exact banner crop before save.</p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
                Current status: {statusMode}
              </div>
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                void onPickCover(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#091217]">
              {coverUrl ? (
                <div className="space-y-4 p-4 sm:p-5">
                  <div className="relative h-56 overflow-hidden rounded-[24px] border border-white/10 bg-[#10242a] sm:h-72">
                    <img src={coverUrl} alt="Event cover preview" className="h-full w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-4 py-4">
                      <p className="text-sm font-semibold text-white">Cover preview</p>
                      <p className="text-xs text-slate-200">This leads the event page header and ambient background.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
                    >
                      {uploadingCover ? "Uploading..." : "Change cover"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCoverUrl("")}
                      className="rounded-full border border-white/20 bg-black/25 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-black/35"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 px-4 py-10 text-center sm:px-6">
                  <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
                    <span className="material-symbols-outlined text-[30px] text-slate-300">add_photo_alternate</span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-white">Upload event cover</p>
                    <p className="text-sm text-slate-400">Use a 1.91:1 cover, ideally 1920 × 1005. Keep key text centered for mobile crops.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
                  >
                    {uploadingCover ? "Uploading..." : "Choose image"}
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white">Essentials</h2>
            <div className="grid gap-4">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Event Title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value.slice(0, MAX_TITLE_LENGTH))}
                  placeholder="e.g. Midnight Salsa Social"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <div className="text-right text-xs text-slate-500">{title.length}/{MAX_TITLE_LENGTH}</div>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Event Type</span>
                  <select
                    value={eventType}
                    onChange={(event) => setEventType(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white focus:border-cyan-300/35 focus:outline-none"
                  >
                    <option value="Social">Social</option>
                    <option value="Workshop">Workshop</option>
                    <option value="Festival">Festival</option>
                    <option value="Masterclass">Masterclass</option>
                    <option value="Competition">Competition</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Visibility</span>
                  <div className="inline-flex w-full rounded-xl border border-white/10 bg-black/20 p-1">
                    <button
                      type="button"
                      onClick={() => setVisibility("public")}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                        visibility === "public" ? "bg-cyan-300 text-[#062328]" : "text-slate-300 hover:text-white"
                      }`}
                    >
                      Public
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibility("private")}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                        visibility === "private" ? "bg-cyan-300 text-[#062328]" : "text-slate-300 hover:text-white"
                      }`}
                    >
                      Private
                    </button>
                  </div>
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Styles</span>
                <input
                  value={stylesInput}
                  onChange={(event) => setStylesInput(event.target.value)}
                  placeholder="e.g. bachata, salsa, zouk"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <p className="text-xs text-slate-500">Comma-separated tags, up to 12.</p>
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white">When & Where</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Country</span>
                <div className="relative">
                  <select
                    value={country}
                    onChange={(event) => {
                      setCountry(event.target.value);
                      setCity("");
                      resetLocationSearchState();
                    }}
                    className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 pr-11 text-white focus:border-cyan-300/35 focus:outline-none"
                  >
                    <option value="">Select country</option>
                    {countryNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-500">
                    expand_more
                  </span>
                </div>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">City</span>
                <input
                  value={city}
                  onChange={(event) => {
                    setCity(event.target.value);
                    resetLocationSearchState();
                  }}
                  list={selectedCountryIso && cityMenuOptions.length > 0 ? "event-edit-city-options" : undefined}
                  disabled={!selectedCountryIso}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none disabled:opacity-55"
                  placeholder={selectedCountryIso ? "Type or choose city" : "Select country first"}
                />
                {selectedCountryIso && cityMenuOptions.length > 0 ? (
                  <datalist id="event-edit-city-options">
                    {cityMenuOptions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                ) : null}
                <p className="text-[11px] text-slate-500">
                  {selectedCountryIso
                    ? cityOptions.length > 0
                      ? "Start typing to open the city menu, or keep your own custom city."
                      : "Type the city manually if it is missing from the list."
                    : "Choose the country first to unlock city suggestions."}
                </p>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Venue Name</span>
                <input
                  value={venueName}
                  onChange={(event) => {
                    setVenueName(event.target.value.slice(0, MAX_VENUE_NAME_LENGTH));
                    resetLocationSearchState();
                  }}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <div className="text-right text-xs text-slate-500">{venueName.length}/{MAX_VENUE_NAME_LENGTH}</div>
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Venue Address</span>
                <input
                  value={venueAddress}
                  onChange={(event) => {
                    setVenueAddress(event.target.value.slice(0, MAX_VENUE_ADDRESS_LENGTH));
                    resetLocationSearchState();
                  }}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                  placeholder="Start with street and number, then confirm the exact result"
                />
                <div className="text-right text-xs text-slate-500">{venueAddress.length}/{MAX_VENUE_ADDRESS_LENGTH}</div>

                <div className="mt-3 rounded-2xl border border-white/10 bg-[#0d1419] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Exact address search</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        We try the exact venue + street first, then broader fallback matches automatically so the map can lock faster.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void lookupAddress()}
                      disabled={locationSearchBusy}
                      className="inline-flex items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/12 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/18 disabled:opacity-60"
                    >
                      {locationSearchBusy ? "Searching..." : "Search exact place"}
                    </button>
                  </div>

                  {locationSearchFeedback ? (
                    <p className={`mt-3 text-xs leading-5 ${locationResults.length > 0 ? "text-cyan-100" : "text-amber-200"}`}>
                      {locationSearchFeedback}
                    </p>
                  ) : null}

                  {locationResults.length > 0 ? (
                    <div className="mt-4 grid max-h-64 gap-2 overflow-y-auto overscroll-contain pr-1">
                      {locationResults.map((result) => (
                        <button
                          key={`${result.lat}-${result.lon}-${result.displayName}`}
                          type="button"
                          onClick={() => {
                            setSelectedLocation(result);
                            const resolvedStreet = exactStreetAddress(result);
                            if (resolvedStreet) setVenueAddress(resolvedStreet);
                            const resolvedCity =
                              result.address.city ??
                              result.address.town ??
                              result.address.village ??
                              result.address.municipality ??
                              result.address.county;
                            if (resolvedCity) setCity(resolvedCity);
                            if (result.address.country) setCountry(result.address.country);
                            setLocationSearchFeedback("Map preview updated from the selected address.");
                          }}
                          className={`rounded-2xl border px-4 py-3 text-left text-sm ${
                            selectedLocation?.displayName === result.displayName
                              ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-50"
                              : "border-white/10 bg-white/[0.03] text-white/85 hover:bg-white/[0.06]"
                          }`}
                        >
                          {result.displayName}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {selectedLocation ? (
                    <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0f171c]">
                      <iframe
                        title="Event location preview"
                        src={buildOsmEmbedUrl(selectedLocation.lat, selectedLocation.lon)}
                        className="h-56 w-full border-0"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                      />
                      <div className="border-t border-white/10 px-4 py-3">
                        <p className="text-sm font-semibold text-white">{selectedLocation.displayName}</p>
                        <p className="mt-1 text-xs text-slate-400">Selected result will be used as the map preview on the event page.</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </label>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0c1419] p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Starts</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-slate-400">
                    Opening time
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date</span>
                    <input
                      type="date"
                      value={localDatePart(startsAtLocal)}
                      onChange={(event) => setStartsAtLocal(mergeLocalDateTime(event.target.value, localTimePart(startsAtLocal)))}
                      className="dark-calendar-input w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white focus:border-cyan-300/35 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Time</span>
                    <input
                      type="time"
                      step={900}
                      value={localTimePart(startsAtLocal)}
                      onChange={(event) => setStartsAtLocal(mergeLocalDateTime(localDatePart(startsAtLocal), event.target.value))}
                      className="dark-calendar-input w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white focus:border-cyan-300/35 focus:outline-none"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0c1419] p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Ends</span>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_DURATION_HOURS.map((hours) => (
                      <button
                        key={hours}
                        type="button"
                        onClick={() => setEndsAtLocal(shiftLocalDateTimeByHours(startsAtLocal, hours))}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-cyan-300/25 hover:text-white"
                      >
                        +{hours}h
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date</span>
                    <input
                      type="date"
                      value={localDatePart(endsAtLocal)}
                      onChange={(event) => setEndsAtLocal(mergeLocalDateTime(event.target.value, localTimePart(endsAtLocal)))}
                      className="dark-calendar-input w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white focus:border-cyan-300/35 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Time</span>
                    <input
                      type="time"
                      step={900}
                      value={localTimePart(endsAtLocal)}
                      onChange={(event) => setEndsAtLocal(mergeLocalDateTime(localDatePart(endsAtLocal), event.target.value))}
                      className="dark-calendar-input w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white focus:border-cyan-300/35 focus:outline-none"
                    />
                  </label>
                </div>
              </div>
            </div>

            {!isValidWindow ? (
              <p className="text-sm text-amber-200">End date-time must be after start date-time.</p>
            ) : null}
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white">Details</h2>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
                rows={5}
                placeholder="Tell people what makes your event special..."
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
              />
              <div className="flex items-center justify-between text-xs">
                <span className={descriptionLength < MIN_DESCRIPTION_LENGTH ? "text-amber-200" : "text-slate-500"}>
                  Minimum {MIN_DESCRIPTION_LENGTH} characters
                </span>
                <span className="text-slate-500">{description.length}/{MAX_DESCRIPTION_LENGTH}</span>
              </div>
            </label>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Limit attendees</p>
                  <p className="text-xs text-slate-400">Set max capacity (1 to 2000)</p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={hasCapacity}
                    onChange={(event) => setHasCapacity(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-transparent accent-cyan-300"
                  />
                  <span className="text-slate-300">Enable</span>
                </label>
              </div>
              <input
                type="number"
                min={1}
                max={2000}
                value={capacity}
                onChange={(event) => setCapacity(event.target.value ? Number(event.target.value) : "")}
                disabled={!hasCapacity}
                placeholder="Enter max capacity"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 disabled:opacity-50"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">External Links</p>
              {links.map((link, index) => (
                <div key={`event-link-${index}`} className="grid gap-2 sm:grid-cols-[1fr,1fr,180px,auto]">
                  <input
                    value={link.label}
                    onChange={(event) => {
                      setLinks((prev) => prev.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)));
                    }}
                    placeholder="Label"
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  />
                  <input
                    value={link.url}
                    onChange={(event) => {
                      setLinks((prev) => prev.map((item, i) => (i === index ? { ...item, url: event.target.value } : item)));
                    }}
                    placeholder="https://..."
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  />
                  <input
                    value={link.type}
                    onChange={(event) => {
                      setLinks((prev) => prev.map((item, i) => (i === index ? { ...item, type: event.target.value } : item)));
                    }}
                    placeholder="tickets"
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => setLinks((prev) => prev.filter((_, i) => i !== index))}
                    className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/20"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLinks((prev) => [...prev, { label: "Link", url: "", type: "link" }])}
                className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-1.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20"
              >
                + Add link
              </button>
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Finish</h2>
                <p className="text-sm text-slate-400">Keep it as a draft while you refine it, or publish the updated version now.</p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
                {statusMode === "draft" ? "Currently draft" : "Currently published"}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <Link href={`/events/${encodeURIComponent(eventId)}`} className="text-sm font-semibold text-slate-400 hover:text-white">
                Cancel
              </Link>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void submitEvent("draft")}
                  disabled={submitting || uploadingCover || !canSaveDraft}
                  className="rounded-full border border-white/15 bg-white/[0.05] px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {submitting && statusMode === "draft" ? "Saving..." : "Save draft"}
                </button>
                <button
                  type="button"
                  onClick={() => void submitEvent("published")}
                  disabled={submitting || uploadingCover || !canPublish}
                  className="rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400 px-7 py-2.5 text-sm font-bold text-[#052328] hover:opacity-95 disabled:opacity-60"
                >
                  {submitting ? "Saving..." : uploadingCover ? "Uploading cover..." : statusMode === "draft" ? "Publish event" : "Save changes"}
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      <EventCoverCropDialog
        file={pendingCoverFile}
        busy={uploadingCover}
        onClose={() => setPendingCoverFile(null)}
        onConfirm={uploadPreparedCover}
      />
    </div>
  );
}
