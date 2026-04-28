"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DismissibleBanner } from "@/components/DismissibleBanner";
import SearchableMobileSelect from "@/components/SearchableMobileSelect";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import EventCoverCropDialog from "@/components/events/EventCoverCropDialog";
import {
  getCachedCitiesOfCountry,
  getCachedCountriesAll,
  getCitiesOfCountry,
  getCountriesAll,
  type CountryEntry,
} from "@/lib/country-city-client";
import {
  EVENT_ACCESS_TYPE_OPTIONS,
  PRIVATE_GROUP_CHAT_MODE_OPTIONS,
  normalizeEventAccessType,
  normalizeEventChatMode,
  type EventAccessType,
  type EventChatMode,
} from "@/lib/events/access";
import { validateEventCoverSourceFile } from "@/lib/events/cover-upload";
import { buildOsmEmbedUrl, normalizeOsmGeocodeResult, type OsmGeocodeResult } from "@/lib/maps/osm";
import { supabase } from "@/lib/supabase/client";

type EventLinkDraft = {
  label: string;
  url: string;
  type: string;
};

const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 50;
const MIN_DESCRIPTION_LENGTH = 24;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_VENUE_NAME_LENGTH = 120;
const MAX_VENUE_ADDRESS_LENGTH = 180;
const QUICK_DURATION_HOURS = [2, 3, 4, 6];

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

function todayLocalDateTimeValue() {
  return formatLocalDateTimeValue(new Date());
}

function plusHoursLocalDateTimeValue(hours: number) {
  const now = new Date();
  return formatLocalDateTimeValue(new Date(now.getTime() + hours * 60 * 60 * 1000));
}

function privateGroupWindow() {
  const starts = new Date();
  const ends = new Date(starts);
  ends.setFullYear(ends.getFullYear() + 10);
  return { startsAt: starts.toISOString(), endsAt: ends.toISOString() };
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

export default function CreateEventPage() {
  return (
    <Suspense>
      <CreateEventForm />
    </Suspense>
  );
}

function CreateEventForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isGroupCreate = searchParams.get("type") === "private_group";

  // Redirect group creation to the dedicated page
  useEffect(() => {
    if (isGroupCreate) {
      router.replace("/groups/new");
    }
  }, [isGroupCreate, router]);

  const formTitle = isGroupCreate ? "Create Group" : "Create Event";
  const publishLabel = isGroupCreate ? "Create group" : "Publish event";
  const modeOptions = useMemo(
    () =>
      EVENT_ACCESS_TYPE_OPTIONS.filter((option) =>
        isGroupCreate ? option.value === "private_group" : option.value !== "private_group"
      ),
    [isGroupCreate]
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [countriesAll, setCountriesAll] = useState<CountryEntry[]>(() => getCachedCountriesAll());
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const countryNames = useMemo(() => countriesAll.map((entry) => entry.name), [countriesAll]);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("Social");
  const [stylesInput, setStylesInput] = useState("");
  const [eventAccessType, setEventAccessType] = useState<EventAccessType>(isGroupCreate ? "private_group" : "public");
  const [chatMode, setChatMode] = useState<EventChatMode>(isGroupCreate ? "discussion" : "broadcast");
  const [showGuestList, setShowGuestList] = useState(true);
  const [guestsCanInvite, setGuestsCanInvite] = useState(false);
  const [approveMessages, setApproveMessages] = useState(false);
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const selectedCountryEntry = useMemo(() => resolveCountryEntry(countriesAll, country), [countriesAll, country]);
  const selectedCountryIso = selectedCountryEntry?.isoCode ?? "";
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState(todayLocalDateTimeValue());
  const [endsAtLocal, setEndsAtLocal] = useState(plusHoursLocalDateTimeValue(3));
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [hasCapacity, setHasCapacity] = useState(false);
  const [capacity, setCapacity] = useState<number | "">("");
  const [links, setLinks] = useState<EventLinkDraft[]>([]);
  const [locationResults, setLocationResults] = useState<OsmGeocodeResult[]>([]);
  const [locationSearchBusy, setLocationSearchBusy] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<OsmGeocodeResult | null>(null);
  const [locationSearchFeedback, setLocationSearchFeedback] = useState<string | null>(null);
  // FB-style location modal
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locationModalQuery, setLocationModalQuery] = useState("");
  const [locationModalResults, setLocationModalResults] = useState<OsmGeocodeResult[]>([]);
  const [locationModalSearching, setLocationModalSearching] = useState(false);
  const [locationModalSelected, setLocationModalSelected] = useState<OsmGeocodeResult | null>(null);
  const [locationModalVenueName, setLocationModalVenueName] = useState("");
  const trimmedDescription = description.trim();
  const descriptionLength = trimmedDescription.length;
  const groupDescriptionValid = isGroupCreate && descriptionLength > 0 && descriptionLength <= MAX_DESCRIPTION_LENGTH;
  const locationSearchQuery = [venueName, venueAddress, city, country].map((value) => value.trim()).filter(Boolean).join(", ");
  const cityMenuOptions = useMemo(() => cityOptions.slice(0, 500), [cityOptions]);

  useEffect(() => {
    const from = searchParams.get("from");
    if (!from) return;
    try {
      const pre = JSON.parse(decodeURIComponent(from)) as Record<string, unknown>;
      if (typeof pre.title === "string") setTitle(`${pre.title} (copy)`);
      if (typeof pre.eventType === "string") setEventType(pre.eventType);
      const nextAccessType = normalizeEventAccessType(
        typeof pre.eventAccessType === "string" ? pre.eventAccessType : null,
        typeof pre.visibility === "string" ? pre.visibility : null
      );
      const compatibleAccessType = isGroupCreate
        ? "private_group"
        : nextAccessType === "private_group"
          ? "public"
          : nextAccessType;
      setEventAccessType(compatibleAccessType);
      setChatMode(
        normalizeEventChatMode(typeof pre.chatMode === "string" ? pre.chatMode : null, compatibleAccessType)
      );
      if (typeof pre.showGuestList === "boolean") setShowGuestList(pre.showGuestList);
      if (typeof pre.guestsCanInvite === "boolean") setGuestsCanInvite(pre.guestsCanInvite);
      if (typeof pre.approveMessages === "boolean") setApproveMessages(pre.approveMessages);
      if (typeof pre.city === "string") setCity(pre.city);
      if (typeof pre.country === "string") setCountry(pre.country);
      if (typeof pre.venueName === "string") setVenueName(pre.venueName);
      if (typeof pre.venueAddress === "string") setVenueAddress(pre.venueAddress);
      if (typeof pre.description === "string") setDescription(pre.description);
      if (Array.isArray(pre.styles)) setStylesInput((pre.styles as string[]).join(", "));
      if (typeof pre.capacity === "number") { setHasCapacity(true); setCapacity(pre.capacity); }
    } catch { /* ignore malformed param */ }
  }, [isGroupCreate, searchParams]);

  useEffect(() => {
    if (isGroupCreate && eventAccessType !== "private_group") {
      setEventAccessType("private_group");
      setChatMode("discussion");
      return;
    }
    if (!isGroupCreate && eventAccessType === "private_group") {
      setEventAccessType("public");
      setChatMode("broadcast");
    }
  }, [eventAccessType, isGroupCreate]);

  useEffect(() => {
    if (eventAccessType !== "private_group" && chatMode === "none") {
      setChatMode("broadcast");
      return;
    }
    if (eventAccessType === "private_group" && chatMode === "none") {
      setChatMode("discussion");
    }
  }, [chatMode, eventAccessType]);

  useEffect(() => {
    if (chatMode !== "discussion" && approveMessages) {
      setApproveMessages(false);
    }
  }, [approveMessages, chatMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr || !authData.user) {
          router.replace("/auth");
          return;
        }
        setMeId(authData.user.id);

        const [{ data: sessionData }, profileRes] = await Promise.all([
          supabase.auth.getSession(),
          supabase.from("profiles").select("city,country").eq("user_id", authData.user.id).maybeSingle(),
        ]);

        if (cancelled) return;

        setAccessToken(sessionData.session?.access_token ?? null);
        // Don't pre-select country/city from user profile as requested
        // if (profileRes.data) {
        //   const profileRow = profileRes.data as Record<string, unknown>;
        //   if (typeof profileRow.city === "string") setCity(profileRow.city);
        //   if (typeof profileRow.country === "string") setCountry(profileRow.country);
        // }
        if (countriesAll.length === 0) {
          const fetchedCountries = await getCountriesAll();
          if (!cancelled && fetchedCountries.length > 0) setCountriesAll(fetchedCountries);
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : "Could not load event form.");
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
  }, [countriesAll.length, router]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCountryIso) {
      setCityOptions([]);
      setLoadingCities(false);
      return;
    }

    const cached = getCachedCitiesOfCountry(selectedCountryIso);
    if (cached.length) {
      setCityOptions(cached);
      setLoadingCities(false);
    } else {
      setLoadingCities(true);
    }

    (async () => {
      try {
        const fetched = await getCitiesOfCountry(selectedCountryIso);
        if (!cancelled) {
          setCityOptions(fetched);
          setLoadingCities(false);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadingCities(false);
          console.error("Failed to load cities:", error);
          const cached = getCachedCitiesOfCountry(selectedCountryIso);
          setCityOptions(cached.length ? cached : []);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCountryIso]);

  // Remove country normalization effect as it can cause issues
  // when countries are loaded after user has already selected a country

  const isValidWindow = useMemo(() => {
    const start = toIsoOrNull(startsAtLocal);
    const end = toIsoOrNull(endsAtLocal);
    return Boolean(start && end && start < end);
  }, [endsAtLocal, startsAtLocal]);

  const canPublish = useMemo(() => {
    if (isGroupCreate) {
      // Groups need title and description for publishing
      return Boolean(title.trim() && trimmedDescription);
    }
    // Events require location (city, country, venue) and all other fields
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
  }, [city, country, descriptionLength, endsAtLocal, eventType, isGroupCreate, isValidWindow, startsAtLocal, title, trimmedDescription, venueName]);

  const canSaveDraft = useMemo(() => {
    if (isGroupCreate) return Boolean(title.trim());
    // Events require location for draft too
    return Boolean(title.trim() && city.trim() && country.trim() && startsAtLocal && endsAtLocal && isValidWindow);
  }, [city, country, endsAtLocal, isGroupCreate, isValidWindow, startsAtLocal, title]);

  function resetLocationSearchState() {
    setLocationResults([]);
    setSelectedLocation(null);
    setLocationSearchFeedback(null);
  }

  useEffect(() => {
    const q = locationModalQuery.trim();
    if (q.length < 2) { setLocationModalResults([]); return; }
    setLocationModalSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=8&addressdetails=1&accept-language=en`;
        const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "ConXion/1.0" } });
        const raw = await res.json() as unknown[];
        setLocationModalResults(raw.map(normalizeOsmGeocodeResult).filter(Boolean) as OsmGeocodeResult[]);
      } catch { /* aborted */ } finally {
        setLocationModalSearching(false);
      }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [locationModalQuery]);

  async function onPickCover(file: File | null) {
    if (!file) return;
    if (!meId) {
      setError("Missing user session. Please sign in again.");
      return;
    }

    setError(null);
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
    setUploadingCover(true);
    try {
      if (!accessToken) throw new Error("Missing auth session. Please sign in again.");
      const formData = new FormData();
      formData.append("file", preparedFile);
      formData.append("prefix", "event-cover");
      const res = await fetch("/api/uploads/cover", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      const json = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!json.ok || !json.url) throw new Error(json.error ?? "Cover upload failed.");

      setCoverUrl(json.url);
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

    const groupWindow = isGroupCreate ? privateGroupWindow() : null;
    const startsAt = groupWindow?.startsAt ?? toIsoOrNull(startsAtLocal);
    const endsAt = groupWindow?.endsAt ?? toIsoOrNull(endsAtLocal);
    const requiresFullPublishFields = nextStatus === "published";

    if (isGroupCreate) {
      if (title.trim().length < MIN_TITLE_LENGTH) {
        setSubmitting(false);
        setError(`Title must be at least ${MIN_TITLE_LENGTH} characters.`);
        return;
      }
      if (title.trim().length > MAX_TITLE_LENGTH) {
        setSubmitting(false);
        setError(`Title must be no more than ${MAX_TITLE_LENGTH} characters.`);
        return;
      }
      if (requiresFullPublishFields && trimmedDescription.length < MIN_DESCRIPTION_LENGTH) {
        setSubmitting(false);
        setError(`Description must be at least ${MIN_DESCRIPTION_LENGTH} characters.`);
        return;
      }
    } else {
      if (title.trim().length < MIN_TITLE_LENGTH) {
        setSubmitting(false);
        setError(`Title must be at least ${MIN_TITLE_LENGTH} characters.`);
        return;
      }
      if (title.trim().length > MAX_TITLE_LENGTH) {
        setSubmitting(false);
        setError(`Title must be no more than ${MAX_TITLE_LENGTH} characters.`);
        return;
      }
      // For published events, validate all required fields
      if (requiresFullPublishFields && (!city.trim() || !country.trim() || !venueName.trim() || !startsAt || !endsAt)) {
        setSubmitting(false);
        setError("Title, venue, city, country, and valid start/end date-time are required.");
        return;
      }
      if (startsAt && endsAt && startsAt >= endsAt) {
        setSubmitting(false);
        setError("Event end time must be after start time.");
        return;
      }
    }
    if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
      setSubmitting(false);
      setError(`Description must be no more than ${MAX_DESCRIPTION_LENGTH} characters.`);
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
      const response = await fetch("/api/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          eventType: isGroupCreate ? "Group" : eventType,
          styles: isGroupCreate ? [] : styles,
          eventAccessType: isGroupCreate ? "private_group" : eventAccessType,
          chatMode: isGroupCreate ? chatMode : chatMode,
          city: city.trim(),
          country: country.trim(),
          venueName: isGroupCreate ? "" : venueName.trim(),
          venueAddress: isGroupCreate ? "" : venueAddress.trim(),
          startsAt,
          endsAt,
          capacity: isGroupCreate || eventAccessType === "private_group" ? null : hasCapacity && typeof capacity === "number" ? capacity : null,
          coverUrl: coverUrl.trim(),
          links: isGroupCreate ? [] : cleanedLinks,
          status: nextStatus,
          settings: isGroupCreate
            ? undefined
            : {
                showGuestList,
                guestsCanInvite,
                approveMessages,
              },
        }),
      });

      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; event_id?: string } | null;
      if (!response.ok || !json?.ok || !json.event_id) {
        setSubmitting(false);
        setError(json?.error ?? "Failed to create event.");
        return;
      }

      if (nextStatus === "published") {
        if (isGroupCreate) {
          // Redirect to Activity/Groups page instead of event page
          router.push(`/activity?tab=groups`);
          return;
        }
        router.push(`/events/${encodeURIComponent(json.event_id)}`);
        return;
      }

      router.push("/activity");
    } catch {
      setSubmitting(false);
      setError("Could not save event. Check your connection and try again.");
    }
  }

  async function lookupAddress() {
    if (locationSearchQuery.length < 5) {
      setLocationSearchFeedback("Add venue or street details first, then search again.");
      return;
    }

    setLocationSearchBusy(true);
    setLocationSearchFeedback(null);

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
      <div className="min-h-screen bg-[#05060a] text-white">
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
    <div className="min-h-screen bg-[#05060a] text-slate-100">
      <Nav />

      <main className="mx-auto w-full max-w-[980px] px-4 pb-14 pt-7 sm:px-6 lg:px-8">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">{formTitle}</h1>
        </header>

        {error ? (
          <div className="mb-5">
            <DismissibleBanner message={error} tone="error" onDismiss={() => setError(null)} />
          </div>
        ) : null}

        <div className="space-y-8 rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(0,245,255,0.055),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,0,255,0.06),transparent_32%),linear-gradient(180deg,rgba(8,10,16,0.98),rgba(4,5,10,0.99))] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.52)] sm:p-8">
          <section className="space-y-4">
            {!isGroupCreate ? (
              <h2 className="text-lg font-bold text-white">Event Cover</h2>
            ) : null}
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

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0a0c13]">
              {coverUrl ? (
                <div className="p-4 sm:p-5">
                  <div className="relative h-56 overflow-hidden rounded-[24px] border border-white/10 bg-[#10242a] sm:h-72">
                    <img src={coverUrl} alt="Event cover preview" className="h-full w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-4 py-4">
                      <p className="text-sm font-semibold text-white">Cover preview</p>
                      <p className="text-xs text-slate-200">This leads the event page header and ambient background.</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
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
                    <p className="text-base font-semibold text-white">{isGroupCreate ? "Upload group cover" : "Upload event cover"}</p>
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

          {!isGroupCreate ? (
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
                  <div className="flex justify-between text-xs">
                    <span className={title.trim().length > 0 && title.trim().length < MIN_TITLE_LENGTH ? "text-amber-300" : "text-slate-500"}>
                      {title.trim().length > 0 && title.trim().length < MIN_TITLE_LENGTH ? `Min ${MIN_TITLE_LENGTH} chars` : ""}
                    </span>
                    <span className={title.length > MAX_TITLE_LENGTH ? "text-rose-400" : "text-slate-500"}>{title.length}/{MAX_TITLE_LENGTH}</span>
                  </div>
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

                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Mode</span>
                    <div className="grid gap-2">
                      {modeOptions.map((option) => {
                        const selected = eventAccessType === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              if (!isGroupCreate) setEventAccessType(option.value);
                            }}
                            disabled={isGroupCreate}
                            className={`rounded-xl border px-4 py-3 text-left transition ${
                              selected
                                ? "border-cyan-300/35 bg-[linear-gradient(135deg,rgba(0,245,255,0.12),rgba(255,0,255,0.08))] text-white"
                                : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:text-white"
                            }`}
                          >
                            <p className="text-sm font-semibold">{option.label}</p>
                            <p className="mt-1 text-xs text-slate-400">{option.helper}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {eventAccessType === "private_group" ? (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Chat mode</span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {PRIVATE_GROUP_CHAT_MODE_OPTIONS.map((option) => {
                        const selected = chatMode === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setChatMode(option.value)}
                            className={`rounded-xl border px-4 py-3 text-left transition ${
                              selected
                                ? "border-fuchsia-300/35 bg-fuchsia-400/12 text-white"
                                : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:text-white"
                            }`}
                          >
                            <p className="text-sm font-semibold">{option.label}</p>
                            <p className="mt-1 text-xs text-slate-400">{option.helper}</p>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-cyan-200/85">Plan your dance life together.</p>
                  </div>
                ) : null}

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
          ) : (
            <section className="space-y-6">
               <div className="grid gap-4">
                 <label className="space-y-1">
                   <span className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Group Title</span>
                   <input
                     value={title}
                     onChange={(event) => setTitle(event.target.value.slice(0, MAX_TITLE_LENGTH))}
                     placeholder="e.g. Barcelona bachata practice group"
                     className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                   />
                   <div className="flex justify-between text-xs">
                     <span className={title.trim().length > 0 && title.trim().length < MIN_TITLE_LENGTH ? "text-amber-300" : "text-slate-500"}>
                       {title.trim().length > 0 && title.trim().length < MIN_TITLE_LENGTH ? `Min ${MIN_TITLE_LENGTH} chars` : ""}
                     </span>
                     <span className={title.length > MAX_TITLE_LENGTH ? "text-rose-400" : "text-slate-500"}>{title.length}/{MAX_TITLE_LENGTH}</span>
                   </div>
                 </label>

                 <label className="space-y-1">
                   <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Description</span>
                   <textarea
                     value={description}
                     onChange={(event) => setDescription(event.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
                     rows={4}
                     placeholder="Describe what this group is about, who it's for, and what members can expect..."
                     className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                   />
                   <div className="flex items-center justify-between text-xs">
                     <span className={description.trim().length > 0 && description.trim().length < MIN_DESCRIPTION_LENGTH ? "text-amber-300" : "text-slate-500"}>
                       {description.trim().length > 0 && description.trim().length < MIN_DESCRIPTION_LENGTH ? `Min ${MIN_DESCRIPTION_LENGTH} chars` : ""}
                     </span>
                     <span className={description.length > MAX_DESCRIPTION_LENGTH ? "text-rose-400" : "text-slate-500"}>{description.length}/{MAX_DESCRIPTION_LENGTH}</span>
                   </div>
                 </label>

                 <div className="space-y-2">
                   <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Chat mode</span>
                   <div className="grid gap-2 sm:grid-cols-2">
                     {PRIVATE_GROUP_CHAT_MODE_OPTIONS.map((option) => {
                       const selected = chatMode === option.value;
                       return (
                         <button
                           key={option.value}
                           type="button"
                           onClick={() => setChatMode(option.value)}
                           className={`rounded-xl border px-4 py-3 text-left transition ${
                             selected
                               ? "border-fuchsia-300/35 bg-fuchsia-400/12 text-white"
                               : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:text-white"
                           }`}
                         >
                           <p className="text-sm font-semibold">{option.label}</p>
                           <p className="mt-1 text-xs text-slate-400">{option.helper}</p>
                         </button>
                       );
                     })}
                   </div>
                   <p className="text-xs text-cyan-200/85">Plan your dance life together.</p>
                 </div>
               </div>
            </section>
          )}

          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white">{isGroupCreate ? "Location (optional)" : "When & Where"}</h2>

            {/* FB-style location trigger */}
            {!isGroupCreate ? (
              <button
                type="button"
                onClick={() => {
                  setLocationModalOpen(true);
                  setLocationModalQuery(venueName || city || country || "");
                  setLocationModalSelected(selectedLocation);
                  setLocationModalVenueName(venueName);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-[#0a0c13] px-4 py-3.5 text-left transition hover:border-white/20"
              >
                <span className="material-symbols-outlined text-[22px] text-white/40">location_on</span>
                <div className="min-w-0 flex-1">
                  {venueName || city ? (
                    <>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300/80">Add location</p>
                      <p className="truncate text-sm font-semibold text-white">
                        {[venueName, city, country].filter(Boolean).join(", ")}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Add location</p>
                      <p className="text-sm text-white/45">Include a place or address</p>
                    </>
                  )}
                </div>
                {(venueName || city) && selectedLocation ? (
                  <span className="material-symbols-outlined text-[16px] text-cyan-300/60">edit</span>
                ) : (
                  <span className="material-symbols-outlined text-[18px] text-white/25">chevron_right</span>
                )}
              </button>
            ) : (
              /* Group: keep simple country/city fields */
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Country (optional)</span>
                  <div className="sm:hidden">
                    <SearchableMobileSelect
                      label="Country"
                      value={country}
                      options={countryNames}
                      placeholder="Select country (optional)"
                      searchPlaceholder="Search countries..."
                      onSelect={(nextCountry) => {
                        setCountry(nextCountry);
                        setCity("");
                        resetLocationSearchState();
                      }}
                      buttonClassName="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-white"
                    />
                  </div>
                  <div className="relative hidden sm:block">
                    <select
                      value={country}
                      onChange={(e) => { setCountry(e.target.value); setCity(""); resetLocationSearchState(); }}
                      className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 pr-11 text-white focus:border-cyan-300/35 focus:outline-none"
                    >
                      <option value="">Select country (optional)</option>
                      {countryNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-500">expand_more</span>
                  </div>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">City (optional)</span>
                  {selectedCountryIso && cityMenuOptions.length > 0 ? (
                    <>
                      <div className="sm:hidden">
                        <SearchableMobileSelect
                          label="City"
                          value={city}
                          options={cityMenuOptions}
                          placeholder={loadingCities ? "Loading cities..." : "Select or search city"}
                          searchPlaceholder="Search cities..."
                          disabled={!selectedCountryIso || loadingCities}
                          allowCustomValue
                          customValueLabel={(value) => `Use "${value}"`}
                          onSelect={(nextCity) => {
                            setCity(nextCity);
                            resetLocationSearchState();
                          }}
                          buttonClassName="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-white disabled:opacity-55"
                        />
                      </div>
                      <input
                        value={city}
                        onChange={(e) => { setCity(e.target.value); resetLocationSearchState(); }}
                        list="group-create-city-options"
                        className="hidden w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none sm:block"
                        placeholder="Type or choose city"
                      />
                      <datalist id="group-create-city-options">
                        {cityMenuOptions.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </>
                  ) : (
                    <input
                      value={city}
                      onChange={(e) => { setCity(e.target.value); resetLocationSearchState(); }}
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                      placeholder={selectedCountryIso ? "City name" : "Select country first or type city"}
                    />
                  )}
                </label>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {!isGroupCreate ? (
                <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0a0c13] p-4">
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
              ) : null}
              {!isGroupCreate ? (
                <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0a0c13] p-4">
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
              ) : null}
            </div>
            {!isGroupCreate && !isValidWindow ? (
              <p className="text-sm text-amber-200">End date-time must be after start date-time.</p>
            ) : null}
          </section>
          
          {!isGroupCreate ? (
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
                  <span className={descriptionLength > 0 && descriptionLength < MIN_DESCRIPTION_LENGTH ? "text-amber-200" : "text-slate-500"}>
                    {descriptionLength > 0 && descriptionLength < MIN_DESCRIPTION_LENGTH ? `Min ${MIN_DESCRIPTION_LENGTH} chars` : ""}
                  </span>
                  <span className={description.length > MAX_DESCRIPTION_LENGTH ? "text-rose-400" : "text-slate-500"}>{description.length}/{MAX_DESCRIPTION_LENGTH}</span>
                </div>
              </label>
              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {eventAccessType === "private_group" ? "Private Group limit" : "Limit attendees"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {eventAccessType === "private_group"
                        ? "Private groups are limited to 25 members."
                        : "Set max capacity (1 to 2000)"}
                    </p>
                  </div>
                  {eventAccessType !== "private_group" ? (
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={hasCapacity}
                        onChange={(event) => setHasCapacity(event.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-transparent accent-cyan-300"
                      />
                      <span className="text-slate-300">Enable</span>
                    </label>
                  ) : (
                    <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                      25 max
                    </span>
                  )}
                </div>
                {eventAccessType === "private_group" ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200">
                    Members can join until the group reaches 25 people.
                  </div>
                ) : (
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
                )}
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

              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Allow attendee messages</p>
                    <p className="mt-0.5 text-xs text-slate-400">Guests can post one message each in the event thread instead of organiser-only updates.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={chatMode === "discussion"}
                    onClick={() => setChatMode((mode) => mode === "discussion" ? "broadcast" : "discussion")}
                    className={["relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                      chatMode === "discussion" ? "bg-cyan-400" : "bg-white/20"
                    ].join(" ")}
                  >
                    <span className={["pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform",
                      chatMode === "discussion" ? "translate-x-5" : "translate-x-0"
                    ].join(" ")} />
                  </button>
                </div>

                {chatMode === "discussion" ? (
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Approve attendee messages</p>
                      <p className="mt-0.5 text-xs text-slate-400">New guest messages stay pending until the organiser approves them.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={approveMessages}
                      onClick={() => setApproveMessages((value) => !value)}
                      className={["relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                        approveMessages ? "bg-cyan-400" : "bg-white/20"
                      ].join(" ")}
                    >
                      <span className={["pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform",
                        approveMessages ? "translate-x-5" : "translate-x-0"
                      ].join(" ")} />
                    </button>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Show guest list</p>
                    <p className="mt-0.5 text-xs text-slate-400">Members can see who is already joining the event.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showGuestList}
                    onClick={() => setShowGuestList((value) => !value)}
                    className={["relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                      showGuestList ? "bg-cyan-400" : "bg-white/20"
                    ].join(" ")}
                  >
                    <span className={["pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform",
                      showGuestList ? "translate-x-5" : "translate-x-0"
                    ].join(" ")} />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Guests can invite friends</p>
                    <p className="mt-0.5 text-xs text-slate-400">Joined guests can invite accepted connections from the event page.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={guestsCanInvite}
                    onClick={() => setGuestsCanInvite((value) => !value)}
                    className={["relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                      guestsCanInvite ? "bg-cyan-400" : "bg-white/20"
                    ].join(" ")}
                  >
                    <span className={["pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform",
                      guestsCanInvite ? "translate-x-5" : "translate-x-0"
                    ].join(" ")} />
                  </button>
                </div>
              </div>
            </section>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <Link href="/events" className="text-sm font-semibold text-slate-400 hover:text-white">
              Cancel
            </Link>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void submitEvent("draft")}
                disabled={submitting || uploadingCover || !canSaveDraft}
                className="rounded-full border border-white/15 bg-white/[0.05] px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Save draft"}
              </button>
              <button
                type="button"
                onClick={() => void submitEvent("published")}
                disabled={submitting || uploadingCover || !canPublish}
                className="rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400 px-7 py-2.5 text-sm font-bold text-[#052328] hover:opacity-95 disabled:opacity-60"
              >
                {submitting ? "Saving..." : uploadingCover ? "Uploading cover..." : publishLabel}
              </button>
            </div>
          </div>
        </div>
      </main>

      <EventCoverCropDialog
        file={pendingCoverFile}
        busy={uploadingCover}
        onClose={() => setPendingCoverFile(null)}
        onConfirm={uploadPreparedCover}
      />

      {/* FB-style Find a Location modal */}
      {locationModalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121414] shadow-[0_30px_60px_rgba(0,0,0,0.5)]">
            {/* Brand gradient top bar */}
            <div className="h-px w-full bg-gradient-to-r from-[#0df2f2]/70 via-[#0df2f2]/20 to-[#f20db1]/70" />

            {/* Header */}
            <div className="relative flex items-center justify-center border-b border-white/8 px-6 py-4">
              <h2 className="text-base font-bold text-white">Find a location</h2>
              <button
                type="button"
                onClick={() => setLocationModalOpen(false)}
                className="absolute right-4 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-white/60 transition hover:bg-white/14 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-4 p-5">
              <p className="text-sm text-white/45">Search by city, neighborhood, or place name to move the map.</p>

              {/* Search */}
              <div className="relative">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-white/35">search</span>
                <input
                  type="text"
                  value={locationModalQuery}
                  onChange={(e) => setLocationModalQuery(e.target.value)}
                  placeholder="Search city, venue, address..."
                  autoFocus
                  className="w-full rounded-xl border border-white/12 bg-black/30 py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:border-[#0df2f2]/40 focus:outline-none focus:ring-1 focus:ring-[#0df2f2]/20"
                />
                {locationModalSearching ? (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#0df2f2]/60">Searching…</span>
                ) : null}
              </div>

              {/* Results */}
              {locationModalResults.length > 0 ? (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#0d0f10]">
                  {locationModalResults.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setLocationModalSelected(r);
                        const resolvedCity = r.address.city ?? r.address.town ?? r.address.village ?? r.address.municipality ?? "";
                        setLocationModalQuery([r.address.road, resolvedCity, r.address.country].filter(Boolean).join(", "));
                        setLocationModalResults([]);
                      }}
                      className="flex w-full items-center gap-3 border-b border-white/5 px-4 py-3 text-left last:border-0 hover:bg-[#0df2f2]/6 transition-colors"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0df2f2]/10">
                        <span className="material-symbols-outlined text-[18px] text-[#0df2f2]/70">location_on</span>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{r.displayName.split(",").slice(0, 2).join(",")}</p>
                        <p className="truncate text-[11px] text-white/35">{r.displayName}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Map — iframe is taller than container to clip OSM attribution bar */}
              <div className="overflow-hidden rounded-xl border border-white/10" style={{ height: "208px" }}>
                {locationModalSelected ? (
                  <iframe
                    key={`${locationModalSelected.lat},${locationModalSelected.lon}`}
                    title="Location map"
                    src={buildOsmEmbedUrl(locationModalSelected.lat, locationModalSelected.lon)}
                    className="w-full border-0"
                    style={{ height: "248px", marginBottom: "-40px" }}
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-52 flex-col items-center justify-center gap-3 bg-[#0d0f10]">
                    <span className="material-symbols-outlined text-[40px] text-[#0df2f2]/25">map</span>
                    <p className="text-sm text-white/30">Search for a location to preview the map</p>
                  </div>
                )}
              </div>

              {locationModalSelected ? (
                <div className="flex items-center gap-2 rounded-xl border border-[#0df2f2]/20 bg-[#0df2f2]/8 px-3 py-2">
                  <span className="material-symbols-outlined text-[16px] text-[#0df2f2]">check_circle</span>
                  <p className="truncate text-sm font-semibold text-[#0df2f2]/90">{locationModalSelected.displayName.split(",").slice(0, 3).join(",")}</p>
                  <button type="button" onClick={() => { setLocationModalSelected(null); setLocationModalQuery(""); }} className="ml-auto shrink-0 text-white/30 hover:text-white">
                    <span className="material-symbols-outlined text-[15px]">close</span>
                  </button>
                </div>
              ) : null}

              {/* Location Name */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Location Name</label>
                <input
                  type="text"
                  value={locationModalVenueName}
                  onChange={(e) => setLocationModalVenueName(e.target.value)}
                  placeholder="e.g. Dance studio, venue name..."
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-[#0df2f2]/40 focus:outline-none focus:ring-1 focus:ring-[#0df2f2]/15"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setLocationModalOpen(false)}
                  className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-white/60 transition hover:border-white/20 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!locationModalSelected && !locationModalVenueName}
                  onClick={() => {
                    if (locationModalSelected) {
                      setSelectedLocation(locationModalSelected);
                      const resolvedCity = locationModalSelected.address.city ?? locationModalSelected.address.town ?? locationModalSelected.address.village ?? locationModalSelected.address.municipality ?? "";
                      if (resolvedCity) setCity(resolvedCity);
                      if (locationModalSelected.address.country) setCountry(locationModalSelected.address.country);
                      const street = [locationModalSelected.address.road, locationModalSelected.address.houseNumber].filter(Boolean).join(" ");
                      if (street) setVenueAddress(street);
                    }
                    if (locationModalVenueName) setVenueName(locationModalVenueName);
                    else if (locationModalSelected) setVenueName(locationModalSelected.displayName.split(",")[0]);
                    setLocationModalOpen(false);
                    setLocationModalResults([]);
                  }}
                  className="rounded-xl px-5 py-2.5 text-sm font-bold text-[#0A0A0A] transition hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundImage: "linear-gradient(90deg,#00F5FF 0%,#d946ef 100%)" }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
