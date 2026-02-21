"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import {
  type EventMemberRecord,
  type EventRecord,
  type LiteProfile,
  mapEventMemberRows,
  mapEventRows,
  mapProfileRows,
} from "@/lib/events/model";

type AccessFilter = "all" | "public" | "private";
type DatePreset = "any" | "today" | "tomorrow" | "this_weekend" | "this_week" | "next_week" | "this_month" | "custom";
type InterestState = "interested" | "going" | "not_interested";

type DateRange = {
  start: string;
  end: string;
};

const REGULAR_EVENTS_BATCH = 6;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function localIso(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function atStartOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatPickerDate(iso: string) {
  if (!iso) return "";
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
}

function resolveDateRange(preset: DatePreset, customFrom: string, customTo: string): DateRange {
  const today = atStartOfDay(new Date());
  const dayOfWeek = today.getDay(); // Sun 0 ... Sat 6

  if (preset === "any") return { start: "", end: "" };
  if (preset === "custom") {
    return {
      start: customFrom || "",
      end: customTo || "",
    };
  }

  if (preset === "today") {
    const iso = localIso(today);
    return { start: iso, end: iso };
  }

  if (preset === "tomorrow") {
    const iso = localIso(addDays(today, 1));
    return { start: iso, end: iso };
  }

  if (preset === "this_weekend") {
    const daysToSaturday = (6 - dayOfWeek + 7) % 7;
    const saturday = addDays(today, daysToSaturday);
    const sunday = addDays(saturday, 1);
    return { start: localIso(saturday), end: localIso(sunday) };
  }

  if (preset === "this_week") {
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = addDays(today, mondayOffset);
    const sunday = addDays(monday, 6);
    return { start: localIso(monday), end: localIso(sunday) };
  }

  if (preset === "next_week") {
    const mondayOffset = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const monday = addDays(today, mondayOffset);
    const sunday = addDays(monday, 6);
    return { start: localIso(monday), end: localIso(sunday) };
  }

  // this_month
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: localIso(first), end: localIso(last) };
}

function datePresetLabel(preset: DatePreset, customFrom: string, customTo: string) {
  if (preset === "any") return "Any date";
  if (preset === "today") return "Today";
  if (preset === "tomorrow") return "Tomorrow";
  if (preset === "this_weekend") return "This weekend";
  if (preset === "this_week") return "This week";
  if (preset === "next_week") return "Next week";
  if (preset === "this_month") return "This month";

  if (customFrom && customTo) return `${formatPickerDate(customFrom)} - ${formatPickerDate(customTo)}`;
  if (customFrom) return `From ${formatPickerDate(customFrom)}`;
  if (customTo) return `Until ${formatPickerDate(customTo)}`;
  return "Custom range";
}

function eventTypeBadge(eventType: string) {
  const normalized = eventType.toLowerCase();
  if (normalized.includes("festival")) return "border-cyan-300/35 bg-cyan-300/15 text-cyan-100";
  if (normalized.includes("workshop") || normalized.includes("class")) return "border-emerald-300/35 bg-emerald-400/15 text-emerald-100";
  if (normalized.includes("social")) return "border-fuchsia-300/35 bg-fuchsia-400/15 text-fuchsia-100";
  return "border-slate-300/30 bg-slate-400/15 text-slate-100";
}

function summarize(text: string | null | undefined, max = 78) {
  const value = (text ?? "").trim();
  if (!value) return "No description provided yet.";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}...`;
}

function seededEventCover(event: EventRecord) {
  const seed = `${event.id}-${event.city}-${event.country}-${event.eventType}`;
  return `https://picsum.photos/seed/conxion-event-${encodeURIComponent(seed)}/920/520`;
}

function eventDateBadgeParts(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { month: "--", day: "--", weekday: "--" };
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(parsed),
    month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(parsed).toUpperCase(),
    day: new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(parsed),
  };
}

function formatEventRangeWithWeekday(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Date not set";

  const sameDay = start.toDateString() === end.toDateString();
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startWeekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(start);
  const endWeekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(end);
  const startMonthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(start);
  const endMonthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(end);

  if (sameDay) return `${startWeekday}, ${startMonthDay}`;
  if (sameMonth) return `${startWeekday}, ${startMonthDay} - ${endWeekday}, ${endMonthDay}`;
  return `${startWeekday}, ${startMonthDay} - ${endWeekday}, ${endMonthDay}`;
}

function formatEventStartTime(startsAt: string) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

function getTimelineStatus(event: EventRecord) {
  if (event.status === "cancelled") {
    return {
      label: "Cancelled",
      textClass: "text-rose-300/90",
    };
  }

  const now = Date.now();
  const start = new Date(event.startsAt).getTime();
  const end = new Date(event.endsAt).getTime();
  if (!Number.isNaN(start) && !Number.isNaN(end)) {
    if (start <= now && now <= end) {
      return {
        label: "Happening now",
        textClass: "text-red-400",
      };
    }

    if (end < now) {
      return {
        label: "Ended",
        textClass: "text-slate-400",
      };
    }
  }

  const startDay = event.startsAt.slice(0, 10);
  const tomorrowDay = localIso(addDays(atStartOfDay(new Date()), 1));
  if (startDay === tomorrowDay) {
    return {
      label: "Tomorrow",
      textClass: "text-cyan-200/90",
    };
  }

  return {
    label: "Upcoming",
    textClass: "text-emerald-300/90",
  };
}

function friendSummary(names: string[], total: number) {
  if (!total) return "";
  if (total <= 3) return names.join(", ");
  if (names.length === 1) return `${names[0]} and ${total - 1} friends`;
  if (names.length === 2) return `${names[0]}, ${names[1]} and ${total - 2} friends`;
  return `${names[0]}, ${names[1]}, ${names[2]} and ${total - 3} friends`;
}

function compactLocation(event: EventRecord, isAuthenticated: boolean) {
  const venueAddress = (event.venueAddress ?? "").trim();
  if (venueAddress) {
    const parts = venueAddress
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    const street = parts[0] ?? "";
    const neighborhood = parts[1] ?? "";

    if (isAuthenticated && street && neighborhood) return `${street}, ${neighborhood}`;
    if (isAuthenticated && street) return street;
    if (!isAuthenticated && neighborhood) return neighborhood;
  }

  const venue = (event.venueName ?? "").trim();
  if (venue) return venue;
  return [event.city, event.country].filter(Boolean).join(", ");
}

export default function EventsExplorePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [myCity, setMyCity] = useState("");
  const [myCountry, setMyCountry] = useState("");

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [allMembers, setAllMembers] = useState<EventMemberRecord[]>([]);
  const [myMemberships, setMyMemberships] = useState<EventMemberRecord[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});
  const [connectedUserIds, setConnectedUserIds] = useState<string[]>([]);

  const [query, setQuery] = useState("");
  const [myLocationOnly, setMyLocationOnly] = useState(false);
  const [connectionsOnly, setConnectionsOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [styleFilter, setStyleFilter] = useState("all");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all");

  const [datePreset, setDatePreset] = useState<DatePreset>("any");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");

  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [dateCustomMode, setDateCustomMode] = useState(false);
  const [interestMenuEventId, setInterestMenuEventId] = useState<string | null>(null);
  const [shareMenuEventId, setShareMenuEventId] = useState<string | null>(null);
  const [interestStateByEvent, setInterestStateByEvent] = useState<Record<string, InterestState>>({});
  const [visibleRegularCount, setVisibleRegularCount] = useState(REGULAR_EVENTS_BATCH);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const effectiveAccessFilter: AccessFilter = !isAuthenticated && accessFilter === "private" ? "all" : accessFilter;

  const closeMenus = useCallback(() => {
    setDateMenuOpen(false);
    setDateCustomMode(false);
    setInterestMenuEventId(null);
    setShareMenuEventId(null);
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenus();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [closeMenus]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [{ data: sessionData }, { data: authData, error: authErr }] = await Promise.all([
      supabase.auth.getSession(),
      supabase.auth.getUser(),
    ]);

    const token = sessionData.session?.access_token ?? null;
    const userId = authErr || !authData.user ? null : authData.user.id;

    setMeId(userId);
    setIsAuthenticated(Boolean(userId));

    let eventRows: EventRecord[] = [];

    if (userId) {
      const [profileRes, eventsRes] = await Promise.all([
        supabase.from("profiles").select("city,country").eq("user_id", userId).maybeSingle(),
        supabase.from("events").select("*").eq("status", "published").order("starts_at", { ascending: true }).limit(400),
      ]);

      if (profileRes.data) {
        const row = profileRes.data as Record<string, unknown>;
        setMyCity(typeof row.city === "string" ? row.city : "");
        setMyCountry(typeof row.country === "string" ? row.country : "");
      }

      if (eventsRes.error) {
        setError(eventsRes.error.message);
        setLoading(false);
        return;
      }

      eventRows = mapEventRows((eventsRes.data ?? []) as unknown[]);
    } else {
      setMyCity("");
      setMyCountry("");

      const eventsRes = await supabase.rpc("list_public_events_lite", { p_limit: 400 });
      if (eventsRes.error) {
        setError(eventsRes.error.message);
        setLoading(false);
        return;
      }
      eventRows = mapEventRows((eventsRes.data ?? []) as unknown[]);
    }

    setEvents(eventRows);

    if (!eventRows.length) {
      setAllMembers([]);
      setMyMemberships([]);
      setProfilesById({});
      setConnectedUserIds([]);
      setLoading(false);
      return;
    }

    if (!userId || !token) {
      setAllMembers([]);
      setMyMemberships([]);
      setProfilesById({});
      setConnectedUserIds([]);
      setLoading(false);
      return;
    }

    const eventIds = eventRows.map((event) => event.id);
    const hostIds = Array.from(new Set(eventRows.map((event) => event.hostUserId)));

    const [membersRes, myMembersRes] = await Promise.all([
      supabase
        .from("event_members")
        .select("*")
        .in("event_id", eventIds)
        .in("status", ["host", "going", "waitlist"]),
      supabase.from("event_members").select("*").eq("user_id", userId).in("event_id", eventIds),
    ]);

    if (membersRes.error) {
      setAllMembers([]);
    } else {
      setAllMembers(mapEventMemberRows((membersRes.data ?? []) as unknown[]));
    }
    setMyMemberships(mapEventMemberRows((myMembersRes.data ?? []) as unknown[]));

    let acceptedConnections: Array<{ requester_id?: string; target_id?: string }> = [];
    const connectionsRes = await supabase
      .from("connections")
      .select("requester_id,target_id,status,blocked_by")
      .or(`requester_id.eq.${userId},target_id.eq.${userId}`)
      .eq("status", "accepted")
      .is("blocked_by", null)
      .limit(2000);

    if (connectionsRes.error) {
      const fallbackConnectionsRes = await supabase
        .from("connections")
        .select("requester_id,target_id,status")
        .or(`requester_id.eq.${userId},target_id.eq.${userId}`)
        .eq("status", "accepted")
        .limit(2000);
      if (!fallbackConnectionsRes.error) {
        acceptedConnections = (fallbackConnectionsRes.data ?? []) as Array<{ requester_id?: string; target_id?: string }>;
      }
    } else {
      acceptedConnections = (connectionsRes.data ?? []) as Array<{ requester_id?: string; target_id?: string }>;
    }

    const connectionIds = Array.from(
      new Set(
        acceptedConnections
          .map((row) => {
            const requester = typeof row.requester_id === "string" ? row.requester_id : "";
            const target = typeof row.target_id === "string" ? row.target_id : "";
            if (requester === userId) return target;
            if (target === userId) return requester;
            return "";
          })
          .filter(Boolean)
      )
    );

    setConnectedUserIds(connectionIds);

    const profileIds = Array.from(new Set([...hostIds, ...connectionIds]));
    if (profileIds.length) {
      const profilesRes = await supabase
        .from("profiles")
        .select("user_id,display_name,city,country,avatar_url")
        .in("user_id", profileIds.slice(0, 600));

      if (!profilesRes.error) {
        setProfilesById(mapProfileRows((profilesRes.data ?? []) as unknown[]));
      } else {
        setProfilesById({});
      }
    } else {
      setProfilesById({});
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  const memberStatusByEvent = useMemo(() => {
    const map: Record<string, EventMemberRecord> = {};
    myMemberships.forEach((membership) => {
      map[membership.eventId] = membership;
    });
    return map;
  }, [myMemberships]);

  const connectedAttendeesByEvent = useMemo(() => {
    const set = new Set(connectedUserIds);
    const map: Record<string, EventMemberRecord[]> = {};
    if (!set.size) return map;

    allMembers.forEach((member) => {
      if (!(member.status === "host" || member.status === "going" || member.status === "waitlist")) return;
      if (!set.has(member.userId)) return;
      if (!map[member.eventId]) map[member.eventId] = [];
      map[member.eventId].push(member);
    });

    Object.values(map).forEach((list) => {
      list.sort((a, b) => {
        const left = new Date(b.createdAt).getTime();
        const right = new Date(a.createdAt).getTime();
        if (Number.isNaN(left) || Number.isNaN(right)) return 0;
        return left - right;
      });
    });

    return map;
  }, [allMembers, connectedUserIds]);

  const eventTypeOptions = useMemo(() => {
    const set = new Set<string>();
    events.forEach((event) => {
      if (event.eventType.trim()) set.add(event.eventType.trim());
    });
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [events]);

  const styleOptions = useMemo(() => {
    const set = new Set<string>();
    events.forEach((event) => {
      event.styles.forEach((style) => {
        const normalized = style.trim();
        if (normalized) set.add(normalized);
      });
    });
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [events]);

  const range = useMemo(() => resolveDateRange(datePreset, customDateFrom, customDateTo), [datePreset, customDateFrom, customDateTo]);

  const filteredEvents = useMemo(() => {
    const queryText = query.trim().toLowerCase();

    return events.filter((event) => {
      if (!isAuthenticated && event.visibility !== "public") return false;
      if (effectiveAccessFilter !== "all" && event.visibility !== effectiveAccessFilter) return false;
      if (typeFilter !== "all" && event.eventType !== typeFilter) return false;
      if (styleFilter !== "all" && !event.styles.some((style) => style.toLowerCase() === styleFilter.toLowerCase())) return false;

      const eventDate = event.startsAt.slice(0, 10);
      if (range.start && eventDate < range.start) return false;
      if (range.end && eventDate > range.end) return false;

      if (myLocationOnly) {
        const cityMatch = myCity && event.city.toLowerCase() === myCity.toLowerCase();
        const countryMatch = myCountry && event.country.toLowerCase() === myCountry.toLowerCase();
        if (!cityMatch && !countryMatch) return false;
      }

      if (connectionsOnly) {
        const connectedCount = connectedAttendeesByEvent[event.id]?.length ?? 0;
        if (connectedCount === 0) return false;
      }

      if (!queryText) return true;

      const host = profilesById[event.hostUserId];
      const haystack = [
        event.title,
        event.city,
        event.country,
        event.venueName ?? "",
        event.eventType,
        event.styles.join(" "),
        host?.displayName ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(queryText);
    });
  }, [
    connectedAttendeesByEvent,
    connectionsOnly,
    effectiveAccessFilter,
    events,
    isAuthenticated,
    myCity,
    myCountry,
    myLocationOnly,
    profilesById,
    query,
    range.end,
    range.start,
    styleFilter,
    typeFilter,
  ]);

  const orderedEvents = useMemo(() => {
    return filteredEvents.slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [filteredEvents]);

  const featuredEvents = useMemo(() => orderedEvents.slice(0, 3), [orderedEvents]);
  const regularEvents = useMemo(() => orderedEvents.slice(3), [orderedEvents]);
  const visibleRegularEvents = useMemo(() => regularEvents.slice(0, visibleRegularCount), [regularEvents, visibleRegularCount]);
  const hasMoreRegularEvents = visibleRegularCount < regularEvents.length;

  const loadMoreRegularEvents = useCallback(() => {
    setVisibleRegularCount((current) => Math.min(current + REGULAR_EVENTS_BATCH, regularEvents.length));
  }, [regularEvents.length]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleRegularCount(REGULAR_EVENTS_BATCH);
  }, [query, myLocationOnly, connectionsOnly, typeFilter, styleFilter, effectiveAccessFilter, datePreset, customDateFrom, customDateTo]);

  useEffect(() => {
    if (!hasMoreRegularEvents) return;
    const node = loadMoreSentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleRegularCount((current) => Math.min(current + REGULAR_EVENTS_BATCH, regularEvents.length));
        }
      },
      { rootMargin: "260px 0px 260px 0px", threshold: 0 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreRegularEvents, regularEvents.length]);

  const handleShareAction = useCallback(
    async (eventId: string, action: "copy_link" | "share_feed" | "share_messenger" | "share_event" | "share_group" | "share_profile") => {
      setActionInfo(null);
      setActionError(null);

      const path = `/events/${eventId}`;
      const absolute = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

      if (action === "copy_link") {
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(absolute);
            setActionInfo("Event link copied.");
          } else {
            setActionError("Clipboard is not available in this browser.");
          }
        } catch {
          setActionError("Could not copy link.");
        }
        return;
      }

      if (action === "share_feed") {
        setActionInfo("Share to feed is ready. Connect posting in the next iteration.");
        return;
      }
      if (action === "share_messenger") {
        setActionInfo("Messenger share flow is ready. Hook it to your chat integration next.");
        return;
      }
      if (action === "share_event") {
        setActionInfo("Event-to-event share slot prepared.");
        return;
      }
      if (action === "share_group") {
        setActionInfo("Group share slot prepared.");
        return;
      }
      setActionInfo("Profile share slot prepared.");
    },
    []
  );

  const dateOptions: Array<{ key: DatePreset; label: string }> = [
    { key: "any", label: "Any date" },
    { key: "today", label: "Today" },
    { key: "tomorrow", label: "Tomorrow" },
    { key: "this_weekend", label: "This weekend" },
    { key: "this_week", label: "This week" },
    { key: "next_week", label: "Next week" },
    { key: "this_month", label: "This month" },
    { key: "custom", label: "Custom date range" },
  ];

  const renderEventCard = (event: EventRecord, featured = false) => {
    const myMembership = memberStatusByEvent[event.id];
    const isHost = Boolean(meId && meId === event.hostUserId);
    const hero = (isHost && event.coverUrl) || (event.coverStatus === "approved" ? event.coverUrl : null) || seededEventCover(event);

    const connectedMembersRaw = connectedAttendeesByEvent[event.id] ?? [];
    const connectedMembers = Array.from(new Map(connectedMembersRaw.map((row) => [row.userId, row])).values());
    const friendProfiles = connectedMembers.slice(0, 3).map((member) => profilesById[member.userId]).filter(Boolean);
    const friendNames = friendProfiles.map((profile) => profile.displayName);
    const friendCount = connectedMembers.length;
    const friendText = friendSummary(friendNames, friendCount);

    const timeline = getTimelineStatus(event);
    const dateBadge = eventDateBadgeParts(event.startsAt);
    const rangeLabel = formatEventRangeWithWeekday(event.startsAt, event.endsAt);
    const startTimeLabel = formatEventStartTime(event.startsAt);
    const interestState =
      interestStateByEvent[event.id] ?? (myMembership?.status === "going" || myMembership?.status === "waitlist" ? "going" : "interested");
    const interestLabel = interestState === "going" ? "Going" : interestState === "not_interested" ? "Not interested" : "Interested";

    return (
      <article
        key={event.id}
        className={cx(
          "relative flex h-full flex-col overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] shadow-[0_6px_20px_rgba(0,0,0,0.3)] transition hover:-translate-y-0.5 hover:border-cyan-300/30",
          featured &&
            "border-cyan-300/35 bg-[linear-gradient(180deg,rgba(37,209,244,0.08)_0%,rgba(18,18,18,0.98)_40%)] shadow-[0_12px_32px_rgba(37,209,244,0.18)]"
        )}
        onClick={(entry) => entry.stopPropagation()}
      >
        {featured ? <div className="h-[2px] w-full bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-cyan-200" /> : null}

        <Link href={`/events/${event.id}`} className="block">
          <div className={cx("relative h-[108px]", featured && "h-[112px]")}>
            <img src={hero} alt={event.title} className="h-full w-full object-cover transition duration-700 hover:scale-105" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-transparent to-transparent" />

            <div className="absolute left-2 top-2 flex items-center gap-1.5">
              <span className={cx("rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase", eventTypeBadge(event.eventType))}>
                {event.eventType}
              </span>
            </div>

            <div className="absolute right-2 top-2">
              <span className="rounded-full border border-white/20 bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-100">
                {event.visibility}
              </span>
            </div>
          </div>
        </Link>

        <div className="relative flex flex-1 flex-col p-2">
          <div className="pointer-events-none absolute right-2 top-1 z-10">
            <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/14 px-2 py-1 text-center shadow-[0_8px_20px_rgba(34,211,238,0.12)]">
              <p className="text-[10px] font-semibold tracking-wide text-cyan-100">{dateBadge.weekday}</p>
              <p className="text-[10px] font-semibold tracking-wide text-cyan-100">{dateBadge.month}</p>
              <p className="text-[22px] font-extrabold leading-none text-white">{dateBadge.day}</p>
            </div>
          </div>

          <div className="mb-0.5">
            <p className={cx("mb-0.5 text-[10px] font-semibold uppercase tracking-wide", timeline.textClass)}>{timeline.label}</p>
            <Link href={`/events/${event.id}`} className="block min-w-0 pr-[98px]">
              <h2 className="line-clamp-2 min-h-[34px] text-[15px] font-bold leading-tight text-white">{event.title}</h2>
            </Link>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-cyan-200/90">
              {rangeLabel}
              {startTimeLabel ? ` • ${startTimeLabel}` : ""}
            </p>
          </div>

          <div>
            <p className="mt-0.5 flex items-center gap-1 text-[13px] text-slate-300">
              <span className="material-symbols-outlined text-[16px] text-cyan-200">location_on</span>
              <span className="truncate">{compactLocation(event, isAuthenticated)}</span>
              {event.styles.length ? (
                <>
                  <span className="text-white/40">,</span>
                  <span className="truncate text-cyan-100/85">{event.styles.slice(0, 2).join(", ")}</span>
                </>
              ) : null}
            </p>

            <p className="mt-0.5 line-clamp-2 min-h-[30px] text-[13px] leading-[1.25] text-slate-400">{summarize(event.description)}</p>

            <div className="mt-0.5 min-h-[20px]">
              {isAuthenticated ? (
                friendCount > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {connectedMembers.slice(0, 3).map((member) => {
                        const profile = profilesById[member.userId];
                        return (
                          <div key={member.id} className="h-7 w-7 overflow-hidden rounded-full border border-[#121212] bg-[#1f2a2f]">
                            {profile?.avatarUrl ? (
                              <img src={profile.avatarUrl} alt={profile.displayName} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-cyan-100">
                                {(profile?.displayName ?? "F").slice(0, 1).toUpperCase()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="truncate text-[11px] text-slate-300">{friendText}</p>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">No direct connections attending yet</p>
                )
              ) : (
                <p className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                  <span className="material-symbols-outlined text-[14px]">lock</span>
                  Attendee identities are hidden
                </p>
              )}
            </div>
          </div>

          <div className="mt-auto flex items-center gap-1.5 border-t border-white/10 pt-1">
            <div className="relative flex-1">
              <button
                type="button"
                onClick={() => {
                  setShareMenuEventId(null);
                  setInterestMenuEventId((current) => (current === event.id ? null : event.id));
                  setDateMenuOpen(false);
                  setDateCustomMode(false);
                }}
                className="flex h-[33px] w-full items-center justify-center gap-1 rounded-xl bg-white/8 text-[12px] font-semibold text-white/90 hover:bg-white/12"
              >
                <span className="material-symbols-outlined text-[18px]">star</span>
                {interestLabel}
                <span className="material-symbols-outlined text-[16px]">expand_more</span>
              </button>

              {interestMenuEventId === event.id ? (
                <div className="absolute bottom-[46px] left-0 z-30 w-[260px] rounded-xl border border-white/10 bg-[#202326] p-2 shadow-2xl">
                  {!isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => router.push(`/auth?next=${encodeURIComponent(`/events/${event.id}`)}`)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/8"
                    >
                      <span className="material-symbols-outlined text-[18px] text-cyan-300">lock</span>
                      Sign in to save interest
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setInterestStateByEvent((state) => ({ ...state, [event.id]: "interested" }));
                          setInterestMenuEventId(null);
                          setActionInfo("Marked as interested.");
                        }}
                        className={cx(
                          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                          interestState === "interested" ? "bg-white/10 text-blue-300" : "text-white hover:bg-white/6"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[18px]">star</span>
                          Interested
                        </span>
                        {interestState === "interested" ? <span className="text-blue-300">●</span> : null}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setInterestMenuEventId(null);
                          router.push(`/events/${event.id}`);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/6"
                      >
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[18px]">check_circle</span>
                          Going
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setInterestStateByEvent((state) => ({ ...state, [event.id]: "not_interested" }));
                          setInterestMenuEventId(null);
                          setActionInfo("Marked as not interested.");
                        }}
                        className={cx(
                          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                          interestState === "not_interested" ? "bg-white/10 text-white" : "text-white hover:bg-white/6"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[18px]">cancel</span>
                          Not interested
                        </span>
                        {interestState === "not_interested" ? <span className="text-blue-300">●</span> : null}
                      </button>

                      <div className="my-1 h-px bg-white/10" />

                      <Link
                        href={`/events/${event.id}`}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-cyan-100 hover:bg-white/6"
                      >
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                          View event details
                        </span>
                        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                      </Link>
                    </>
                  )}
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setInterestMenuEventId(null);
                  setShareMenuEventId((current) => (current === event.id ? null : event.id));
                  setDateMenuOpen(false);
                  setDateCustomMode(false);
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 text-white/85 hover:bg-white/12"
                aria-label="Event options"
              >
                <span className="material-symbols-outlined text-[20px]">more_horiz</span>
              </button>

              {shareMenuEventId === event.id ? (
                <div className="absolute right-0 top-[46px] z-30 w-[280px] rounded-xl border border-white/10 bg-[#202326] p-2 shadow-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      void handleShareAction(event.id, "copy_link");
                      setShareMenuEventId(null);
                    }}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/6"
                  >
                    <span className="material-symbols-outlined text-[20px] text-cyan-200">link</span>
                    <span>
                      Copy event link
                      <span className="block text-xs text-white/55">Invite others with direct access</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleShareAction(event.id, "share_feed");
                      setShareMenuEventId(null);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/6"
                  >
                    <span className="material-symbols-outlined text-[20px]">edit_square</span>
                    Share to Feed
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleShareAction(event.id, "share_messenger");
                      setShareMenuEventId(null);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/6"
                  >
                    <span className="material-symbols-outlined text-[20px]">chat</span>
                    Send in Messenger
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleShareAction(event.id, "share_event");
                      setShareMenuEventId(null);
                    }}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/6"
                  >
                    <span className="material-symbols-outlined text-[20px]">event</span>
                    <span>
                      Share to an event
                      <span className="block text-xs text-white/55">Reach dancers already engaging with similar events</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleShareAction(event.id, "share_group");
                      setShareMenuEventId(null);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/6"
                  >
                    <span className="material-symbols-outlined text-[20px]">groups</span>
                    Share to a group
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void handleShareAction(event.id, "share_profile");
                      setShareMenuEventId(null);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/6"
                  >
                    <span className="material-symbols-outlined text-[20px]">person_add</span>
                    Share on a friend&apos;s profile
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {!isAuthenticated ? <div className="absolute inset-y-0 right-0 w-[2px] bg-gradient-to-b from-transparent via-cyan-300/50 to-transparent" /> : null}
      </article>
    );
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />

      <main className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8" onClick={closeMenus}>
        <header className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-white">Discover Events</h1>

          <div className="flex items-center gap-2">
            {!isAuthenticated ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75">
                <span className="material-symbols-outlined text-[15px] text-cyan-300">lock</span>
                Limited mode
              </span>
            ) : null}

            {isAuthenticated ? (
              <Link
                href="/events/new"
                className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/20 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/30"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Create Event
              </Link>
            ) : (
              <Link
                href="/auth?next=/events"
                className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/20 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/30"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="material-symbols-outlined text-[18px]">login</span>
                Sign in
              </Link>
            )}
          </div>
        </header>

        <section
          className="mb-6 rounded-2xl border border-white/10 bg-[#121212] p-3"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setMyLocationOnly((value) => !value)}
              disabled={!isAuthenticated || (!myCity && !myCountry)}
              className={cx(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition",
                myLocationOnly
                  ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                  : "border-white/10 bg-white/5 text-white/70 hover:text-white",
                (!isAuthenticated || (!myCity && !myCountry)) && "cursor-not-allowed opacity-45"
              )}
            >
              <span className="material-symbols-outlined text-[17px]">location_on</span>
              My location
            </button>

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setDateMenuOpen((open) => !open);
                  setDateCustomMode(false);
                  setInterestMenuEventId(null);
                  setShareMenuEventId(null);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white/80 hover:text-white"
              >
                <span className="material-symbols-outlined text-[17px] text-cyan-300">calendar_month</span>
                {datePresetLabel(datePreset, customDateFrom, customDateTo)}
                <span className="material-symbols-outlined text-[16px]">expand_more</span>
              </button>

              {dateMenuOpen ? (
                <div className="absolute left-0 top-full z-40 mt-2 w-[320px] rounded-2xl border border-white/10 bg-[#202326] p-3 shadow-2xl">
                  {!dateCustomMode ? (
                    <div className="space-y-1">
                      {dateOptions.map((option) => {
                        const selected = datePreset === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => {
                              if (option.key === "custom") {
                                setDatePreset("custom");
                                setDateCustomMode(true);
                                return;
                              }
                              setDatePreset(option.key);
                              setDateMenuOpen(false);
                            }}
                            className={cx(
                              "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition",
                              selected ? "bg-white/10 text-white" : "text-white/85 hover:bg-white/5"
                            )}
                          >
                            <span>{option.label}</span>
                            <span
                              className={cx(
                                "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                                selected ? "border-blue-400 text-blue-400" : "border-white/40 text-transparent"
                              )}
                            >
                              ●
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        onClick={() => setDateCustomMode(false)}
                        className="mb-2 inline-flex items-center gap-1 text-sm text-white/75 hover:text-white"
                      >
                        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                        Back
                      </button>

                      <div className="grid gap-2">
                        <label className="text-xs text-white/65">
                          From
                          <input
                            type="date"
                            value={customDateFrom}
                            onChange={(event) => setCustomDateFrom(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-white/15 bg-black/25 px-2.5 py-2 text-sm text-white"
                          />
                        </label>
                        <label className="text-xs text-white/65">
                          To
                          <input
                            type="date"
                            value={customDateTo}
                            onChange={(event) => setCustomDateTo(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-white/15 bg-black/25 px-2.5 py-2 text-sm text-white"
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setDatePreset("custom");
                          setDateMenuOpen(false);
                          setDateCustomMode(false);
                        }}
                        className="mt-3 w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                      >
                        Apply
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <label className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white/80">
              <span className="material-symbols-outlined text-[17px] text-cyan-300">interests</span>
              <span className="text-white/65">Style</span>
              <select
                value={styleFilter}
                onChange={(event) => setStyleFilter(event.target.value)}
                className="bg-transparent text-sm text-white outline-none"
              >
                {styleOptions.map((option) => (
                  <option key={option} value={option} className="bg-[#13181b]">
                    {option === "all" ? "All styles" : option}
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white/80">
              <span className="material-symbols-outlined text-[17px] text-cyan-300">category</span>
              <span className="text-white/65">Type</span>
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="bg-transparent text-sm text-white outline-none"
              >
                {eventTypeOptions.map((option) => (
                  <option key={option} value={option} className="bg-[#13181b]">
                    {option === "all" ? "All types" : option}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => setConnectionsOnly((value) => !value)}
              disabled={!isAuthenticated}
              className={cx(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition",
                connectionsOnly
                  ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                  : "border-white/10 bg-white/5 text-white/70 hover:text-white",
                !isAuthenticated && "cursor-not-allowed opacity-45"
              )}
            >
              <span className="material-symbols-outlined text-[17px]">group</span>
              Connections
            </button>

            <label className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white/80">
              <span className="material-symbols-outlined text-[17px] text-cyan-300">lock</span>
              <select
                value={effectiveAccessFilter}
                onChange={(event) => setAccessFilter(event.target.value as AccessFilter)}
                className="bg-transparent text-sm text-white outline-none"
              >
                <option value="all" className="bg-[#13181b]">
                  Access: All
                </option>
                <option value="public" className="bg-[#13181b]">
                  Public
                </option>
                {isAuthenticated ? (
                  <option value="private" className="bg-[#13181b]">
                    Private
                  </option>
                ) : null}
              </select>
            </label>

            <div className="relative ml-auto min-w-[220px] flex-1">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                search
              </span>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Keyword search"
                className="h-10 w-full rounded-xl border border-white/10 bg-black/25 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
              />
            </div>
          </div>
        </section>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {actionError ? (
          <div className="mb-4 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{actionError}</div>
        ) : null}
        {actionInfo ? (
          <div className="mb-4 rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">{actionInfo}</div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-[#121212] p-8 text-center text-slate-300">Loading events...</div>
        ) : orderedEvents.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#121212] p-8 text-center text-slate-300">
            No events found for the current filters.
          </div>
        ) : (
          <div className="space-y-4">
            {featuredEvents.length ? (
              <section className="rounded-2xl border border-cyan-300/25 bg-[radial-gradient(circle_at_top_left,rgba(37,209,244,0.14),transparent_42%),radial-gradient(circle_at_top_right,rgba(217,70,239,0.12),transparent_46%),#101214] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-cyan-100">Featured Events</h2>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {featuredEvents.map((event) => renderEventCard(event, true))}
                </div>
              </section>
            ) : null}

            {regularEvents.length ? (
              <>
                <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {visibleRegularEvents.map((event) => renderEventCard(event))}
                </section>

                {hasMoreRegularEvents ? (
                  <div className="relative pt-2">
                    <div className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-gradient-to-b from-transparent to-[#0A0A0A]" />
                    <div ref={loadMoreSentinelRef} className="h-1 w-full" />
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={loadMoreRegularEvents}
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/10 px-5 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20"
                      >
                        View more
                        <span className="material-symbols-outlined text-[16px]">expand_more</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-24 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/85 to-transparent" />
    </div>
  );
}
