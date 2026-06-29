"use client";

import Link from "next/link";
import Nav from "@/components/Nav";
import SearchableMobileSelect from "@/components/SearchableMobileSelect";
import TeacherBookingsManager from "@/components/teacher/TeacherBookingsManager";
import TeacherInfoManager from "@/components/teacher/TeacherInfoManager";
import { supabase } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { canManageTeacherInfo } from "@/lib/teacher-info/roles";
import { isPaymentVerified } from "@/lib/verification";
import {
  getCachedCitiesOfCountry,
  getCachedCountriesAll,
  getCitiesOfCountry,
  getCountriesAll,
  type CountryEntry,
} from "@/lib/country-city-client";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEACHER_PROFILE_ELIGIBLE_ROLES = ["teacher", "artist", "instructor", "organizer"] as const;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const DANCE_STYLES = [
  "Bachata",
  "Salsa",
  "Kizomba",
  "Tango",
  "Zouk",
  "West Coast Swing",
  "Cha-Cha",
  "Rumba",
  "Lindy Hop",
  "Blues",
  "Hustle",
  "Cumbia",
  "Merengue",
] as const;

const CLASS_LEVELS = [
  "Beginner",
  "Improver",
  "Intermediate",
  "Advanced",
  "All levels",
] as const;

const SERVICE_TYPES = [
  { value: "private_class", label: "Private class" },
  { value: "group_class", label: "Group class" },
  { value: "general", label: "General" },
] as const;

const LANGUAGES = [
  "English", "Spanish", "Portuguese", "French", "Italian", "German",
  "Russian", "Ukrainian", "Polish", "Dutch", "Swedish", "Finnish",
  "Estonian", "Latvian", "Lithuanian", "Norwegian", "Danish",
  "Czech", "Slovak", "Hungarian", "Romanian", "Bulgarian", "Serbian",
  "Croatian", "Greek", "Turkish", "Arabic", "Hebrew", "Persian",
  "Hindi", "Chinese", "Japanese", "Korean", "Thai", "Vietnamese",
  "Indonesian", "Malay",
] as const;

const AVAILABILITY_OPTIONS = [
  "Weekdays", "Weekends", "DayTime", "Evenings", "Travel for Events",
] as const;
type AvailabilityOption = (typeof AVAILABILITY_OPTIONS)[number];

type ServiceType = (typeof SERVICE_TYPES)[number]["value"];
type ActiveTab = "profile" | "classes" | "inquiries" | "events" | "bookings" | "references";

// ─── DB Row Types ─────────────────────────────────────────────────────────────

type TeacherProfileRow = {
  user_id: string;
  teacher_profile_enabled: boolean;
  default_public_view: "social" | "teacher";
  headline: string | null;
  bio: string | null;
  base_city: string | null;
  base_address: string | null;
  base_country: string | null;
  base_school: string | null;
  languages: string[];
  travel_available: boolean;
  availability_summary: string | null;
  teacher_profile_trial_started_at: string | null;
  teacher_profile_trial_ends_at: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

type RegularClassRow = {
  id: string;
  user_id: string;
  title: string;
  style: string | null;
  level: string | null;
  weekday: number | null;
  start_time: string | null;
  duration_min: number | null;
  venue_name: string | null;
  city: string | null;
  country: string | null;
  recurrence_text: string | null;
  notes: string | null;
  is_active: boolean;
};

type EventTeachingRow = {
  id: string;
  user_id: string;
  event_name: string;
  role: string | null;
  city: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  is_active: boolean;
};

// ─── Form Drafts ──────────────────────────────────────────────────────────────

type ClassDraft = {
  title: string;
  style: string;
  level: string;
  weekday: string;
  start_time: string;
  duration_min: string;
  venue_name: string;
  city: string;
  country: string;
  recurrence_text: string;
  notes: string;
};

type EventDraft = {
  event_name: string;
  role: string;
  city: string;
  country: string;
  start_date: string;
  end_date: string;
  notes: string;
};

function emptyClassDraft(): ClassDraft {
  return {
    title: "",
    style: "",
    level: "",
    weekday: "",
    start_time: "",
    duration_min: "",
    venue_name: "",
    city: "",
    country: "",
    recurrence_text: "",
    notes: "",
  };
}

function emptyEventDraft(): EventDraft {
  return {
    event_name: "",
    role: "",
    city: "",
    country: "",
    start_date: "",
    end_date: "",
    notes: "",
  };
}

type TeacherReferenceRow = {
  id: string;
  client_name: string;
  client_context: string | null;
  testimonial: string;
  rating: number | null;
  reference_year: number | null;
  is_public: boolean;
  status: string;
  sort_order: number;
};

type RefDraft = {
  client_name: string;
  client_context: string;
  testimonial: string;
  rating: string;
  reference_year: string;
  is_public: boolean;
};

function emptyRefDraft(): RefDraft {
  return {
    client_name: "",
    client_context: "",
    testimonial: "",
    rating: "",
    reference_year: "",
    is_public: true,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(t: string | null) {
  if (!t) return "";
  // HH:MM:SS → HH:MM
  return t.slice(0, 5);
}

function formatEventDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        checked ? "bg-cyan-400" : "bg-white/20",
        disabled ? "cursor-not-allowed opacity-50" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={[
          "h-6 w-6 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TeacherProfilePage({ embedded = false }: { embedded?: boolean }) {
  // Auth / eligibility
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [paymentVerified, setPaymentVerified] = useState(false);

  // Data
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfileRow | null>(null);
  const [regularClasses, setRegularClasses] = useState<RegularClassRow[]>([]);
  const [eventTeaching, setEventTeaching] = useState<EventTeachingRow[]>([]);

  // UI
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("profile");
  const [featureUnavailable, setFeatureUnavailable] = useState(false);
  const [profileDisplayName, setProfileDisplayName] = useState("Teacher");

  // Profile form state
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [baseCity, setBaseCity] = useState("");
  const [baseAddress, setBaseAddress] = useState("");
  const [baseSchool, setBaseSchool] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [travelAvailable, setTravelAvailable] = useState(false);
  const [baseCountry, setBaseCountry] = useState("");
  const [baseCountryCities, setBaseCountryCities] = useState<string[]>([]);
  const [countriesAll, setCountriesAll] = useState<CountryEntry[]>(() => getCachedCountriesAll());
  const [languagePick, setLanguagePick] = useState("");
  const [availabilityTags, setAvailabilityTags] = useState<string[]>([]);

  // Classes UI
  const [showClassForm, setShowClassForm] = useState(false);
  const [classDraft, setClassDraft] = useState<ClassDraft>(emptyClassDraft());
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [busyClassId, setBusyClassId] = useState<string | null>(null);
  const [savingClass, setSavingClass] = useState(false);
  const [classCities, setClassCities] = useState<string[]>([]);

  // Events UI
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventDraft, setEventDraft] = useState<EventDraft>(emptyEventDraft());
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);
  const [eventCities, setEventCities] = useState<string[]>([]);

  // References UI
  const [references, setReferences] = useState<TeacherReferenceRow[]>([]);
  const [refsLoading, setRefsLoading] = useState(false);
  const [showRefForm, setShowRefForm] = useState(false);
  const [editingRefId, setEditingRefId] = useState<string | null>(null);
  const [savingRef, setSavingRef] = useState(false);
  const [busyRefId, setBusyRefId] = useState<string | null>(null);
  const [refDraft, setRefDraft] = useState<RefDraft>(emptyRefDraft());

  const eligible = canManageTeacherInfo(roles);

  // ── URL-based tab switching ────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const validTabs: ActiveTab[] = ["profile", "classes", "inquiries", "events", "bookings", "references"];
    if (tab && (validTabs as string[]).includes(tab)) {
      setActiveTab(tab as ActiveTab);
    }
  }, []);

  // ── Auto-dismiss messages ──────────────────────────────────────────────────

  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(id);
  }, [error]);

  useEffect(() => {
    if (!info) return;
    const id = window.setTimeout(() => setInfo(null), 6000);
    return () => window.clearTimeout(id);
  }, [info]);

  // ── Load data ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const countriesData = await getCountriesAll();
        if (!cancelled) setCountriesAll(countriesData);

        const authRes = await supabase.auth.getUser();
        const currentUser = authRes.data.user;
        if (!currentUser) {
          window.location.assign("/auth");
          return;
        }

        const profileRes = await supabase
          .from("profiles")
          .select("user_id,display_name,roles,verified,verified_label")
          .eq("user_id", currentUser.id)
          .maybeSingle();

        if (profileRes.error || !profileRes.data) {
          throw new Error(profileRes.error?.message ?? "Could not load your profile.");
        }

        const profileRow = profileRes.data as {
          user_id?: string;
          display_name?: unknown;
          roles?: unknown;
          verified?: unknown;
          verified_label?: unknown;
        };
        const nextRoles: string[] = Array.isArray(profileRow.roles)
          ? profileRow.roles.filter((item): item is string => typeof item === "string")
          : [];

        if (cancelled) return;
        setUserId(currentUser.id);
        setProfileDisplayName(
          typeof profileRow.display_name === "string" && profileRow.display_name.trim()
            ? profileRow.display_name.trim()
            : "Teacher"
        );
        setRoles(nextRoles);
        setPaymentVerified(isPaymentVerified(profileRow));

        // Fetch teacher_profiles
        const tpRes = await supabase
          .from("teacher_profiles")
          .select("*")
          .eq("user_id", currentUser.id)
          .maybeSingle();

        if (tpRes.error) {
          // Check if the table doesn't exist (schema error)
          const msg = tpRes.error.message ?? "";
          if (
            msg.toLowerCase().includes("does not exist") ||
            msg.toLowerCase().includes("relation") ||
            tpRes.error.code === "42P01"
          ) {
            if (!cancelled) setFeatureUnavailable(true);
            return;
          }
          throw new Error(msg || "Could not load teacher profile.");
        }

        const [classesRes, eventsRes] = await Promise.all([
          supabase
            .from("teacher_regular_classes")
            .select("*")
            .eq("user_id", currentUser.id)
            .eq("is_active", true)
            .order("weekday", { ascending: true }),
          supabase
            .from("teacher_event_teaching")
            .select("*")
            .eq("user_id", currentUser.id)
            .eq("is_active", true)
            .order("start_date", { ascending: true }),
        ]);

        if (cancelled) return;

        setTeacherProfile((tpRes.data as TeacherProfileRow) ?? null);

        // Seed form state from existing profile
        if (tpRes.data) {
          const tp = tpRes.data as TeacherProfileRow;
          setHeadline(tp.headline ?? "");
          setBio(tp.bio ?? "");
          setBaseCity(tp.base_city ?? "");
          setBaseAddress(tp.base_address ?? "");
          setBaseSchool(tp.base_school ?? "");
          setLanguages(tp.languages ?? []);
          setTravelAvailable(tp.travel_available ?? false);
          setBaseCountry(tp.base_country ?? "");
          // availability_summary stores tags as JSON, e.g. ["Weekdays","Evenings"]
          try {
            const parsed = JSON.parse(tp.availability_summary ?? "[]");
            setAvailabilityTags(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
          } catch {
            setAvailabilityTags([]);
          }

          if (tp.base_country) {
            const iso = countriesData.find((c) => c.name === tp.base_country)?.isoCode ?? tp.base_country;
            getCitiesOfCountry(iso).then((cities) => { if (!cancelled) setBaseCountryCities(cities); }).catch((err) => { console.warn("[get-cities] Failed:", err instanceof Error ? err.message : err); });
          }
        }

        setRegularClasses((classesRes.data as RegularClassRow[]) ?? []);
        setEventTeaching((eventsRes.data as EventTeachingRow[]) ?? []);

        // Load references
        const refsRes = await supabase
          .from("teacher_references")
          .select("*")
          .eq("teacher_user_id", currentUser.id)
          .order("sort_order", { ascending: true });
        if (!cancelled && refsRes.data) {
          setReferences(refsRes.data as TeacherReferenceRow[]);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load teacher profile."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Auto-save helpers ─────────────────────────────────────────────────────

  async function autoSaveField(fields: Partial<TeacherProfileRow>) {
    if (!userId) return;
    setAutoSaving(true);
    try {
      const now = new Date().toISOString();

      // Determine trial fields if enabling for the first time
      let extraFields: Partial<TeacherProfileRow> = {};
      if (
        "teacher_profile_enabled" in fields &&
        fields.teacher_profile_enabled === true &&
        (!teacherProfile || !teacherProfile.teacher_profile_trial_started_at)
      ) {
        const trialStart = now;
        const trialEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // +2 months
        extraFields = { teacher_profile_trial_started_at: trialStart, teacher_profile_trial_ends_at: trialEnd };
      }

      const upsertData = {
        user_id: userId,
        updated_at: now,
        ...fields,
        ...extraFields,
      };

      const { data, error: upsertError } = await supabase
        .from("teacher_profiles")
        .upsert(upsertData, { onConflict: "user_id" })
        .select("*")
        .single();

      if (upsertError) throw new Error(upsertError.message);
      setTeacherProfile(data as TeacherProfileRow);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto-save failed.");
    } finally {
      setAutoSaving(false);
    }
  }

  // ── Toggle enable/disable ─────────────────────────────────────────────────

  function handleToggleEnabled() {
    const nextEnabled = !(teacherProfile?.teacher_profile_enabled ?? false);
    // Optimistically update UI
    setTeacherProfile((prev) =>
      prev ? { ...prev, teacher_profile_enabled: nextEnabled } : null
    );
    void autoSaveField({ teacher_profile_enabled: nextEnabled });
  }

  // ── Default view ──────────────────────────────────────────────────────────

  function handleSetDefaultView(view: "social" | "teacher") {
    setTeacherProfile((prev) =>
      prev ? { ...prev, default_public_view: view } : null
    );
    void autoSaveField({ default_public_view: view });
  }

  // ── Save profile info ─────────────────────────────────────────────────────

  async function handleSaveProfile() {
    if (!userId) return;
    setSaving(true);
    setError(null);

    try {
      const now = new Date().toISOString();
      const upsertData = {
        user_id: userId,
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        base_city: baseCity.trim() || null,
        base_address: baseAddress.trim() || null,
        base_country: baseCountry.trim() || null,
        base_school: baseSchool.trim() || null,
        languages: languages,
        travel_available: travelAvailable,
        availability_summary: availabilityTags.length > 0 ? JSON.stringify(availabilityTags) : null,
        updated_at: now,
      };

      const { data, error: upsertError } = await supabase
        .from("teacher_profiles")
        .upsert(upsertData, { onConflict: "user_id" })
        .select("*")
        .single();

      if (upsertError) throw new Error(upsertError.message);
      setTeacherProfile(data as TeacherProfileRow);
      setInfo("Profile saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  // ── Classes CRUD ──────────────────────────────────────────────────────────

  function openAddClass() {
    setEditingClassId(null);
    setClassDraft(emptyClassDraft());
    setShowClassForm(true);
  }

  function openEditClass(cls: RegularClassRow) {
    setEditingClassId(cls.id);
    setClassDraft({
      title: cls.title,
      style: cls.style ?? "",
      level: cls.level ?? "",
      weekday: cls.weekday != null ? String(cls.weekday) : "",
      start_time: formatTime(cls.start_time),
      duration_min: cls.duration_min != null ? String(cls.duration_min) : "",
      venue_name: cls.venue_name ?? "",
      city: cls.city ?? "",
      country: cls.country ?? "",
      recurrence_text: cls.recurrence_text ?? "",
      notes: cls.notes ?? "",
    });
    setShowClassForm(true);
  }

  async function handleSaveClass() {
    if (!userId) return;
    if (!classDraft.title.trim()) {
      setError("Class title is required.");
      return;
    }
    setSavingClass(true);
    setError(null);

    try {
      const payload = {
        user_id: userId,
        title: classDraft.title.trim(),
        style: classDraft.style.trim() || null,
        level: classDraft.level.trim() || null,
        weekday: classDraft.weekday !== "" ? Number(classDraft.weekday) : null,
        start_time: classDraft.start_time.trim() || null,
        duration_min: classDraft.duration_min !== "" ? Number(classDraft.duration_min) : null,
        venue_name: classDraft.venue_name.trim() || null,
        city: classDraft.city.trim() || null,
        country: classDraft.country.trim() || null,
        recurrence_text: classDraft.recurrence_text.trim() || null,
        notes: classDraft.notes.trim() || null,
        is_active: true,
      };

      if (editingClassId) {
        const { data, error: updateError } = await supabase
          .from("teacher_regular_classes")
          .update(payload)
          .eq("id", editingClassId)
          .eq("user_id", userId)
          .select("*")
          .single();
        if (updateError) throw new Error(updateError.message);
        setRegularClasses((prev) =>
          prev.map((c) => (c.id === editingClassId ? (data as RegularClassRow) : c))
        );
      } else {
        const { data, error: insertError } = await supabase
          .from("teacher_regular_classes")
          .insert(payload)
          .select("*")
          .single();
        if (insertError) throw new Error(insertError.message);
        setRegularClasses((prev) => [...prev, data as RegularClassRow]);
      }

      setShowClassForm(false);
      setEditingClassId(null);
      setClassDraft(emptyClassDraft());
      setInfo(editingClassId ? "Class updated." : "Class added.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save class.");
    } finally {
      setSavingClass(false);
    }
  }

  async function handleDeleteClass(id: string) {
    if (!userId) return;
    setBusyClassId(id);
    try {
      const { error: updateError } = await supabase
        .from("teacher_regular_classes")
        .update({ is_active: false })
        .eq("id", id)
        .eq("user_id", userId);
      if (updateError) throw new Error(updateError.message);
      setRegularClasses((prev) => prev.filter((c) => c.id !== id));
      setInfo("Class removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove class.");
    } finally {
      setBusyClassId(null);
    }
  }

  // ── Events CRUD ───────────────────────────────────────────────────────────

  function openAddEvent() {
    setEditingEventId(null);
    setEventDraft(emptyEventDraft());
    setEventCities([]);
    setShowEventForm(true);
  }

  function openEditEvent(ev: EventTeachingRow) {
    setEditingEventId(ev.id);
    setEventDraft({
      event_name: ev.event_name,
      role: ev.role ?? "",
      city: ev.city ?? "",
      country: ev.country ?? "",
      start_date: ev.start_date ?? "",
      end_date: ev.end_date ?? "",
      notes: ev.notes ?? "",
    });
    if (ev.country) {
      const iso = countriesAll.find((c) => c.name === ev.country)?.isoCode ?? ev.country;
      void getCitiesOfCountry(iso).then(setEventCities).catch((err) => { console.warn("[get-cities] Failed:", err instanceof Error ? err.message : err); });
    } else {
      setEventCities([]);
    }
    setShowEventForm(true);
  }

  async function handleSaveEvent() {
    if (!userId) return;
    if (!eventDraft.event_name.trim()) {
      setError("Event name is required.");
      return;
    }
    setSavingEvent(true);
    setError(null);

    try {
      const payload = {
        user_id: userId,
        event_name: eventDraft.event_name.trim(),
        role: eventDraft.role.trim() || null,
        city: eventDraft.city.trim() || null,
        country: eventDraft.country.trim() || null,
        start_date: eventDraft.start_date || null,
        end_date: eventDraft.end_date || null,
        notes: eventDraft.notes.trim() || null,
        is_active: true,
      };

      if (editingEventId) {
        const { data, error: updateError } = await supabase
          .from("teacher_event_teaching")
          .update(payload)
          .eq("id", editingEventId)
          .eq("user_id", userId)
          .select("*")
          .single();
        if (updateError) throw new Error(updateError.message);
        setEventTeaching((prev) =>
          prev.map((ev) => (ev.id === editingEventId ? (data as EventTeachingRow) : ev))
        );
      } else {
        const { data, error: insertError } = await supabase
          .from("teacher_event_teaching")
          .insert(payload)
          .select("*")
          .single();
        if (insertError) throw new Error(insertError.message);
        setEventTeaching((prev) => [...prev, data as EventTeachingRow]);
      }

      setShowEventForm(false);
      setEditingEventId(null);
      setEventDraft(emptyEventDraft());
      setInfo(editingEventId ? "Event updated." : "Event added.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save event.");
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleDeleteEvent(id: string) {
    if (!userId) return;
    setBusyEventId(id);
    try {
      const { error: updateError } = await supabase
        .from("teacher_event_teaching")
        .update({ is_active: false })
        .eq("id", id)
        .eq("user_id", userId);
      if (updateError) throw new Error(updateError.message);
      setEventTeaching((prev) => prev.filter((ev) => ev.id !== id));
      setInfo("Event removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove event.");
    } finally {
      setBusyEventId(null);
    }
  }

  // ── Computed values ───────────────────────────────────────────────────────

  const isEnabled = teacherProfile?.teacher_profile_enabled ?? false;
  const trialExpired =
    teacherProfile?.teacher_profile_trial_started_at != null &&
    teacherProfile?.teacher_profile_trial_ends_at != null &&
    new Date(teacherProfile.teacher_profile_trial_ends_at).getTime() <= Date.now();
  const defaultView = teacherProfile?.default_public_view ?? "social";
  const teacherProfileLocked = trialExpired && !paymentVerified;

  // ── References handlers ───────────────────────────────────────────────────

  async function handleSaveRef() {
    if (!userId) return;
    setSavingRef(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      const payload = {
        clientName: refDraft.client_name.trim(),
        clientContext: refDraft.client_context.trim() || null,
        testimonial: refDraft.testimonial.trim(),
        rating: refDraft.rating ? Number(refDraft.rating) : null,
        referenceYear: refDraft.reference_year ? Number(refDraft.reference_year) : null,
        isPublic: refDraft.is_public,
      };

      if (editingRefId) {
        const res = await fetch(`/api/teacher-references/${editingRefId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        const json = await res.json() as { ok: boolean; error?: string; reference?: TeacherReferenceRow };
        if (!json.ok) throw new Error(json.error ?? "Failed to update reference.");
        setReferences((prev) => prev.map((r) => r.id === editingRefId ? (json.reference ?? r) : r));
      } else {
        const res = await fetch("/api/teacher-references", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        const json = await res.json() as { ok: boolean; error?: string; reference?: TeacherReferenceRow };
        if (!json.ok) throw new Error(json.error ?? "Failed to add reference.");
        if (json.reference) setReferences((prev) => [...prev, json.reference!]);
      }

      setShowRefForm(false);
      setEditingRefId(null);
      setRefDraft(emptyRefDraft());
      setInfo(editingRefId ? "Reference updated." : "Reference added.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save reference.");
    } finally {
      setSavingRef(false);
    }
  }

  async function handleDeleteRef(id: string) {
    if (!userId) return;
    setBusyRefId(id);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      const res = await fetch(`/api/teacher-references/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to delete.");
      setReferences((prev) => prev.filter((r) => r.id !== id));
      setInfo("Reference deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete reference.");
    } finally {
      setBusyRefId(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={embedded ? "" : "min-h-screen bg-[#06070b] text-slate-100"}>
        {!embedded && <Nav />}
        <div className={embedded ? "" : "mx-auto max-w-3xl px-4 py-6 sm:px-6"}>
          <div className="animate-pulse space-y-4">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
              <div className="flex items-center gap-4">
                <div className="h-7 w-12 rounded-full bg-white/[0.08]" />
                <div className="space-y-1.5">
                  <div className="h-4 w-32 rounded bg-white/[0.10]" />
                  <div className="h-3 w-40 rounded bg-white/[0.06]" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-20 rounded bg-white/[0.06]" />
                <div className="h-8 w-16 rounded-xl bg-white/[0.08]" />
                <div className="h-8 w-16 rounded-xl bg-white/[0.06]" />
              </div>
            </div>
            <div className="flex gap-0.5 rounded-2xl border border-white/10 bg-white/[0.03] p-0.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-9 flex-1 rounded-xl bg-white/[0.05]" />
              ))}
            </div>
            <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <div className="h-3 w-24 rounded bg-white/[0.10]" />
              <div className="space-y-2">
                <div className="h-3 w-16 rounded bg-white/[0.06]" />
                <div className="h-10 w-full rounded-xl bg-white/[0.05]" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-12 rounded bg-white/[0.06]" />
                <div className="h-24 w-full rounded-xl bg-white/[0.05]" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="h-3 w-16 rounded bg-white/[0.06]" />
                  <div className="h-10 w-full rounded-xl bg-white/[0.05]" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-12 rounded bg-white/[0.06]" />
                  <div className="h-10 w-full rounded-xl bg-white/[0.05]" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-white/[0.06]" />
                <div className="h-10 w-full rounded-xl bg-white/[0.05]" />
              </div>
              <div className="h-10 w-32 rounded-xl bg-white/[0.08]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (featureUnavailable) {
    return (
      <div className={embedded ? "" : "min-h-screen bg-[#06070b] text-slate-100"}>
        {!embedded && <Nav />}
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <p className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
            Teacher profile feature is being set up. Check back soon.
          </p>
        </div>
      </div>
    );
  }

  if (!eligible) {
    return (
      <div className={embedded ? "" : "min-h-screen bg-[#06070b] text-slate-100"}>
        {!embedded && <Nav />}
        <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-4">
          <p className="text-slate-400 text-sm">
            Add a teacher role to your profile first to access teacher profile settings.
          </p>
          <Link
            href="/me/edit"
            className="inline-block rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-[#06121a]"
          >
            Go to profile settings
          </Link>
        </div>
      </div>
    );
  }

  if (teacherProfileLocked) {
    return (
      <div className={embedded ? "" : "min-h-screen bg-[#06070b] text-slate-100"}>
        {!embedded && <Nav />}
        <div className="mx-auto max-w-4xl px-4 pb-24 pt-6">
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-200/80">Teacher Profile Locked</p>
            <h1 className="mt-3 text-2xl font-black text-white">Your teacher page trial has ended</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Your public profile falls back to the social view until you upgrade. Unlock the teacher page again with Plus.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-3 text-sm font-semibold text-[#06121a] hover:brightness-110"
              >
                Upgrade to Plus
              </Link>
              <Link
                href="/me/edit"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
              >
                Back to profile settings
              </Link>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "" : "min-h-screen bg-[#06070b] text-slate-100"}>
      {!embedded && <Nav />}

      <div
        className={[
          embedded
            ? "w-full pb-24 pt-1"
            : "mx-auto w-full max-w-[1240px] px-4 pb-24 pt-6 sm:px-6 lg:px-8",
        ].join(" ")}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        {!embedded && (
          <div className="mb-6 flex items-center gap-3">
            <Link
              href="/me/edit"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Back"
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 16 16">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <h1 className="text-lg font-semibold tracking-tight">Teacher Profile</h1>
            {autoSaving && (
              <span className="ml-auto text-xs text-slate-500 animate-pulse">Saving…</span>
            )}
          </div>
        )}
        {embedded && autoSaving && (
          <div className="mb-4 flex justify-end">
            <span className="text-xs text-slate-500 animate-pulse">Saving…</span>
          </div>
        )}

        {/* ── Trial / verification status banner ─────────────────────────── */}
        {teacherProfileLocked && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <span>Trial ended. Upgrade to Plus to continue.</span>
            <Link
              href="/pricing"
              className="shrink-0 rounded-lg bg-rose-400/20 px-3 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-400/30 transition-colors"
            >
              Upgrade to Plus
            </Link>
          </div>
        )}

        {/* ── Error / info messages ───────────────────────────────────────── */}
        {error && (
          <div className="mb-4 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
            {info}
          </div>
        )}

        {/* ── Enable / disable toggle + default view ──────────────────────── */}
        <div data-tour="tour-teacher-enable" className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
          <div className="flex items-center gap-3">
            <Toggle checked={isEnabled} onChange={handleToggleEnabled} disabled={autoSaving} />
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">Teacher profile</p>
              {isEnabled && userId ? (
                <a
                  href={`/profile/${userId}/teacher`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-300/70 hover:text-cyan-200"
                  title="View public page"
                >
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                </a>
              ) : null}
            </div>
          </div>

          {isEnabled ? (
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Default profile</p>
              <div className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.03] p-0.5">
                {(["social", "teacher"] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => handleSetDefaultView(view)}
                    disabled={autoSaving}
                    className={[
                      "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                      defaultView === view
                        ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-[#06121a]"
                        : "text-slate-400 hover:text-slate-200",
                      autoSaving ? "cursor-not-allowed opacity-50" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {view === "social" ? "Social" : "Teacher"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div data-tour="tour-teacher-tabs" className="mb-4 overflow-x-auto">
          <div className="flex w-full gap-0.5 rounded-2xl border border-white/10 bg-white/[0.03] p-0.5">
          {(
            [
              { key: "profile", label: "Profile info" },
              { key: "classes", label: "Weekly classes" },
              { key: "inquiries", label: "Inquiries" },
              { key: "events", label: "Events" },
              { key: "bookings", label: "Booking" },
              { key: "references", label: "References" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={[
                "flex-1 whitespace-nowrap rounded-xl px-1 py-1.5 text-center text-xs font-medium transition-colors sm:px-2 sm:text-sm",
                activeTab === key
                  ? "bg-white/10 text-slate-100"
                  : "text-slate-500 hover:text-slate-300",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
          </div>
        </div>

        {/* ── Profile info form ───────────────────────────────────────────── */}
        {activeTab === "profile" && (
        <section data-tour="tour-teacher-profile-info" className="mb-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Profile info
          </p>
          <div className="space-y-4">
            {/* Headline */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">Headline</label>
                <span className="text-xs text-slate-600">{headline.length}/120</span>
              </div>
              <input
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value.slice(0, 120))}
                placeholder="e.g. Bachata & Salsa instructor based in London"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
              />
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[11px] text-white/40">Quick fill:</span>
                {[
                  { label: "Instructor", text: "Bachata & Salsa instructor based in your city" },
                  { label: "Performer", text: "Performer and teacher — workshops, shows, and private classes" },
                  { label: "Coach", text: "Coach for couples and solo dancers — technique, musicality, expression" },
                ].map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => setHeadline(tpl.text.slice(0, 120))}
                    className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/70 hover:border-cyan-300/40 hover:text-cyan-100"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bio */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">Bio</label>
                <span className="text-xs text-slate-600">{bio.length}/1000</span>
              </div>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 1000))}
                placeholder="Tell students about your teaching style, experience, and what makes you unique…"
                rows={5}
                className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
              />
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[11px] text-white/40">Quick fill:</span>
                {[
                  { label: "Beginner-friendly", text: "I love working with beginners and anyone new to dance. My classes focus on the fundamentals: posture, connection, and how to feel the music. Expect a relaxed environment where mistakes are part of learning. After years of teaching socials and workshops, my goal is to get you confident on the dance floor as quickly as possible." },
                  { label: "Technique-focused", text: "Technique-first instructor with a background in performance and competitions. I break down movement, body mechanics, and timing in a way that's clear and repeatable. Whether you're polishing a routine or refining your social dancing, I'll help you understand the why behind every step. I teach privates, group classes, and workshops at festivals." },
                  { label: "Couples & socials", text: "Helping couples and partners enjoy dancing together. I focus on connection, lead/follow communication, and musicality so you can dance with anyone, anywhere. I've taught at festivals across Europe and run regular weekly classes. My style is patient, technical when needed, and always rooted in the social dance experience." },
                ].map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => setBio(tpl.text.slice(0, 1000))}
                    className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/70 hover:border-cyan-300/40 hover:text-cyan-100"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Country + City + Studio */}
            <div className="grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="text-xs text-slate-400">Country</span>
                <div className="mt-1.5 sm:hidden">
                  <SearchableMobileSelect
                    label="Country"
                    value={baseCountry}
                    options={countriesAll.map((country) => country.name)}
                    placeholder="Select country..."
                    searchPlaceholder="Search countries..."
                    onSelect={(nextCountry) => {
                      setBaseCountry(nextCountry);
                      setBaseCity("");
                      setBaseCountryCities([]);
                      const iso = countriesAll.find((country) => country.name === nextCountry)?.isoCode ?? nextCountry;
                      void getCitiesOfCountry(iso).then(setBaseCountryCities).catch((err) => { console.warn("[get-cities] Failed:", err instanceof Error ? err.message : err); });
                    }}
                    buttonClassName="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left text-sm text-white"
                  />
                </div>
                <select
                  value={baseCountry}
                  onChange={(e) => {
                    setBaseCountry(e.target.value);
                    setBaseCity("");
                    setBaseCountryCities([]);
                    if (e.target.value) {
                      const iso = countriesAll.find((c) => c.name === e.target.value)?.isoCode ?? e.target.value;
                      void getCitiesOfCountry(iso).then(setBaseCountryCities).catch((err) => { console.warn("[get-cities] Failed:", err instanceof Error ? err.message : err); });
                    }
                  }}
                  className="mt-1.5 hidden w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none sm:block"
                >
                  <option value="">Select country…</option>
                  {countriesAll.map((c) => (
                    <option key={c.isoCode} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-slate-400">City</span>
                <div className="mt-1.5 sm:hidden">
                  <SearchableMobileSelect
                    label="City"
                    value={baseCity}
                    options={baseCountryCities}
                    placeholder={baseCountry ? (baseCountryCities.length === 0 ? "Loading..." : "Select city...") : "Select country first"}
                    searchPlaceholder="Search cities..."
                    disabled={!baseCountry || baseCountryCities.length === 0}
                    emptyMessage="No cities found."
                    onSelect={(nextCity) => setBaseCity(nextCity)}
                    buttonClassName="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left text-sm text-white disabled:opacity-50"
                  />
                </div>
                <select
                  value={baseCity}
                  onChange={(e) => setBaseCity(e.target.value)}
                  disabled={!baseCountry}
                  className="mt-1.5 hidden w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none disabled:opacity-50 sm:block"
                >
                  <option value="">
                    {!baseCountry ? "Select country first" : baseCountryCities.length === 0 ? "Loading…" : "Select city…"}
                  </option>
                  {baseCountryCities.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-slate-400">Base school / studio</span>
                <input
                  type="text"
                  value={baseSchool}
                  onChange={(e) => setBaseSchool(e.target.value)}
                  placeholder="Studio name"
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                />
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Address</label>
              <input
                type="text"
                value={baseAddress}
                onChange={(e) => setBaseAddress(e.target.value.slice(0, 240))}
                placeholder="Street, number, or meeting point"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
              />
            </div>

            {/* Languages */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Languages taught</label>
              <div className="sm:hidden">
                <SearchableMobileSelect
                  label="Language"
                  value=""
                  options={LANGUAGES.filter((language) => !languages.includes(language))}
                  placeholder={languages.length >= 5 ? "Max 5 languages" : "Search languages..."}
                  searchPlaceholder="Search languages..."
                  disabled={languages.length >= 5}
                  emptyMessage="No languages left to add."
                  onSelect={(nextLanguage) => {
                    if (!nextLanguage || languages.length >= 5) return;
                    setLanguages((prev) => [...prev, nextLanguage]);
                    setLanguagePick("");
                  }}
                  buttonClassName="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left text-sm text-white disabled:opacity-40"
                />
              </div>
              <div className="hidden gap-2 sm:flex">
                <select
                  value={languagePick}
                  onChange={(e) => setLanguagePick(e.target.value)}
                  disabled={languages.length >= 5}
                  className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none disabled:opacity-50"
                >
                  <option value="">{languages.length >= 5 ? "Max 5 languages" : "Select language…"}</option>
                  {LANGUAGES.filter((l) => !languages.includes(l)).map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!languagePick || languages.length >= 5}
                  onClick={() => {
                    if (!languagePick || languages.length >= 5) return;
                    setLanguages((prev) => [...prev, languagePick]);
                    setLanguagePick("");
                  }}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              {languages.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {languages.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLanguages((prev) => prev.filter((x) => x !== l))}
                      className="flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-200"
                    >
                      {l} <span className="text-slate-400">×</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleSaveProfile()}
              disabled={saving}
              className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </section>
        )}

        {activeTab === "inquiries" && (
          <TeacherInfoManager embedded />
        )}

        {activeTab === "bookings" && userId ? (
          <TeacherBookingsManager teacherUserId={userId} teacherName={profileDisplayName} />
        ) : null}

        {/* ── Tab: Classes ────────────────────────────────────────────────── */}
        {activeTab === "classes" && (
          <section className="border-0 p-0">
            <div className="mb-4 flex items-center justify-between">
              {!showClassForm ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Weekly classes</p>
                  <button
                    type="button"
                    onClick={openAddClass}
                    className="rounded-xl bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors"
                  >
                    + Add weekly class
                  </button>
                </>
              ) : null}
            </div>

            {/* Class list */}
            {regularClasses.length === 0 && !showClassForm && (
              <p className="text-sm text-slate-500">No weekly classes added yet.</p>
            )}
            <div className="flex flex-col gap-4">
              {regularClasses.map((cls) => (
                <div
                  key={cls.id}
                  className="bg-zinc-900/40 backdrop-blur-xl flex flex-col md:flex-row items-start md:items-center justify-between p-4 sm:p-6 rounded-2xl border border-white/5"
                >
                  <div className="flex items-center gap-5 sm:gap-10 min-w-0 flex-1">
                    <div className="text-center min-w-[64px]">
                      <p className="font-black text-2xl text-[#c1fffe]">
                        {cls.weekday != null ? (WEEKDAY_NAMES[cls.weekday]?.slice(0, 3).toUpperCase() ?? "–") : "–"}
                      </p>
                      <p className="text-xs text-zinc-500 font-bold uppercase">
                        {formatTime(cls.start_time)}
                      </p>
                      {cls.duration_min ? (
                        <p className="mt-0.5 text-[10px] text-zinc-600 font-semibold uppercase">
                          {cls.duration_min} min
                        </p>
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-base sm:text-lg mb-1 text-white truncate">{cls.title}</h4>
                      {(cls.venue_name || cls.city || cls.country) && (
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <span className="material-symbols-outlined text-sm">location_on</span>
                          <p className="text-xs sm:text-sm truncate">
                            {[cls.venue_name, cls.city, cls.country].filter(Boolean).join(", ")}
                          </p>
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 md:hidden">
                        {cls.style && (
                          <span className="px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
                            {cls.style}
                          </span>
                        )}
                        {cls.level && (
                          <span className="px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
                            {cls.level}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="hidden md:flex items-center gap-3">
                    {cls.style && (
                      <span className="px-3 py-1 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
                        {cls.style}
                      </span>
                    )}
                    {cls.level && (
                      <span className="px-3 py-1 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
                        {cls.level}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5 mt-3 md:mt-0 md:ml-4">
                    <button
                      type="button"
                      onClick={() => openEditClass(cls)}
                      disabled={busyClassId === cls.id}
                      className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClass(cls.id)}
                      disabled={busyClassId === cls.id}
                      className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors"
                    >
                      {busyClassId === cls.id ? "…" : "Remove"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Inline class form */}
            {showClassForm && (
              <div
                className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {editingClassId ? "Edit weekly class" : "New weekly class"}
                </p>

                {/* Title */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">
                    Title <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={classDraft.title}
                    onChange={(e) => setClassDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="e.g. Bachata Sensual Intermediate"
                    required
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                  />
                </div>

                {/* Style + Level */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Style</label>
                    <select
                      value={classDraft.style}
                      onChange={(e) => setClassDraft((d) => ({ ...d, style: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
                    >
                      <option value="">— any —</option>
                      {DANCE_STYLES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Level</label>
                    <select
                      value={classDraft.level}
                      onChange={(e) => setClassDraft((d) => ({ ...d, level: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
                    >
                      <option value="">— any —</option>
                      {CLASS_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Weekday + Start time + Duration */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Weekday</label>
                    <select
                      value={classDraft.weekday}
                      onChange={(e) => setClassDraft((d) => ({ ...d, weekday: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
                    >
                      <option value="">—</option>
                      {WEEKDAY_NAMES.map((name, i) => (
                        <option key={i} value={i}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Start time</label>
                    <input
                      type="time"
                      value={classDraft.start_time}
                      onChange={(e) => setClassDraft((d) => ({ ...d, start_time: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Duration (min)</label>
                    <input
                      type="number"
                      value={classDraft.duration_min}
                      onChange={(e) =>
                        setClassDraft((d) => ({ ...d, duration_min: e.target.value }))
                      }
                      placeholder="60"
                      min="1"
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                    />
                  </div>
                </div>

                {/* Venue */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Venue</label>
                  <input
                    type="text"
                    value={classDraft.venue_name}
                    onChange={(e) => setClassDraft((d) => ({ ...d, venue_name: e.target.value }))}
                    placeholder="Studio name"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                  />
                </div>

                {/* Country + City */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Country</label>
                    <div className="sm:hidden">
                      <SearchableMobileSelect
                        label="Country"
                        value={classDraft.country}
                        options={countriesAll.map((country) => country.name)}
                        placeholder="Any"
                        searchPlaceholder="Search countries..."
                        onSelect={(country) => {
                          setClassDraft((d) => ({ ...d, country, city: "" }));
                          setClassCities([]);
                          if (country) {
                            const iso = countriesAll.find((c) => c.name === country)?.isoCode ?? country;
                            void getCitiesOfCountry(iso).then(setClassCities).catch(() => {});
                          }
                        }}
                        buttonClassName="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left text-sm text-white"
                      />
                    </div>
                    <select
                      value={classDraft.country}
                      onChange={(e) => {
                        setClassDraft((d) => ({ ...d, country: e.target.value, city: "" }));
                        if (e.target.value) {
                          const iso = countriesAll.find((c) => c.name === e.target.value)?.isoCode ?? e.target.value;
                          void getCitiesOfCountry(iso).then(setClassCities).catch(() => {});
                        } else {
                          setClassCities([]);
                        }
                      }}
                      className="hidden w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20 sm:block"
                    >
                      <option value="">Any</option>
                      {countriesAll.map((c) => (
                        <option key={c.isoCode} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">City</label>
                    <div className="sm:hidden">
                      <SearchableMobileSelect
                        label="City"
                        value={classDraft.city}
                        options={classCities}
                        placeholder={!classDraft.country ? "Select country first" : classCities.length === 0 ? "Loading..." : "Any"}
                        searchPlaceholder="Search cities..."
                        disabled={!classDraft.country || classCities.length === 0}
                        emptyMessage={!classDraft.country ? "Choose a country first." : "No cities found."}
                        onSelect={(nextCity) => setClassDraft((d) => ({ ...d, city: nextCity }))}
                        buttonClassName="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left text-sm text-white disabled:opacity-50"
                      />
                    </div>
                    <select
                      value={classDraft.city}
                      onChange={(e) => setClassDraft((d) => ({ ...d, city: e.target.value }))}
                      disabled={!classDraft.country}
                      className="hidden w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20 disabled:opacity-50 sm:block"
                    >
                      <option value="">{!classDraft.country ? "Select country first" : classDraft.country && classCities.length === 0 ? "Loading…" : "Any"}</option>
                      {classCities.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Recurrence */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Recurrence</label>
                  <input
                    type="text"
                    value={classDraft.recurrence_text}
                    onChange={(e) =>
                      setClassDraft((d) => ({ ...d, recurrence_text: e.target.value }))
                    }
                    placeholder="e.g. Every Monday"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                  />
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Notes</label>
                  <textarea
                    value={classDraft.notes}
                    onChange={(e) => setClassDraft((d) => ({ ...d, notes: e.target.value }))}
                    rows={2}
                    placeholder="Any additional info…"
                    className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveClass()}
                    disabled={savingClass}
                    className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
                  >
                    {savingClass ? "Saving…" : editingClassId ? "Update" : "Add weekly class"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowClassForm(false);
                      setEditingClassId(null);
                      setClassDraft(emptyClassDraft());
                    }}
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:bg-white/[0.04] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Tab: Events ─────────────────────────────────────────────────── */}
        {activeTab === "events" && (
          <section className="border-0 p-0">
            <div className="mb-4 flex items-center justify-between">
              {!showEventForm ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Events taught</p>
                  <button
                    type="button"
                    onClick={openAddEvent}
                    className="rounded-xl bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors"
                  >
                    + Add event
                  </button>
                </>
              ) : null}
            </div>

            {/* Event list */}
            {eventTeaching.length === 0 && !showEventForm && (
              <p className="text-sm text-slate-500">No events added yet.</p>
            )}
            <div className="relative space-y-8">
              {eventTeaching.length > 0 ? (
                <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-[#c1fffe]/50 to-transparent" />
              ) : null}
              {eventTeaching.map((ev, i) => (
                <div key={ev.id} className="pl-10 relative">
                  <div
                    className={`absolute left-[-5px] top-1 w-2.5 h-2.5 rounded-full ${
                      i === 0
                        ? "bg-[#c1fffe] shadow-[0_0_10px_#c1fffe]"
                        : "bg-zinc-800"
                    }`}
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`font-black text-[11px] tracking-[0.2em] uppercase mb-2 ${
                          i === 0 ? "text-[#ff51fa]" : "text-zinc-600"
                        }`}
                      >
                        {ev.start_date
                          ? ev.end_date && ev.end_date !== ev.start_date
                            ? `${formatEventDate(ev.start_date)} – ${formatEventDate(ev.end_date)}`
                            : formatEventDate(ev.start_date)
                          : "DATE TBD"}
                      </p>
                      <h4 className="text-lg sm:text-xl font-bold text-white mb-1">{ev.event_name}</h4>
                      {(ev.city || ev.country) ? (
                        <p className="text-zinc-500 italic mb-3 text-sm">
                          {[ev.city, ev.country].filter(Boolean).join(", ")}
                        </p>
                      ) : null}
                      {ev.role ? (
                        <span className="inline-block px-3 py-1 rounded bg-zinc-900 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
                          {ev.role}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditEvent(ev)}
                        disabled={busyEventId === ev.id}
                        className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteEvent(ev.id)}
                        disabled={busyEventId === ev.id}
                        className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors"
                      >
                        {busyEventId === ev.id ? "…" : "Remove"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Inline event form */}
            {showEventForm && (
              <div
                className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {editingEventId ? "Edit event" : "New event"}
                </p>

                {/* Event name */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">
                    Event name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={eventDraft.event_name}
                    onChange={(e) => setEventDraft((d) => ({ ...d, event_name: e.target.value }))}
                    placeholder="e.g. SalsaFest Europe 2025"
                    required
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                  />
                </div>

                {/* Role */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Role</label>
                  <input
                    type="text"
                    value={eventDraft.role}
                    onChange={(e) => setEventDraft((d) => ({ ...d, role: e.target.value }))}
                    placeholder="e.g. Teacher, Guest Artist, Workshop Lead"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                  />
                </div>

                {/* Country + City */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Country</label>
                    <div className="sm:hidden">
                      <SearchableMobileSelect
                        label="Country"
                        value={eventDraft.country}
                        options={countriesAll.map((country) => country.name)}
                        placeholder="Select country..."
                        searchPlaceholder="Search countries..."
                        onSelect={(country) => {
                          setEventDraft((d) => ({ ...d, country, city: "" }));
                          setEventCities([]);
                          const iso = countriesAll.find((c) => c.name === country)?.isoCode ?? country;
                          void getCitiesOfCountry(iso).then(setEventCities).catch((err) => { console.warn("[get-cities] Failed:", err instanceof Error ? err.message : err); });
                        }}
                        buttonClassName="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left text-sm text-white"
                      />
                    </div>
                    <select
                      value={eventDraft.country}
                      onChange={(e) => {
                        const country = e.target.value;
                        setEventDraft((d) => ({ ...d, country, city: "" }));
                        setEventCities([]);
                        if (country) {
                          const iso = countriesAll.find((c) => c.name === country)?.isoCode ?? country;
                          void getCitiesOfCountry(iso).then(setEventCities).catch((err) => { console.warn("[get-cities] Failed:", err instanceof Error ? err.message : err); });
                        }
                      }}
                      className="hidden w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20 sm:block"
                    >
                      <option value="">Select country…</option>
                      {countriesAll.map((c) => (
                        <option key={c.isoCode} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">City</label>
                    <div className="sm:hidden">
                      <SearchableMobileSelect
                        label="City"
                        value={eventDraft.city}
                        options={eventCities}
                        placeholder={!eventDraft.country ? "Select country first" : eventCities.length === 0 ? "Loading..." : "Select city..."}
                        searchPlaceholder="Search cities..."
                        disabled={!eventDraft.country || eventCities.length === 0}
                        emptyMessage={!eventDraft.country ? "Choose a country first." : "No cities found."}
                        onSelect={(nextCity) => setEventDraft((d) => ({ ...d, city: nextCity }))}
                        buttonClassName="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left text-sm text-white disabled:opacity-50"
                      />
                    </div>
                    <select
                      value={eventDraft.city}
                      onChange={(e) => setEventDraft((d) => ({ ...d, city: e.target.value }))}
                      disabled={!eventDraft.country}
                      className="hidden w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20 disabled:opacity-50 sm:block"
                    >
                      <option value="">
                        {!eventDraft.country ? "Select country first" : eventCities.length === 0 ? "Loading…" : "Select city…"}
                      </option>
                      {eventCities.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Start date</label>
                    <input
                      type="date"
                      value={eventDraft.start_date}
                      onChange={(e) => setEventDraft((d) => ({ ...d, start_date: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">End date</label>
                    <input
                      type="date"
                      value={eventDraft.end_date}
                      onChange={(e) => setEventDraft((d) => ({ ...d, end_date: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
                    />
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Notes</label>
                  <textarea
                    value={eventDraft.notes}
                    onChange={(e) => setEventDraft((d) => ({ ...d, notes: e.target.value }))}
                    rows={2}
                    placeholder="Any additional info…"
                    className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveEvent()}
                    disabled={savingEvent}
                    className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
                  >
                    {savingEvent ? "Saving…" : editingEventId ? "Update" : "Add event"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEventForm(false);
                      setEditingEventId(null);
                      setEventDraft(emptyEventDraft());
                    }}
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:bg-white/[0.04] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── References tab ──────────────────────────────────────────────── */}
        {activeTab === "references" && (
          <section className="mb-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Student References</p>
              {!showRefForm && (
                <button
                  type="button"
                  onClick={() => { setShowRefForm(true); setEditingRefId(null); setRefDraft(emptyRefDraft()); }}
                  className="rounded-xl border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/[0.04] transition-colors"
                >
                  + Add reference
                </button>
              )}
            </div>

            {refsLoading && (
              <p className="text-xs text-slate-500 animate-pulse">Loading…</p>
            )}

            {!refsLoading && references.length === 0 && !showRefForm && (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
                <p className="text-sm text-slate-500">No references yet.</p>
                <p className="text-xs text-slate-600 mt-1">Add testimonials from previous students to build trust on your public profile.</p>
              </div>
            )}

            {!refsLoading && references.length > 0 && (
              <div className="space-y-3 mb-4">
                {references.map((ref) => (
                  <div key={ref.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-semibold text-white">{ref.client_name}</span>
                          {ref.client_context && (
                            <span className="text-xs text-slate-500">{ref.client_context}</span>
                          )}
                          {ref.reference_year && (
                            <span className="text-xs text-slate-600">{ref.reference_year}</span>
                          )}
                          {ref.rating && (
                            <span className="text-xs text-[#0df2f2]">{"★".repeat(ref.rating)}</span>
                          )}
                          <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${ref.status === "published" ? "border-emerald-800 text-emerald-500" : "border-zinc-700 text-zinc-500"}`}>
                            {ref.status}
                          </span>
                          {!ref.is_public && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500">Private</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-2">&ldquo;{ref.testimonial}&rdquo;</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRefId(ref.id);
                            setRefDraft({
                              client_name: ref.client_name,
                              client_context: ref.client_context ?? "",
                              testimonial: ref.testimonial,
                              rating: ref.rating ? String(ref.rating) : "",
                              reference_year: ref.reference_year ? String(ref.reference_year) : "",
                              is_public: ref.is_public,
                            });
                            setShowRefForm(true);
                          }}
                          className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-400 hover:bg-white/[0.04] transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busyRefId === ref.id}
                          onClick={() => void handleDeleteRef(ref.id)}
                          className="rounded-lg border border-red-900/40 px-2.5 py-1 text-xs text-red-400 hover:bg-red-900/10 transition-colors disabled:opacity-50"
                        >
                          {busyRefId === ref.id ? "…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showRefForm && (
              <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4 mt-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  {editingRefId ? "Edit reference" : "New reference"}
                </p>

                {/* Client name */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-400">Student name <span className="text-red-400">*</span></label>
                    <span className="text-xs text-slate-600">{refDraft.client_name.length}/80</span>
                  </div>
                  <input
                    type="text"
                    value={refDraft.client_name}
                    onChange={(e) => setRefDraft((d) => ({ ...d, client_name: e.target.value.slice(0, 80) }))}
                    placeholder="e.g. Maria G."
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                  />
                </div>

                {/* Client context */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-400">Context (optional)</label>
                    <span className="text-xs text-slate-600">{refDraft.client_context.length}/80</span>
                  </div>
                  <input
                    type="text"
                    value={refDraft.client_context}
                    onChange={(e) => setRefDraft((d) => ({ ...d, client_context: e.target.value.slice(0, 80) }))}
                    placeholder="e.g. Bachata student, 2 years"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                  />
                </div>

                {/* Testimonial */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-400">Testimonial <span className="text-red-400">*</span></label>
                    <span className="text-xs text-slate-600">{refDraft.testimonial.length}/500</span>
                  </div>
                  <textarea
                    value={refDraft.testimonial}
                    onChange={(e) => setRefDraft((d) => ({ ...d, testimonial: e.target.value.slice(0, 500) }))}
                    rows={3}
                    placeholder="What the student said about your teaching…"
                    className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                  />
                </div>

                {/* Rating and Year */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Rating (1–5)</label>
                    <select
                      value={refDraft.rating}
                      onChange={(e) => setRefDraft((d) => ({ ...d, rating: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
                    >
                      <option value="">No rating</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n} star{n !== 1 ? "s" : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Year</label>
                    <input
                      type="number"
                      value={refDraft.reference_year}
                      onChange={(e) => setRefDraft((d) => ({ ...d, reference_year: e.target.value }))}
                      placeholder="e.g. 2023"
                      min={1990}
                      max={2030}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
                    />
                  </div>
                </div>

                {/* Public toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-400">Show on public profile</label>
                  <Toggle checked={refDraft.is_public} onChange={(v) => setRefDraft((d) => ({ ...d, is_public: v }))} />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleSaveRef()}
                    disabled={savingRef}
                    className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
                  >
                    {savingRef ? "Saving…" : editingRefId ? "Update" : "Add reference"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRefForm(false);
                      setEditingRefId(null);
                      setRefDraft(emptyRefDraft());
                    }}
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:bg-white/[0.04] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
