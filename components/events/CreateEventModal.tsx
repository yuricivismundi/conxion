"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import CustomEventCalendarModal from "@/components/events/CustomEventCalendarModal";
import { type EventAccessType } from "@/lib/events/access";
import {
  getEventCoverRenderLayout,
  prepareEventCoverFile,
  validateEventCoverSourceFile,
} from "@/lib/events/cover-upload";
import { buildOsmEmbedUrl, normalizeOsmGeocodeResult, type OsmGeocodeResult } from "@/lib/maps/osm";
import { CalendarPicker, TimePickerDropdown } from "@/components/ui/DateTimePicker";
import { supabase } from "@/lib/supabase/client";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 120;
const MIN_DESCRIPTION_LENGTH = 24;
const MAX_DESCRIPTION_LENGTH = 4000;
const QUICK_DURATION_HOURS = [2, 3, 4, 6];

type RecurringFrequency = "none" | "biweekly" | "monthly" | "custom";
type UIAccessMode = "public" | "request";
type ScheduledDateSelection = {
  dateKey: string;
  slots: { id: string; start: string; end: string }[];
};
type EventOccurrence = {
  startsAt: string;
  endsAt: string;
};

function toIsoOrNull(localDateTime: string) {
  if (!localDateTime) return null;
  const parsed = new Date(localDateTime);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatLocalDateTimeValue(date: Date) {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function exactStreetAddress(result: OsmGeocodeResult) {
  const parts = [result.address.road, result.address.houseNumber].filter(Boolean);
  return parts.join(" ").trim();
}

function geocodePlaceName(result: OsmGeocodeResult) {
  return result.displayName.split(",")[0]?.trim() || result.address.city || result.address.town || result.address.village || result.address.country || "Selected place";
}

function geocodePlaceDetails(result: OsmGeocodeResult) {
  const placeCity = result.address.city ?? result.address.town ?? result.address.village ?? result.address.municipality ?? "";
  const placeCountry = result.address.country ?? "";
  const streetAddress = exactStreetAddress(result);
  return [streetAddress, placeCity, placeCountry]
    .filter((segment, index, arr) => Boolean(segment) && arr.indexOf(segment) === index)
    .join(" · ");
}

function plusHoursLocalDateTimeValue(hours: number) {
  const now = new Date();
  return formatLocalDateTimeValue(new Date(now.getTime() + hours * 60 * 60 * 1000));
}

function localDatePart(value: string) { return value.split("T")[0] ?? ""; }
function localTimePart(value: string) { return value.split("T")[1]?.slice(0, 5) ?? ""; }
function mergeLocalDateTime(datePart: string, timePart: string) {
  if (!datePart) return "";
  return `${datePart}T${(timePart || "00:00").slice(0, 5)}`;
}
function shiftLocalDateTimeByHours(value: string, hours: number) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatLocalDateTimeValue(new Date(parsed.getTime() + hours * 60 * 60 * 1000));
}

function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildRecurringOccurrences(params: {
  recurring: RecurringFrequency;
  startsAtLocal: string;
  endsAtLocal: string;
  repeatEndDate: string;
  repeatEndTime: string;
  scheduledDates: ScheduledDateSelection[];
  occurrenceOverrides: Record<string, string | null>;
}) {
  const occurrences: EventOccurrence[] = [];
  const seen = new Set<string>();

  const pushOccurrence = (startsAtLocal: string, endsAtLocal: string) => {
    const startsAt = toIsoOrNull(startsAtLocal);
    const endsAt = toIsoOrNull(endsAtLocal);
    if (!startsAt || !endsAt || startsAt >= endsAt) return;
    const key = `${startsAt}|${endsAt}`;
    if (seen.has(key)) return;
    seen.add(key);
    occurrences.push({ startsAt, endsAt });
  };

  if (params.recurring === "custom") {
    params.scheduledDates
      .slice()
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .forEach((entry) => {
        entry.slots.forEach((slot) => {
          pushOccurrence(
            mergeLocalDateTime(entry.dateKey, slot.start),
            mergeLocalDateTime(entry.dateKey, slot.end)
          );
        });
      });
    return occurrences;
  }

  if (params.recurring !== "biweekly" && params.recurring !== "monthly") {
    return occurrences;
  }

  if (!params.startsAtLocal || !params.repeatEndDate) {
    return occurrences;
  }

  const startDate = new Date(params.startsAtLocal);
  const capDate = new Date(`${params.repeatEndDate}T23:59:59`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(capDate.getTime())) {
    return occurrences;
  }

  const startTime = localTimePart(params.startsAtLocal);
  const endTime = params.repeatEndTime || localTimePart(params.endsAtLocal);
  let cursor = new Date(startDate);

  while (cursor <= capDate && occurrences.length < 12) {
    const originalKey = localDateKey(cursor);
    const override = params.occurrenceOverrides[originalKey];
    if (override !== null) {
      const dateKey = override ?? originalKey;
      pushOccurrence(
        mergeLocalDateTime(dateKey, startTime),
        mergeLocalDateTime(dateKey, endTime)
      );
    }

    cursor =
      params.recurring === "biweekly"
        ? new Date(cursor.getTime() + 14 * 24 * 60 * 60 * 1000)
        : new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate(), cursor.getHours(), cursor.getMinutes());
  }

  return occurrences.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

type Props = {
  onClose: () => void;
  onPublished: (eventId: string) => void;
  /** If provided, the modal opens in edit mode for this event ID */
  eventId?: string;
  onSaved?: (eventId: string) => void;
};

export default function CreateEventModal({ onClose, onPublished, eventId: editEventId, onSaved }: Props) {
  const isEditMode = Boolean(editEventId);
  useBodyScrollLock(true);

  const [submitting, setSubmitting] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [eventsThisMonth, setEventsThisMonth] = useState(0);
  const [editCurrentStatus, setEditCurrentStatus] = useState<"draft" | "published">("draft");

  // Form fields
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("Social");
  const [stylesInput, setStylesInput] = useState("");
  const [uiAccess, setUiAccess] = useState<UIAccessMode>("public");
  const eventAccessType: EventAccessType = uiAccess === "request" ? "request" : "public";
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<OsmGeocodeResult[]>([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const [locationDropOpen, setLocationDropOpen] = useState(false);
  const [startsAtLocal, setStartsAtLocal] = useState(() => formatLocalDateTimeValue(new Date()));
  const [endsAtLocal, setEndsAtLocal] = useState(() => plusHoursLocalDateTimeValue(3));
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");        // final uploaded URL
  const [coverFile, setCoverFile] = useState<File | null>(null); // raw local file
  const [coverSourceUrl, setCoverSourceUrl] = useState<string | null>(null); // object URL for preview
  const [coverNaturalSize, setCoverNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [coverPanX, setCoverPanX] = useState(0);
  const [coverPanY, setCoverPanY] = useState(0);
  const [coverFrameSize, setCoverFrameSize] = useState({ w: 0, h: 0 });
  const [coverDragging, setCoverDragging] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const coverFrameRef = useRef<HTMLDivElement | null>(null);
  const coverDragRef = useRef<{ px: number; py: number; startPanX: number; startPanY: number; id: number } | null>(null);
  const repeatFreqBtnRef = useRef<HTMLButtonElement | null>(null);
  const [repeatFreqRect, setRepeatFreqRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [hasCapacity, setHasCapacity] = useState(false);
  const [capacity, setCapacity] = useState<number | "">("");
  const [ticketsUrl, setTicketsUrl] = useState("");
  const [recurring, setRecurring] = useState<RecurringFrequency>("none");
  const [showEndDate, setShowEndDate] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatFreqOpen, setRepeatFreqOpen] = useState(false);
  const [repeatEndDate, setRepeatEndDate] = useState("");
  const [repeatEndTime, setRepeatEndTime] = useState("");
  const [occurrenceOverrides, setOccurrenceOverrides] = useState<Record<string, string | null>>({});
  const [editingOccurrence, setEditingOccurrence] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [additionalOpen, setAdditionalOpen] = useState(false);
  const [accessDropdownOpen, setAccessDropdownOpen] = useState(false);
  const [showGuestList, setShowGuestList] = useState(true);
  const [guestsCanInvite, setGuestsCanInvite] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [scheduledDates, setScheduledDates] = useState<ScheduledDateSelection[]>([]);

  // Location modal
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locationModalQuery, setLocationModalQuery] = useState("");
  const [locationModalResults, setLocationModalResults] = useState<OsmGeocodeResult[]>([]);
  const [locationModalSearching, setLocationModalSearching] = useState(false);
  const [locationModalSelected, setLocationModalSelected] = useState<OsmGeocodeResult | null>(null);

  const trimmedDescription = description.trim();
  const descriptionLength = trimmedDescription.length;
  const recurringOccurrences = useMemo(
    () =>
      buildRecurringOccurrences({
        recurring,
        startsAtLocal,
        endsAtLocal,
        repeatEndDate,
        repeatEndTime,
        scheduledDates,
        occurrenceOverrides,
      }),
    [endsAtLocal, occurrenceOverrides, recurring, repeatEndDate, repeatEndTime, scheduledDates, startsAtLocal]
  );

  // Bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;
      setMeId(authData.user.id);
      const { data: sessionData } = await supabase.auth.getSession();
      if (!cancelled) setAccessToken(sessionData.session?.access_token ?? null);

      if (editEventId) {
        // Edit mode: load existing event data
        try {
          const { data: ev } = await supabase.from("events").select("*").eq("id", editEventId).maybeSingle();
          if (!cancelled && ev) {
            const isoToLocal = (v: string | null) => {
              if (!v) return "";
              const p = new Date(v);
              if (Number.isNaN(p.getTime())) return "";
              const local = new Date(p.getTime() - p.getTimezoneOffset() * 60_000);
              return local.toISOString().slice(0, 16);
            };
            setTitle(ev.title ?? "");
            setDescription(ev.description ?? "");
            setEventType(ev.event_type ?? "Social");
            setStylesInput(Array.isArray(ev.styles) ? ev.styles.join(", ") : "");
            setUiAccess(ev.access_type === "request" ? "request" : "public");
            setCity(ev.city ?? "");
            setCountry(ev.country ?? "");
            setVenueName(ev.venue_name ?? "");
            setVenueAddress(ev.venue_address ?? "");
            setStartsAtLocal(isoToLocal(ev.starts_at));
            setEndsAtLocal(isoToLocal(ev.ends_at));
            setCoverUrl(ev.cover_url ?? "");
            setEditCurrentStatus(ev.status === "draft" ? "draft" : "published");
            const cap = ev.capacity;
            setHasCapacity(typeof cap === "number");
            setCapacity(typeof cap === "number" ? cap : "");
            const links = Array.isArray(ev.links) ? ev.links as { label: string; url: string; type: string }[] : [];
            setTicketsUrl(links.find((l) => l.type === "tickets")?.url ?? "");
            const settings = (ev.settings ?? {}) as Record<string, boolean>;
            setShowGuestList(settings.showGuestList !== false);
            setGuestsCanInvite(settings.guestsCanInvite === true);
          }
        } finally {
          if (!cancelled) setLoadingEdit(false);
        }
        return;
      }

      // Count events this month for starter plan indicator
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { count } = await supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("host_user_id", authData.user.id)
        .eq("status", "published")
        .gte("created_at", monthStart);
      if (!cancelled) setEventsThisMonth(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [editEventId]);

  // IP geolocation on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("https://ipapi.co/json/");
        const data = (await res.json()) as { city?: string; country_name?: string; region?: string } | null;
        if (data?.city && data?.country_name && !city) {
          setCity(data.city);
          setCountry(data.country_name);
          setLocationQuery(`${data.city}, ${data.country_name}`);
        }
      } catch { /* silent — geolocation is best-effort */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced business/location search
  useEffect(() => {
    const q = locationQuery.trim();
    if (!q || q === `${city}, ${country}`) { setLocationResults([]); setLocationDropOpen(false); return; }
    const timer = setTimeout(async () => {
      setLocationSearching(true);
      try {
        const searchParams = new URLSearchParams({
          q,
          venue: q,
          city: city.trim(),
          country: country.trim(),
        });
        const res = await fetch(`/api/geocode/search?${searchParams.toString()}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; results?: OsmGeocodeResult[] } | null;
        const data = res.ok && json?.ok && Array.isArray(json.results) ? json.results : [];
        setLocationResults(data);
        setLocationDropOpen(data.length > 0);
      } catch { setLocationResults([]); }
      finally { setLocationSearching(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [locationQuery, city, country]);

  // Cover file object URL + natural size
  useEffect(() => {
    if (!coverFile) { setCoverSourceUrl(null); setCoverNaturalSize(null); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverSourceUrl(url);
    setCoverPanX(0); setCoverPanY(0);
    const img = new window.Image();
    img.onload = () => setCoverNaturalSize({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  // Measure cover frame
  useEffect(() => {
    const node = coverFrameRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => setCoverFrameSize({ w: node.clientWidth, h: node.clientHeight }));
    ro.observe(node);
    setCoverFrameSize({ w: node.clientWidth, h: node.clientHeight });
    return () => ro.disconnect();
  }, [coverFile, coverSourceUrl]);

  const coverLayout = useMemo(() => {
    if (!coverNaturalSize || !coverFrameSize.w || !coverFrameSize.h) return null;
    return getEventCoverRenderLayout({
      sourceWidth: coverNaturalSize.w,
      sourceHeight: coverNaturalSize.h,
      frameWidth: coverFrameSize.w,
      frameHeight: coverFrameSize.h,
      crop: { zoom: 1, panX: coverPanX, panY: coverPanY },
    });
  }, [coverNaturalSize, coverFrameSize, coverPanX, coverPanY]);

  // Business/location search for location modal
  useEffect(() => {
    const q = locationModalQuery.trim();
    if (q.length < 2) { setLocationModalResults([]); return; }
    setLocationModalSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const searchParams = new URLSearchParams({
          q,
          venue: q,
          city: city.trim(),
          country: country.trim(),
        });
        const res = await fetch(`/api/geocode/search?${searchParams.toString()}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; results?: OsmGeocodeResult[] } | null;
        const data = res.ok && json?.ok && Array.isArray(json.results) ? json.results : [];
        setLocationModalResults(data);
      } catch {
        setLocationModalResults([]);
      } finally {
        setLocationModalSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [city, country, locationModalQuery]);

  const isValidWindow = useMemo(() => {
    const start = toIsoOrNull(startsAtLocal);
    const end = toIsoOrNull(endsAtLocal);
    return Boolean(start && end && start < end);
  }, [endsAtLocal, startsAtLocal]);

  const canPublish = useMemo(() => Boolean(
    title.trim() && eventType.trim() && city.trim() && country.trim() && venueName.trim() &&
    startsAtLocal && endsAtLocal && isValidWindow &&
    descriptionLength >= MIN_DESCRIPTION_LENGTH && descriptionLength <= MAX_DESCRIPTION_LENGTH
  ), [city, country, descriptionLength, endsAtLocal, eventType, isValidWindow, startsAtLocal, title, venueName]);

  const canSaveDraft = useMemo(() => Boolean(
    title.trim() && city.trim() && country.trim() && startsAtLocal && endsAtLocal && isValidWindow
  ), [city, country, endsAtLocal, isValidWindow, startsAtLocal, title]);

  async function uploadCoverFile(file: File): Promise<string> {
    if (!accessToken) throw new Error("Missing auth session.");
    setUploadingCover(true);
    try {
      const prepared = await prepareEventCoverFile(file, { zoom: 1, panX: coverPanX, panY: coverPanY });
      const formData = new FormData();
      formData.append("file", prepared);
      formData.append("prefix", "event-cover");
      const res = await fetch("/api/uploads/cover", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (!json?.ok || !json.url) throw new Error(json?.error ?? "Cover upload failed.");
      return json.url;
    } finally { setUploadingCover(false); }
  }

  async function submitEvent(nextStatus: "published" | "draft") {
    if (!accessToken) { setError("Missing auth session. Please sign in again."); return; }
    if (uploadingCover) { setError("Please wait for cover upload to finish."); return; }

    if (title.trim().length < MIN_TITLE_LENGTH) { setError(`Title must be at least ${MIN_TITLE_LENGTH} characters.`); return; }
    if (title.trim().length > MAX_TITLE_LENGTH) { setError(`Title must be no more than ${MAX_TITLE_LENGTH} characters.`); return; }
    if (nextStatus === "published") {
      const missing: string[] = [];
      if (!title.trim()) missing.push("title");
      if (!venueName.trim()) missing.push("venue");
      if (!city.trim()) missing.push("city");
      if (!country.trim()) missing.push("country");
      if (!startsAtLocal || !endsAtLocal || !isValidWindow) missing.push("a valid start and end time");
      if (descriptionLength < MIN_DESCRIPTION_LENGTH) missing.push(`description (${MIN_DESCRIPTION_LENGTH}+ chars)`);
      if (missing.length > 0) {
        setError(`To publish, add ${missing.join(", ")}.`);
        return;
      }
    }
    if (descriptionLength > MAX_DESCRIPTION_LENGTH) { setError(`Description must be no more than ${MAX_DESCRIPTION_LENGTH} characters.`); return; }
    const startsAt = toIsoOrNull(startsAtLocal);
    const endsAt = toIsoOrNull(endsAtLocal);
    if (startsAt && endsAt && startsAt >= endsAt) { setError("End time must be after start time."); return; }
    if (recurring !== "none" && recurringOccurrences.length < 2) {
      setError("Add at least two valid repeat occurrences before saving this event series.");
      return;
    }

    setSubmitting(true);
    setError(null);

    // Upload local cover file if present (with current pan position)
    let finalCoverUrl = coverUrl;
    if (coverFile) {
      try {
        finalCoverUrl = await uploadCoverFile(coverFile);
        setCoverUrl(finalCoverUrl);
        setCoverFile(null);
      } catch (e) {
        setSubmitting(false);
        setError(e instanceof Error ? e.message : "Cover upload failed.");
        return;
      }
    }

    const styles = stylesInput.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0).slice(0, 12);
    const cleanedLinks = ticketsUrl.trim() ? [{ label: "Tickets", url: ticketsUrl.trim(), type: "tickets" }] : [];

    const payload = {
      title: title.trim(),
      description: description.trim(),
      eventType,
      styles,
      eventAccessType,
      chatMode: "broadcast",
      city: city.trim(),
      country: country.trim(),
      venueName: venueName.trim(),
      venueAddress: venueAddress.trim(),
      startsAt,
      endsAt,
      capacity: hasCapacity && typeof capacity === "number" ? capacity : null,
      coverUrl: finalCoverUrl.trim(),
      links: cleanedLinks,
      status: nextStatus,
      settings: {
        showGuestList,
        guestsCanInvite,
      },
      ...(!isEditMode && recurring !== "none" && recurringOccurrences.length > 1
        ? { recurrence: { kind: recurring, timezone, occurrences: recurringOccurrences } }
        : {}),
    };

    try {
      const url = isEditMode ? `/api/events/${editEventId}` : "/api/events";
      const method = isEditMode ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(payload),
      });

      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        event_id?: string;
        event_ids?: string[];
      } | null;

      if (isEditMode) {
        if (!response.ok || !json?.ok) {
          setSubmitting(false);
          setError(json?.error ?? "Failed to save event.");
          return;
        }
        const savedId = json?.event_id ?? editEventId!;
        if (nextStatus === "published") {
          onPublished(savedId);
        } else {
          onSaved?.(savedId);
          onClose();
        }
        return;
      }

      if (!response.ok || !json?.ok || !json.event_id) {
        setSubmitting(false);
        setError(json?.error ?? "Failed to create event.");
        return;
      }

      if (nextStatus === "published") {
        onPublished(json.event_id);
      } else {
        onClose();
      }
    } catch {
      setSubmitting(false);
      setError("Could not save event. Check your connection and try again.");
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 sm:p-6">
        <div className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#181c20] shadow-[0_32px_80px_rgba(0,0,0,0.6)]">
          {/* Brand gradient */}
          <div className="h-px w-full shrink-0 bg-gradient-to-r from-[#0df2f2]/70 via-[#0df2f2]/20 to-[#f20db1]/70" />

          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">{isEditMode ? "Edit Event" : "Create Event"}</h2>
              {isEditMode && (
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${editCurrentStatus === "published" ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/5 text-slate-400"}`}>
                  {editCurrentStatus === "published" ? "Published" : "Draft"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {!isEditMode && (
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tabular-nums ${eventsThisMonth >= 2 ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-400"}`}>
                  {eventsThisMonth}/2 monthly events
                </span>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-white/60 transition hover:bg-white/14 hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          </div>

          {/* Cover photo — full-bleed, inline drag-to-reposition */}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                validateEventCoverSourceFile(file);
                setCoverFile(file);
                setCoverUrl(""); // clear any previously uploaded URL
              } catch (err) { setError(err instanceof Error ? err.message : "Invalid file."); }
              e.currentTarget.value = "";
            }}
          />
          <div
            ref={coverFrameRef}
            className="relative shrink-0 overflow-hidden touch-none select-none"
            style={{
              aspectRatio: "1.91/1",
              maxHeight: "220px",
              cursor: coverSourceUrl ? (coverDragging ? "grabbing" : "grab") : "default",
            }}
            onPointerDown={(e) => {
              if (!coverSourceUrl || !coverLayout) return;
              coverDragRef.current = { px: e.clientX, py: e.clientY, startPanX: coverPanX, startPanY: coverPanY, id: e.pointerId };
              e.currentTarget.setPointerCapture(e.pointerId);
              setCoverDragging(true);
            }}
            onPointerMove={(e) => {
              const d = coverDragRef.current;
              if (!d || d.id !== e.pointerId || !coverLayout) return;
              const dx = e.clientX - d.px;
              const dy = e.clientY - d.py;
              const clamp = (v: number) => Math.min(1, Math.max(-1, v));
              setCoverPanX(coverLayout.maxOffsetX > 0 ? clamp(d.startPanX + dx / coverLayout.maxOffsetX) : 0);
              setCoverPanY(coverLayout.maxOffsetY > 0 ? clamp(d.startPanY + dy / coverLayout.maxOffsetY) : 0);
            }}
            onPointerUp={() => { coverDragRef.current = null; setCoverDragging(false); }}
            onPointerCancel={() => { coverDragRef.current = null; setCoverDragging(false); }}
          >
            {/* Image — local file preview with drag pan, or uploaded URL */}
            {coverSourceUrl && coverLayout ? (
              <img
                src={coverSourceUrl}
                alt="Cover preview"
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
                style={{
                  width: `${coverLayout.renderWidth}px`,
                  height: `${coverLayout.renderHeight}px`,
                  transform: `translate(calc(-50% + ${coverLayout.offsetX}px), calc(-50% + ${coverLayout.offsetY}px))`,
                }}
              />
            ) : coverUrl ? (
              <img src={coverUrl} alt="Cover" className="h-full w-full object-cover pointer-events-none" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#181b20]">
                <span className="material-symbols-outlined text-[32px] text-white/15">image</span>
              </div>
            )}

            {/* Gradient overlay */}
            {(coverSourceUrl || coverUrl) ? (
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            ) : null}

            {/* Drag hint */}
            {coverSourceUrl ? (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center">
                <span className="rounded-full bg-black/50 px-3 py-1.5 text-[11px] font-semibold text-white/70 backdrop-blur-sm">
                  Drag to reposition
                </span>
              </div>
            ) : null}

            {/* Action buttons */}
            <div className="absolute bottom-3 left-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/75"
              >
                <span className="material-symbols-outlined text-[14px]">add_photo_alternate</span>
                {coverSourceUrl || coverUrl ? "Change photo" : "Add cover photo"}
              </button>
              {(coverSourceUrl || coverUrl) ? (
                <button
                  type="button"
                  onClick={() => { setCoverFile(null); setCoverUrl(""); }}
                  className="flex items-center gap-1 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white/70 backdrop-blur-sm transition hover:bg-black/75 hover:text-white"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                  Remove
                </button>
              ) : null}
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto overscroll-contain bg-[#181c20]">
            {loadingEdit ? (
              <div className="flex items-center justify-center py-24">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-cyan-300" />
              </div>
            ) : null}
            <div className={`space-y-4 p-5 ${loadingEdit ? "hidden" : ""}`}>
              {error ? (
                <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                  <button type="button" onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
                </div>
              ) : null}

              {/* Title */}
              <div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE_LENGTH))}
                  placeholder="Event title"
                  className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-base font-semibold text-white placeholder:font-normal placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <div className="mt-1 flex justify-between text-[11px]">
                  <span className={title.trim().length > 0 && title.trim().length < MIN_TITLE_LENGTH ? "text-amber-300" : "text-transparent"}>
                    Min {MIN_TITLE_LENGTH} chars
                  </span>
                  <span className={title.length > MAX_TITLE_LENGTH * 0.85 ? "text-slate-400" : "text-slate-600"}>{title.length}/{MAX_TITLE_LENGTH}</span>
                </div>
              </div>

              {/* Location + Access — equal halves */}
              <div className="grid grid-cols-2 gap-2">
                {/* Location — inline search */}
                <div className="relative">
                  <div className={`flex h-full min-h-[56px] items-center rounded-xl border bg-black/30 transition ${locationDropOpen ? "border-[#00f5ff]/40" : "border-white/10 focus-within:border-white/20"}`}>
                    <span className="material-symbols-outlined pointer-events-none ml-3 shrink-0 text-[18px] text-white/35">location_on</span>
                    <input
                      value={locationQuery}
                      onChange={(e) => { setLocationQuery(e.target.value); if (!e.target.value) { setCity(""); setCountry(""); setVenueName(""); } }}
                      onFocus={() => { if (locationResults.length > 0) setLocationDropOpen(true); }}
                      placeholder="Add location"
                      className="min-w-0 flex-1 bg-transparent py-3 pl-2.5 pr-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                    />
                    {locationSearching
                      ? <span className="mr-1 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-[#00f5ff]" />
                      : null}
                    <button
                      type="button"
                      onClick={() => { setLocationModalOpen(true); setLocationModalQuery(locationQuery || city || ""); }}
                      className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/35 transition hover:bg-white/10 hover:text-white/70"
                      title="Open map"
                    >
                      <span className="material-symbols-outlined text-[17px]">map</span>
                    </button>
                  </div>
                  {locationDropOpen && locationResults.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-[29]" onClick={() => setLocationDropOpen(false)} />
                      <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-white/12 bg-[#181c20] shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
                        {locationResults.map((r, i) => {
                          const normalized = normalizeOsmGeocodeResult(r);
                          if (!normalized) return null;
                          const placeCity = normalized.address.city ?? normalized.address.town ?? normalized.address.village ?? normalized.address.municipality ?? "";
                          const placeCountry = normalized.address.country ?? "";
                          const placeName = normalized.displayName.split(",")[0]?.trim() ?? placeCity;
                          const streetAddress = exactStreetAddress(normalized);
                          const details = [streetAddress, placeCity, placeCountry].filter((s, idx, arr) => s && arr.indexOf(s) === idx).join(" · ");
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => {
                                setCity(placeCity);
                                setCountry(placeCountry);
                                setVenueName(placeName);
                                setVenueAddress(streetAddress || normalized.displayName);
                                setLocationQuery(placeName);
                                setLocationDropOpen(false);
                                setLocationResults([]);
                              }}
                              className="flex w-full items-center gap-3 border-b border-white/6 px-3 py-2.5 text-left last:border-0 hover:bg-white/5 transition"
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/8 text-white/50">
                                <span className="material-symbols-outlined text-[16px]">location_on</span>
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">{placeName}</p>
                                <p className="truncate text-[11px] text-slate-400">{details || normalized.displayName}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* Access — FB-style dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setAccessDropdownOpen((v) => !v)}
                    className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-3 transition hover:border-white/20"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                      <span className="material-symbols-outlined text-[18px] text-white/55">
                        {uiAccess === "public" ? "public" : "mail"}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Who can see it?</p>
                      <p className="text-sm font-bold text-white">{uiAccess === "public" ? "Public" : "Request Event"}</p>
                    </div>
                    <span className="material-symbols-outlined text-[16px] text-white/30">expand_more</span>
                  </button>

                  {accessDropdownOpen ? (
                    <div className="fixed inset-0 z-9" onClick={() => setAccessDropdownOpen(false)} />
                  ) : null}
                  {/* Dropdown panel */}
                  {accessDropdownOpen ? (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1.5 overflow-hidden rounded-xl border border-white/12 bg-[#181c20] shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
                      {([
                        { value: "public", icon: "public", label: "Public", desc: "Anyone can discover and join" },
                        { value: "request", icon: "mail", label: "Request Event", desc: "Visible in discovery. Guests request approval before joining" },
                      ] as const).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { setUiAccess(opt.value); setAccessDropdownOpen(false); }}
                          className="flex w-full items-center gap-3 border-b border-white/6 px-4 py-3 text-left last:border-0 hover:bg-white/5"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                            <span className="material-symbols-outlined text-[18px] text-white/60">{opt.icon}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white">{opt.label}</p>
                            <p className="text-[11px] text-slate-400">{opt.desc}</p>
                          </div>
                          <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${uiAccess === opt.value ? "border-[#00f5ff]" : "border-white/25"}`}>
                            {uiAccess === opt.value ? <div className="h-2 w-2 rounded-full bg-[#00f5ff]" /> : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Type + Dance Styles */}
              <div className="grid gap-2 grid-cols-2">
                <label className="flex flex-col gap-0.5 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 cursor-pointer hover:border-white/20">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Type of event</span>
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                    className="w-full bg-transparent text-sm font-bold text-white focus:outline-none"
                  >
                    {["Social", "Workshop", "Festival", "Masterclass", "Competition"].map((t) => (
                      <option key={t} value={t} className="bg-[#181c20]">{t}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 cursor-pointer hover:border-white/20 focus-within:border-white/20">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Dance styles</span>
                  <input
                    value={stylesInput}
                    onChange={(e) => setStylesInput(e.target.value)}
                    placeholder="bachata, salsa…"
                    className="w-full bg-transparent text-sm font-bold text-white placeholder:font-normal placeholder:text-slate-500 focus:outline-none"
                  />
                </label>
              </div>

              {/* Date & Time */}
              <div className="space-y-2">
                {/* Start row: date | time | timezone */}
                <div className="grid grid-cols-3 gap-2">
                  <CalendarPicker
                    label="Start date"
                    value={localDatePart(startsAtLocal)}
                    onChange={(d) => setStartsAtLocal(mergeLocalDateTime(d, localTimePart(startsAtLocal)))}
                  />
                  <TimePickerDropdown
                    label="Start time"
                    value={localTimePart(startsAtLocal)}
                    dateValue={localDatePart(startsAtLocal)}
                    onChange={(t) => setStartsAtLocal(mergeLocalDateTime(localDatePart(startsAtLocal), t))}
                  />
                  <label className="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 cursor-pointer hover:border-white/20">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Time zone</span>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full bg-transparent text-sm font-semibold text-white focus:outline-none"
                    >
                      {Intl.supportedValuesOf("timeZone").map((tz) => (
                        <option key={tz} value={tz} className="bg-[#181c20]">{tz.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* End date toggle */}
                {!showEndDate ? (
                  <button
                    type="button"
                    onClick={() => setShowEndDate(true)}
                    className="text-xs font-semibold text-[#00f5ff] hover:underline"
                  >
                    + End date and time
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <CalendarPicker
                        label="End date"
                        value={localDatePart(endsAtLocal)}
                        minDate={localDatePart(startsAtLocal)}
                        onChange={(d) => setEndsAtLocal(mergeLocalDateTime(d, localTimePart(endsAtLocal)))}
                      />
                      <div className="space-y-1">
                        <TimePickerDropdown
                          label="End time"
                          value={localTimePart(endsAtLocal)}
                          dateValue={localDatePart(endsAtLocal)}
                          onChange={(t) => setEndsAtLocal(mergeLocalDateTime(localDatePart(endsAtLocal), t))}
                        />
                        <div className="flex gap-1 pt-0.5">
                          {QUICK_DURATION_HOURS.map((h) => (
                            <button
                              key={h}
                              type="button"
                              onClick={() => setEndsAtLocal(shiftLocalDateTimeByHours(startsAtLocal, h))}
                              className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 hover:border-cyan-300/25 hover:text-white"
                            >
                              +{h}h
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowEndDate(false)}
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      − Remove end date
                    </button>
                  </div>
                )}
                {showEndDate && !isValidWindow ? (
                  <p className="text-xs text-amber-200">End time must be after start time.</p>
                ) : null}
              </div>

              {/* Description */}
              <div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
                  rows={4}
                  placeholder="Add details of event..."
                  className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <div className="mt-1 flex justify-between text-[11px]">
                  <span className={descriptionLength > 0 && descriptionLength < MIN_DESCRIPTION_LENGTH ? "text-amber-200" : "text-transparent"}>
                    Min {MIN_DESCRIPTION_LENGTH} chars
                  </span>
                  <span className={descriptionLength > MAX_DESCRIPTION_LENGTH * 0.9 ? "text-slate-400" : "text-slate-600"}>{descriptionLength}/{MAX_DESCRIPTION_LENGTH}</span>
                </div>
              </div>

              {/* Tickets URL */}
              <label className="block space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Tickets</span>
                <div className="relative">
                  <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[17px] text-white/30">confirmation_number</span>
                  <input
                    value={ticketsUrl}
                    onChange={(e) => setTicketsUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                  />
                </div>
              </label>

              {/* Additional Settings — collapsible */}
              <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setAdditionalOpen((o) => !o)}
                  className="flex w-full items-center gap-3 px-4 py-3 hover:bg-white/[0.03]"
                >
                  <span className="material-symbols-outlined text-[18px] text-white/40">tune</span>
                  <span className="flex-1 text-left text-sm font-semibold text-white/70">Additional settings</span>
                  <span className={`material-symbols-outlined text-[18px] text-slate-400 transition-transform ${additionalOpen ? "rotate-180" : ""}`}>expand_more</span>
                </button>
                {additionalOpen ? (
                  <div className="divide-y divide-white/5 border-t border-white/8">
                    {/* Capacity */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="material-symbols-outlined text-[18px] text-white/30">group</span>
                      <div className="flex-1">
                        <p className="text-sm text-white/80">Limit attendees</p>
                        <p className="text-[11px] text-slate-500">Set max capacity (1–2000)</p>
                      </div>
                      <label className="flex items-center gap-2 shrink-0">
                        <input
                          type="checkbox"
                          checked={hasCapacity}
                          onChange={(e) => setHasCapacity(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-transparent accent-cyan-300"
                        />
                      </label>
                      {hasCapacity ? (
                        <input
                          type="number"
                          min={1}
                          max={2000}
                          value={capacity}
                          onChange={(e) => setCapacity(e.target.value ? Number(e.target.value) : "")}
                          placeholder="Max"
                          className="w-16 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                        />
                      ) : null}
                    </div>
                    {/* Show guest list */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="material-symbols-outlined text-[18px] text-white/30">checklist</span>
                      <div className="flex-1">
                        <p className="text-sm text-white/80">Show guest list</p>
                        <p className="text-[11px] text-slate-500">Guests can see who is attending</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={showGuestList}
                        onClick={() => setShowGuestList((v) => !v)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${showGuestList ? "bg-[#00f5ff]" : "bg-white/20"}`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${showGuestList ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                    {/* Guests can invite friends */}
                    <div className="flex items-center gap-3 border-t border-white/6 px-4 py-3">
                      <span className="material-symbols-outlined text-[18px] text-white/30">group_add</span>
                      <div className="flex-1">
                        <p className="text-sm text-white/80">Guests can invite friends</p>
                        <p className="text-[11px] text-slate-500">Joined guests can invite accepted connections from the event page</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={guestsCanInvite}
                        onClick={() => setGuestsCanInvite((v) => !v)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${guestsCanInvite ? "bg-[#00f5ff]" : "bg-white/20"}`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${guestsCanInvite ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Repeat Event — collapsible section */}
              <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                {/* Collapsible header */}
                <button
                  type="button"
                  onClick={() => setRepeatOpen((v) => !v)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition"
                >
                  <span className="material-symbols-outlined text-[20px] text-white/40">event_repeat</span>
                  <p className="flex-1 text-sm font-semibold text-white/80">Repeat event</p>
                  <span className="text-[11px] text-slate-500 mr-1">Current plan: max 2/month</span>
                  <span className="material-symbols-outlined text-[18px] text-white/30 transition-transform" style={{ transform: repeatOpen ? "rotate(180deg)" : "rotate(0deg)" }}>expand_more</span>
                </button>

                {repeatOpen ? (
                  <div className="border-t border-white/6 px-4 py-3 space-y-3">
                    {/* Compact frequency dropdown button */}
                    <div className="relative">
                      <button
                        ref={repeatFreqBtnRef}
                        type="button"
                        onClick={() => {
                          const rect = repeatFreqBtnRef.current?.getBoundingClientRect();
                          if (rect) {
                            const dropH = 4 * 52;
                            const spaceBelow = window.innerHeight - rect.bottom;
                            const top = spaceBelow >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
                            setRepeatFreqRect({ top, left: rect.left, width: rect.width });
                          }
                          setRepeatFreqOpen((v) => !v);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                          repeatFreqOpen ? "border-[#00f5ff]/50 bg-[#00f5ff]/5" : "border-white/12 bg-black/30 hover:border-white/20"
                        }`}
                      >
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#00f5ff]/70">Frequency</p>
                          <p className="mt-0.5 text-sm font-semibold text-white">
                            {recurring === "none" ? "Never" : recurring === "biweekly" ? "Every 2 weeks" : recurring === "monthly" ? "Monthly" : "Custom"}
                          </p>
                        </div>
                        <span className="material-symbols-outlined text-[18px] text-white/30">expand_more</span>
                      </button>

                      {/* Fixed-position dropdown */}
                      {repeatFreqOpen && repeatFreqRect ? (
                        <>
                          <div className="fixed inset-0 z-[49]" onClick={() => setRepeatFreqOpen(false)} />
                          <div
                            className="fixed z-50 overflow-hidden rounded-xl border border-white/12 bg-[#181c20] shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
                            style={{ top: repeatFreqRect.top, left: repeatFreqRect.left, width: repeatFreqRect.width }}
                          >
                            {([
                              { key: "none", label: "Never" },
                              { key: "biweekly", label: "Every 2 weeks" },
                              { key: "monthly", label: "Monthly" },
                              { key: "custom", label: "Custom" },
                            ] as const).map((opt) => (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => {
                                  setRecurring(opt.key);
                                  setRepeatFreqOpen(false);
                                  setOccurrenceOverrides({});
                                  setEditingOccurrence(null);
                                  if (opt.key === "custom" && scheduledDates.length === 0) setCalendarOpen(true);
                                }}
                                className="flex w-full items-center justify-between border-b border-white/6 px-4 py-3 text-left last:border-0 hover:bg-white/5 transition"
                              >
                                <span className="text-sm font-medium text-white">{opt.label}</span>
                                {recurring === opt.key && (
                                  <span className="material-symbols-outlined text-[18px] text-[#00f5ff]">check</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>

                    {/* End date + time for biweekly / monthly + occurrence list */}
                    {(recurring === "biweekly" || recurring === "monthly") ? (() => {
                      const today = new Date();
                      const maxDate = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate());
                      const startD = startsAtLocal ? new Date(startsAtLocal) : today;
                      const endD = repeatEndDate ? new Date(repeatEndDate + "T00:00:00") : null;
                      const cap = endD ? (endD < maxDate ? endD : maxDate) : null;
                      const occurrences: Date[] = [];
                      let cursor = new Date(startD);
                      while (cap && cursor <= cap && occurrences.length < 12) {
                        occurrences.push(new Date(cursor));
                        cursor = recurring === "biweekly"
                          ? new Date(cursor.getTime() + 14 * 24 * 60 * 60 * 1000)
                          : new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
                      }
                      return (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <CalendarPicker
                              label="End date"
                              value={repeatEndDate}
                              minDate={localDatePart(startsAtLocal)}
                              maxDate={(() => { const d = new Date(); d.setMonth(d.getMonth() + 3); const p = (n: number) => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; })()}
                              onChange={setRepeatEndDate}
                            />
                            <TimePickerDropdown
                              label="End time"
                              value={repeatEndTime || localTimePart(endsAtLocal)}
                              onChange={setRepeatEndTime}
                            />
                          </div>
                          {occurrences.length > 0 && (() => {
                            const fmtKey = (d: Date) => {
                              const p = (n: number) => String(n).padStart(2,"0");
                              return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
                            };
                            const visibleOccurrences = occurrences.map((d) => {
                              const key = fmtKey(d);
                              const override = occurrenceOverrides[key];
                              if (override === null) return null; // deleted
                              return { originalKey: key, displayKey: override ?? key };
                            }).filter(Boolean) as { originalKey: string; displayKey: string }[];
                            const maxDate3mo = (() => { const d = new Date(); d.setMonth(d.getMonth() + 3); const p = (n: number) => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; })();
                            return (
                              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 space-y-2">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#00f5ff]/70">
                                  {visibleOccurrences.length} occurrence{visibleOccurrences.length !== 1 ? "s" : ""}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {visibleOccurrences.map(({ originalKey, displayKey }) => {
                                    const d = new Date(displayKey + "T00:00:00");
                                    const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                                    const isEditing = editingOccurrence === originalKey;
                                    return (
                                      <div key={originalKey} className="relative">
                                        <div className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${isEditing ? "border-[#00f5ff]/50 bg-[#00f5ff]/10 text-[#00f5ff]" : "border-white/12 bg-white/[0.04] text-slate-300"}`}>
                                          <button
                                            type="button"
                                            onClick={() => setEditingOccurrence(isEditing ? null : originalKey)}
                                            className="flex items-center gap-1"
                                          >
                                            <span className="material-symbols-outlined text-[12px] opacity-60">edit_calendar</span>
                                            {label}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setOccurrenceOverrides((prev) => ({ ...prev, [originalKey]: null }));
                                              if (editingOccurrence === originalKey) setEditingOccurrence(null);
                                            }}
                                            className="ml-0.5 text-slate-500 hover:text-rose-400 transition"
                                          >
                                            <span className="material-symbols-outlined text-[13px]">close</span>
                                          </button>
                                        </div>
                                        {isEditing && (
                                          <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-2xl border border-white/12 bg-[#181c20] p-3 shadow-[0_16px_48px_rgba(0,0,0,0.6)]">
                                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Change date</p>
                                            <CalendarPicker
                                              value={displayKey}
                                              onChange={(newKey) => {
                                                setOccurrenceOverrides((prev) => ({ ...prev, [originalKey]: newKey }));
                                                setEditingOccurrence(null);
                                              }}
                                              minDate={localDatePart(startsAtLocal)}
                                              maxDate={maxDate3mo}
                                            />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                                {Object.values(occurrenceOverrides).some((v) => v === null) && (
                                  <button
                                    type="button"
                                    onClick={() => setOccurrenceOverrides({})}
                                    className="text-[11px] text-slate-500 hover:text-slate-300 transition"
                                  >
                                    Reset all
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </>
                      );
                    })() : null}

                    {/* Custom dates row */}
                    {recurring === "custom" ? (
                      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-bold text-white">Custom dates</p>
                          <p className="mt-0.5 text-[11px] text-slate-400 truncate">
                            {scheduledDates.length > 0
                              ? scheduledDates.map((d) =>
                                  new Date(d.dateKey + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                                ).join(", ")
                              : "No dates selected"}
                          </p>
                        </div>
                        <button type="button" onClick={() => setCalendarOpen(true)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white transition">
                          <span className="material-symbols-outlined text-[16px]">edit</span>
                        </button>
                        <button type="button" onClick={() => setScheduledDates([])}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-rose-400 transition">
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {calendarOpen ? (
            <CustomEventCalendarModal
              maxDates={2}
              initialDates={scheduledDates}
              defaultStartTime={localTimePart(startsAtLocal) || "20:00"}

              onClose={() => setCalendarOpen(false)}
              onDone={(dates) => {
                setScheduledDates(dates);
                setCalendarOpen(false);
                if (dates.length > 0) {
                  const sorted = [...dates].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
                  const first = sorted[0]!;
                  const last = sorted[sorted.length - 1]!;
                  const firstTime = first.slots[0]?.start ?? localTimePart(startsAtLocal);
                  const lastTime = last.slots[0]?.end ?? localTimePart(endsAtLocal);
                  setStartsAtLocal(mergeLocalDateTime(first.dateKey, firstTime));
                  setEndsAtLocal(mergeLocalDateTime(last.dateKey, lastTime));
                  setShowEndDate(true);
                }
              }}
            />
          ) : null}

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/8 px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-semibold text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <div className="flex flex-col items-end gap-2">
              <p className="text-[11px] text-slate-400">
                Publish requires venue, city, country, start/end time, and a {MIN_DESCRIPTION_LENGTH}+ character description.
              </p>
              <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submitEvent("draft")}
                disabled={submitting || uploadingCover || !canSaveDraft}
                className="rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                onClick={() => void submitEvent("published")}
                disabled={submitting || uploadingCover || !canPublish}
                className="rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400 px-5 py-2 text-sm font-bold text-[#052328] hover:opacity-95 disabled:opacity-60"
              >
                {submitting ? "Saving…" : uploadingCover ? "Uploading…" : "Publish event"}
              </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Location modal */}
      {locationModalOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121414] shadow-[0_30px_60px_rgba(0,0,0,0.5)]">
            <div className="h-px w-full bg-gradient-to-r from-[#0df2f2]/70 via-[#0df2f2]/20 to-[#f20db1]/70" />
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
                      className="flex w-full items-center gap-3 border-b border-white/5 px-4 py-3 text-left last:border-0 transition-colors hover:bg-[#0df2f2]/6"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0df2f2]/10">
                        <span className="material-symbols-outlined text-[18px] text-[#0df2f2]/70">location_on</span>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{geocodePlaceName(r)}</p>
                        <p className="truncate text-[11px] text-white/35">{geocodePlaceDetails(r) || r.displayName}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

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
                  <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#0d0f10]">
                    <span className="material-symbols-outlined text-[40px] text-[#0df2f2]/25">map</span>
                    <p className="text-sm text-white/30">Search for a location to preview the map</p>
                  </div>
                )}
              </div>

              {locationModalSelected ? (
                <div className="flex items-center gap-2 rounded-xl border border-[#0df2f2]/20 bg-[#0df2f2]/8 px-3 py-2">
                  <span className="material-symbols-outlined text-[16px] text-[#0df2f2]">check_circle</span>
                  <p className="truncate text-sm font-semibold text-[#0df2f2]/90">{geocodePlaceName(locationModalSelected)}</p>
                  <button type="button" onClick={() => { setLocationModalSelected(null); setLocationModalQuery(""); }} className="ml-auto shrink-0 text-white/30 hover:text-white">
                    <span className="material-symbols-outlined text-[15px]">close</span>
                  </button>
                </div>
              ) : null}

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
                  disabled={!locationModalSelected}
                  onClick={() => {
                    if (locationModalSelected) {
                      const resolvedCity = locationModalSelected.address.city ?? locationModalSelected.address.town ?? locationModalSelected.address.village ?? locationModalSelected.address.municipality ?? "";
                      if (resolvedCity) setCity(resolvedCity);
                      if (locationModalSelected.address.country) setCountry(locationModalSelected.address.country);
                      const street = exactStreetAddress(locationModalSelected);
                      if (street) setVenueAddress(street);
                      setVenueName(geocodePlaceName(locationModalSelected));
                    }
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
    </>
  );
}
