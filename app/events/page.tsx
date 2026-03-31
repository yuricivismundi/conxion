"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import PaginationControls from "@/components/PaginationControls";
import { supabase } from "@/lib/supabase/client";
import {
  type EventMemberRecord,
  type EventRecord,
  type LiteProfile,
  mapEventMemberRows,
  mapEventRows,
  mapProfileRows,
} from "@/lib/events/model";

type DatePreset = "any" | "today" | "tomorrow" | "this_weekend" | "this_week" | "next_week" | "this_month" | "custom";
type InterestState = "interested" | "going" | "not_interested";

type DateRange = {
  start: string;
  end: string;
};

const PUBLIC_EVENTS_CAP = 5;
const EVENTS_PAGE_SIZE = 10;
const PAST_EVENTS_CUTOFF_MONTHS = 3;

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
  if (normalized.includes("festival")) return "border-fuchsia-300/35 bg-fuchsia-400/15 text-fuchsia-100";
  if (normalized.includes("workshop") || normalized.includes("class") || normalized.includes("masterclass")) {
    return "border-cyan-300/35 bg-cyan-300/15 text-cyan-100";
  }
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

function EventsExplorePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [hostReferenceTotals, setHostReferenceTotals] = useState<Record<string, number>>({});
  const [connectedUserIds, setConnectedUserIds] = useState<string[]>([]);

  const [query, setQuery] = useState("");
  const [myLocationOnly, setMyLocationOnly] = useState(false);
  const [connectionsOnly, setConnectionsOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [styleFilter, setStyleFilter] = useState("all");
  const [referencesFilter, setReferencesFilter] = useState<"all" | "has" | "none">("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");

  const [datePreset, setDatePreset] = useState<DatePreset>("any");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");

  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [dateCustomMode, setDateCustomMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [interestMenuEventId, setInterestMenuEventId] = useState<string | null>(null);
  const [shareMenuEventId, setShareMenuEventId] = useState<string | null>(null);
  const [interestStateByEvent, setInterestStateByEvent] = useState<Record<string, InterestState>>({});
  const [eventsPage, setEventsPage] = useState(1);

  const requestedView = searchParams.get("view");
  const viewForcesPastOnly = requestedView === "past";
  const viewForcesOrganizingOnly = requestedView === "organizing";
  const viewForcesMyEventsOnly = requestedView === "mine" || viewForcesOrganizingOnly;
  const effectivePastOnly = isAuthenticated && viewForcesPastOnly;
  const effectiveMyEventsOnly = viewForcesMyEventsOnly;
  const effectiveOrganizingOnly = viewForcesOrganizingOnly;

  const effectiveDatePreset: DatePreset = !isAuthenticated && datePreset === "custom" ? "any" : datePreset;
  const effectiveCustomDateFrom = !isAuthenticated && datePreset === "custom" ? "" : customDateFrom;
  const effectiveCustomDateTo = !isAuthenticated && datePreset === "custom" ? "" : customDateTo;

  const closeMenus = useCallback(() => {
    setDateMenuOpen(false);
    setDateCustomMode(false);
    setFiltersOpen(false);
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
      const nowIso = new Date().toISOString();
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - PAST_EVENTS_CUTOFF_MONTHS);
      const cutoffIso = cutoff.toISOString();
      const eventsQuery = effectivePastOnly
        ? supabase
            .from("events")
            .select("*")
            .eq("status", "published")
            .lt("ends_at", nowIso)
            .gte("ends_at", cutoffIso)
            .order("ends_at", { ascending: false })
            .limit(300)
        : supabase
            .from("events")
            .select("*")
            .eq("status", "published")
            .gte("ends_at", nowIso)
            .order("starts_at", { ascending: true })
            .limit(300);

      const [profileRes, eventsRes] = await Promise.all([
        supabase.from("profiles").select("city,country").eq("user_id", userId).maybeSingle(),
        eventsQuery,
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
      setHostReferenceTotals({});
      setConnectedUserIds([]);
      setLoading(false);
      return;
    }

    if (!userId || !token) {
      setAllMembers([]);
      setMyMemberships([]);
      setProfilesById({});
      setHostReferenceTotals({});
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
      const profileFeedRes = await supabase.from("profiles_feed").select("id,ref_total_all").in("id", hostIds.slice(0, 600));
      if (!profileFeedRes.error) {
        const nextHostReferenceTotals: Record<string, number> = {};
        ((profileFeedRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
          const id = typeof row.id === "string" ? row.id : "";
          const total = typeof row.ref_total_all === "number" ? row.ref_total_all : 0;
          if (id) nextHostReferenceTotals[id] = total;
        });
        setHostReferenceTotals(nextHostReferenceTotals);
      } else {
        setHostReferenceTotals({});
      }

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
      setHostReferenceTotals({});
    }

    setLoading(false);
  }, [effectivePastOnly]);

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

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    events.forEach((event) => {
      const normalized = event.country.trim();
      if (normalized) set.add(normalized);
    });
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [events]);

  const cityOptions = useMemo(() => {
    const set = new Set<string>();
    events.forEach((event) => {
      const countryMatches = countryFilter === "all" || event.country.toLowerCase() === countryFilter.toLowerCase();
      if (!countryMatches) return;
      const normalized = event.city.trim();
      if (normalized) set.add(normalized);
    });
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [countryFilter, events]);

  const effectiveCityFilter = useMemo(() => {
    if (countryFilter === "all" || cityFilter === "all") return "all";
    return cityOptions.some((option) => option.toLowerCase() === cityFilter.toLowerCase()) ? cityFilter : "all";
  }, [cityFilter, cityOptions, countryFilter]);

  const range = useMemo(
    () => resolveDateRange(effectiveDatePreset, effectiveCustomDateFrom, effectiveCustomDateTo),
    [effectiveDatePreset, effectiveCustomDateFrom, effectiveCustomDateTo]
  );

  const filteredEvents = useMemo(() => {
    const queryText = isAuthenticated ? query.trim().toLowerCase() : "";

    return events.filter((event) => {
      if (!isAuthenticated && event.visibility !== "public") return false;
      if (typeFilter !== "all" && event.eventType !== typeFilter) return false;
      if (styleFilter !== "all" && !event.styles.some((style) => style.toLowerCase() === styleFilter.toLowerCase())) return false;
      if (referencesFilter !== "all") {
        const referenceTotal = Number(hostReferenceTotals[event.hostUserId] ?? 0);
        if (referencesFilter === "has" && referenceTotal <= 0) return false;
        if (referencesFilter === "none" && referenceTotal > 0) return false;
      }
      if (effectiveMyEventsOnly) {
        const isHost = Boolean(meId && event.hostUserId === meId);
        const hasMembership = Boolean(memberStatusByEvent[event.id]);
        if (effectiveOrganizingOnly) {
          if (!isHost) return false;
        } else if (!isHost && !hasMembership) {
          return false;
        }
      }

      const eventDate = event.startsAt.slice(0, 10);
      if (range.start && eventDate < range.start) return false;
      if (range.end && eventDate > range.end) return false;

      if (myLocationOnly) {
        const cityMatch = myCity && event.city.toLowerCase() === myCity.toLowerCase();
        const countryMatch = myCountry && event.country.toLowerCase() === myCountry.toLowerCase();
        if (!cityMatch && !countryMatch) return false;
      }

      if (countryFilter !== "all" && event.country.toLowerCase() !== countryFilter.toLowerCase()) return false;
      if (effectiveCityFilter !== "all" && event.city.toLowerCase() !== effectiveCityFilter.toLowerCase()) return false;

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
    events,
    isAuthenticated,
    myCity,
    myCountry,
    myLocationOnly,
    effectiveMyEventsOnly,
    effectiveOrganizingOnly,
    profilesById,
    query,
    range.end,
    range.start,
    referencesFilter,
    memberStatusByEvent,
    styleFilter,
    typeFilter,
    countryFilter,
    effectiveCityFilter,
    hostReferenceTotals,
    meId,
  ]);

  const orderedEvents = useMemo(() => {
    return filteredEvents.slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [filteredEvents]);

  const discoverEvents = useMemo(
    () => (isAuthenticated ? orderedEvents : orderedEvents.slice(0, PUBLIC_EVENTS_CAP)),
    [isAuthenticated, orderedEvents]
  );
  const totalEventPages = Math.max(1, Math.ceil(discoverEvents.length / EVENTS_PAGE_SIZE));
  const currentEventsPage = Math.min(eventsPage, totalEventPages);
  const pagedEvents = useMemo(
    () => discoverEvents.slice((currentEventsPage - 1) * EVENTS_PAGE_SIZE, currentEventsPage * EVENTS_PAGE_SIZE),
    [currentEventsPage, discoverEvents]
  );
  const featuredEvents = useMemo(
    () => (currentEventsPage === 1 ? pagedEvents.slice(0, 3) : []),
    [currentEventsPage, pagedEvents]
  );
  const regularEvents = useMemo(
    () => (currentEventsPage === 1 ? pagedEvents.slice(3) : pagedEvents),
    [currentEventsPage, pagedEvents]
  );
  const myEventsCount = useMemo(() => {
    return meId ? events.filter((event) => event.hostUserId === meId).length : 0;
  }, [events, meId]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (effectivePastOnly) count += 1;
    if (countryFilter !== "all") count += 1;
    if (effectiveCityFilter !== "all") count += 1;
    if (styleFilter !== "all") count += 1;
    if (referencesFilter !== "all") count += 1;
    if (typeFilter !== "all") count += 1;
    if (connectionsOnly) count += 1;
    if (datePreset !== "any") count += 1;
    if (isAuthenticated && myLocationOnly) count += 1;
    if (isAuthenticated && query.trim().length > 0) count += 1;
    return count;
  }, [connectionsOnly, countryFilter, datePreset, effectiveCityFilter, effectivePastOnly, isAuthenticated, myLocationOnly, query, referencesFilter, styleFilter, typeFilter]);

  const setEventsView = useCallback(
    (view: "active" | "past") => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (view === "past") {
        nextParams.set("view", "past");
      } else if (nextParams.get("view") === "past") {
        nextParams.delete("view");
      }
      const queryString = nextParams.toString();
      router.replace(queryString ? `/events?${queryString}` : "/events", { scroll: false });
    },
    [router, searchParams]
  );

  const resetFilters = useCallback(() => {
    setCountryFilter("all");
    setCityFilter("all");
    setStyleFilter("all");
    setReferencesFilter("all");
    setTypeFilter("all");
    setConnectionsOnly(false);
    setDatePreset("any");
    setCustomDateFrom("");
    setCustomDateTo("");
    setMyLocationOnly(false);
    setQuery("");
    if (viewForcesPastOnly) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("view");
      const queryString = nextParams.toString();
      router.replace(queryString ? `/events?${queryString}` : "/events", { scroll: false });
    }
  }, [router, searchParams, viewForcesPastOnly]);

  /* eslint-disable react-hooks/set-state-in-effect -- reset listing pagination when filters change. */
  useEffect(() => {
    setEventsPage(1);
  }, [
    query,
    myLocationOnly,
    connectionsOnly,
    typeFilter,
    styleFilter,
    countryFilter,
    cityFilter,
    referencesFilter,
    effectiveDatePreset,
    effectiveCustomDateFrom,
    effectiveCustomDateTo,
    effectivePastOnly,
    effectiveMyEventsOnly,
    effectiveOrganizingOnly,
    isAuthenticated,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const dateOptions: Array<{ key: DatePreset; label: string }> = useMemo(() => {
    const base: Array<{ key: DatePreset; label: string }> = [
      { key: "any", label: "Any date" },
      { key: "today", label: "Today" },
      { key: "tomorrow", label: "Tomorrow" },
      { key: "this_weekend", label: "This weekend" },
      { key: "this_week", label: "This week" },
      { key: "next_week", label: "Next week" },
      { key: "this_month", label: "This month" },
    ];
    if (isAuthenticated) base.push({ key: "custom", label: "Custom date range" });
    return base;
  }, [isAuthenticated]);

  const renderEventCard = (event: EventRecord, featured = false) => {
    const myMembership = memberStatusByEvent[event.id];
    const isHost = Boolean(meId && meId === event.hostUserId);
    const hero = event.coverUrl || seededEventCover(event);

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
    const eventTitle = isAuthenticated ? event.title : "Public dance event";

    return (
      <article
        key={event.id}
        className={cx(
          "relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#121212] shadow-[0_6px_20px_rgba(0,0,0,0.3)] transition hover:-translate-y-0.5 hover:border-cyan-300/30",
          featured &&
            "border-cyan-300/35 bg-[linear-gradient(180deg,rgba(37,209,244,0.08)_0%,rgba(18,18,18,0.98)_40%)] shadow-[0_12px_32px_rgba(37,209,244,0.18)]"
        )}
        onClick={() => router.push(`/events/${event.id}`)}
      >
        {featured ? <div className="h-[2px] w-full bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-cyan-200" /> : null}

        <Link href={`/events/${event.id}`} className="block">
          <div className={cx("relative h-[108px]", featured && "h-[112px]")}>
            <img src={hero} alt={eventTitle} className="h-full w-full object-cover transition duration-700 hover:scale-105" />
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
              {isAuthenticated ? (
                <h2 className="line-clamp-2 min-h-[34px] text-[15px] font-bold leading-tight text-white">{event.title}</h2>
              ) : (
                <div className="min-h-[34px]" />
              )}
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

          <div
            className="mt-auto flex items-center gap-1.5 border-t border-white/10 pt-1"
            onClick={(entry) => entry.stopPropagation()}
          >
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
                    <div className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/75">
                      <span className="material-symbols-outlined text-[18px] text-cyan-300">lock</span>
                      Interest actions are available after authentication
                    </div>
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-6">
            <div className="h-28 rounded-[28px] bg-white/[0.04] sm:h-36" />
            <div className="h-12 rounded-full bg-white/[0.04]" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-[280px] rounded-2xl bg-white/[0.04]" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />

      <main className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8" onClick={closeMenus}>
        {!isAuthenticated ? (
          <section className="mb-5 overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(0,245,255,0.08),transparent_42%),linear-gradient(180deg,rgba(18,24,32,0.96),rgba(10,10,10,0.98))] p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-2xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/55">Public events</p>
                <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl">Events</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-white/68 sm:text-base">
                  Browse public dance events by location and date. Create an account to unlock the full event experience.
                </p>
              </div>

              <div className="flex flex-col items-start gap-2 rounded-2xl border border-cyan-300/18 bg-cyan-300/8 px-5 py-4 text-left xl:min-w-[280px]">
                <p className="text-sm font-semibold text-white/72">Quick filters</p>
                <p className="text-sm leading-6 text-white/58">Use country, city, and date to narrow public events.</p>
                <Link
                  href="/auth?mode=signup"
                  className="inline-flex items-center justify-center rounded-full bg-[#00F5FF] px-5 py-2.5 text-sm font-bold text-[#0A0A0A] transition hover:opacity-90"
                >
                  Create an account
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        <header className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-white/50">
              Showing <span className="font-semibold text-white">{discoverEvents.length}</span>{" "}
              {effectivePastOnly ? "past events" : "events"}
            </p>
            {isAuthenticated ? (
              <Link
                href="/events/new"
                className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/20 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/30"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Create Event
              </Link>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setFiltersOpen((value) => !value);
                setDateMenuOpen(false);
                setDateCustomMode(false);
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#00F5FF] px-6 py-2.5 text-sm font-bold text-[#0A0A0A] transition hover:opacity-90 sm:w-auto"
            >
              <span className="material-symbols-outlined text-[18px]">tune</span>
              Filters{activeFiltersCount ? ` (${activeFiltersCount})` : ""}
            </button>
          </div>
        </header>

        {!isAuthenticated ? (
          <section className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <div className="flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Quick filters</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="block text-sm font-semibold text-white/88">
                    Country
                    <div className="relative mt-2">
                      <select
                        value={countryFilter === "all" ? "" : countryFilter}
                        onChange={(event) => {
                          setCountryFilter(event.target.value || "all");
                          setCityFilter("all");
                        }}
                        className="w-full appearance-none rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      >
                        <option value="">Any country</option>
                        {countryOptions.filter((option) => option !== "all").map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-3 top-3 text-[20px] text-white/40">
                        expand_more
                      </span>
                    </div>
                  </label>

                  <label className="block text-sm font-semibold text-white/88">
                    City
                    <div className="relative mt-2">
                      <select
                        value={effectiveCityFilter === "all" ? "" : effectiveCityFilter}
                        onChange={(event) => setCityFilter(event.target.value || "all")}
                        disabled={cityOptions.filter((option) => option !== "all").length === 0}
                        className="w-full appearance-none rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">{countryFilter === "all" ? "Any city" : "Any city in country"}</option>
                        {cityOptions.filter((option) => option !== "all").map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-3 top-3 text-[20px] text-white/40">
                        expand_more
                      </span>
                    </div>
                  </label>

                  <label className="block text-sm font-semibold text-white/88">
                    Date
                    <div className="relative mt-2">
                      <select
                        value={datePreset}
                        onChange={(event) => setDatePreset((event.target.value as DatePreset) || "any")}
                        className="w-full appearance-none rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      >
                        {dateOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-3 top-3 text-[20px] text-white/40">
                        expand_more
                      </span>
                    </div>
                  </label>

                  <div className="flex flex-col justify-end">
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex h-[50px] items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/85 transition hover:border-white/25 hover:bg-white/8"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {filtersOpen ? (
          <div className="fixed inset-0 z-[60]">
            <button aria-label="Close filters" className="absolute inset-0 bg-black/60" onClick={() => setFiltersOpen(false)} type="button" />

            <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#0A0A0A] shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
                <h2 className="text-2xl font-bold tracking-tight text-white">Filter Events</h2>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
                  aria-label="Close filters"
                >
                  <span className="material-symbols-outlined text-[22px]">close</span>
                </button>
              </div>

              <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6 pb-36">
                {isAuthenticated ? (
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 text-[#00F5FF]">
                      <span className="material-symbols-outlined text-[20px]">search</span>
                      <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Search & Shortcuts</h3>
                    </div>

                    <label className="group relative block">
                      <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[18px] text-white/35 transition-colors group-focus-within:text-cyan-300">
                        search
                      </span>
                      <input
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search events, cities, venues..."
                        className="h-12 w-full rounded-2xl border border-white/10 bg-[#1B1B1B] pl-11 pr-4 text-sm text-white/90 outline-none placeholder:text-white/35 transition focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      />
                    </label>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setMyLocationOnly((value) => !value)}
                        disabled={!myCity && !myCountry}
                        className={cx(
                          "inline-flex min-h-12 items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition",
                          myLocationOnly
                            ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-50"
                            : "border-white/10 bg-white/[0.03] text-white/80 hover:text-white",
                          (!myCity && !myCountry) && "cursor-not-allowed opacity-45"
                        )}
                        title={myCity || myCountry ? `Filter to ${[myCity, myCountry].filter(Boolean).join(", ")}` : "Location unavailable"}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span className="material-symbols-outlined text-[18px]">location_on</span>
                          My location
                        </span>
                        <span className="text-[11px] text-white/55">{myCity || myCountry ? "On map" : "No profile location"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFiltersOpen(false);
                          router.push("/events/my");
                        }}
                        className="inline-flex min-h-12 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
                      >
                        <span className="inline-flex items-center gap-2">
                          <span className="material-symbols-outlined text-[18px]">calendar_month</span>
                          My Events
                        </span>
                        <span className="rounded-full bg-black/35 px-2 py-0.5 text-[11px] font-bold">{myEventsCount}</span>
                      </button>
                    </div>
                  </section>
                ) : null}

                {isAuthenticated ? (
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 text-[#00F5FF]">
                      <span className="material-symbols-outlined text-[20px]">history</span>
                      <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Event timeline</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { key: "active", label: "Active events" },
                        { key: "past", label: "Past events" },
                      ] as const).map((option) => {
                        const selected =
                          (option.key === "past" && effectivePastOnly) || (option.key === "active" && !effectivePastOnly);
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => setEventsView(option.key)}
                            className={cx(
                              "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                              selected
                                ? "border-[#00F5FF] bg-[#00F5FF]/15 text-[#00F5FF]"
                                : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-[#00F5FF]">
                    <span className="material-symbols-outlined text-[20px]">location_on</span>
                    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Location</h3>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-white/90">Country</label>
                    <div className="relative mt-2">
                      <select
                        value={countryFilter === "all" ? "" : countryFilter}
                        onChange={(event) => {
                          setCountryFilter(event.target.value || "all");
                          setCityFilter("all");
                        }}
                        className="w-full appearance-none rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                      >
                        <option value="">Any country</option>
                        {countryOptions.filter((option) => option !== "all").map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-3 top-3 text-[20px] text-white/40">
                        expand_more
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-semibold text-white/90">City</label>
                      <span className="rounded-full bg-[#00F5FF]/15 px-2 py-0.5 text-xs font-bold text-[#00F5FF]">
                        {effectiveCityFilter === "all" ? "0/1" : "1/1"}
                      </span>
                    </div>
                    <div className="relative mt-2">
                      <select
                        value={effectiveCityFilter === "all" ? "" : effectiveCityFilter}
                        onChange={(event) => setCityFilter(event.target.value || "all")}
                        disabled={cityOptions.filter((option) => option !== "all").length === 0}
                        className="w-full appearance-none rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">{countryFilter === "all" ? "Any city" : "Any city in country"}</option>
                        {cityOptions.filter((option) => option !== "all").map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-3 top-3 text-[20px] text-white/40">
                        expand_more
                      </span>
                    </div>
                    {countryFilter === "all" ? (
                      <p className="mt-2 text-[11px] text-white/45">Choose a country to narrow city options.</p>
                    ) : null}
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-[#00F5FF]">
                    <span className="material-symbols-outlined text-[20px]">calendar_month</span>
                    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Date</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {dateOptions.map((option) => {
                      const selected = effectiveDatePreset === option.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setDatePreset(option.key)}
                          className={cx(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                            selected
                              ? "border-[#00F5FF] bg-[#00F5FF]/15 text-[#00F5FF]"
                              : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  {effectiveDatePreset === "custom" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-sm font-semibold text-white/90">
                        From
                        <input
                          type="date"
                          value={customDateFrom}
                          onChange={(event) => setCustomDateFrom(event.target.value)}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                        />
                      </label>
                      <label className="text-sm font-semibold text-white/90">
                        To
                        <input
                          type="date"
                          value={customDateTo}
                          onChange={(event) => setCustomDateTo(event.target.value)}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-[#1B1B1B] px-4 py-3 text-sm text-white/90 outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
                        />
                      </label>
                    </div>
                  ) : null}
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-[#00F5FF]">
                    <span className="material-symbols-outlined text-[20px]">category</span>
                    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Event Type</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {eventTypeOptions.map((option) => {
                      const selected = typeFilter === option;
                      const label = option === "all" ? "All" : option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setTypeFilter(option)}
                          className={cx(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                            selected
                              ? "border-[#00F5FF] bg-[#00F5FF]/15 text-[#00F5FF]"
                              : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-[#00F5FF]">
                    <span className="material-symbols-outlined text-[20px]">interests</span>
                    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Dance Styles</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {styleOptions.map((option) => {
                      const selected = styleFilter === option;
                      const label = option === "all" ? "All" : option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setStyleFilter(option)}
                          className={cx(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                            selected
                              ? "border-[#00F5FF] bg-[#00F5FF]/15 text-[#00F5FF]"
                              : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-[#00F5FF]">
                    <span className="material-symbols-outlined text-[20px]">verified</span>
                    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">References</h3>
                  </div>
                  <p className="text-[11px] text-white/45">Filter by whether the event organizer already has reference history.</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: "all", label: "All" },
                      { key: "has", label: "Has references" },
                      { key: "none", label: "No references" },
                    ].map((option) => {
                      const selected = referencesFilter === option.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setReferencesFilter(option.key as "all" | "has" | "none")}
                          className={cx(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                            selected
                              ? "border-[#00F5FF] bg-[#00F5FF]/15 text-[#00F5FF]"
                              : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {isAuthenticated ? (
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 text-[#00F5FF]">
                      <span className="material-symbols-outlined text-[20px]">group</span>
                      <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Network</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: "all", label: "All" },
                        { key: "friends", label: "Friends going" },
                      ].map((option) => {
                        const selected = option.key === "all" ? !connectionsOnly : connectionsOnly;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => setConnectionsOnly(option.key === "friends")}
                            className={cx(
                              "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                              selected
                                ? "border-[#00F5FF] bg-[#00F5FF]/15 text-[#00F5FF]"
                                : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

              </div>

              <div className="absolute inset-x-0 bottom-0 flex items-center gap-4 border-t border-white/10 bg-[#0A0A0A]/95 px-6 py-4 backdrop-blur">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-sm font-bold text-white/50 underline decoration-2 underline-offset-4 hover:text-white"
                >
                  Clear all
                </button>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-extrabold text-[#0A0A0A] shadow-[0_0_24px_rgba(13,245,255,0.25)] transition hover:scale-[1.01]"
                  style={{ backgroundImage: "linear-gradient(90deg,#00F5FF 0%,#FF00FF 100%)" }}
                >
                  <span className="material-symbols-outlined text-[18px]">search</span>
                  Show Events
                </button>
              </div>
            </aside>
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {actionError ? (
          <div className="mb-4 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{actionError}</div>
        ) : null}
        {actionInfo ? (
          <div className="mb-4 rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">{actionInfo}</div>
        ) : null}
        {effectivePastOnly || effectiveMyEventsOnly ? (
          <div className="mb-4 rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">
            {effectivePastOnly
              ? "Showing past published events."
              : effectiveOrganizingOnly
                ? "Showing only events you organize."
                : "Showing only your events (hosted or joined)."}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-4">
            <section className="rounded-2xl border border-cyan-300/20 bg-[radial-gradient(circle_at_top_left,rgba(37,209,244,0.12),transparent_42%),radial-gradient(circle_at_top_right,rgba(217,70,239,0.1),transparent_46%),#101214] p-3">
              <div className="mb-3 h-5 w-36 animate-pulse rounded bg-white/10" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`event-featured-sk-${index}`}
                    className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212] animate-pulse"
                  >
                    <div className="h-44 bg-white/5" />
                    <div className="space-y-3 p-4">
                      <div className="h-4 w-24 rounded bg-white/10" />
                      <div className="h-6 w-4/5 rounded bg-white/10" />
                      <div className="h-4 w-3/5 rounded bg-white/10" />
                      <div className="flex gap-2 pt-1">
                        <div className="h-8 w-20 rounded-full bg-white/10" />
                        <div className="h-8 w-24 rounded-full bg-white/10" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={`event-card-sk-${index}`}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212] animate-pulse"
                >
                  <div className="h-44 bg-white/5" />
                  <div className="space-y-3 p-4">
                    <div className="h-4 w-20 rounded bg-white/10" />
                    <div className="h-5 w-11/12 rounded bg-white/10" />
                    <div className="h-4 w-2/3 rounded bg-white/10" />
                    <div className="flex gap-2 pt-1">
                      <div className="h-7 w-16 rounded-full bg-white/10" />
                      <div className="h-7 w-20 rounded-full bg-white/10" />
                    </div>
                  </div>
                </div>
              ))}
            </section>
          </div>
        ) : discoverEvents.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#121212] p-8 text-center text-slate-300">
            <p>{effectivePastOnly ? "No past events found for the current filters." : "No events found for the current filters."}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {isAuthenticated && !effectivePastOnly ? (
                <>
                  <Link
                    href="/events/new"
                    className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/20 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/30"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    Create Event
                  </Link>
                  <Link
                    href="/events/past"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:text-white"
                  >
                    <span className="material-symbols-outlined text-[18px]">history</span>
                    View Past Events
                  </Link>
                </>
              ) : null}
              {isAuthenticated && effectivePastOnly ? (
                <Link
                  href="/events"
                  className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/25"
                >
                  <span className="material-symbols-outlined text-[18px]">event</span>
                  Back to Active Events
                </Link>
              ) : null}
              {!isAuthenticated ? (
                <Link
                  href="/auth?mode=signup"
                  className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/18 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/28"
                >
                  <span className="material-symbols-outlined text-[18px]">person_add</span>
                  Create an account
                </Link>
              ) : null}
            </div>
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
                  {regularEvents.map((event) => renderEventCard(event))}
                </section>

                {!isAuthenticated && orderedEvents.length > discoverEvents.length ? (
                  <div className="relative overflow-hidden rounded-2xl border border-cyan-300/18 bg-[linear-gradient(180deg,rgba(16,22,30,0.94),rgba(10,10,10,0.99))] px-5 py-8">
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#0A0A0A] via-[#0A0A0A]/88 to-transparent" />
                    <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="max-w-2xl">
                        <p className="text-lg font-bold text-white">Create an account to keep exploring events</p>
                        <p className="mt-1 text-sm leading-6 text-white/62">
                          Sign up to continue browsing the full event feed, save interests, and unlock personalized discovery.
                        </p>
                      </div>
                      <Link
                        href="/auth?mode=signup"
                        className="inline-flex items-center justify-center rounded-full bg-[#00F5FF] px-5 py-2.5 text-sm font-bold text-[#0A0A0A] transition hover:opacity-90"
                      >
                        Create an account
                      </Link>
                    </div>
                    <div className="relative mt-6 grid grid-cols-1 gap-3 opacity-35 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div
                          key={`event-lock-preview-${index}`}
                          className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212]"
                          aria-hidden="true"
                        >
                          <div className="h-44 bg-white/5" />
                          <div className="space-y-3 p-4">
                            <div className="h-4 w-20 rounded bg-white/10" />
                            <div className="h-5 w-11/12 rounded bg-white/10" />
                            <div className="h-4 w-2/3 rounded bg-white/10" />
                            <div className="flex gap-2 pt-1">
                              <div className="h-7 w-16 rounded-full bg-white/10" />
                              <div className="h-7 w-20 rounded-full bg-white/10" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <PaginationControls
                  page={currentEventsPage}
                  totalPages={totalEventPages}
                  totalItems={discoverEvents.length}
                  pageSize={EVENTS_PAGE_SIZE}
                  itemLabel="events"
                  onPageChange={(page) => setEventsPage(Math.max(1, Math.min(page, totalEventPages)))}
                />
              </>
            ) : null}
          </div>
        )}
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-24 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/85 to-transparent" />
    </div>
  );
}

export default function EventsExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0A0A0A] text-white">
          <Nav />
          <main className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-7 sm:px-6 lg:px-8">
            <div className="space-y-4">
              <section className="border-b border-white/6 pb-4">
                <div className="no-scrollbar mx-auto flex w-full max-w-[560px] items-center gap-3 overflow-x-auto pb-1 sm:justify-center sm:gap-8">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={`events-tab-sk-${index}`}
                      className="h-11 w-28 shrink-0 animate-pulse rounded-full border border-white/10 bg-white/5"
                    />
                  ))}
                </div>
              </section>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="h-5 w-28 animate-pulse rounded bg-white/10" />
                  <div className="h-10 w-28 animate-pulse rounded-full border border-white/10 bg-white/5" />
                  <div className="h-10 w-28 animate-pulse rounded-full border border-white/10 bg-white/5" />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="h-11 w-full animate-pulse rounded-full border border-white/10 bg-white/5 lg:w-[320px]" />
                  <div className="h-11 w-full animate-pulse rounded-full bg-[#00F5FF]/80 sm:w-[144px]" />
                </div>
              </div>
              <section className="rounded-2xl border border-cyan-300/20 bg-[radial-gradient(circle_at_top_left,rgba(37,209,244,0.12),transparent_42%),radial-gradient(circle_at_top_right,rgba(217,70,239,0.1),transparent_46%),#101214] p-3">
                <div className="mb-3 h-5 w-36 animate-pulse rounded bg-white/10" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={`event-fallback-featured-sk-${index}`}
                      className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212] animate-pulse"
                    >
                      <div className="h-44 bg-white/5" />
                      <div className="space-y-3 p-4">
                        <div className="h-4 w-24 rounded bg-white/10" />
                        <div className="h-6 w-4/5 rounded bg-white/10" />
                        <div className="h-4 w-3/5 rounded bg-white/10" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div
                    key={`event-fallback-card-sk-${index}`}
                    className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212] animate-pulse"
                  >
                    <div className="h-44 bg-white/5" />
                    <div className="space-y-3 p-4">
                      <div className="h-4 w-20 rounded bg-white/10" />
                      <div className="h-5 w-11/12 rounded bg-white/10" />
                      <div className="h-4 w-2/3 rounded bg-white/10" />
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </main>
        </div>
      }
    >
      <EventsExplorePageContent />
    </Suspense>
  );
}
