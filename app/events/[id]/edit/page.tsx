"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DismissibleBanner } from "@/components/DismissibleBanner";
import SearchableMobileSelect from "@/components/SearchableMobileSelect";
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
import {
  EVENT_ACCESS_TYPE_OPTIONS,
  PRIVATE_GROUP_CHAT_MODE_OPTIONS,
  type EventAccessType,
  type EventChatMode,
} from "@/lib/events/access";
import { mapEventRows } from "@/lib/events/model";
import { validateEventCoverSourceFile } from "@/lib/events/cover-upload";
import MapboxLocationSearch from "@/components/maps/MapboxLocationSearch";
import type { MapboxPlaceResult } from "@/lib/maps/mapbox";
import { supabase } from "@/lib/supabase/client";

type EventLinkDraft = {
  label: string;
  url: string;
  type: string;
};

const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 120;
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
  const [eventAccessType, setEventAccessType] = useState<EventAccessType>("public");
  const [chatMode, setChatMode] = useState<EventChatMode>("broadcast");
  const [showGuestList, setShowGuestList] = useState(true);
  const [guestsCanInvite, setGuestsCanInvite] = useState(false);
  const [approveMessages, setApproveMessages] = useState(false);
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
  const [ticketsUrl, setTicketsUrl] = useState("");
  const [locationQuery, setLocationQuery] = useState("");

  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const trimmedDescription = description.trim();
  const descriptionLength = trimmedDescription.length;
  const cityMenuOptions = useMemo(() => cityOptions.slice(0, 500), [cityOptions]);
  const visibleAccessOptions = useMemo(
    () =>
      eventAccessType === "private_group"
        ? EVENT_ACCESS_TYPE_OPTIONS
        : EVENT_ACCESS_TYPE_OPTIONS.filter((option) => option.value !== "private_group"),
    [eventAccessType]
  );
  const hostOnlyMessages = chatMode !== "discussion";

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
        setEventAccessType(event.accessType);
        setChatMode(event.chatMode);
        setShowGuestList(event.showGuestList);
        setGuestsCanInvite(event.guestsCanInvite);
        setApproveMessages(event.approveMessages);
        setCity(event.city);
        setCountry(event.country);
        setVenueName(event.venueName ?? "");
        setVenueAddress(event.venueAddress ?? "");
        setStartsAtLocal(isoToLocalDateTimeValue(event.startsAt));
        setEndsAtLocal(isoToLocalDateTimeValue(event.endsAt));
        setCoverUrl(event.coverUrl ?? "");
        setStatusMode(event.status === "draft" ? "draft" : "published");
        setHasCapacity(event.accessType !== "private_group" && typeof event.capacity === "number");
        setCapacity(event.accessType !== "private_group" && typeof event.capacity === "number" ? event.capacity : "");
        setLinks(
          event.links.length
            ? event.links.map((item) => ({ label: item.label, url: item.url, type: item.type }))
            : []
        );
        setTicketsUrl(event.links.find((item) => item.type === "tickets")?.url ?? "");
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

  const isValidWindow = useMemo(() => {
    const start = toIsoOrNull(startsAtLocal);
    const end = toIsoOrNull(endsAtLocal);
    return Boolean(start && end && start < end);
  }, [endsAtLocal, startsAtLocal]);

  const canPublish = useMemo(() => {
    if (eventAccessType === "private_group") {
      // Groups need title and description for publishing
      return Boolean(title.trim() && trimmedDescription);
    }
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
  }, [city, country, descriptionLength, endsAtLocal, eventAccessType, eventType, isValidWindow, startsAtLocal, title, trimmedDescription, venueName]);

  const canSaveDraft = useMemo(() => {
    if (eventAccessType === "private_group") {
      return Boolean(title.trim());
    }
    return Boolean(title.trim() && city.trim() && country.trim() && startsAtLocal && endsAtLocal && isValidWindow);
  }, [city, country, endsAtLocal, eventAccessType, isValidWindow, startsAtLocal, title]);

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
    const isPrivateGroup = eventAccessType === "private_group";

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

    if (isPrivateGroup) {
      if (requiresFullPublishFields && trimmedDescription.length < MIN_DESCRIPTION_LENGTH) {
        setSubmitting(false);
        setError(`Description must be at least ${MIN_DESCRIPTION_LENGTH} characters.`);
        return;
      }
    } else {
      // Events need full validation
      if (!city.trim() || !country.trim() || !startsAt || !endsAt) {
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

    const nonTicketLinks = links
      .map((item) => ({
        label: item.label.trim() || "Link",
        url: item.url.trim(),
        type: item.type.trim() || "link",
      }))
      .filter((item) => item.url && item.type.toLowerCase() !== "tickets");
    const cleanedLinks = ticketsUrl.trim()
      ? [...nonTicketLinks, { label: "Tickets", url: ticketsUrl.trim(), type: "tickets" }]
      : nonTicketLinks;

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
          eventAccessType,
          chatMode: hostOnlyMessages ? "broadcast" : "discussion",
          city: city.trim(),
          country: country.trim(),
          venueName: venueName.trim(),
          venueAddress: venueAddress.trim(),
          startsAt,
          endsAt,
          capacity: eventAccessType === "private_group" ? null : hasCapacity && typeof capacity === "number" ? capacity : null,
          coverUrl: coverUrl.trim(),
          links: cleanedLinks,
          status: nextStatus,
          settings: {
            showGuestList,
            guestsCanInvite,
            hostOnlyMessages,
            approveMessages,
          },
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

      <main className="mx-auto w-full max-w-[640px] px-4 pb-14 pt-7 sm:px-6">
        <div className="mb-4 space-y-2">
          <DismissibleBanner message={error} tone="error" onDismiss={() => setError(null)} />
          <DismissibleBanner message={info} tone="info" onDismiss={() => setInfo(null)} />
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#14161c] shadow-[0_28px_80px_rgba(0,0,0,0.5)]">
          {/* Header row */}
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white">Edit Event</h1>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                statusMode === "published"
                  ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
                  : "border-amber-400/40 bg-amber-400/15 text-amber-300"
              }`}>
                {statusMode === "published" ? "Published" : "Draft"}
              </span>
            </div>
            <Link href={`/events/${encodeURIComponent(eventId)}`} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-slate-300 hover:bg-white/20">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </Link>
          </div>

          {/* Cover — flush, full-width */}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              void onPickCover(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
          {coverUrl ? (
            <div className="relative h-56 bg-black sm:h-72">
              <img src={coverUrl} alt="Event cover" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <div className="absolute bottom-4 left-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-black/85"
                >
                  <span className="material-symbols-outlined text-[16px]">add_photo_alternate</span>
                  {uploadingCover ? "Uploading..." : "Change photo"}
                </button>
                <button
                  type="button"
                  onClick={() => setCoverUrl("")}
                  className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-black/85"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="flex h-44 w-full flex-col items-center justify-center gap-2 bg-[#1e2028] text-center hover:bg-[#22242c]"
            >
              <span className="material-symbols-outlined text-[36px] text-slate-400">add_photo_alternate</span>
              <p className="text-sm font-semibold text-slate-300">{uploadingCover ? "Uploading..." : "Add cover photo"}</p>
            </button>
          )}

          {/* Form body */}
          <div className="space-y-5 px-5 py-6">

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
                  <div className="relative">
                    <select
                      value={eventAccessType}
                      onChange={(event) => setEventAccessType(event.target.value as EventAccessType)}
                      className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 pr-11 text-white focus:border-cyan-300/35 focus:outline-none"
                    >
                      {visibleAccessOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-500">
                      expand_more
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {visibleAccessOptions.find((option) => option.value === eventAccessType)?.helper ?? ""}
                  </p>
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

          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white">When & Where</h2>
            <MapboxLocationSearch
              value={locationQuery}
              onChange={setLocationQuery}
              onSelect={(result: MapboxPlaceResult) => {
                setVenueName(result.name);
                setVenueAddress(result.address);
                setCity(result.city);
                setCountry(result.country);
                setLocationQuery(result.fullAddress || result.name);
              }}
              onClear={() => { setCity(""); setCountry(""); setVenueName(""); setVenueAddress(""); setLocationQuery(""); }}
              placeholder="Search venue or city to autofill…"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Country</span>
                <div className="sm:hidden">
                  <SearchableMobileSelect
                    label="Country"
                    value={country}
                    options={countryNames}
                    placeholder="Select country"
                    searchPlaceholder="Search countries..."
                    onSelect={(nextCountry) => {
                      setCountry(nextCountry);
                      setCity("");
                    }}
                    buttonClassName="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-white"
                  />
                </div>
                <div className="relative">
                  <select
                    value={country}
                    onChange={(event) => {
                      setCountry(event.target.value);
                      setCity("");
                    }}
                    className="hidden w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 pr-11 text-white focus:border-cyan-300/35 focus:outline-none sm:block"
                  >
                    <option value="">Select country</option>
                    {countryNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 text-[20px] text-slate-500 sm:block">
                    expand_more
                  </span>
                </div>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">City</span>
                {selectedCountryIso && cityMenuOptions.length > 0 ? (
                  <div className="sm:hidden">
                    <SearchableMobileSelect
                      label="City"
                      value={city}
                      options={cityMenuOptions}
                      placeholder={selectedCountryIso ? "Select or search city" : "Select country first"}
                      searchPlaceholder="Search cities..."
                      disabled={!selectedCountryIso}
                      allowCustomValue
                      customValueLabel={(value) => `Use "${value}"`}
                      onSelect={(nextCity) => {
                        setCity(nextCity);
                      }}
                      buttonClassName="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-white disabled:opacity-55"
                    />
                  </div>
                ) : null}
                <input
                  value={city}
                  onChange={(event) => {
                    setCity(event.target.value);
                  }}
                  list={selectedCountryIso && cityMenuOptions.length > 0 ? "event-edit-city-options" : undefined}
                  disabled={!selectedCountryIso}
                  className={`w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none disabled:opacity-55 ${
                    selectedCountryIso && cityMenuOptions.length > 0 ? "hidden sm:block" : ""
                  }`}
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
                  }}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                  placeholder="Start with street and number, then confirm the exact result"
                />
                <div className="text-right text-xs text-slate-500">{venueAddress.length}/{MAX_VENUE_ADDRESS_LENGTH}</div>
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
                  aria-label="Max capacity"
                  placeholder="Enter max capacity"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 disabled:opacity-50"
                />
              )}
            </div>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Tickets URL</span>
              <input
                value={ticketsUrl}
                onChange={(event) => setTicketsUrl(event.target.value)}
                placeholder="https://..."
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
              />
              <p className="text-xs text-slate-500">Use this if people should buy tickets or RSVP outside ConXion.</p>
            </label>

            {/* Event thread settings (non-group events only) */}
            {eventAccessType !== "private_group" && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Only hosts can message</p>
                    <p className="mt-0.5 text-xs text-slate-400">Turn this off to let guests post one message each in the event thread.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={hostOnlyMessages}
                    onClick={() => setChatMode((mode) => mode === "discussion" ? "broadcast" : "discussion")}
                    className={["relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none",
                      hostOnlyMessages ? "bg-cyan-400" : "bg-white/20"
                    ].join(" ")}
                  >
                    <span className={["pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform",
                      hostOnlyMessages ? "translate-x-5" : "translate-x-0"
                    ].join(" ")} />
                  </button>
                </div>

                {!hostOnlyMessages ? (
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Approve attendee messages</p>
                      <p className="mt-0.5 text-xs text-slate-400">Guest messages stay pending until you approve them.</p>
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
            )}
          </section>

          </div>{/* end form body */}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-white/10 px-5 py-4">
            <Link href={`/events/${encodeURIComponent(eventId)}`} className="text-sm font-semibold text-slate-400 hover:text-white">
              Cancel
            </Link>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void submitEvent("draft")}
                disabled={submitting || uploadingCover || !canSaveDraft}
                className="rounded-full border border-white/20 bg-white/[0.06] px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.10] disabled:opacity-50"
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
