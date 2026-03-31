"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import Avatar from "@/components/Avatar";
import { useDashboardEmbedMode } from "@/components/dashboard/DashboardEmbedMode";
import { supabase } from "@/lib/supabase/client";
import {
  isSchemaMissingError,
  titleCase,
  type DanceMoveDifficulty,
  type DanceMovePracticeLog,
  type DanceMoveStatus,
  type DanceMoveType,
  type DanceMoveUser,
} from "@/lib/growth/types";

type DashboardProfile = {
  userId: string;
  displayName: string;
  city: string;
  country: string;
  nationality: string | null;
  avatarUrl: string | null;
  danceStyles: string[];
  roles: string[];
  languages: string[];
  interests: string[];
  availability: string[];
};

type GoalCategory = "practice" | "learning" | "social" | "competition" | "event";

type DashboardGoal = {
  id: string;
  title: string;
  category: GoalCategory | null;
  status: "active" | "completed";
  progress: number;
  targetDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

type ContactType = "member" | "external";

type DanceContactRole =
  | "Dancer"
  | "Teacher"
  | "Organizer"
  | "DJ"
  | "Videographer"
  | "Photographer"
  | "Studio owner"
  | "Friend"
  | "Festival buddy";

type DanceContact = {
  id: string;
  userId: string;
  contactType: ContactType;
  linkedUserId: string | null;
  name: string;
  roles: string[];
  city: string;
  country: string;
  instagram: string | null;
  whatsapp: string | null;
  email: string | null;
  tags: string[];
  notes: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type CompetitionResult = {
  id: string;
  eventName: string;
  city: string;
  country: string;
  style: string;
  division: string;
  role: string;
  result: CompetitionOutcome;
  year: number;
  note: string | null;
  createdAt: string;
};

type MoveFormState = {
  style: string;
  name: string;
  status: DanceMoveStatus;
  confidence: "" | "1" | "2" | "3" | "4" | "5";
  difficulty: DanceMoveDifficulty;
  moveType: DanceMoveType;
  referenceUrl: string;
  keyCue: string;
  commonMistake: string;
  fixTip: string;
  note: string;
};

type MoveDetailFormState = {
  confidence: "" | "1" | "2" | "3" | "4" | "5";
  difficulty: DanceMoveDifficulty;
  moveType: DanceMoveType;
  referenceUrl: string;
  keyCue: string;
  commonMistake: string;
  fixTip: string;
  note: string;
};

type GoalFormState = {
  title: string;
  category: "" | GoalCategory;
  targetDate: string;
  progress: string;
  note: string;
};

type AddContactFormState = {
  contactType: ContactType;
  linkedUserId: string;
  name: string;
  city: string;
  country: string;
  instagram: string;
  whatsapp: string;
  email: string;
  rolesText: string;
  tagsText: string;
  notes: string;
};

type CompetitionFormState = {
  eventName: string;
  city: string;
  country: string;
  style: string;
  division: string;
  role: "Leader" | "Follower" | "Switch";
  result: CompetitionOutcome;
  year: string;
  note: string;
};

type CompetitionOutcome =
  | "Participated"
  | "Quarterfinalist"
  | "Semifinalist"
  | "Finalist"
  | "Winner";

type GrowthSort = "recent" | "az" | "oldest";

type MoveUndoToast = {
  moveId: string;
  previousStatus: DanceMoveStatus;
  nextStatus: DanceMoveStatus;
  label: string;
};

type PracticeFeedItem = {
  id: string;
  moveId: string;
  moveName: string;
  moveStyle: string;
  moveStatus: DanceMoveStatus | null;
  confidenceAfter: number | null;
  quickNote: string | null;
  createdAt: string;
};

const CORE_STYLES = ["bachata", "salsa", "kizomba", "zouk", "tango", "other"];
const MOVE_DIFFICULTIES: DanceMoveDifficulty[] = ["easy", "medium", "hard"];
const MOVE_TYPES: DanceMoveType[] = ["footwork", "partnerwork", "turn-pattern", "styling", "musicality", "other"];
const COMPETITION_TABLE = "dance_competitions_user";
const COMPETITION_RESULTS: CompetitionOutcome[] = [
  "Participated",
  "Quarterfinalist",
  "Semifinalist",
  "Finalist",
  "Winner",
];
const LEARNED_CONFIRM_KEY = "cx_growth_learned_confirmed_v1";
const GOAL_CATEGORIES: Array<{ value: GoalCategory; label: string }> = [
  { value: "practice", label: "Practice" },
  { value: "learning", label: "Learning" },
  { value: "social", label: "Social dancing" },
  { value: "competition", label: "Competitions" },
  { value: "event", label: "Events" },
];
const CONTACT_PRESET_ROLES: DanceContactRole[] = [
  "Dancer",
  "Teacher",
  "Organizer",
  "DJ",
  "Videographer",
  "Photographer",
  "Studio owner",
  "Friend",
  "Festival buddy",
];
const CONTACTS_TABLE = "dance_contacts";
const MAX_CONTACTS = 100;
const MAX_CONTACT_NOTES = 500;
const MAX_CONTACT_TAGS = 10;
const GOAL_TEMPLATES: Array<{ id: string; title: string; category: GoalCategory; note?: string }> = [
  {
    id: "practice-3-sessions",
    title: "Practice 3 partnerwork sessions this week",
    category: "practice",
    note: "Keep sessions short and focused.",
  },
  {
    id: "learn-new-combo",
    title: "Learn 1 new Salsa combo",
    category: "learning",
  },
  {
    id: "attend-2-socials",
    title: "Attend 2 socials this month",
    category: "social",
  },
  {
    id: "jack-jill-prep",
    title: "Train for upcoming Jack & Jill",
    category: "competition",
  },
  {
    id: "event-prep",
    title: "Practice shines 4 times before next event",
    category: "event",
  },
];
const MoveDetailDialog = dynamic(() => import("@/components/dashboard/MoveDetailDialog"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-3xl border border-white/15 bg-[#080b12] px-5 py-6 text-sm text-slate-300 shadow-[0_30px_80px_rgba(0,0,0,0.65)]">
        Loading move details...
      </div>
    </div>
  ),
});
const MAX_ACTIVE_GOALS = 3;
const MAX_VISIBLE_COMPLETED_GOALS = 10;
const MAX_GOAL_TITLE_LENGTH = 120;
const MAX_GOAL_NOTE_LENGTH = 200;
const MAX_GOAL_DURATION_DAYS = 90;
const STALE_GOAL_DAYS = 5;

const EMPTY_MOVE_FORM: MoveFormState = {
  style: "bachata",
  name: "",
  status: "planned",
  confidence: "",
  difficulty: "medium",
  moveType: "other",
  referenceUrl: "",
  keyCue: "",
  commonMistake: "",
  fixTip: "",
  note: "",
};

const EMPTY_MOVE_DETAIL_FORM: MoveDetailFormState = {
  confidence: "",
  difficulty: "medium",
  moveType: "other",
  referenceUrl: "",
  keyCue: "",
  commonMistake: "",
  fixTip: "",
  note: "",
};

const EMPTY_GOAL_FORM: GoalFormState = {
  title: "",
  category: "",
  targetDate: "",
  progress: "0",
  note: "",
};

const EMPTY_ADD_CONTACT_FORM: AddContactFormState = {
  contactType: "external",
  linkedUserId: "",
  name: "",
  city: "",
  country: "",
  instagram: "",
  whatsapp: "",
  email: "",
  rolesText: "",
  tagsText: "",
  notes: "",
};

const EMPTY_COMPETITION_FORM: CompetitionFormState = {
  eventName: "",
  city: "",
  country: "",
  style: "bachata",
  division: "Beginner",
  role: "Leader",
  result: "Participated",
  year: new Date().getFullYear().toString(),
  note: "",
};

function normalizeCompetitionResult(value: string): CompetitionOutcome {
  const normalized = value.trim().toLowerCase();
  if (normalized === "winner") return "Winner";
  if (normalized === "finalist" || normalized === "podium") return "Finalist";
  if (normalized === "semifinalist" || normalized === "semi finalist") return "Semifinalist";
  if (normalized === "quarterfinalist" || normalized === "quarter finalist" || normalized === "top 5") {
    return "Quarterfinalist";
  }
  return "Participated";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(row: Record<string, unknown>, key: string, fallback = "") {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function pickNullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysBetweenDates(start: Date, end: Date) {
  const startTs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endTs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.round((endTs - startTs) / (24 * 60 * 60 * 1000));
}

function pickNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeCsvList(value: string) {
  if (!value.trim()) return [] as string[];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRoleArray(value: string) {
  const values = normalizeCsvList(value);
  const unique = new Set<string>();
  const roles: string[] = [];
  for (const item of values) {
    const normalized = CONTACT_PRESET_ROLES.find((role) => role.toLowerCase() === item.toLowerCase()) ?? item;
    if (unique.has(normalized.toLowerCase())) continue;
    unique.add(normalized.toLowerCase());
    roles.push(normalized);
  }
  return roles;
}

function normalizeTagArray(value: string) {
  const unique = new Set<string>();
  const tags: string[] = [];
  for (const item of normalizeCsvList(value)) {
    const normalized = item.toLowerCase();
    if (!normalized) continue;
    if (unique.has(normalized)) continue;
    unique.add(normalized);
    tags.push(normalized);
  }
  return tags;
}

function mapMoves(rows: unknown[]): DanceMoveUser[] {
  return rows
  .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, "id");
      const userId = pickString(row, "user_id");
      const style = pickString(row, "style");
      const name = pickString(row, "name");
      const statusRaw = pickString(row, "status");
      const createdAt = pickString(row, "created_at");
      const updatedAt = pickString(row, "updated_at");
      if (!id || !userId || !style || !name || !createdAt || !updatedAt) return null;

      const status: DanceMoveStatus =
        statusRaw === "practicing" || statusRaw === "learned" ? statusRaw : "planned";

      const confidenceRaw = pickNumber(row, "confidence");
      const confidence = confidenceRaw >= 1 && confidenceRaw <= 5 ? confidenceRaw : null;
      const difficultyRaw = pickString(row, "difficulty", "medium").toLowerCase();
      const moveTypeRaw = pickString(row, "move_type", "other").toLowerCase();
      const difficulty: DanceMoveDifficulty =
        difficultyRaw === "easy" || difficultyRaw === "hard" ? difficultyRaw : "medium";
      const moveType: DanceMoveType =
        moveTypeRaw === "footwork" ||
        moveTypeRaw === "partnerwork" ||
        moveTypeRaw === "turn-pattern" ||
        moveTypeRaw === "styling" ||
        moveTypeRaw === "musicality"
          ? moveTypeRaw
          : "other";

      return {
        id,
        userId,
        style,
        name,
        status,
        confidence,
        difficulty,
        moveType,
        practiceCount: Math.max(0, pickNumber(row, "practice_count")),
        startedPracticingAt: pickNullableString(row, "started_practicing_at"),
        lastPracticedAt: pickNullableString(row, "last_practiced_at"),
        referenceUrl: pickNullableString(row, "reference_url"),
        keyCue: pickNullableString(row, "key_cue"),
        commonMistake: pickNullableString(row, "common_mistake"),
        fixTip: pickNullableString(row, "fix_tip"),
        note: pickNullableString(row, "note"),
        isPublic: row.is_public === true,
        learnedAt: pickNullableString(row, "learned_at"),
        createdAt,
        updatedAt,
      } satisfies DanceMoveUser;
    })
    .filter((item): item is DanceMoveUser => Boolean(item))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function mapDanceContacts(rows: unknown[]) {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, "id");
      const userId = pickString(row, "user_id");
      const contactTypeRaw = pickString(row, "contact_type", "external").toLowerCase();
      const contactType: ContactType = contactTypeRaw === "member" ? "member" : "external";
      const name = pickString(row, "name");
      const createdAt = pickString(row, "created_at");
      const updatedAt = pickString(row, "updated_at");
      if (!id || !userId || !name || !createdAt || !updatedAt) return null;
      return {
        id,
        userId,
        contactType,
        linkedUserId: pickNullableString(row, "linked_user_id"),
        name,
        roles: asStringArray(row.role),
        city: pickString(row, "city"),
        country: pickString(row, "country"),
        instagram: pickNullableString(row, "instagram"),
        whatsapp: pickNullableString(row, "whatsapp"),
        email: pickNullableString(row, "email"),
        tags: asStringArray(row.tags),
        notes: pickNullableString(row, "notes"),
        avatarUrl: pickNullableString(row, "avatar_url"),
        createdAt,
        updatedAt,
      } satisfies DanceContact;
    })
    .filter((item): item is DanceContact => Boolean(item))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function mapCompetitionRows(rows: unknown[]) {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, "id");
      const eventName = pickString(row, "event_name");
      const style = pickString(row, "style");
      const division = pickString(row, "division");
      const role = pickString(row, "role");
      const result = normalizeCompetitionResult(pickString(row, "result"));
      const createdAt = pickString(row, "created_at");
      if (!id || !eventName || !style || !division || !role || !result || !createdAt) return null;

      return {
        id,
        eventName,
        city: pickString(row, "city"),
        country: pickString(row, "country"),
        style,
        division,
        role,
        result,
        year: Math.max(0, pickNumber(row, "year")),
        note: pickNullableString(row, "note"),
        createdAt,
      } satisfies CompetitionResult;
    })
    .filter((item): item is CompetitionResult => Boolean(item))
    .sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

function mapGoalRows(rows: unknown[]) {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, "id");
      const title = pickString(row, "title");
      const createdAt = pickString(row, "created_at");
      const updatedAt = pickString(row, "updated_at", createdAt);
      if (!id || !title || !createdAt || !updatedAt) return null;

      const statusRaw = pickString(row, "status", "active").toLowerCase();
      const status: DashboardGoal["status"] = statusRaw === "completed" ? "completed" : "active";
      const progress = Math.min(100, Math.max(0, pickNumber(row, "progress")));
      const categoryRaw = pickString(row, "category").toLowerCase();
      const category: GoalCategory | null =
        categoryRaw === "practice" ||
        categoryRaw === "learning" ||
        categoryRaw === "social" ||
        categoryRaw === "competition" ||
        categoryRaw === "event"
          ? categoryRaw
          : null;

      return {
        id,
        title,
        category,
        status,
        progress,
        targetDate: pickNullableString(row, "target_date"),
        note: pickNullableString(row, "note"),
        createdAt,
        updatedAt,
      } satisfies DashboardGoal;
    })
    .filter((item): item is DashboardGoal => Boolean(item))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      if (a.status === "active") {
        const aDate = parseDateOnly(a.targetDate);
        const bDate = parseDateOnly(b.targetDate);
        if (aDate && bDate && aDate.getTime() !== bDate.getTime()) return aDate.getTime() - bDate.getTime();
        if (aDate && !bDate) return -1;
        if (!aDate && bDate) return 1;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function mapMovePracticeLogs(rows: unknown[]): DanceMovePracticeLog[] {
  return rows
    .map((raw) => {
      const row = asRecord(raw);
      const id = pickString(row, "id");
      const moveId = pickString(row, "move_id");
      const userId = pickString(row, "user_id");
      const createdAt = pickString(row, "created_at");
      if (!id || !moveId || !userId || !createdAt) return null;
      const confidenceAfterRaw = pickNumber(row, "confidence_after");
      const confidenceAfter =
        confidenceAfterRaw >= 1 && confidenceAfterRaw <= 5 ? confidenceAfterRaw : null;
      return {
        id,
        moveId,
        userId,
        confidenceAfter,
        quickNote: pickNullableString(row, "quick_note"),
        createdAt,
      } satisfies DanceMovePracticeLog;
    })
    .filter((item): item is DanceMovePracticeLog => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function statusToLabel(status: DanceMoveStatus) {
  if (status === "planned") return "Planned";
  if (status === "practicing") return "Practicing";
  return "Learned";
}

function moveTypeLabel(value: DanceMoveType) {
  if (value === "turn-pattern") return "Turn Pattern";
  return titleCase(value);
}

function nextStatus(status: DanceMoveStatus): DanceMoveStatus | null {
  if (status === "planned") return "practicing";
  if (status === "practicing") return "learned";
  return null;
}

function previousStatus(status: DanceMoveStatus): DanceMoveStatus | null {
  if (status === "learned") return "practicing";
  if (status === "practicing") return "planned";
  return null;
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "Just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatMonthDay(value: string | null | undefined) {
  if (!value) return "No target date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No target date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function goalCategoryLabel(value: GoalCategory | null | undefined) {
  if (!value) return null;
  return GOAL_CATEGORIES.find((item) => item.value === value)?.label ?? titleCase(value);
}

function goalDaysRemaining(targetDate: string | null | undefined) {
  const target = parseDateOnly(targetDate);
  if (!target) return null;
  return daysBetweenDates(new Date(), target);
}

function goalDaysRemainingLabel(targetDate: string | null | undefined) {
  const remaining = goalDaysRemaining(targetDate);
  if (remaining === null) return "Deadline not set";
  if (remaining === 0) return "Due today";
  if (remaining < 0) return `${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"} overdue`;
  return `${remaining} day${remaining === 1 ? "" : "s"} left`;
}

function goalNeedsAttention(goal: DashboardGoal) {
  if (goal.status !== "active") return false;
  const updated = new Date(goal.updatedAt);
  if (Number.isNaN(updated.getTime())) return false;
  const days = daysBetweenDates(updated, new Date());
  return days >= STALE_GOAL_DAYS;
}

function normalizeMoveDate(value: string | null | undefined) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function moveSortTimestamp(move: DanceMoveUser, status: DanceMoveStatus) {
  if (status === "practicing") {
    return normalizeMoveDate(move.lastPracticedAt ?? move.updatedAt ?? move.createdAt);
  }
  if (status === "planned") {
    return normalizeMoveDate(move.createdAt ?? move.updatedAt);
  }
  return normalizeMoveDate(move.learnedAt ?? move.updatedAt ?? move.createdAt);
}

function applyMoveStatusChange(move: DanceMoveUser, targetStatus: DanceMoveStatus, nowIso: string) {
  const patch: Record<string, unknown> = {
    status: targetStatus,
    updated_at: nowIso,
  };
  const nextMove: DanceMoveUser = {
    ...move,
    status: targetStatus,
    updatedAt: nowIso,
  };

  if (targetStatus === "practicing" && move.status === "planned" && !move.startedPracticingAt) {
    patch.started_practicing_at = nowIso;
    nextMove.startedPracticingAt = nowIso;
  }

  if (targetStatus === "learned" && !move.learnedAt) {
    patch.learned_at = nowIso;
    nextMove.learnedAt = nowIso;
  }

  return { patch, nextMove };
}

function isGrowthRefineMissingError(message: string) {
  const text = message.toLowerCase();
  if (text.includes("column") && text.includes("does not exist")) return true;
  if (text.includes("function") && text.includes("log_dance_move_practice")) return true;
  if (text.includes("relation") && text.includes("dance_move_practice_logs") && text.includes("does not exist")) return true;
  return false;
}

function isGoalsRefineMissingError(message: string) {
  const text = message.toLowerCase();
  return text.includes("column") && text.includes("category") && text.includes("does not exist");
}

function DashboardPageContent({
  embeddedSection = null,
}: {
  embeddedSection?: "growth" | null;
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseCompat = supabase as unknown as { from: (table: string) => any };
  const showOnlyGrowth = embeddedSection === "growth";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [moves, setMoves] = useState<DanceMoveUser[]>([]);

  const [growthSchemaMissing, setGrowthSchemaMissing] = useState(false);
  const [competitionsSchemaMissing, setCompetitionsSchemaMissing] = useState(false);
  const [competitions, setCompetitions] = useState<CompetitionResult[]>([]);
  const [goalsSchemaMissing, setGoalsSchemaMissing] = useState(false);
  const [goals, setGoals] = useState<DashboardGoal[]>([]);
  const [danceContactsSchemaMissing, setDanceContactsSchemaMissing] = useState(false);
  const [danceContacts, setDanceContacts] = useState<DanceContact[]>([]);

  const [showAddMove, setShowAddMove] = useState(false);
  const [moveForm, setMoveForm] = useState<MoveFormState>(EMPTY_MOVE_FORM);
  const [addingMove, setAddingMove] = useState(false);
  const [busyMoveId, setBusyMoveId] = useState<string | null>(null);
  const [activeMoveId, setActiveMoveId] = useState<string | null>(null);
  const [moveDetailForm, setMoveDetailForm] = useState<MoveDetailFormState>(EMPTY_MOVE_DETAIL_FORM);
  const [movePracticeLogs, setMovePracticeLogs] = useState<DanceMovePracticeLog[]>([]);
  const [loadingMoveDetail, setLoadingMoveDetail] = useState(false);
  const [savingMoveDetail, setSavingMoveDetail] = useState(false);
  const [loggingPractice, setLoggingPractice] = useState(false);
  const [deletingMove, setDeletingMove] = useState(false);
  const [practiceQuickNote, setPracticeQuickNote] = useState("");
  const [showPracticeFeed, setShowPracticeFeed] = useState(false);
  const [loadingPracticeFeed, setLoadingPracticeFeed] = useState(false);
  const [practiceFeed, setPracticeFeed] = useState<PracticeFeedItem[]>([]);
  const practiceLogSectionRef = useRef<HTMLElement | null>(null);

  const [showAddGoal, setShowAddGoal] = useState(false);
  const [goalForm, setGoalForm] = useState<GoalFormState>(EMPTY_GOAL_FORM);
  const [addingGoal, setAddingGoal] = useState(false);
  const [busyGoalId, setBusyGoalId] = useState<string | null>(null);
  const [goalWarning, setGoalWarning] = useState<string | null>(null);

  const [showAddCompetition, setShowAddCompetition] = useState(false);
  const [competitionForm, setCompetitionForm] = useState<CompetitionFormState>(EMPTY_COMPETITION_FORM);
  const [addingCompetition, setAddingCompetition] = useState(false);
  const [showAllCompetitionHistory, setShowAllCompetitionHistory] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [addContactForm, setAddContactForm] = useState<AddContactFormState>(EMPTY_ADD_CONTACT_FORM);
  const [addingContact, setAddingContact] = useState(false);
  const [contactsQuery, setContactsQuery] = useState("");
  const [contactsTypeFilter, setContactsTypeFilter] = useState<"all" | ContactType>("all");
  const [contactsRoleFilter, setContactsRoleFilter] = useState("all");
  const [contactsTagFilter, setContactsTagFilter] = useState("all");
  const [contactsCityFilter, setContactsCityFilter] = useState("all");
  const [growthQuery, setGrowthQuery] = useState("");
  const [growthStyleFilters, setGrowthStyleFilters] = useState<string[]>([]);
  const [growthStatusFilter, setGrowthStatusFilter] = useState<"all" | DanceMoveStatus>("all");
  const [growthSort, setGrowthSort] = useState<GrowthSort>("recent");
  const [growthOnlyRecent, setGrowthOnlyRecent] = useState(false);
  const [showGrowthMobileFilters, setShowGrowthMobileFilters] = useState(false);
  const [dragMoveId, setDragMoveId] = useState<string | null>(null);
  const [dropColumnStatus, setDropColumnStatus] = useState<DanceMoveStatus | null>(null);
  const [moveUndoToast, setMoveUndoToast] = useState<MoveUndoToast | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledActionRef = useRef<string | null>(null);

  const locationLabel = useMemo(
    () => [profile?.city, profile?.country].filter(Boolean).join(", ") || "Location not set",
    [profile?.city, profile?.country]
  );

  const totalMoves = moves.length;
  const totalPracticingMoves = useMemo(
    () => moves.filter((move) => move.status === "practicing").length,
    [moves]
  );
  const growthTotals = useMemo(() => {
    const planned = moves.filter((move) => move.status === "planned").length;
    const practicing = moves.filter((move) => move.status === "practicing").length;
    const learned = moves.filter((move) => move.status === "learned").length;
    const stylesTracked = new Set(moves.map((move) => move.style.toLowerCase())).size;
    return { planned, practicing, learned, stylesTracked };
  }, [moves]);
  const growthStyles = useMemo(() => {
    const merged = new Set<string>(CORE_STYLES);
    for (const move of moves) merged.add(move.style.toLowerCase());
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [moves]);
  const normalizedGrowthQuery = growthQuery.trim().toLowerCase();
  const filteredMoves = useMemo(() => {
    const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return moves.filter((move) => {
      if (growthStatusFilter !== "all" && move.status !== growthStatusFilter) return false;
      if (growthStyleFilters.length > 0 && !growthStyleFilters.includes(move.style.toLowerCase())) return false;
      if (normalizedGrowthQuery) {
        const haystack = [
          move.name,
          move.style,
          move.note,
          move.keyCue,
          move.commonMistake,
          move.fixTip,
          move.referenceUrl,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(normalizedGrowthQuery)) return false;
      }
      if (growthOnlyRecent) {
        const recentTs = normalizeMoveDate(move.lastPracticedAt ?? move.updatedAt ?? move.createdAt);
        if (recentTs === 0 || recentTs < recentCutoff) return false;
      }
      return true;
    });
  }, [moves, growthStatusFilter, growthStyleFilters, normalizedGrowthQuery, growthOnlyRecent]);
  const groupedMoves = useMemo(() => {
    const sorted = (status: DanceMoveStatus) => {
      const list = filteredMoves.filter((move) => move.status === status);
      if (growthSort === "az") return [...list].sort((a, b) => a.name.localeCompare(b.name));
      if (growthSort === "oldest") {
        return [...list].sort((a, b) => moveSortTimestamp(a, status) - moveSortTimestamp(b, status));
      }
      return [...list].sort((a, b) => moveSortTimestamp(b, status) - moveSortTimestamp(a, status));
    };
    return {
      planned: sorted("planned"),
      practicing: sorted("practicing"),
      learned: sorted("learned"),
    };
  }, [filteredMoves, growthSort]);
  const hasGrowthFilters = Boolean(
    normalizedGrowthQuery || growthStyleFilters.length > 0 || growthStatusFilter !== "all" || growthOnlyRecent
  );
  const activeMove = useMemo(
    () => moves.find((move) => move.id === activeMoveId) ?? null,
    [moves, activeMoveId]
  );
  const practiceFeedSummary = useMemo(() => {
    const last7dCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const last7d = practiceFeed.filter((item) => normalizeMoveDate(item.createdAt) >= last7dCutoff).length;
    return { total: practiceFeed.length, last7d };
  }, [practiceFeed]);
  const practiceFeedStatus14d = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const items = practiceFeed.filter((item) => normalizeMoveDate(item.createdAt) >= cutoff);
    const totals = { planned: 0, practicing: 0, learned: 0 };
    for (const item of items) {
      if (!item.moveStatus) continue;
      totals[item.moveStatus] += 1;
    }
    const total = totals.planned + totals.practicing + totals.learned;
    return { ...totals, total };
  }, [practiceFeed]);

  const competitionStats = useMemo(() => {
    const total = competitions.length;
    const winners = competitions.filter((item) => item.result === "Winner").length;
    const completed = competitions.filter((item) => item.result !== "Participated").length;
    const leader = competitions.filter((item) => item.role === "Leader").length;
    const follower = competitions.filter((item) => item.role === "Follower").length;
    return { total, winners, completed, leader, follower };
  }, [competitions]);

  const activeGoals = useMemo(() => goals.filter((goal) => goal.status === "active"), [goals]);
  const completedGoals = useMemo(() => goals.filter((goal) => goal.status === "completed"), [goals]);
  const visibleCompletedGoals = useMemo(
    () => completedGoals.slice(0, MAX_VISIBLE_COMPLETED_GOALS),
    [completedGoals]
  );
  const hiddenCompletedGoalsCount = Math.max(0, completedGoals.length - visibleCompletedGoals.length);
  const activeGoalsLimitReached = activeGoals.length >= MAX_ACTIVE_GOALS;
  const needsAttentionGoalsCount = useMemo(
    () => activeGoals.filter((goal) => goalNeedsAttention(goal)).length,
    [activeGoals]
  );
  const minGoalTargetDate = useMemo(() => toDateInputValue(new Date()), []);
  const maxGoalTargetDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + MAX_GOAL_DURATION_DAYS);
    return toDateInputValue(date);
  }, []);
  const normalizedContactsQuery = contactsQuery.trim().toLowerCase();
  const contactsRoleOptions = useMemo(() => {
    const merged = new Set<string>(CONTACT_PRESET_ROLES);
    for (const contact of danceContacts) {
      for (const role of contact.roles) {
        if (role.trim()) merged.add(role.trim());
      }
    }
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [danceContacts]);
  const contactsTagOptions = useMemo(() => {
    const merged = new Set<string>();
    for (const contact of danceContacts) {
      for (const tag of contact.tags) {
        if (tag.trim()) merged.add(tag.trim().toLowerCase());
      }
    }
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [danceContacts]);
  const contactsCityOptions = useMemo(() => {
    const merged = new Set<string>();
    for (const contact of danceContacts) {
      const value = [contact.city, contact.country].filter(Boolean).join(", ");
      if (value) merged.add(value);
    }
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [danceContacts]);
  const filteredContacts = useMemo(() => {
    return danceContacts.filter((contact) => {
      if (contactsTypeFilter !== "all" && contact.contactType !== contactsTypeFilter) return false;
      if (contactsRoleFilter !== "all" && !contact.roles.some((item) => item.toLowerCase() === contactsRoleFilter.toLowerCase())) {
        return false;
      }
      if (contactsTagFilter !== "all" && !contact.tags.some((item) => item.toLowerCase() === contactsTagFilter.toLowerCase())) {
        return false;
      }
      if (contactsCityFilter !== "all") {
        const cityLabel = [contact.city, contact.country].filter(Boolean).join(", ");
        if (cityLabel !== contactsCityFilter) return false;
      }
      if (!normalizedContactsQuery) return true;
      const haystack = [
        contact.name,
        contact.city,
        contact.country,
        contact.instagram,
        contact.whatsapp,
        contact.email,
        contact.notes,
        ...contact.roles,
        ...contact.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedContactsQuery);
    });
  }, [
    danceContacts,
    contactsTypeFilter,
    contactsRoleFilter,
    contactsTagFilter,
    contactsCityFilter,
    normalizedContactsQuery,
  ]);
  const contactsSummary = useMemo(() => {
    const memberCount = danceContacts.filter((item) => item.contactType === "member").length;
    const externalCount = danceContacts.length - memberCount;
    return { total: danceContacts.length, memberCount, externalCount };
  }, [danceContacts]);
  const hasContactsFilters = Boolean(
    normalizedContactsQuery ||
      contactsTypeFilter !== "all" ||
      contactsRoleFilter !== "all" ||
      contactsTagFilter !== "all" ||
      contactsCityFilter !== "all"
  );
  const setupMissingModules = useMemo(
    () => ({
      growth: growthSchemaMissing,
      competitions: competitionsSchemaMissing,
      goals: goalsSchemaMissing,
      danceContacts: danceContactsSchemaMissing,
    }),
    [growthSchemaMissing, competitionsSchemaMissing, goalsSchemaMissing, danceContactsSchemaMissing]
  );
  const hasMissingDashboardSchema = useMemo(
    () => Object.values(setupMissingModules).some(Boolean),
    [setupMissingModules]
  );

  const handleGrowthMutationError = useCallback((message: string) => {
    if (isSchemaMissingError(message) || isGrowthRefineMissingError(message)) {
      setGrowthSchemaMissing(true);
      setError("Growth schema is out of date. Run SQL migration: scripts/sql/2026-03-04_dance_space_move_detail_refine.sql");
      return;
    }
    setError(message);
  }, []);

  const clearUndoToast = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setMoveUndoToast(null);
  }, []);

  const pushUndoToast = useCallback((toast: MoveUndoToast) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setMoveUndoToast(toast);
    undoTimerRef.current = setTimeout(() => {
      setMoveUndoToast(null);
      undoTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeMove) {
      setMoveDetailForm(EMPTY_MOVE_DETAIL_FORM);
      return;
    }
    setMoveDetailForm({
      confidence: activeMove.confidence ? String(activeMove.confidence) as MoveDetailFormState["confidence"] : "",
      difficulty: activeMove.difficulty,
      moveType: activeMove.moveType,
      referenceUrl: activeMove.referenceUrl ?? "",
      keyCue: activeMove.keyCue ?? "",
      commonMistake: activeMove.commonMistake ?? "",
      fixTip: activeMove.fixTip ?? "",
      note: activeMove.note ?? "",
    });
  }, [activeMove]);

  const loadMovePracticeHistory = useCallback(
    async (moveId: string) => {
      if (!meId) return;
      const res = await supabase
        .from("dance_move_practice_logs")
        .select("id,move_id,user_id,confidence_after,quick_note,created_at")
        .eq("move_id", moveId)
        .eq("user_id", meId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (res.error) {
        if (isSchemaMissingError(res.error.message)) {
          setMovePracticeLogs([]);
          return;
        }
        throw res.error;
      }
      setMovePracticeLogs(mapMovePracticeLogs((res.data ?? []) as unknown[]));
    },
    [meId]
  );

  const loadPracticeFeed = useCallback(async () => {
    if (!meId) return;
    setLoadingPracticeFeed(true);
    const res = await supabase
      .from("dance_move_practice_logs")
      .select("id,move_id,user_id,confidence_after,quick_note,created_at")
      .eq("user_id", meId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (res.error) {
      setLoadingPracticeFeed(false);
      if (isSchemaMissingError(res.error.message)) {
        setGrowthSchemaMissing(true);
        setPracticeFeed([]);
        return;
      }
      throw res.error;
    }

    const moveMap = new Map(moves.map((move) => [move.id, move]));
    const rows = mapMovePracticeLogs((res.data ?? []) as unknown[]);
    setPracticeFeed(
      rows.map((row) => {
        const move = moveMap.get(row.moveId);
        return {
          id: row.id,
          moveId: row.moveId,
          moveName: move?.name ?? "Move",
          moveStyle: move?.style ?? "other",
          moveStatus: move?.status ?? null,
          confidenceAfter: row.confidenceAfter,
          quickNote: row.quickNote,
          createdAt: row.createdAt,
        } satisfies PracticeFeedItem;
      })
    );
    setLoadingPracticeFeed(false);
  }, [meId, moves]);

  useEffect(() => {
    if (!showPracticeFeed || !meId || growthSchemaMissing) return;
    void loadPracticeFeed().catch((err) => {
      setError(err instanceof Error ? err.message : "Could not load practice history.");
    });
  }, [showPracticeFeed, meId, growthSchemaMissing, loadPracticeFeed]);

  const loadDashboard = useCallback(async (userId: string) => {
    const [
      profileRes,
      movesRes,
      competitionsRes,
      goalsRes,
      contactsRes,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id,display_name,city,country,nationality,avatar_url,dance_styles,roles,languages,interests,availability")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("dance_moves_user")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(60),
      supabaseCompat
        .from(COMPETITION_TABLE)
        .select("id,event_name,city,country,style,division,role,result,year,note,created_at")
        .eq("user_id", userId)
        .order("year", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(60),
      supabaseCompat
        .from("dance_goals_user")
        .select("*")
        .eq("user_id", userId)
        .order("status", { ascending: true })
        .order("updated_at", { ascending: false })
        .limit(64),
      supabaseCompat
        .from(CONTACTS_TABLE)
        .select("id,user_id,contact_type,linked_user_id,name,role,city,country,instagram,whatsapp,email,tags,notes,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(120),
    ]);

    if (profileRes.error || !profileRes.data) {
      throw new Error(profileRes.error?.message ?? "Could not load your dance tools profile.");
    }

    const profileRow = asRecord(profileRes.data);
    setProfile({
      userId,
      displayName: pickString(profileRow, "display_name", "Member"),
      city: pickString(profileRow, "city"),
      country: pickString(profileRow, "country"),
      nationality: pickNullableString(profileRow, "nationality"),
      avatarUrl: pickNullableString(profileRow, "avatar_url"),
      danceStyles: asStringArray(profileRow.dance_styles),
      roles: asStringArray(profileRow.roles),
      languages: asStringArray(profileRow.languages),
      interests: asStringArray(profileRow.interests),
      availability: asStringArray(profileRow.availability),
    });

    if (movesRes.error) {
      if (isSchemaMissingError(movesRes.error.message)) {
        setGrowthSchemaMissing(true);
        setMoves([]);
      } else {
        throw new Error(movesRes.error.message);
      }
    } else {
      setMoves(mapMoves((movesRes.data ?? []) as unknown[]));
    }

    if (competitionsRes.error) {
      if (isSchemaMissingError(competitionsRes.error.message)) {
        setCompetitionsSchemaMissing(true);
        setCompetitions([]);
      } else {
        throw new Error(competitionsRes.error.message);
      }
    } else {
      setCompetitionsSchemaMissing(false);
      setCompetitions(mapCompetitionRows((competitionsRes.data ?? []) as unknown[]));
    }

    if (goalsRes.error) {
      if (isSchemaMissingError(goalsRes.error.message)) {
        setGoalsSchemaMissing(true);
        setGoals([]);
      } else {
        throw new Error(goalsRes.error.message);
      }
    } else {
      setGoalsSchemaMissing(false);
      setGoals(mapGoalRows((goalsRes.data ?? []) as unknown[]));
    }

    if (contactsRes.error) {
      if (isSchemaMissingError(contactsRes.error.message)) {
        setDanceContactsSchemaMissing(true);
      } else {
        setDanceContactsSchemaMissing(false);
      }
      setDanceContacts([]);
      return;
    }

    setDanceContactsSchemaMissing(false);
    const mappedContacts = mapDanceContacts((contactsRes.data ?? []) as unknown[]);
    if (mappedContacts.length === 0) {
      setDanceContacts([]);
      return;
    }

    const linkedUserIds = Array.from(
      new Set(mappedContacts.map((item) => item.linkedUserId).filter((value): value is string => Boolean(value)))
    );

    if (linkedUserIds.length === 0) {
      setDanceContacts(mappedContacts);
      return;
    }

    const linkedProfilesRes = await supabase
      .from("profiles")
      .select("user_id,display_name,city,country,avatar_url,roles")
      .in("user_id", linkedUserIds);

    const linkedById = new Map<string, { displayName: string; city: string; country: string; avatarUrl: string | null; roles: string[] }>();
    if (!linkedProfilesRes.error) {
      for (const raw of (linkedProfilesRes.data ?? []) as unknown[]) {
        const row = asRecord(raw);
        const linkedId = pickString(row, "user_id");
        if (!linkedId) continue;
        linkedById.set(linkedId, {
          displayName: pickString(row, "display_name", "Member"),
          city: pickString(row, "city"),
          country: pickString(row, "country"),
          avatarUrl: pickNullableString(row, "avatar_url"),
          roles: asStringArray(row.roles),
        });
      }
    }

    setDanceContacts(
      mappedContacts.map((item) => {
        if (!item.linkedUserId) return item;
        const linked = linkedById.get(item.linkedUserId);
        if (!linked) return item;
        return {
          ...item,
          name: linked.displayName || item.name,
          city: linked.city || item.city,
          country: linked.country || item.country,
          roles: linked.roles.length > 0 ? linked.roles : item.roles,
          avatarUrl: linked.avatarUrl ?? item.avatarUrl,
        } satisfies DanceContact;
      })
    );
  }, [supabaseCompat]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setInfo(null);

      const authRes = await supabase.auth.getUser();
      const user = authRes.data.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      if (cancelled) return;

      setMeId(user.id);

      try {
        await loadDashboard(user.id);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load Dance Tools.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [loadDashboard, router]);

  useEffect(() => {
    if (loading) return;

    const action = searchParams.get("action");
    if (!action) {
      handledActionRef.current = null;
      return;
    }
    if (handledActionRef.current === action) return;
    handledActionRef.current = action;

    const scrollTo = (id: string) => {
      if (typeof window === "undefined") return;
      window.requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };

    if (action === "add-move") {
      setShowAddMove(true);
      scrollTo("growth");
    } else if (action === "add-goal") {
      setShowAddGoal(true);
      scrollTo("goals");
    } else if (action === "add-contact") {
      setShowAddContact(true);
      scrollTo("dance-network");
    } else if (action === "add-result") {
      setShowAddCompetition(true);
      scrollTo("competitions");
    }

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("action");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [loading, searchParams]);

  const refreshDashboard = useCallback(async (message?: string) => {
    if (!meId) return;
    try {
      await loadDashboard(meId);
      if (message) setInfo(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh Dance Tools.");
    }
  }, [loadDashboard, meId]);

  async function addMove() {
    if (!meId) return;
    const style = moveForm.style.trim().toLowerCase();
    const name = moveForm.name.trim();
    const note = moveForm.note.trim();
    const keyCue = moveForm.keyCue.trim();
    const commonMistake = moveForm.commonMistake.trim();
    const fixTip = moveForm.fixTip.trim();
    const referenceUrl = moveForm.referenceUrl.trim();
    if (!style || !name) {
      setError("Style and move name are required.");
      return;
    }
    if (totalMoves >= 200) {
      setError("You reached the 200 move limit.");
      return;
    }
    if (moveForm.status === "practicing" && totalPracticingMoves >= 20) {
      setError("You can have up to 20 moves in Practicing.");
      return;
    }
    if (/[,;/|]/.test(style)) {
      setError("Each move can have only one style.");
      return;
    }
    if (note.length > 500 || keyCue.length > 500 || commonMistake.length > 500 || fixTip.length > 500) {
      setError("Notes fields can be at most 500 characters.");
      return;
    }
    if (referenceUrl && !/^https?:\/\//i.test(referenceUrl)) {
      setError("Reference link must start with http:// or https://");
      return;
    }

    setAddingMove(true);
    setError(null);
    setInfo(null);

    const payload = {
      user_id: meId,
      style,
      name,
      status: moveForm.status,
      confidence: moveForm.confidence ? Number(moveForm.confidence) : null,
      difficulty: moveForm.difficulty,
      move_type: moveForm.moveType,
      reference_url: referenceUrl || null,
      key_cue: keyCue || null,
      common_mistake: commonMistake || null,
      fix_tip: fixTip || null,
      note: note || null,
      practice_count: 0,
      started_practicing_at: moveForm.status === "practicing" ? new Date().toISOString() : null,
      last_practiced_at: null,
      learned_at: moveForm.status === "learned" ? new Date().toISOString() : null,
    };

    const res = await supabase.from("dance_moves_user").insert(payload).select("id").single();
    if (res.error) {
      setAddingMove(false);
      handleGrowthMutationError(res.error.message);
      return;
    }

    setMoveForm(EMPTY_MOVE_FORM);
    setShowAddMove(false);
    setAddingMove(false);
    await refreshDashboard("Move added.");
  }

  async function updateMoveStatus(
    move: DanceMoveUser,
    targetStatus: DanceMoveStatus,
    options?: { showUndo?: boolean; source?: "button" | "drag" | "undo" }
  ) {
    if (!meId || move.status === targetStatus) return;
    if (targetStatus === "practicing" && move.status !== "practicing" && totalPracticingMoves >= 20) {
      setError("You can have up to 20 moves in Practicing.");
      return;
    }

    if (targetStatus === "learned" && options?.source === "drag" && typeof window !== "undefined") {
      const alreadyConfirmed = window.localStorage.getItem(LEARNED_CONFIRM_KEY) === "1";
      if (!alreadyConfirmed) {
        const ok = window.confirm("Mark this move as Learned?");
        if (!ok) return;
        window.localStorage.setItem(LEARNED_CONFIRM_KEY, "1");
      }
    }

    setBusyMoveId(move.id);
    setError(null);
    setInfo(null);

    const nowIso = new Date().toISOString();
    const { patch, nextMove } = applyMoveStatusChange(move, targetStatus, nowIso);
    setMoves((prev) => prev.map((item) => (item.id === move.id ? nextMove : item)));

    const res = await supabase.from("dance_moves_user").update(patch).eq("id", move.id).eq("user_id", meId);
    if (res.error) {
      setMoves((prev) => prev.map((item) => (item.id === move.id ? move : item)));
      setBusyMoveId(null);
      handleGrowthMutationError(res.error.message);
      return;
    }

    setBusyMoveId(null);
    const message = `Moved "${move.name}" to ${statusToLabel(targetStatus)}.`;
    const nextMessage =
      targetStatus === "learned"
        ? `${message} Tip: create a goal to practice this move 5 times this week.`
        : message;
    setInfo(nextMessage);
    if (options?.showUndo && targetStatus !== move.status) {
      pushUndoToast({
        moveId: move.id,
        previousStatus: move.status,
        nextStatus: targetStatus,
        label: message,
      });
    }
  }

  async function shiftMove(move: DanceMoveUser, direction: "prev" | "next") {
    const target = direction === "next" ? nextStatus(move.status) : previousStatus(move.status);
    if (!target) return;
    await updateMoveStatus(move, target, { source: "button" });
  }

  function onMoveDragStart(moveId: string) {
    setDragMoveId(moveId);
    setDropColumnStatus(null);
    setError(null);
  }

  function onMoveDragEnd() {
    setDragMoveId(null);
    setDropColumnStatus(null);
  }

  async function onDropMoveToStatus(targetStatus: DanceMoveStatus) {
    if (!dragMoveId) return;
    const dragged = moves.find((move) => move.id === dragMoveId);
    setDropColumnStatus(null);
    setDragMoveId(null);
    if (!dragged || dragged.status === targetStatus) return;
    await updateMoveStatus(dragged, targetStatus, { showUndo: true, source: "drag" });
  }

  function togglePracticeFeedSection() {
    if (showPracticeFeed) {
      setShowPracticeFeed(false);
      return;
    }
    setShowPracticeFeed(true);
  }

  async function openMoveFromFeed(moveId: string) {
    const move = moves.find((item) => item.id === moveId);
    if (!move) {
      setInfo("Move no longer exists.");
      return;
    }
    await openMoveDetail(move);
  }

  async function undoLastMoveStatusChange() {
    if (!moveUndoToast) return;
    const move = moves.find((item) => item.id === moveUndoToast.moveId);
    clearUndoToast();
    if (!move) return;
    await updateMoveStatus(move, moveUndoToast.previousStatus, { source: "undo" });
  }

  const openMoveDetail = useCallback(async (move: DanceMoveUser) => {
    setActiveMoveId(move.id);
    setPracticeQuickNote("");
    setError(null);
    setLoadingMoveDetail(true);
    try {
      await loadMovePracticeHistory(move.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load move detail.");
    } finally {
      setLoadingMoveDetail(false);
    }
  }, [loadMovePracticeHistory]);

  function closeMoveDetail() {
    setActiveMoveId(null);
    setMovePracticeLogs([]);
    setPracticeQuickNote("");
  }

  async function saveMoveDetail() {
    if (!meId || !activeMove) return;
    const note = moveDetailForm.note.trim();
    const keyCue = moveDetailForm.keyCue.trim();
    const commonMistake = moveDetailForm.commonMistake.trim();
    const fixTip = moveDetailForm.fixTip.trim();
    const referenceUrl = moveDetailForm.referenceUrl.trim();

    if (note.length > 500 || keyCue.length > 500 || commonMistake.length > 500 || fixTip.length > 500) {
      setError("Notes fields can be at most 500 characters.");
      return;
    }
    if (referenceUrl && !/^https?:\/\//i.test(referenceUrl)) {
      setError("Reference link must start with http:// or https://");
      return;
    }

    setSavingMoveDetail(true);
    setError(null);
    setInfo(null);

    const patch = {
      confidence: moveDetailForm.confidence ? Number(moveDetailForm.confidence) : null,
      difficulty: moveDetailForm.difficulty,
      move_type: moveDetailForm.moveType,
      reference_url: referenceUrl || null,
      key_cue: keyCue || null,
      common_mistake: commonMistake || null,
      fix_tip: fixTip || null,
      note: note || null,
      updated_at: new Date().toISOString(),
    };

    const res = await supabase.from("dance_moves_user").update(patch).eq("id", activeMove.id).eq("user_id", meId);
    if (res.error) {
      setSavingMoveDetail(false);
      handleGrowthMutationError(res.error.message);
      return;
    }
    setSavingMoveDetail(false);
    await refreshDashboard(`Saved details for "${activeMove.name}".`);
  }

  async function logPractice() {
    if (!activeMove || !meId) return;
    const quickNote = practiceQuickNote.trim();
    if (quickNote.length > 500) {
      setError("Quick note can be at most 500 characters.");
      return;
    }

    setLoggingPractice(true);
    setError(null);
    setInfo(null);

    const rpc = await supabase.rpc("log_dance_move_practice", {
      p_move_id: activeMove.id,
      p_confidence_after: moveDetailForm.confidence ? Number(moveDetailForm.confidence) : null,
      p_quick_note: quickNote || null,
    });
    if (rpc.error) {
      setLoggingPractice(false);
      handleGrowthMutationError(rpc.error.message);
      return;
    }

    setPracticeQuickNote("");
    await refreshDashboard(`Practice logged for "${activeMove.name}".`);
    try {
      await loadMovePracticeHistory(activeMove.id);
      if (showPracticeFeed) await loadPracticeFeed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Practice logged, but history could not refresh.");
    } finally {
      setLoggingPractice(false);
    }
  }

  async function deleteMove(move: DanceMoveUser) {
    if (!meId) return;
    setDeletingMove(true);
    setError(null);
    setInfo(null);
    const res = await supabase.from("dance_moves_user").delete().eq("id", move.id).eq("user_id", meId);
    if (res.error) {
      setDeletingMove(false);
      handleGrowthMutationError(res.error.message);
      return;
    }
    setDeletingMove(false);
    closeMoveDetail();
    await refreshDashboard(`Deleted "${move.name}".`);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== "l") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      const ordered = [...moves].sort(
        (a, b) =>
          normalizeMoveDate(b.lastPracticedAt ?? b.updatedAt ?? b.createdAt) -
          normalizeMoveDate(a.lastPracticedAt ?? a.updatedAt ?? a.createdAt)
      );
      const candidate = ordered.find((item) => item.status === "practicing") ?? ordered[0];
      if (!candidate) return;
      event.preventDefault();
      setInfo(`Quick log opened for "${candidate.name}".`);
      void openMoveDetail(candidate);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moves, openMoveDetail]);

  async function addCompetitionResult() {
    if (!meId) return;
    const eventName = competitionForm.eventName.trim();
    const style = competitionForm.style.trim().toLowerCase();
    const year = Number(competitionForm.year);
    if (!eventName || !style || !Number.isInteger(year) || year < 1990 || year > new Date().getFullYear() + 1) {
      setError("Complete event name, style, and a valid year.");
      return;
    }

    setAddingCompetition(true);
    setError(null);
    setInfo(null);

    const payload = {
      user_id: meId,
      event_name: eventName,
      city: competitionForm.city.trim() || null,
      country: competitionForm.country.trim() || null,
      style,
      division: competitionForm.division.trim(),
      role: competitionForm.role,
      result: competitionForm.result,
      year,
      note: competitionForm.note.trim() || null,
    };

    const res = await supabaseCompat.from(COMPETITION_TABLE).insert(payload).select("id").single();
    if (res.error) {
      setAddingCompetition(false);
      setError(res.error.message);
      return;
    }

    setCompetitionForm(EMPTY_COMPETITION_FORM);
    setShowAddCompetition(false);
    setAddingCompetition(false);
    await refreshDashboard("Competition result added.");
  }

  async function addGoal() {
    if (!meId) return;
    setGoalWarning(null);
    const title = goalForm.title.trim();
    const note = goalForm.note.trim();
    const progressRaw = Number(goalForm.progress);
    const progress = Number.isFinite(progressRaw) ? Math.round(progressRaw) : 0;
    const status: DashboardGoal["status"] = progress >= 100 ? "completed" : "active";
    const targetDate = goalForm.targetDate.trim();
    const parsedTargetDate = parseDateOnly(targetDate);
    const minDate = parseDateOnly(minGoalTargetDate);
    const maxDate = parseDateOnly(maxGoalTargetDate);
    const category = goalForm.category || null;

    if (!title) {
      setGoalWarning("Goal title is required.");
      return;
    }
    if (title.length > MAX_GOAL_TITLE_LENGTH) {
      setGoalWarning(`Goal title must be ${MAX_GOAL_TITLE_LENGTH} characters or less.`);
      return;
    }
    if (note.length > MAX_GOAL_NOTE_LENGTH) {
      setGoalWarning(`Goal note must be ${MAX_GOAL_NOTE_LENGTH} characters or less.`);
      return;
    }
    if (!targetDate || !parsedTargetDate || !minDate || !maxDate) {
      setGoalWarning("Goal deadline is required.");
      return;
    }
    if (parsedTargetDate.getTime() < minDate.getTime() || parsedTargetDate.getTime() > maxDate.getTime()) {
      setGoalWarning(`Deadline must be within the next ${MAX_GOAL_DURATION_DAYS} days.`);
      return;
    }
    if (progress < 0 || progress > 100) {
      setGoalWarning("Progress must be between 0 and 100.");
      return;
    }
    if (status === "active" && activeGoalsLimitReached) {
      setGoalWarning("Focus on finishing your current goals first. Complete or delete one to add another.");
      return;
    }

    setAddingGoal(true);
    setError(null);
    setInfo(null);
    setGoalWarning(null);

    const payload = {
      user_id: meId,
      title,
      category,
      status,
      progress,
      target_date: targetDate,
      note: note || null,
    };

    const res = await supabaseCompat.from("dance_goals_user").insert(payload).select("id").single();
    if (res.error) {
      setAddingGoal(false);
      if (isGoalsRefineMissingError(res.error.message)) {
        setGoalWarning("Goals schema is out of date. Run SQL migration: scripts/sql/2026-03-05_dashboard_goals_refine.sql");
        return;
      }
      setGoalWarning(res.error.message);
      return;
    }

    setGoalForm(EMPTY_GOAL_FORM);
    setShowAddGoal(false);
    setAddingGoal(false);
    setGoalWarning(null);
    await refreshDashboard("Goal added.");
  }

  function applyGoalTemplate(templateId: string) {
    const template = GOAL_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setGoalForm((prev) => ({
      ...prev,
      title: template.title,
      category: template.category,
      note: template.note ?? prev.note,
      progress: "0",
      targetDate: prev.targetDate || minGoalTargetDate,
    }));
  }

  async function updateGoal(goalId: string, patch: Record<string, unknown>, successMessage: string) {
    if (!meId) return;
    setBusyGoalId(goalId);
    setError(null);
    setInfo(null);
    setGoalWarning(null);

    const res = await supabaseCompat.from("dance_goals_user").update(patch).eq("id", goalId).eq("user_id", meId);
    if (res.error) {
      setBusyGoalId(null);
      setGoalWarning(res.error.message);
      return;
    }

    setBusyGoalId(null);
    await refreshDashboard(successMessage);
  }

  async function adjustGoalProgress(goal: DashboardGoal, delta: number) {
    const nextProgress = Math.max(0, Math.min(100, goal.progress + delta));
    const nextStatus: DashboardGoal["status"] = nextProgress >= 100 ? "completed" : "active";
    await updateGoal(goal.id, { progress: nextProgress, status: nextStatus }, `Updated "${goal.title}".`);
  }

  async function toggleGoalStatus(goal: DashboardGoal) {
    if (goal.status === "completed") {
      if (activeGoalsLimitReached) {
        setGoalWarning("Focus on finishing your current goals first. Complete or delete one to add another.");
        return;
      }
      const reopenedProgress = goal.progress >= 100 ? 90 : goal.progress;
      await updateGoal(goal.id, { status: "active", progress: reopenedProgress }, `Reopened "${goal.title}".`);
      return;
    }
    await updateGoal(goal.id, { status: "completed", progress: 100 }, `Completed "${goal.title}".`);
  }

  async function deleteGoal(goal: DashboardGoal) {
    if (!meId) return;
    setBusyGoalId(goal.id);
    setError(null);
    setInfo(null);

    const res = await supabaseCompat.from("dance_goals_user").delete().eq("id", goal.id).eq("user_id", meId);
    if (res.error) {
      setBusyGoalId(null);
      setError(res.error.message);
      return;
    }

    setBusyGoalId(null);
    await refreshDashboard(`Deleted "${goal.title}".`);
  }

  async function addDanceContact() {
    if (!meId) return;
    const contactType = addContactForm.contactType;
    const linkedUserId = addContactForm.linkedUserId.trim();
    const name = addContactForm.name.trim();
    const city = addContactForm.city.trim();
    const country = addContactForm.country.trim();
    const instagram = addContactForm.instagram.trim();
    const whatsapp = addContactForm.whatsapp.trim();
    const email = addContactForm.email.trim();
    const notes = addContactForm.notes.trim();
    const roles = normalizeRoleArray(addContactForm.rolesText);
    const tags = normalizeTagArray(addContactForm.tagsText);

    if (danceContacts.length >= MAX_CONTACTS) {
      setError(`You reached the ${MAX_CONTACTS} contacts limit.`);
      return;
    }
    if (!name) {
      setError("Contact name is required.");
      return;
    }
    if (notes.length > MAX_CONTACT_NOTES) {
      setError(`Notes can be at most ${MAX_CONTACT_NOTES} characters.`);
      return;
    }
    if (tags.length > MAX_CONTACT_TAGS) {
      setError(`Use up to ${MAX_CONTACT_TAGS} tags.`);
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email.");
      return;
    }
    if (contactType === "member" && !linkedUserId) {
      setError("Member contacts require a linked user id.");
      return;
    }

    setAddingContact(true);
    setError(null);
    setInfo(null);

    const payload = {
      user_id: meId,
      contact_type: contactType,
      linked_user_id: contactType === "member" ? linkedUserId : null,
      name,
      role: roles,
      city: city || null,
      country: country || null,
      instagram: instagram || null,
      whatsapp: whatsapp || null,
      email: email || null,
      tags,
      notes: notes || null,
    };

    const res = await supabaseCompat.from(CONTACTS_TABLE).insert(payload).select("id").single();
    if (res.error) {
      setAddingContact(false);
      if (isSchemaMissingError(res.error.message)) {
        setDanceContactsSchemaMissing(true);
        setError("Dance contacts table is missing. Run SQL migration: scripts/sql/2026-03-05_dashboard_dance_contacts.sql");
        return;
      }
      if (res.error.message.toLowerCase().includes("ux_dance_contacts_user_linked")) {
        setError("This member is already saved in your contacts.");
        return;
      }
      setError(res.error.message);
      return;
    }

    setAddContactForm(EMPTY_ADD_CONTACT_FORM);
    setShowAddContact(false);
    setAddingContact(false);
    await refreshDashboard("Contact saved.");
  }

  async function deleteDanceContact(contact: DanceContact) {
    if (!meId) return;
    setError(null);
    setInfo(null);
    const res = await supabaseCompat.from(CONTACTS_TABLE).delete().eq("id", contact.id).eq("user_id", meId);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    await refreshDashboard(`Removed "${contact.name}" from contacts.`);
  }

  return (
    <div className={showOnlyGrowth ? "text-slate-100" : "min-h-screen bg-[#06070b] text-slate-100"}>
      {!showOnlyGrowth ? <Nav /> : null}
      <main className={showOnlyGrowth ? "w-full" : "mx-auto w-full max-w-[1380px] px-4 pb-16 pt-6 sm:px-6 lg:px-8"}>
        {error ? (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <p className="min-w-0">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="shrink-0 rounded-md border border-rose-300/30 bg-rose-400/10 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-400/20"
            >
              x
            </button>
          </div>
        ) : null}
        {info ? (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">
            <p className="min-w-0">{info}</p>
            <button
              type="button"
              onClick={() => setInfo(null)}
              aria-label="Dismiss notice"
              className="shrink-0 rounded-md border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
            >
              x
            </button>
          </div>
        ) : null}
        {hasMissingDashboardSchema ? (
          <div className="mb-4 rounded-2xl border border-amber-300/35 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            <p className="font-semibold">Dance Tools modules need database setup in this Supabase project.</p>
            <p className="mt-1 text-amber-100/90">Run these SQL files in order:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-50/95">
              <li><code>scripts/sql/2026-03-03_dashboard_connections.sql</code></li>
              <li><code>scripts/sql/2026-03-02_dance_space_growth.sql</code></li>
              <li><code>scripts/sql/2026-03-04_dance_space_move_detail_refine.sql</code></li>
              <li><code>scripts/sql/2026-03-02_dashboard_goals.sql</code></li>
              <li><code>scripts/sql/2026-03-05_dashboard_goals_refine.sql</code></li>
              <li><code>scripts/sql/2026-03-02_dashboard_competitions.sql</code></li>
              <li><code>scripts/sql/2026-03-03_dashboard_competitions_results_refresh.sql</code></li>
              <li><code>scripts/sql/2026-03-05_dashboard_dance_contacts.sql</code></li>
              <li><code>scripts/sql/2026-03-02_dashboard_seed_sample.sql</code> (optional seed)</li>
              <li><code>scripts/sql/2026-03-05_dashboard_dance_contacts_seed.sql</code> (optional seed)</li>
            </ol>
          </div>
        ) : null}

        {loading ? (
          <section className={showOnlyGrowth ? "rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center" : "rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"}>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300" />
            <p className="text-sm text-slate-300">Loading Dance Tools…</p>
          </section>
        ) : (
          <div className={showOnlyGrowth ? "space-y-6" : "flex flex-col gap-7"}>
            {!showOnlyGrowth ? (
            <section className="relative overflow-hidden rounded-[28px] border border-cyan-200/10 bg-[#0b1a1d]/70 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:p-7">
              <div className="absolute inset-0 bg-[linear-gradient(125deg,rgba(17,113,127,0.36),rgba(164,41,187,0.26))]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.2),transparent_50%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(236,72,153,0.15),transparent_56%)]" />

              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <Avatar
                    src={profile?.avatarUrl ?? null}
                    alt={profile?.displayName ?? "Member"}
                    size={92}
                    className="h-[92px] w-[92px] rounded-full border-2 border-white/20"
                  />
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/90">Dance Tools</p>
                    <h1 className="truncate text-3xl font-black text-white">{profile?.displayName ?? "Member"}</h1>
                    <p className="truncate text-sm text-slate-200/90">{locationLabel}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {meId ? (
                    <Link
                      href={`/profile/${meId}`}
                      className="rounded-xl border border-white/20 bg-black/30 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-black/45"
                    >
                      View public profile
                    </Link>
                  ) : null}
                  <Link
                    href="/me/edit"
                    className="rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-[#06121a] hover:brightness-110"
                  >
                    Edit profile
                  </Link>
                </div>
              </div>
            </section>
            ) : null}

            <section
              id="growth"
              className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[#0a0d12]/92 p-5 shadow-[0_22px_55px_rgba(0,0,0,0.35)] sm:p-6"
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(148,163,184,0.08),transparent_44%)]" />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_86%,rgba(217,70,239,0.09),transparent_42%)]" />

              <div className="relative">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-black text-white sm:text-3xl">Growth</h2>
                    </div>
                  </div>
                  <div className="hidden flex-wrap items-end gap-3 sm:flex xl:justify-end">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={togglePracticeFeedSection}
                        className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${
                          showPracticeFeed
                            ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/22"
                            : "border-white/25 bg-white/[0.04] text-slate-100 hover:bg-white/[0.1]"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[16px]">history</span>
                        {showPracticeFeed ? "Hide log" : "Practice log"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddMove((prev) => !prev)}
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-gradient-to-r from-cyan-300/20 to-fuchsia-400/20 px-4 py-2 text-sm font-semibold text-cyan-100 hover:brightness-110"
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span>
                        Add move
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 sm:hidden">
                  <button
                    type="button"
                    onClick={togglePracticeFeedSection}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                      showPracticeFeed
                        ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                        : "border-white/20 bg-white/[0.04] text-slate-100"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">history</span>
                    {showPracticeFeed ? "Hide log" : "Practice log"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddMove((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/35 bg-gradient-to-r from-cyan-300/20 to-fuchsia-400/20 px-3 py-2 text-xs font-semibold text-cyan-100"
                  >
                    <span className="material-symbols-outlined text-[14px]">add</span>
                    Add move
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGrowthMobileFilters(true)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold ${
                      hasGrowthFilters
                        ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                        : "border-white/20 bg-white/[0.04] text-slate-100"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">tune</span>
                    Filters
                  </button>
                </div>

                <div className="mt-5 hidden gap-3 rounded-[22px] border border-white/10 bg-black/30 p-3 sm:grid sm:p-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(180px,0.62fr)_minmax(180px,0.58fr)_minmax(150px,0.5fr)_auto_auto]">
                  <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Search
                    <div className="relative">
                      <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-500">
                        search
                      </span>
                      <input
                        value={growthQuery}
                        onChange={(event) => setGrowthQuery(event.target.value)}
                        placeholder="Search moves..."
                        className="w-full rounded-full border border-white/15 bg-black/45 py-2 pl-10 pr-3 text-sm text-white placeholder:text-slate-500"
                      />
                    </div>
                  </label>
                  <div className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    <span>Dance style</span>
                    <details className="group relative">
                      <summary className="flex cursor-pointer list-none items-center justify-between rounded-full border border-white/15 bg-black/45 px-3 py-2 text-sm font-semibold normal-case text-white">
                        <span className="truncate">
                          {growthStyleFilters.length > 0
                            ? `${growthStyleFilters.length} selected`
                            : "All styles"}
                        </span>
                        <span className="material-symbols-outlined text-[18px] text-slate-400 transition-transform group-open:rotate-180">
                          expand_more
                        </span>
                      </summary>
                      <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-xl border border-white/10 bg-[#05070b] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
                        <div className="max-h-56 space-y-1 overflow-auto pr-1">
                          {growthStyles.map((style) => {
                            const selected = growthStyleFilters.includes(style);
                            return (
                              <label
                                key={style}
                                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5 text-xs font-semibold normal-case text-slate-200 hover:bg-white/[0.06]"
                              >
                                <span>{titleCase(style)}</span>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() =>
                                    setGrowthStyleFilters((prev) =>
                                      prev.includes(style)
                                        ? prev.filter((item) => item !== style)
                                        : [...prev, style]
                                    )
                                  }
                                  className="h-3.5 w-3.5 rounded border-white/30 bg-black/40 accent-cyan-300"
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </details>
                  </div>
                  <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Status
                    <select
                      value={growthStatusFilter}
                      onChange={(event) => setGrowthStatusFilter(event.target.value as "all" | DanceMoveStatus)}
                      className="rounded-full border border-white/15 bg-black/45 px-3 py-2 text-sm text-white"
                    >
                      <option value="all">All statuses</option>
                      <option value="planned">Planned</option>
                      <option value="practicing">Practicing</option>
                      <option value="learned">Learned</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Sort
                    <select
                      value={growthSort}
                      onChange={(event) => setGrowthSort(event.target.value as GrowthSort)}
                      className="rounded-full border border-white/15 bg-black/45 px-3 py-2 text-sm text-white"
                    >
                      <option value="recent">Most recent</option>
                      <option value="az">A → Z</option>
                      <option value="oldest">Oldest</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setGrowthOnlyRecent((prev) => !prev)}
                    className={`self-end rounded-full border px-3 py-2 text-sm font-semibold ${
                      growthOnlyRecent
                        ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                        : "border-white/20 bg-white/[0.04] text-slate-200"
                    }`}
                  >
                    Recent (14d)
                  </button>
                  {hasGrowthFilters ? (
                    <button
                      type="button"
                      onClick={() => {
                        setGrowthQuery("");
                        setGrowthStyleFilters([]);
                        setGrowthStatusFilter("all");
                        setGrowthSort("recent");
                        setGrowthOnlyRecent(false);
                      }}
                      className="self-end rounded-full border border-white/20 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.1]"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                {showGrowthMobileFilters ? (
                  <div
                    className="fixed inset-0 z-[90] flex items-end bg-black/70 px-0 backdrop-blur-sm sm:hidden"
                    onClick={() => setShowGrowthMobileFilters(false)}
                  >
                    <div
                      className="w-full rounded-t-[28px] border border-white/10 bg-[#091117] px-4 pb-5 pt-4 shadow-[0_-24px_60px_rgba(0,0,0,0.5)]"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/80">Growth filters</p>
                          <p className="mt-1 text-sm text-slate-300">Filter moves without crowding the board on mobile.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowGrowthMobileFilters(false)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/25 text-slate-200"
                          aria-label="Close growth filters"
                        >
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      </div>

                      <div className="mt-4 max-h-[68vh] space-y-4 overflow-y-auto pr-1">
                        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Search
                          <div className="relative">
                            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-500">
                              search
                            </span>
                            <input
                              value={growthQuery}
                              onChange={(event) => setGrowthQuery(event.target.value)}
                              placeholder="Search moves..."
                              className="w-full rounded-2xl border border-white/15 bg-black/45 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500"
                            />
                          </div>
                        </label>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Status
                            <select
                              value={growthStatusFilter}
                              onChange={(event) => setGrowthStatusFilter(event.target.value as "all" | DanceMoveStatus)}
                              className="rounded-2xl border border-white/15 bg-black/45 px-3 py-2.5 text-sm text-white"
                            >
                              <option value="all">All statuses</option>
                              <option value="planned">Planned</option>
                              <option value="practicing">Practicing</option>
                              <option value="learned">Learned</option>
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Sort
                            <select
                              value={growthSort}
                              onChange={(event) => setGrowthSort(event.target.value as GrowthSort)}
                              className="rounded-2xl border border-white/15 bg-black/45 px-3 py-2.5 text-sm text-white"
                            >
                              <option value="recent">Most recent</option>
                              <option value="az">A → Z</option>
                              <option value="oldest">Oldest</option>
                            </select>
                          </label>
                        </div>

                        <button
                          type="button"
                          onClick={() => setGrowthOnlyRecent((prev) => !prev)}
                          className={`w-full rounded-2xl border px-3 py-2.5 text-sm font-semibold ${
                            growthOnlyRecent
                              ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                              : "border-white/20 bg-white/[0.04] text-slate-200"
                          }`}
                        >
                          Recent only (14d)
                        </button>

                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Dance styles</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {growthStyles.map((style) => {
                              const selected = growthStyleFilters.includes(style);
                              return (
                                <button
                                  key={`mobile-style-${style}`}
                                  type="button"
                                  onClick={() =>
                                    setGrowthStyleFilters((prev) =>
                                      prev.includes(style) ? prev.filter((item) => item !== style) : [...prev, style]
                                    )
                                  }
                                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                                    selected
                                      ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                                      : "border-white/15 bg-white/[0.04] text-slate-200"
                                  }`}
                                >
                                  {titleCase(style)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center gap-2">
                        {hasGrowthFilters ? (
                          <button
                            type="button"
                            onClick={() => {
                              setGrowthQuery("");
                              setGrowthStyleFilters([]);
                              setGrowthStatusFilter("all");
                              setGrowthSort("recent");
                              setGrowthOnlyRecent(false);
                            }}
                            className="flex-1 rounded-2xl border border-white/20 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200"
                          >
                            Clear
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setShowGrowthMobileFilters(false)}
                          className="flex-1 rounded-2xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a]"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {growthSchemaMissing ? (
                <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
                  Growth module is unavailable in this environment until database setup is completed.
                </div>
              ) : (
                <>
                  {showAddMove ? (
                    <div className="mt-4 grid gap-3 rounded-[24px] border border-cyan-200/15 bg-black/30 p-4 shadow-[0_14px_35px_rgba(0,0,0,0.3)] sm:grid-cols-2 lg:grid-cols-6">
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Style
                        <select
                          value={moveForm.style}
                          onChange={(event) => setMoveForm((prev) => ({ ...prev, style: event.target.value }))}
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        >
                          {CORE_STYLES.map((style) => (
                            <option key={style} value={style}>
                              {titleCase(style)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                        Move name
                        <input
                          value={moveForm.name}
                          onChange={(event) => setMoveForm((prev) => ({ ...prev, name: event.target.value }))}
                          placeholder="e.g. Shadow position"
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Start in
                        <select
                          value={moveForm.status}
                          onChange={(event) =>
                            setMoveForm((prev) => ({ ...prev, status: event.target.value as DanceMoveStatus }))
                          }
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        >
                          <option value="planned">Planned</option>
                          <option value="practicing">Practicing</option>
                          <option value="learned">Learned</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Difficulty
                        <select
                          value={moveForm.difficulty}
                          onChange={(event) =>
                            setMoveForm((prev) => ({ ...prev, difficulty: event.target.value as DanceMoveDifficulty }))
                          }
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        >
                          {MOVE_DIFFICULTIES.map((difficulty) => (
                            <option key={difficulty} value={difficulty}>
                              {titleCase(difficulty)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Type
                        <select
                          value={moveForm.moveType}
                          onChange={(event) =>
                            setMoveForm((prev) => ({ ...prev, moveType: event.target.value as DanceMoveType }))
                          }
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        >
                          {MOVE_TYPES.map((moveType) => (
                            <option key={moveType} value={moveType}>
                              {moveTypeLabel(moveType)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Confidence
                        <select
                          value={moveForm.confidence}
                          onChange={(event) =>
                            setMoveForm((prev) => ({ ...prev, confidence: event.target.value as MoveFormState["confidence"] }))
                          }
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        >
                          <option value="">None</option>
                          <option value="1">1</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                          <option value="4">4</option>
                          <option value="5">5</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2 lg:col-span-3">
                        Reference link (optional)
                        <input
                          value={moveForm.referenceUrl}
                          onChange={(event) => setMoveForm((prev) => ({ ...prev, referenceUrl: event.target.value }))}
                          placeholder="https://youtube.com/..."
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2 lg:col-span-3">
                        Key cue
                        <input
                          maxLength={500}
                          value={moveForm.keyCue}
                          onChange={(event) => setMoveForm((prev) => ({ ...prev, keyCue: event.target.value }))}
                          placeholder="One line cue"
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2 lg:col-span-3">
                        Common mistake
                        <input
                          maxLength={500}
                          value={moveForm.commonMistake}
                          onChange={(event) => setMoveForm((prev) => ({ ...prev, commonMistake: event.target.value }))}
                          placeholder="What usually breaks"
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2 lg:col-span-3">
                        Fix
                        <input
                          maxLength={500}
                          value={moveForm.fixTip}
                          onChange={(event) => setMoveForm((prev) => ({ ...prev, fixTip: event.target.value }))}
                          placeholder="Actionable fix"
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                        />
                      </label>
                      <label className="sm:col-span-2 lg:col-span-5 flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        More notes (optional)
                        <textarea
                          maxLength={500}
                          value={moveForm.note}
                          onChange={(event) => setMoveForm((prev) => ({ ...prev, note: event.target.value }))}
                          placeholder="Extra context"
                          rows={2}
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                        />
                        <span className="text-[10px] text-slate-500">{moveForm.note.length}/500</span>
                      </label>
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          onClick={() => void addMove()}
                          disabled={addingMove}
                          className="w-full rounded-lg bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
                        >
                          {addingMove ? "Saving..." : "Save move"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="no-scrollbar mt-5 grid auto-cols-[82vw] grid-flow-col gap-4 overflow-x-auto pb-2 snap-x snap-mandatory sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-3">
                    {(["planned", "practicing", "learned"] as DanceMoveStatus[]).map((status) => (
                      <article
                        key={status}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDropColumnStatus(status);
                        }}
                        onDragEnter={(event) => {
                          event.preventDefault();
                          setDropColumnStatus(status);
                        }}
                        onDragLeave={() => {
                          if (dropColumnStatus === status) setDropColumnStatus(null);
                        }}
                        onDrop={() => void onDropMoveToStatus(status)}
                        className={`relative snap-start overflow-hidden rounded-[26px] border bg-[#0a1016]/80 p-3.5 transition-all sm:snap-none ${
                          dropColumnStatus === status
                            ? "border-cyan-300/45 shadow-[0_0_0_1px_rgba(103,232,249,0.25),0_0_32px_rgba(34,211,238,0.18)]"
                            : status === "planned"
                            ? "border-slate-400/25"
                            : status === "practicing"
                            ? "border-cyan-300/25"
                            : "border-fuchsia-300/25"
                        }`}
                      >
                        <div
                          className={`pointer-events-none absolute inset-x-4 top-0 h-[2px] ${
                            status === "planned"
                              ? "bg-slate-300/40"
                              : status === "practicing"
                              ? "bg-cyan-300/60"
                              : "bg-fuchsia-300/55"
                          }`}
                        />
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                status === "planned"
                                  ? "bg-slate-300 shadow-[0_0_10px_rgba(148,163,184,0.55)]"
                                  : status === "practicing"
                                  ? "bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.7)]"
                                  : "bg-fuchsia-300 shadow-[0_0_12px_rgba(232,121,249,0.65)]"
                              }`}
                            />
                            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-200">{statusToLabel(status)}</h3>
                          </div>
                          <span className="rounded-full border border-white/20 bg-white/[0.06] px-2 py-0.5 text-xs font-semibold text-slate-200">
                            {groupedMoves[status].length}
                          </span>
                        </div>
                        <div className="max-h-[360px] space-y-2.5 overflow-auto pr-1">
                          {groupedMoves[status].map((move) => (
                            <div
                              key={move.id}
                              draggable={busyMoveId !== move.id}
                              onDragStart={() => onMoveDragStart(move.id)}
                              onDragEnd={onMoveDragEnd}
                              className={`rounded-2xl border bg-black/40 p-3 transition-all duration-200 ${
                                dragMoveId === move.id
                                  ? "border-cyan-300/45 opacity-80 shadow-[0_0_24px_rgba(34,211,238,0.16)]"
                                  : "border-white/10 hover:border-cyan-300/25 hover:shadow-[0_0_20px_rgba(34,211,238,0.12)]"
                              } ${busyMoveId === move.id ? "cursor-not-allowed opacity-60" : "cursor-grab active:cursor-grabbing"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => void openMoveDetail(move)}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <div className="mb-2 flex items-center gap-2">
                                    <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100">
                                      {titleCase(move.style)}
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                      {move.confidence ? `Confidence ${move.confidence}/5` : "No confidence"}
                                    </span>
                                  </div>
                                  <p className="truncate text-base font-bold text-white">{move.name}</p>
                                  <p className="text-xs text-slate-400">
                                    {moveTypeLabel(move.moveType)} • {move.practiceCount} practices
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    Last practiced: {formatRelative(move.lastPracticedAt)}
                                  </p>
                                </button>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void shiftMove(move, "prev")}
                                    disabled={busyMoveId === move.id || !previousStatus(move.status)}
                                    className="rounded-lg border border-white/20 bg-black/45 px-2 py-1 text-xs text-white/90 disabled:opacity-40"
                                  >
                                    ←
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void shiftMove(move, "next")}
                                    disabled={busyMoveId === move.id || !nextStatus(move.status)}
                                    className="rounded-lg border border-white/20 bg-black/45 px-2 py-1 text-xs text-white/90 disabled:opacity-40"
                                  >
                                    →
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                          {groupedMoves[status].length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/15 bg-black/25 px-3 py-7 text-center text-sm text-slate-500">
                              {hasGrowthFilters ? "No moves match these filters." : "No moves yet."}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>

                  {showPracticeFeed ? (
                    <section
                      id="practice-log"
                      ref={practiceLogSectionRef}
                      className="mt-5 rounded-[24px] border border-cyan-200/15 bg-black/35 p-4 shadow-[0_14px_35px_rgba(0,0,0,0.3)]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="inline-flex items-center gap-2 text-xl font-black text-white">
                          <span className="material-symbols-outlined text-cyan-300">history</span>
                          Practice Log
                        </h2>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-cyan-200/30 bg-cyan-300/12 px-2 py-1 text-[11px] font-semibold text-cyan-100">
                            {practiceFeedSummary.total} total
                          </span>
                          <p className="text-xs text-slate-400">Shortcut: press L</p>
                          <button
                            type="button"
                            onClick={() => void loadPracticeFeed()}
                            disabled={loadingPracticeFeed}
                            className="rounded-full border border-white/20 bg-white/[0.05] px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {loadingPracticeFeed ? "Refreshing..." : "Refresh"}
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
                        <article className="rounded-2xl border border-white/10 bg-black/35 p-4">
                          <div className="flex items-end justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">14-day activity split</p>
                            <p className="text-xs text-slate-500">{practiceFeedStatus14d.total} logs</p>
                          </div>
                          <div className="mt-3 space-y-2">
                            {(["planned", "practicing", "learned"] as DanceMoveStatus[]).map((status) => {
                              const count = practiceFeedStatus14d[status];
                              const pct = practiceFeedStatus14d.total > 0 ? Math.round((count / practiceFeedStatus14d.total) * 100) : 0;
                              return (
                                <div key={status} className="space-y-1">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-semibold text-slate-300">{statusToLabel(status)}</span>
                                    <span className="text-slate-400">{count}</span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                    <div
                                      className={`h-full rounded-full ${
                                        status === "planned"
                                          ? "bg-slate-400/80"
                                          : status === "practicing"
                                          ? "bg-cyan-300"
                                          : "bg-emerald-300"
                                      }`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <p className="mt-4 text-xs text-slate-500">{practiceFeedSummary.last7d} logged in the last 7 days.</p>
                        </article>

                        <article className="rounded-2xl border border-white/10 bg-black/35 p-4">
                          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-200">Latest sessions (20)</h3>
                          {loadingPracticeFeed ? (
                            <p className="rounded-xl border border-white/10 bg-black/40 px-3 py-4 text-sm text-slate-400">Loading practice history…</p>
                          ) : practiceFeed.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-white/15 bg-black/30 px-3 py-4 text-sm text-slate-500">
                              No practice sessions logged yet.
                            </p>
                          ) : (
                            <div className="max-h-[228px] space-y-2 overflow-auto pr-1">
                              {practiceFeed.map((item) => (
                                <div key={item.id} className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-sm font-semibold text-white">
                                      {item.moveName}
                                      <span className="ml-2 text-xs font-medium text-slate-400">
                                        {titleCase(item.moveStyle)}
                                        {item.moveStatus ? ` · ${statusToLabel(item.moveStatus)}` : ""}
                                      </span>
                                    </p>
                                    <p className="text-[11px] text-slate-500">{formatRelative(item.createdAt)}</p>
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <span className="text-slate-400">Confidence: {item.confidenceAfter ?? "-"}</span>
                                    {item.quickNote ? <span className="truncate text-slate-500">{item.quickNote}</span> : null}
                                    <button
                                      type="button"
                                      onClick={() => void openMoveFromFeed(item.moveId)}
                                      className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-0.5 font-semibold text-cyan-100 hover:bg-cyan-300/20"
                                    >
                                      Open move
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </article>
                      </div>
                    </section>
                  ) : null}

                </>
              )}
            </section>

            {moveUndoToast ? (
              <div className="fixed bottom-4 right-4 z-[70] w-[min(92vw,360px)] rounded-xl border border-cyan-300/35 bg-[#071017]/95 p-3 shadow-[0_18px_45px_rgba(0,0,0,0.45)] backdrop-blur">
                <p className="text-sm font-semibold text-cyan-100">{moveUndoToast.label}</p>
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={clearUndoToast}
                    className="rounded-md border border-white/20 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.09]"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => void undoLastMoveStatusChange()}
                    className="rounded-md border border-cyan-300/35 bg-cyan-300/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                  >
                    Undo
                  </button>
                </div>
              </div>
            ) : null}

            <section
              id="competitions"
              className="order-last rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="inline-flex items-center gap-2 text-2xl font-black text-white">
                  <span className="material-symbols-outlined text-amber-300">trending_up</span>
                  Competition Stats
                </h2>
                <button
                  type="button"
                  onClick={() => setShowAddCompetition((prev) => !prev)}
                  className="inline-flex items-center gap-2 rounded-lg border border-fuchsia-300/35 bg-fuchsia-300/10 px-3 py-1.5 text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-300/20"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Add result
                </button>
              </div>

              {competitionsSchemaMissing ? (
                <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
                  Competitions module is unavailable in this environment until database setup is completed.
                </div>
              ) : (
                <>
                  {showAddCompetition ? (
                    <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                        Event
                        <input
                          value={competitionForm.eventName}
                          onChange={(event) => setCompetitionForm((prev) => ({ ...prev, eventName: event.target.value }))}
                          placeholder="Event name"
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        City
                        <input
                          value={competitionForm.city}
                          onChange={(event) => setCompetitionForm((prev) => ({ ...prev, city: event.target.value }))}
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Country
                        <input
                          value={competitionForm.country}
                          onChange={(event) => setCompetitionForm((prev) => ({ ...prev, country: event.target.value }))}
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Style
                        <input
                          value={competitionForm.style}
                          onChange={(event) => setCompetitionForm((prev) => ({ ...prev, style: event.target.value }))}
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Division
                        <input
                          value={competitionForm.division}
                          onChange={(event) => setCompetitionForm((prev) => ({ ...prev, division: event.target.value }))}
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Role
                        <select
                          value={competitionForm.role}
                          onChange={(event) =>
                            setCompetitionForm((prev) => ({ ...prev, role: event.target.value as CompetitionFormState["role"] }))
                          }
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        >
                          <option value="Leader">Leader</option>
                          <option value="Follower">Follower</option>
                          <option value="Switch">Switch</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Result
                        <select
                          value={competitionForm.result}
                          onChange={(event) =>
                            setCompetitionForm((prev) => ({ ...prev, result: event.target.value as CompetitionFormState["result"] }))
                          }
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        >
                          {COMPETITION_RESULTS.map((result) => (
                            <option key={result} value={result}>
                              {result}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Year
                        <input
                          value={competitionForm.year}
                          onChange={(event) => setCompetitionForm((prev) => ({ ...prev, year: event.target.value }))}
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2 lg:col-span-4">
                        Note (optional)
                        <input
                          value={competitionForm.note}
                          onChange={(event) => setCompetitionForm((prev) => ({ ...prev, note: event.target.value }))}
                          placeholder="Optional context"
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                        />
                      </label>
                      <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void addCompetitionResult()}
                          disabled={addingCompetition}
                          className="rounded-lg bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
                        >
                          {addingCompetition ? "Saving..." : "Save result"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:hidden">
                    <article className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Winner cups</p>
                      <p className="mt-1 text-xl font-black text-white">{competitionStats.winners}</p>
                    </article>
                    <article className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Completed</p>
                      <p className="mt-1 text-xl font-black text-white">{competitionStats.completed}</p>
                    </article>
                    <article className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Leader</p>
                      <p className="mt-1 text-xl font-black text-white">{competitionStats.leader}</p>
                    </article>
                    <article className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Follower</p>
                      <p className="mt-1 text-xl font-black text-white">{competitionStats.follower}</p>
                    </article>
                  </div>

                  <div className="mt-4 hidden gap-3 sm:grid sm:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-2xl border border-amber-300/35 bg-gradient-to-br from-amber-500/20 via-amber-700/10 to-transparent p-3 text-center">
                      <span className="material-symbols-outlined text-[26px] text-amber-300">emoji_events</span>
                      <p className="mt-1 text-2xl font-black text-white">{competitionStats.winners}</p>
                      <p className="text-xs uppercase tracking-wide text-amber-100/90">Winner Cups</p>
                    </article>
                    <article className="rounded-2xl border border-emerald-300/35 bg-gradient-to-br from-emerald-500/20 via-emerald-700/10 to-transparent p-3 text-center">
                      <span className="material-symbols-outlined text-[26px] text-emerald-300">star</span>
                      <p className="mt-1 text-2xl font-black text-white">{competitionStats.completed}</p>
                      <p className="text-xs uppercase tracking-wide text-emerald-100/90">Completed</p>
                    </article>
                    <article className="rounded-2xl border border-sky-300/35 bg-gradient-to-br from-sky-500/20 via-sky-700/10 to-transparent p-3 text-center">
                      <span className="material-symbols-outlined text-[26px] text-sky-300">groups</span>
                      <p className="mt-1 text-2xl font-black text-white">{competitionStats.leader}</p>
                      <p className="text-xs uppercase tracking-wide text-sky-100/90">As Leader</p>
                    </article>
                    <article className="rounded-2xl border border-fuchsia-300/35 bg-gradient-to-br from-fuchsia-500/20 via-fuchsia-700/10 to-transparent p-3 text-center">
                      <span className="material-symbols-outlined text-[26px] text-fuchsia-300">groups_2</span>
                      <p className="mt-1 text-2xl font-black text-white">{competitionStats.follower}</p>
                      <p className="text-xs uppercase tracking-wide text-fuchsia-100/90">As Follower</p>
                    </article>
                  </div>

                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="inline-flex items-center gap-2 text-xl font-black text-white">
                        <span className="material-symbols-outlined text-amber-300">emoji_events</span>
                        Competition History
                      </h3>
                      {competitions.length > 6 ? (
                        <button
                          type="button"
                          onClick={() => setShowAllCompetitionHistory((prev) => !prev)}
                          className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
                        >
                          {showAllCompetitionHistory ? "Show latest" : `Show all (${competitionStats.total})`}
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Latest competitions</p>

                    <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                      {competitions.slice(0, 6).map((item) => {
                        const place = [item.city, item.country].filter(Boolean).join(", ");
                        return (
                          <article
                            key={`latest-${item.id}`}
                            className="min-w-[250px] max-w-[280px] rounded-xl border border-white/10 bg-[#090b11] p-3"
                          >
                            <p className="line-clamp-1 text-base font-semibold text-white">{item.eventName}</p>
                            <p className="mt-1 line-clamp-1 text-xs text-slate-400">
                              {[place, String(item.year), item.role].filter(Boolean).join(" • ")}
                            </p>
                            <p className="mt-2 inline-flex rounded-full border border-white/15 bg-white/[0.03] px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                              {item.result}
                            </p>
                            <p className="mt-1 line-clamp-1 text-[11px] uppercase tracking-wide text-slate-500">
                              {titleCase(item.style)} • {item.division}
                            </p>
                          </article>
                        );
                      })}
                      {competitions.length === 0 ? (
                        <div className="w-full rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-5 text-center text-sm text-slate-500">
                          No competition entries yet.
                        </div>
                      ) : null}
                    </div>

                    {showAllCompetitionHistory && competitions.length > 6 ? (
                      <div className="mt-4 grid max-h-72 gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2 sm:grid-cols-2">
                        {competitions.map((item) => {
                          const place = [item.city, item.country].filter(Boolean).join(", ");
                          return (
                            <article key={item.id} className="rounded-lg border border-white/10 bg-[#090b11] p-3">
                              <p className="line-clamp-1 text-sm font-semibold text-white">{item.eventName}</p>
                              <p className="mt-1 line-clamp-1 text-xs text-slate-400">
                                {[place, String(item.year), item.role].filter(Boolean).join(" • ")}
                              </p>
                              <p className="mt-1 text-[11px] font-semibold text-cyan-200">{item.result}</p>
                            </article>
                          );
                        })}
                      </div>
                    ) : null}

                    <p className="mt-3 text-xs text-slate-500">
                      Total competitions logged: <span className="font-semibold text-slate-300">{competitionStats.total}</span>
                    </p>
                  </div>
                </>
              )}
            </section>

            <section
              id="goals"
              className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]"
            >
              {goalWarning ? (
                <div className="mb-3 rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-100">
                  {goalWarning}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-white">Active Goals</h2>
                <button
                  type="button"
                  onClick={() => {
                    if (!showAddGoal && activeGoalsLimitReached) {
                      setGoalWarning("Focus on finishing your current goals first. Complete or delete one to add another.");
                      return;
                    }
                    setGoalWarning(null);
                    setShowAddGoal((prev) => !prev);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-300/35 bg-fuchsia-300/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-300/20 sm:text-sm"
                >
                  <span className="material-symbols-outlined hidden text-[16px] sm:inline-flex">add</span>
                  <span>Add goal</span>
                  <span className="text-[10px] text-fuchsia-100/80 sm:text-xs">({activeGoals.length}/{MAX_ACTIVE_GOALS})</span>
                </button>
              </div>
              {goalsSchemaMissing ? (
                <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
                  Goals module is unavailable in this environment until database setup is completed. Run:
                  <code className="ml-1 rounded bg-black/30 px-1 py-0.5">scripts/sql/2026-03-02_dashboard_goals.sql</code>
                  <span className="mx-1">and</span>
                  <code className="rounded bg-black/30 px-1 py-0.5">scripts/sql/2026-03-05_dashboard_goals_refine.sql</code>.
                </div>
              ) : (
                <>
                  {showAddGoal ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-wrap gap-2">
                        {GOAL_TEMPLATES.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => applyGoalTemplate(template.id)}
                            className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-cyan-300/35 hover:text-cyan-100"
                          >
                            {template.title}
                          </button>
                        ))}
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                        Goal title
                        <input
                          value={goalForm.title}
                          onChange={(event) => setGoalForm((prev) => ({ ...prev, title: event.target.value }))}
                          placeholder="e.g. Practice every Tue/Thu"
                          maxLength={MAX_GOAL_TITLE_LENGTH}
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                        />
                        <span className="text-[11px] text-slate-500">
                          {goalForm.title.trim().length}/{MAX_GOAL_TITLE_LENGTH}
                        </span>
                      </label>
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                          Category
                          <select
                            value={goalForm.category}
                            onChange={(event) =>
                              setGoalForm((prev) => ({ ...prev, category: event.target.value as GoalFormState["category"] }))
                            }
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                          >
                            <option value="">No category</option>
                            {GOAL_CATEGORIES.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Target date
                        <input
                          type="date"
                          value={goalForm.targetDate}
                          onChange={(event) => setGoalForm((prev) => ({ ...prev, targetDate: event.target.value }))}
                          min={minGoalTargetDate}
                          max={maxGoalTargetDate}
                          required
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        />
                        <span className="text-[11px] text-slate-500">
                          Max duration {MAX_GOAL_DURATION_DAYS} days
                        </span>
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Progress %
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={goalForm.progress}
                          onChange={(event) => setGoalForm((prev) => ({ ...prev, progress: event.target.value }))}
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                        />
                      </label>
                        <label className="sm:col-span-2 lg:col-span-4 flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                        Note (optional)
                        <textarea
                          value={goalForm.note}
                          onChange={(event) => setGoalForm((prev) => ({ ...prev, note: event.target.value }))}
                          maxLength={MAX_GOAL_NOTE_LENGTH}
                          placeholder="Optional context"
                          rows={2}
                          className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                        />
                        <span className="text-[11px] text-slate-500">
                          {goalForm.note.trim().length}/{MAX_GOAL_NOTE_LENGTH}
                        </span>
                      </label>
                        <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-between gap-3">
                          <p className="text-xs text-slate-400">
                            Active goals: {activeGoals.length}/{MAX_ACTIVE_GOALS}
                          </p>
                        <button
                          type="button"
                          onClick={() => void addGoal()}
                          disabled={addingGoal}
                          className="rounded-lg bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
                        >
                          {addingGoal ? "Saving..." : "Save goal"}
                        </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-2.5 sm:hidden">
                    {activeGoals.map((goal) => (
                      <article key={`mobile-${goal.id}`} className="rounded-xl border border-white/10 bg-black/25 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-white">{goal.title}</h3>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {[goal.category ? goalCategoryLabel(goal.category) : null, goalDaysRemainingLabel(goal.targetDate)].filter(Boolean).join(" • ")}
                            </p>
                          </div>
                          <span className="rounded-full border border-cyan-200/25 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">
                            {goal.progress}%
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400" style={{ width: `${goal.progress}%` }} />
                        </div>
                        {goalNeedsAttention(goal) ? (
                          <p className="mt-2 text-[11px] font-medium text-amber-100">Needs attention</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => void adjustGoalProgress(goal, -10)}
                            disabled={busyGoalId === goal.id}
                            className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-200 disabled:opacity-50"
                          >
                            -10%
                          </button>
                          <button
                            type="button"
                            onClick={() => void adjustGoalProgress(goal, 10)}
                            disabled={busyGoalId === goal.id}
                            className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-200 disabled:opacity-50"
                          >
                            +10%
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleGoalStatus(goal)}
                            disabled={busyGoalId === goal.id}
                            className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-[11px] font-semibold text-emerald-100 disabled:opacity-50"
                          >
                            Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteGoal(goal)}
                            disabled={busyGoalId === goal.id}
                            className="rounded-lg border border-rose-300/35 bg-rose-300/10 px-2 py-1 text-[11px] font-semibold text-rose-100 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className="mt-4 hidden gap-3 md:grid-cols-2 xl:grid-cols-3 sm:grid">
                    {activeGoals.map((goal) => (
                      <article key={goal.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-base font-bold text-white">{goal.title}</h3>
                            <p className="text-xs text-slate-400">{formatMonthDay(goal.targetDate)}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                              {goal.category ? (
                                <span className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-2 py-0.5 font-semibold text-cyan-100">
                                  {goalCategoryLabel(goal.category)}
                                </span>
                              ) : null}
                              <span className="text-slate-400">{goalDaysRemainingLabel(goal.targetDate)}</span>
                              {goalNeedsAttention(goal) ? (
                                <span className="rounded-full border border-amber-300/35 bg-amber-300/15 px-2 py-0.5 font-semibold text-amber-100">
                                  Needs attention
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <span className="rounded-full border border-cyan-200/35 bg-cyan-300/10 px-2 py-0.5 text-xs font-semibold text-cyan-100">
                            {goal.progress}%
                          </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400" style={{ width: `${goal.progress}%` }} />
                        </div>
                        <p className="mt-2 text-xs text-slate-400">{goal.progress}/100 complete</p>
                        {goal.note ? <p className="mt-3 line-clamp-2 text-xs text-slate-400">{goal.note}</p> : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void adjustGoalProgress(goal, -10)}
                            disabled={busyGoalId === goal.id}
                            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 disabled:opacity-50"
                          >
                            -10%
                          </button>
                          <button
                            type="button"
                            onClick={() => void adjustGoalProgress(goal, 10)}
                            disabled={busyGoalId === goal.id}
                            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 disabled:opacity-50"
                          >
                            +10%
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleGoalStatus(goal)}
                            disabled={busyGoalId === goal.id}
                            className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-xs font-semibold text-emerald-100 disabled:opacity-50"
                          >
                            Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteGoal(goal)}
                            disabled={busyGoalId === goal.id}
                            className="rounded-lg border border-rose-300/35 bg-rose-300/10 px-2.5 py-1 text-xs font-semibold text-rose-100 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>

                  {activeGoals.length === 0 ? (
                    <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-5 text-center text-sm text-slate-500">
                      No active goals yet.
                    </div>
                  ) : null}

                  {completedGoals.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Completed ({completedGoals.length})
                      </p>
                      <div className="space-y-2">
                        {visibleCompletedGoals.map((goal) => (
                          <div key={goal.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-slate-300 line-through">{goal.title}</p>
                              {goal.category ? (
                                <p className="text-[11px] text-slate-500">{goalCategoryLabel(goal.category)}</p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => void toggleGoalStatus(goal)}
                              disabled={busyGoalId === goal.id}
                              className="rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs font-semibold text-white/90 disabled:opacity-50"
                            >
                              Reopen
                            </button>
                          </div>
                        ))}
                      </div>
                      {hiddenCompletedGoalsCount > 0 ? (
                        <p className="mt-2 text-xs text-slate-500">
                          Showing latest {MAX_VISIBLE_COMPLETED_GOALS}. {hiddenCompletedGoalsCount} older goals are archived from this view.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </section>

            {!showOnlyGrowth ? (
            <>
            <section
              id="dance-network"
              className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-white">Dance Contacts</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {contactsSummary.total}/{MAX_CONTACTS} contacts • {contactsSummary.memberCount} members •{" "}
                    {contactsSummary.externalCount} external
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddContact((prev) => !prev)}
                    className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20"
                  >
                    <span className="material-symbols-outlined text-[16px]">person_add</span>
                    Add contact
                  </button>
                </div>
              </div>

              {danceContactsSchemaMissing ? (
                <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
                  Dance contacts module is unavailable in this environment. Run SQL migration:
                  <code className="ml-1 rounded bg-black/30 px-1 py-0.5">scripts/sql/2026-03-05_dashboard_dance_contacts.sql</code>
                </div>
              ) : (
                <>
                  <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-black/25 p-3 sm:grid-cols-2 lg:grid-cols-6">
                    <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                      Search
                      <input
                        value={contactsQuery}
                        onChange={(event) => setContactsQuery(event.target.value)}
                        placeholder="Search name, tags, city..."
                        className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                      Type
                      <select
                        value={contactsTypeFilter}
                        onChange={(event) => setContactsTypeFilter(event.target.value as "all" | ContactType)}
                        className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                      >
                        <option value="all">All</option>
                        <option value="member">Members</option>
                        <option value="external">External</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                      Role
                      <select
                        value={contactsRoleFilter}
                        onChange={(event) => setContactsRoleFilter(event.target.value)}
                        className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                      >
                        <option value="all">All roles</option>
                        {contactsRoleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                      Tag
                      <select
                        value={contactsTagFilter}
                        onChange={(event) => setContactsTagFilter(event.target.value)}
                        className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                      >
                        <option value="all">All tags</option>
                        {contactsTagOptions.map((tag) => (
                          <option key={tag} value={tag}>
                            {tag}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                      City
                      <select
                        value={contactsCityFilter}
                        onChange={(event) => setContactsCityFilter(event.target.value)}
                        className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                      >
                        <option value="all">All cities</option>
                        {contactsCityOptions.map((city) => (
                          <option key={city} value={city}>
                            {city}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {hasContactsFilters ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setContactsQuery("");
                          setContactsTypeFilter("all");
                          setContactsRoleFilter("all");
                          setContactsTagFilter("all");
                          setContactsCityFilter("all");
                        }}
                        className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.12]"
                      >
                        Clear filters
                      </button>
                    </div>
                  ) : null}

                  {showAddContact ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                          Type
                          <select
                            value={addContactForm.contactType}
                            onChange={(event) =>
                              setAddContactForm((prev) => ({
                                ...prev,
                                contactType: event.target.value as ContactType,
                              }))
                            }
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                          >
                            <option value="external">External</option>
                            <option value="member">Member</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                          Name
                          <input
                            value={addContactForm.name}
                            onChange={(event) => setAddContactForm((prev) => ({ ...prev, name: event.target.value }))}
                            maxLength={120}
                            placeholder="Contact name"
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                          />
                        </label>
                        {addContactForm.contactType === "member" ? (
                          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2 lg:col-span-3">
                            Linked user id
                            <input
                              value={addContactForm.linkedUserId}
                              onChange={(event) =>
                                setAddContactForm((prev) => ({ ...prev, linkedUserId: event.target.value }))
                              }
                              placeholder="Use Save contact on member profile, or paste user id"
                              className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                            />
                          </label>
                        ) : null}
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                          City
                          <input
                            value={addContactForm.city}
                            onChange={(event) => setAddContactForm((prev) => ({ ...prev, city: event.target.value }))}
                            placeholder="City"
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                          Country
                          <input
                            value={addContactForm.country}
                            onChange={(event) => setAddContactForm((prev) => ({ ...prev, country: event.target.value }))}
                            placeholder="Country"
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                          Instagram
                          <input
                            value={addContactForm.instagram}
                            onChange={(event) =>
                              setAddContactForm((prev) => ({ ...prev, instagram: event.target.value }))
                            }
                            placeholder="@handle"
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                          WhatsApp
                          <input
                            value={addContactForm.whatsapp}
                            onChange={(event) =>
                              setAddContactForm((prev) => ({ ...prev, whatsapp: event.target.value }))
                            }
                            placeholder="+34 ..."
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                          Email
                          <input
                            value={addContactForm.email}
                            onChange={(event) => setAddContactForm((prev) => ({ ...prev, email: event.target.value }))}
                            placeholder="name@email.com"
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                          Roles
                          <input
                            value={addContactForm.rolesText}
                            onChange={(event) =>
                              setAddContactForm((prev) => ({ ...prev, rolesText: event.target.value }))
                            }
                            placeholder="Organizer, Dancer"
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                          Tags (max 10)
                          <input
                            value={addContactForm.tagsText}
                            onChange={(event) =>
                              setAddContactForm((prev) => ({ ...prev, tagsText: event.target.value }))
                            }
                            placeholder="festival buddy, host"
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2 lg:col-span-3">
                          Notes
                          <textarea
                            value={addContactForm.notes}
                            onChange={(event) => setAddContactForm((prev) => ({ ...prev, notes: event.target.value }))}
                            maxLength={MAX_CONTACT_NOTES}
                            rows={2}
                            placeholder="Private note about this contact"
                            className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                          />
                          <span className="text-[11px] text-slate-500">
                            {addContactForm.notes.trim().length}/{MAX_CONTACT_NOTES}
                          </span>
                        </label>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-slate-500">Save members directly from their profile for auto-fill.</p>
                        <button
                          type="button"
                          onClick={() => void addDanceContact()}
                          disabled={addingContact}
                          className="rounded-lg bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
                        >
                          {addingContact ? "Saving..." : "Save contact"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {filteredContacts.length === 0 ? (
                    <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-5 text-center text-sm text-slate-500">
                      {danceContacts.length === 0
                        ? "No contacts yet. Save members from profile or add external contacts."
                        : "No contacts match these filters."}
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {filteredContacts.slice(0, 12).map((contact) => {
                        const place = [contact.city, contact.country].filter(Boolean).join(", ");
                        const profileHref = contact.linkedUserId ? `/profile/${contact.linkedUserId}` : null;
                        return (
                          <article key={contact.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar
                                  src={contact.avatarUrl}
                                  alt={contact.name}
                                  size={46}
                                  className="h-[46px] w-[46px] rounded-full border border-white/20"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="truncate text-sm font-bold text-white">{contact.name}</p>
                                    <span
                                      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                        contact.contactType === "member"
                                          ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                                          : "border-white/20 bg-white/[0.06] text-slate-300"
                                      }`}
                                    >
                                      {contact.contactType}
                                    </span>
                                  </div>
                                  <p className="truncate text-xs text-slate-400">{place || "Location not set"}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                {profileHref ? (
                                  <Link
                                    href={profileHref}
                                    className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/90 hover:bg-white/10"
                                  >
                                    View
                                  </Link>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => void deleteDanceContact(contact)}
                                  className="rounded-lg border border-rose-300/30 bg-rose-400/10 px-2 py-1 text-[11px] font-semibold text-rose-100 hover:bg-rose-400/20"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {contact.roles.slice(0, 3).map((role) => (
                                <span key={`${contact.id}-role-${role}`} className="rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[11px] text-slate-300">
                                  {role}
                                </span>
                              ))}
                              {contact.tags.slice(0, 4).map((tag) => (
                                <span key={`${contact.id}-tag-${tag}`} className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[11px] text-cyan-100">
                                  #{tag}
                                </span>
                              ))}
                            </div>
                            <div className="mt-3 space-y-1 text-[11px] text-slate-400">
                              {contact.instagram ? <p className="truncate">Instagram: {contact.instagram}</p> : null}
                              {contact.whatsapp ? <p className="truncate">WhatsApp: {contact.whatsapp}</p> : null}
                              {contact.email ? <p className="truncate">Email: {contact.email}</p> : null}
                            </div>
                            {contact.notes ? <p className="mt-3 line-clamp-2 text-xs text-slate-400">{contact.notes}</p> : null}
                            <p className="mt-3 text-[11px] text-slate-500">Updated {formatRelative(contact.updatedAt)}</p>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </section>
            </>
            ) : null}

            {activeMove ? (
              <MoveDetailDialog
                activeMove={activeMove}
                moveDetailForm={moveDetailForm}
                setMoveDetailForm={setMoveDetailForm}
                moveDifficulties={MOVE_DIFFICULTIES}
                moveTypes={MOVE_TYPES}
                practiceQuickNote={practiceQuickNote}
                setPracticeQuickNote={setPracticeQuickNote}
                movePracticeLogs={movePracticeLogs}
                loadingMoveDetail={loadingMoveDetail}
                savingMoveDetail={savingMoveDetail}
                loggingPractice={loggingPractice}
                deletingMove={deletingMove}
                onClose={closeMoveDetail}
                onSave={() => void saveMoveDetail()}
                onLogPractice={() => void logPractice()}
                onDelete={() => void deleteMove(activeMove)}
                formatRelative={formatRelative}
                moveTypeLabel={moveTypeLabel}
                statusToLabel={statusToLabel}
                titleCase={titleCase}
              />
            ) : null}

          </div>
        )}
      </main>
    </div>
  );
}

export default function DashboardPage() {
  const embeddedSection = useDashboardEmbedMode();

  if (embeddedSection) {
    return (
      <Suspense
        fallback={
          <div className="rounded-2xl border border-cyan-300/20 bg-[#121212] p-6 text-sm text-slate-300">
            Loading Dance Tools...
          </div>
        }
      >
        <DashboardPageContent embeddedSection={embeddedSection} />
      </Suspense>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0A0A0A] text-white">
          <Nav />
          <main className="mx-auto w-full max-w-[1240px] px-4 pb-12 pt-8 sm:px-6 lg:px-8">
            <div className="rounded-2xl border border-cyan-300/20 bg-[#121212] p-6 text-sm text-slate-300">
              Loading Dance Tools...
            </div>
          </main>
        </div>
      }
    >
      <DashboardPageContent />
    </Suspense>
  );
}
