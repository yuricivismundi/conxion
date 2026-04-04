"use client";

import Link from "next/link";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { canManageTeacherInfo } from "@/lib/teacher-info/roles";
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
type ActiveTab = "profile" | "classes" | "events";

// ─── DB Row Types ─────────────────────────────────────────────────────────────

type TeacherProfileRow = {
  user_id: string;
  teacher_profile_enabled: boolean;
  default_public_view: "social" | "teacher";
  headline: string | null;
  bio: string | null;
  base_city: string | null;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trialDaysRemaining(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const diff = new Date(trialEndsAt).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatTime(t: string | null) {
  if (!t) return "";
  // HH:MM:SS → HH:MM
  return t.slice(0, 5);
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

  // Profile form state
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [baseCity, setBaseCity] = useState("");
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

  const eligible = canManageTeacherInfo(roles);

  // ── Auto-dismiss messages ──────────────────────────────────────────────────

  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), 3000);
    return () => window.clearTimeout(id);
  }, [error]);

  useEffect(() => {
    if (!info) return;
    const id = window.setTimeout(() => setInfo(null), 3000);
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
          .select("user_id,roles")
          .eq("user_id", currentUser.id)
          .maybeSingle();

        if (profileRes.error || !profileRes.data) {
          throw new Error(profileRes.error?.message ?? "Could not load your profile.");
        }

        const profileRow = profileRes.data as { user_id?: string; roles?: unknown };
        const nextRoles: string[] = Array.isArray(profileRow.roles)
          ? profileRow.roles.filter((item): item is string => typeof item === "string")
          : [];

        if (cancelled) return;
        setUserId(currentUser.id);
        setRoles(nextRoles);

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
            getCitiesOfCountry(iso).then((cities) => { if (!cancelled) setBaseCountryCities(cities); }).catch(() => {});
          }
        }

        setRegularClasses((classesRes.data as RegularClassRow[]) ?? []);
        setEventTeaching((eventsRes.data as EventTeachingRow[]) ?? []);
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
      void getCitiesOfCountry(iso).then(setEventCities).catch(() => {});
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
  const trialActive =
    teacherProfile?.teacher_profile_trial_ends_at != null &&
    new Date(teacherProfile.teacher_profile_trial_ends_at).getTime() > Date.now();
  const trialExpired =
    teacherProfile?.teacher_profile_trial_started_at != null &&
    teacherProfile?.teacher_profile_trial_ends_at != null &&
    new Date(teacherProfile.teacher_profile_trial_ends_at).getTime() <= Date.now();
  const daysLeft = trialActive ? trialDaysRemaining(teacherProfile?.teacher_profile_trial_ends_at ?? null) : null;
  const defaultView = teacherProfile?.default_public_view ?? "social";

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={embedded ? "" : "min-h-screen bg-[#06070b] text-slate-100"}>
        {!embedded && <Nav />}
        <div className="flex min-h-[60vh] items-center justify-center">
          <span className="text-sm text-slate-500">Loading…</span>
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

  return (
    <div className={embedded ? "" : "min-h-screen bg-[#06070b] text-slate-100"}>
      {!embedded && <Nav />}

      <div className="mx-auto max-w-2xl px-4 pb-24 pt-6">
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
        {trialActive && daysLeft != null && (
          <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            Free trial active — <strong>{daysLeft}</strong> {daysLeft === 1 ? "day" : "days"} remaining
          </div>
        )}
        {trialExpired && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <span>Trial ended. Get verified to continue.</span>
            <Link
              href="/me/edit"
              className="shrink-0 rounded-lg bg-rose-400/20 px-3 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-400/30 transition-colors"
            >
              Get verified
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

        {/* ── Enable / disable toggle ─────────────────────────────────────── */}
        <section className="mb-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-100">Teacher profile</p>
              <p className="mt-0.5 text-xs text-slate-400">
                When enabled, visitors can see your professional teacher profile.
              </p>
              {isEnabled && userId && (
                <a
                  href={`/profile/${userId}/teacher`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-cyan-300/80 hover:text-cyan-200"
                >
                  <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                  View teacher profile
                </a>
              )}
            </div>
            <Toggle
              checked={isEnabled}
              onChange={handleToggleEnabled}
              disabled={autoSaving}
            />
          </div>
        </section>

        {/* ── Default view ────────────────────────────────────────────────── */}
        <section className="mb-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Default public view
          </p>
          <p className="mb-3 text-xs text-slate-500">
            Choose what visitors see first when they open your profile.
          </p>
          <div className="flex gap-2">
            {(["social", "teacher"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => handleSetDefaultView(view)}
                disabled={autoSaving}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                  defaultView === view
                    ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-[#06121a] font-semibold"
                    : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10",
                  autoSaving ? "cursor-not-allowed opacity-50" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {view === "social" ? "Social profile" : "Teacher profile"}
              </button>
            ))}
          </div>
        </section>

        {/* ── Profile info form ───────────────────────────────────────────── */}
        <section className="mb-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
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
            </div>

            {/* Country + City */}
            <label className="block">
              <span className="text-xs text-slate-400">Country</span>
              <select
                value={baseCountry}
                onChange={(e) => {
                  setBaseCountry(e.target.value);
                  setBaseCity("");
                  setBaseCountryCities([]);
                  if (e.target.value) {
                    const iso = countriesAll.find((c) => c.name === e.target.value)?.isoCode ?? e.target.value;
                    void getCitiesOfCountry(iso).then(setBaseCountryCities).catch(() => {});
                  }
                }}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none"
              >
                <option value="">Select country…</option>
                {countriesAll.map((c) => (
                  <option key={c.isoCode} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>

            {baseCountry && (
              <label className="block">
                <span className="text-xs text-slate-400">City</span>
                <select
                  value={baseCity}
                  onChange={(e) => setBaseCity(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none"
                >
                  <option value="">{baseCountryCities.length === 0 ? "Loading…" : "Select city…"}</option>
                  {baseCountryCities.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}

            {/* Base school */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Base school / studio</label>
              <input
                type="text"
                value={baseSchool}
                onChange={(e) => setBaseSchool(e.target.value)}
                placeholder="Studio name"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
              />
            </div>

            {/* Languages */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Languages taught</label>
              <div className="flex gap-2">
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

            {/* Travel available */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-200">Available to travel</p>
                <p className="text-xs text-slate-500">I can travel to teach at events or studios</p>
              </div>
              <Toggle
                checked={travelAvailable}
                onChange={setTravelAvailable}
              />
            </div>

            {/* Availability tags */}
            <div>
              <span className="text-xs text-slate-400">Availability</span>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {AVAILABILITY_OPTIONS.map((opt) => {
                  const selected = availabilityTags.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() =>
                        setAvailabilityTags((prev) =>
                          selected ? prev.filter((x) => x !== opt) : [...prev, opt]
                        )
                      }
                      className={[
                        "rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors",
                        selected
                          ? "border-cyan-300/35 bg-cyan-300/14 text-cyan-100"
                          : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]",
                      ].join(" ")}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
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

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="mb-4 flex gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
          {(
            [
              { key: "classes", label: "Classes" },
              { key: "events", label: "Events" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={[
                "flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                activeTab === key
                  ? "bg-white/10 text-slate-100"
                  : "text-slate-500 hover:text-slate-300",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab: Classes ────────────────────────────────────────────────── */}
        {activeTab === "classes" && (
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Regular classes
              </p>
              {!showClassForm && (
                <button
                  type="button"
                  onClick={openAddClass}
                  className="rounded-xl bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors"
                >
                  + Add class
                </button>
              )}
            </div>

            {/* Class list */}
            {regularClasses.length === 0 && !showClassForm && (
              <p className="text-sm text-slate-500">No classes added yet.</p>
            )}
            <div className="space-y-2">
              {regularClasses.map((cls) => (
                <div
                  key={cls.id}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-white/[0.07] bg-black/20 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-100">{cls.title}</p>
                    <p className="text-xs text-slate-500">
                      {[
                        cls.weekday != null ? WEEKDAY_NAMES[cls.weekday] : null,
                        formatTime(cls.start_time) || null,
                        cls.duration_min ? `${cls.duration_min} min` : null,
                        cls.venue_name,
                        cls.city,
                        cls.country,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditClass(cls)}
                      disabled={busyClassId === cls.id}
                      className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClass(cls.id)}
                      disabled={busyClassId === cls.id}
                      className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/20 transition-colors"
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
                  {editingClassId ? "Edit class" : "New class"}
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
                  <label className="block">
                    <span className="text-xs text-slate-400">Country</span>
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
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none"
                    >
                      <option value="">Any</option>
                      {countriesAll.map((c) => (
                        <option key={c.isoCode} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-400">City</span>
                    <select
                      value={classDraft.city}
                      onChange={(e) => setClassDraft((d) => ({ ...d, city: e.target.value }))}
                      disabled={!classDraft.country}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none disabled:opacity-50"
                    >
                      <option value="">{!classDraft.country ? "Select country first" : classDraft.country && classCities.length === 0 ? "Loading…" : "Any"}</option>
                      {classCities.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
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
                    {savingClass ? "Saving…" : editingClassId ? "Update" : "Add class"}
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
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Events taught
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Add upcoming events where you&apos;ll be teaching — your pipeline.
                </p>
              </div>
              {!showEventForm && (
                <button
                  type="button"
                  onClick={openAddEvent}
                  className="rounded-xl bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors"
                >
                  + Add event
                </button>
              )}
            </div>

            {/* Event list */}
            {eventTeaching.length === 0 && !showEventForm && (
              <p className="text-sm text-slate-500">No events added yet.</p>
            )}
            <div className="space-y-2">
              {eventTeaching.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-white/[0.07] bg-black/20 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-100">{ev.event_name}</p>
                    <p className="text-xs text-slate-500">
                      {[
                        ev.role,
                        [ev.city, ev.country].filter(Boolean).join(", "),
                        ev.start_date
                          ? ev.end_date && ev.end_date !== ev.start_date
                            ? `${ev.start_date} – ${ev.end_date}`
                            : ev.start_date
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditEvent(ev)}
                      disabled={busyEventId === ev.id}
                      className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteEvent(ev.id)}
                      disabled={busyEventId === ev.id}
                      className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/20 transition-colors"
                    >
                      {busyEventId === ev.id ? "…" : "Remove"}
                    </button>
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
                    <select
                      value={eventDraft.country}
                      onChange={(e) => {
                        const country = e.target.value;
                        setEventDraft((d) => ({ ...d, country, city: "" }));
                        setEventCities([]);
                        if (country) {
                          const iso = countriesAll.find((c) => c.name === country)?.isoCode ?? country;
                          void getCitiesOfCountry(iso).then(setEventCities).catch(() => {});
                        }
                      }}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20"
                    >
                      <option value="">Select country…</option>
                      {countriesAll.map((c) => (
                        <option key={c.isoCode} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">City</label>
                    <select
                      value={eventDraft.city}
                      onChange={(e) => setEventDraft((d) => ({ ...d, city: e.target.value }))}
                      disabled={!eventDraft.country}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-white/20 disabled:opacity-50"
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
      </div>
    </div>
  );
}
