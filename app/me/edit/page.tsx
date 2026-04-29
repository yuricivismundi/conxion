"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  getCachedCitiesOfCountry,
  getCachedCountriesAll,
  getCitiesOfCountry,
  getCountriesAll,
  type CountryEntry,
} from "@/lib/country-city-client";
import { resolveAvatarUrl } from "@/lib/avatar-storage";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import Nav from "@/components/Nav";
import VerifiedBadge from "@/components/VerifiedBadge";
import SearchableMobileSelect from "@/components/SearchableMobileSelect";
import GetVerifiedButton from "@/components/verification/GetVerifiedButton";
import {
  HOSTING_GUEST_GENDER_OPTIONS,
  HOSTING_SLEEPING_ARRANGEMENT_OPTIONS,
  type HostingPreferredGuestGender,
  type HostingSleepingArrangement,
  normalizeHostingPreferredGuestGender,
  normalizeHostingSleepingArrangement,
} from "@/lib/hosting/preferences";
import {
  normalizeProfileUsernameInput,
  suggestProfileUsername,
} from "@/lib/profile-username";
import { INTEREST_OPTIONS, normalizeInterests } from "@/lib/interests";
import { requestUsernameCheck } from "@/lib/username/client";
import {
  canChangeUsername,
  getUsernameChangeCooldownMessage,
} from "@/lib/username/cooldown";
import { USERNAME_MAX_LENGTH } from "@/lib/username/normalize";
import { mapUsernameServerError, validateUsernameFormat } from "@/lib/username/validate";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { VERIFIED_VIA_PAYMENT_LABEL } from "@/lib/verification";
import { DismissibleBanner } from "@/components/DismissibleBanner";
import { cx } from "@/lib/cx";

function TabPanelLoading({ label }: { label: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-[#0b1418]/88 p-6 shadow-[0_22px_60px_rgba(0,0,0,0.42)] backdrop-blur-sm sm:p-7">
      <div className="profile-shimmer h-5 w-40 rounded-md" />
      <p className="mt-3 text-sm text-slate-400">Loading {label.toLowerCase()}...</p>
    </div>
  );
}

const ProfileMediaManager = dynamic(() => import("@/components/profile/ProfileMediaManager"), {
  ssr: false,
  loading: () => <TabPanelLoading label="media" />,
});

const TeacherInfoManager = dynamic(() => import("@/components/teacher/TeacherInfoManager"), {
  ssr: false,
  loading: () => <TabPanelLoading label="teacher services" />,
});

const TeacherProfilePage = dynamic(() => import("@/app/me/edit/teacher-profile/page"), {
  ssr: false,
  loading: () => <TabPanelLoading label="teacher profile" />,
});

const LEVELS = [
  "Beginner (0–3 months)",
  "Improver (3–9 months)",
  "Intermediate (9–24 months)",
  "Advanced (2+ years)",
  "Teacher/Competitor (3+ years)",
] as const;

const CORE_STYLES = ["bachata", "salsa", "kizomba", "tango", "zouk"] as const;

const ROLE_OPTIONS = [
  "Social Dancer",
  "Student",
  "Organizer",
  "Studio Owner",
  "Promoter",
  "DJ",
  "Artist",
  "Teacher",
] as const;

const AVAILABILITY_OPTIONS = [
  "Weekdays",
  "Weekends",
  "Daytime",
  "Evenings",
  "Travel",
  "Rather not say",
] as const;

const LANGUAGE_OPTIONS = [
  "English", "Spanish", "French", "German", "Portuguese", "Italian", "Russian",
  "Arabic", "Chinese (Mandarin)", "Chinese (Cantonese)", "Japanese", "Korean",
  "Hindi", "Bengali", "Urdu", "Punjabi", "Tamil", "Telugu", "Marathi",
  "Turkish", "Dutch", "Polish", "Ukrainian", "Czech", "Slovak", "Romanian",
  "Hungarian", "Bulgarian", "Serbian", "Croatian", "Bosnian", "Slovenian",
  "Greek", "Swedish", "Norwegian", "Danish", "Finnish", "Estonian", "Latvian",
  "Lithuanian", "Albanian", "Macedonian", "Montenegrin",
  "Hebrew", "Persian (Farsi)", "Pashto", "Kurdish",
  "Indonesian", "Malay", "Tagalog", "Vietnamese", "Thai", "Khmer", "Burmese",
  "Swahili", "Amharic", "Yoruba", "Igbo", "Hausa", "Zulu", "Xhosa",
  "Afrikaans", "Somali",
  "Georgian", "Armenian", "Azerbaijani", "Kazakh", "Uzbek",
] as const;

type DanceSkill = {
  level?: string;
  verified?: boolean;
};

type Profile = {
  user_id: string;
  display_name: string;
  username?: string | null;
  username_updated_at?: string | null;
  username_changed_at?: string | null;
  city: string;
  country: string | null;
  nationality: string | null;
  dance_styles: string[] | null;
  dance_skills: Record<string, DanceSkill> | null;
  roles: string[] | null;
  display_role: string | null;
  languages: string[] | null;
  interests: string[] | null;
  availability: string[] | null;
  instagram_handle: string | null;
  whatsapp_handle: string | null;
  youtube_url: string | null;
  avatar_url: string | null;
  avatar_path?: string | null;
  is_verified?: boolean | null;
  verification_type?: string | null;
  verified?: boolean | null;
  verified_label?: string | null;
  can_host?: boolean | null;
  hosting_status?: string | null;
  max_guests?: number | null;
  hosting_last_minute_ok?: boolean | null;
  hosting_preferred_guest_gender?: HostingPreferredGuestGender | null;
  hosting_kid_friendly?: boolean | null;
  hosting_pet_friendly?: boolean | null;
  hosting_smoking_allowed?: boolean | null;
  hosting_sleeping_arrangement?: HostingSleepingArrangement | null;
  hosting_guest_share?: string | null;
  hosting_transit_access?: string | null;
  hosting_notes?: string | null;
  house_rules?: string | null;
};

type ProfileUpdate = {
  display_name: string;
  username: string;
  country: string | null;
  city: string;
  nationality: string | null;
  dance_styles: string[];
  dance_skills: Record<string, DanceSkill>;
  roles: string[];
  display_role: string | null;
  languages: string[];
  interests: string[];
  availability: string[];
  instagram_handle: string | null;
  whatsapp_handle: string | null;
  youtube_url: string | null;
  can_host: boolean;
  hosting_status: string;
  max_guests: number | null;
  hosting_last_minute_ok: boolean;
  hosting_preferred_guest_gender: HostingPreferredGuestGender;
  hosting_kid_friendly: boolean;
  hosting_pet_friendly: boolean;
  hosting_smoking_allowed: boolean;
  hosting_sleeping_arrangement: HostingSleepingArrangement;
  hosting_guest_share: string | null;
  hosting_transit_access: string | null;
  hosting_notes: string | null;
  house_rules: string | null;
};

type SnapshotValues = {
  displayName: string;
  username: string;
  country: string;
  city: string;
  nationality: string;
  danceSkills: Record<string, DanceSkill>;
  roles: string[];
  languages: string[];
  interests: string[];
  availability: string[];
  instagramHandle: string;
  whatsappHandle: string;
  youtubeUrl: string;
  acceptingHosting: boolean;
  hostingStatus: string;
  maxGuests: string;
  hostingLastMinuteOk: boolean;
  hostingPreferredGuestGender: HostingPreferredGuestGender;
  hostingKidFriendly: boolean;
  hostingPetFriendly: boolean;
  hostingSmokingAllowed: boolean;
  hostingSleepingArrangement: HostingSleepingArrangement;
  hostingGuestShare: string;
  hostingTransitAccess: string;
  hostingNotes: string;
  houseRules: string;
  avatarUrl: string | null;
};

type EditProfileTab = "profile" | "media" | "hosting" | "teacher_services" | "teacher_profile";

const PROFILE_EDIT_SELECT = [
  "user_id",
  "display_name",
  "username",
  "username_updated_at",
  "username_changed_at",
  "city",
  "country",
  "nationality",
  "dance_styles",
  "dance_skills",
  "roles",
  "display_role",
  "languages",
  "interests",
  "availability",
  "instagram_handle",
  "whatsapp_handle",
  "youtube_url",
  "avatar_url",
  "avatar_path",
  "verified",
  "verification_type",
  "verified_label",
  "can_host",
  "hosting_status",
  "max_guests",
  "hosting_last_minute_ok",
  "hosting_preferred_guest_gender",
  "hosting_kid_friendly",
  "hosting_pet_friendly",
  "hosting_smoking_allowed",
  "hosting_sleeping_arrangement",
  "hosting_guest_share",
  "hosting_transit_access",
  "hosting_notes",
  "house_rules",
].join(",");

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function uniqueOrdered(items: string[]) {
  return Array.from(new Set(items));
}

function mergeKnownWithCurrent(known: readonly string[], current: string[]) {
  const extras = current.filter((item) => !known.includes(item));
  return [...known, ...extras];
}

// Legacy role values that were split/renamed — strip them on load
const LEGACY_ROLES_REMOVE = new Set([
  "social dancer / student",
  "social dancer/student",
  "organiser", // British spelling replaced by "Organizer"
]);

function normalizeLegacyRoles(roles: string[]): string[] {
  return roles.filter((r) => !LEGACY_ROLES_REMOVE.has(r.toLowerCase().trim()));
}

function titleCase(value: string) {
  if (!value) return value;
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function styleSort(a: string, b: string) {
  const ai = CORE_STYLES.indexOf(a as (typeof CORE_STYLES)[number]);
  const bi = CORE_STYLES.indexOf(b as (typeof CORE_STYLES)[number]);
  const aCore = ai !== -1;
  const bCore = bi !== -1;

  if (aCore && bCore) return ai - bi;
  if (aCore) return -1;
  if (bCore) return 1;
  return a.localeCompare(b);
}

function normalizeHandle(value: string) {
  const trimmed = value.trim().replaceAll(" ", "");
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

function normalizeStyleKey(style: string) {
  return style.trim().toLowerCase();
}

function isMissingSchemaError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("schema cache") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("relation") ||
    text.includes("not found") ||
    text.includes("404")
  );
}

function sanitizeDanceSkillsForSave(input: Record<string, DanceSkill>) {
  const next: Record<string, DanceSkill> = {};
  for (const [style, raw] of Object.entries(input)) {
    const key = normalizeStyleKey(style);
    if (!key) continue;
    const level = typeof raw?.level === "string" ? raw.level.trim() : "";
    next[key] = {
      level,
      ...(raw?.verified ? { verified: true } : {}),
    };
  }
  return next;
}

function serializeDraft(values: SnapshotValues) {
  const danceSkills = sanitizeDanceSkillsForSave(values.danceSkills);
  const sortedSkills = Object.fromEntries(Object.keys(danceSkills).sort(styleSort).map((style) => [style, danceSkills[style]]));

  return JSON.stringify({
    displayName: values.displayName.trim(),
    username: normalizeProfileUsernameInput(values.username),
    country: values.country.trim(),
    city: values.city.trim(),
    nationality: values.nationality.trim(),
    danceSkills: sortedSkills,
    roles: [...values.roles].sort((a, b) => a.localeCompare(b)),
    languages: [...values.languages].sort((a, b) => a.localeCompare(b)),
    interests: normalizeInterests(values.interests),
    availability: [...values.availability].sort((a, b) => a.localeCompare(b)),
    instagramHandle: normalizeHandle(values.instagramHandle),
    whatsappHandle: values.whatsappHandle.trim(),
    youtubeUrl: values.youtubeUrl.trim(),
    acceptingHosting: values.acceptingHosting,
    hostingStatus: values.hostingStatus.trim(),
    maxGuests: values.maxGuests.trim(),
    hostingLastMinuteOk: values.hostingLastMinuteOk,
    hostingPreferredGuestGender: values.hostingPreferredGuestGender,
    hostingKidFriendly: values.hostingKidFriendly,
    hostingPetFriendly: values.hostingPetFriendly,
    hostingSmokingAllowed: values.hostingSmokingAllowed,
    hostingSleepingArrangement: values.hostingSleepingArrangement,
    hostingGuestShare: values.hostingGuestShare.trim(),
    hostingTransitAccess: values.hostingTransitAccess.trim(),
    hostingNotes: values.hostingNotes.trim(),
    houseRules: values.houseRules.trim(),
    avatarUrl: values.avatarUrl?.trim() ?? "",
  });
}

const CROP_FRAME_SIZE = 320;
const MAX_DISPLAY_NAME_LENGTH = 48;
const MAX_NATIONALITY_LENGTH = 40;
const MAX_CUSTOM_STYLE_LENGTH = 32;

async function makePreviewMatchedCroppedBlob(params: {
  src: string;
  preview: { renderWidth: number; renderHeight: number; offsetX: number; offsetY: number };
}) {
  const image = new window.Image();
  image.decoding = "async";

  const loaded = await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not read image."));
    image.src = params.src;
  });
  void loaded;

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error("Invalid image dimensions.");

  const canvas = document.createElement("canvas");
  const outputSize = 1024;
  canvas.width = outputSize;
  canvas.height = outputSize;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not initialize image cropper.");

  const scaleOut = outputSize / CROP_FRAME_SIZE;
  const outWidth = params.preview.renderWidth * scaleOut;
  const outHeight = params.preview.renderHeight * scaleOut;
  const outOffsetX = params.preview.offsetX * scaleOut;
  const outOffsetY = params.preview.offsetY * scaleOut;

  const left = outputSize / 2 - outWidth / 2 + outOffsetX;
  const top = outputSize / 2 - outHeight / 2 + outOffsetY;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, outputSize, outputSize);
  context.drawImage(image, left, top, outWidth, outHeight);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92);
  });

  if (!blob) throw new Error("Could not create cropped image.");
  return blob;
}
const VALID_TABS: EditProfileTab[] = ["profile", "media", "hosting", "teacher_services", "teacher_profile"];

function isValidTab(t: string | null): t is EditProfileTab {
  return VALID_TABS.includes(t as EditProfileTab);
}

function EditMePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [countriesAll, setCountriesAll] = useState<CountryEntry[]>(() => getCachedCountriesAll());
  const [availableCities, setAvailableCities] = useState<string[]>([]);
  const countryNames = useMemo(() => countriesAll.map((entry) => entry.name), [countriesAll]);

  const [meId, setMeId] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [sectionSnapshots, setSectionSnapshots] = useState<Record<string, string>>({});

  function openSection(id: string, snapshotData: unknown) {
    setSectionSnapshots((prev) => ({ ...prev, [id]: JSON.stringify(snapshotData) }));
    setOpenSections((prev) => ({ ...prev, [id]: true }));
  }
  function closeSection(id: string) {
    setOpenSections((prev) => ({ ...prev, [id]: false }));
  }
  function isSectionDirty(id: string, currentData: unknown) {
    return sectionSnapshots[id] !== JSON.stringify(currentData);
  }
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [trialExpiredBadge, setTrialExpiredBadge] = useState(false);
  const [teacherProfileOn, setTeacherProfileOn] = useState<boolean | null>(null);
  const [inquiriesOn, setInquiriesOn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStage, setSaveStage] = useState<"idle" | "saving" | "redirecting">("idle");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [initialUsername, setInitialUsername] = useState("");
  const [usernameUpdatedAt, setUsernameUpdatedAt] = useState<string | null>(null);
  const [usernameAvailability, setUsernameAvailability] = useState<{
    checking: boolean;
    available: boolean;
    error: string | null;
    suggestion: string | null;
  }>({
    checking: false,
    available: true,
    error: null,
    suggestion: null,
  });
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [nationality, setNationality] = useState("");

  const [danceSkills, setDanceSkills] = useState<Record<string, DanceSkill>>({});
  const [customStyleDraft, setCustomStyleDraft] = useState("");
  const [otherStyleEnabled, setOtherStyleEnabled] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [verificationFeatureAvailable, setVerificationFeatureAvailable] = useState(true);

  const [roles, setRoles] = useState<string[]>([]);
  const [displayRole, setDisplayRole] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [availability, setAvailability] = useState<string[]>([]);

  const [languages, setLanguages] = useState<string[]>([]);
  const [languageDraft, setLanguageDraft] = useState("");

  const [instagramHandle, setInstagramHandle] = useState("");
  const [whatsappHandle, setWhatsappHandle] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [acceptingHosting, setAcceptingHosting] = useState(false);
  const [hostingStatus, setHostingStatus] = useState("inactive");
  const [maxGuests, setMaxGuests] = useState("");
  const [hostingLastMinuteOk, setHostingLastMinuteOk] = useState(false);
  const [hostingPreferredGuestGender, setHostingPreferredGuestGender] = useState<HostingPreferredGuestGender>("any");
  const [hostingKidFriendly, setHostingKidFriendly] = useState(false);
  const [hostingPetFriendly, setHostingPetFriendly] = useState(false);
  const [hostingSmokingAllowed, setHostingSmokingAllowed] = useState(false);
  const [hostingSleepingArrangement, setHostingSleepingArrangement] = useState<HostingSleepingArrangement>("not_specified");
  const [hostingGuestShare, setHostingGuestShare] = useState("");
  const [hostingTransitAccess, setHostingTransitAccess] = useState("");
  const [hostingNotes, setHostingNotes] = useState("");
  const [showAdditionalHostingInfo, setShowAdditionalHostingInfo] = useState(false);
  const [houseRules, setHouseRules] = useState("");
  const [paymentVerified, setPaymentVerified] = useState(false);
  const rawTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<EditProfileTab>(isValidTab(rawTab) ? rawTab : "profile");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [localAvatarPreviewUrl, setLocalAvatarPreviewUrl] = useState<string | null>(null);
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);

  const [cropSource, setCropSource] = useState<string | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPanX, setCropPanX] = useState(0);
  const [cropPanY, setCropPanY] = useState(0);
  const [cropNaturalSize, setCropNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);
  useBodyScrollLock(Boolean(photoOpen || cropSource || saveStage !== "idle"));

  const [initialSnapshot, setInitialSnapshot] = useState("");

  const selectedStyles = useMemo(() => Object.keys(danceSkills).sort(styleSort), [danceSkills]);
  const roleOptions = useMemo(() => mergeKnownWithCurrent(ROLE_OPTIONS, roles), [roles]);
  const interestOptions = useMemo(() => mergeKnownWithCurrent(INTEREST_OPTIONS, interests), [interests]);
  const availabilityOptions = useMemo(
    () => mergeKnownWithCurrent(AVAILABILITY_OPTIONS, availability),
    [availability]
  );

  const currentSnapshot = useMemo(
    () =>
      serializeDraft({
        displayName,
        username,
        country,
        city,
        nationality,
        danceSkills,
        roles,
        languages,
        interests,
        availability,
        instagramHandle,
        whatsappHandle,
        youtubeUrl,
        acceptingHosting,
        hostingStatus,
        maxGuests,
        hostingLastMinuteOk,
        hostingPreferredGuestGender,
        hostingKidFriendly,
        hostingPetFriendly,
        hostingSmokingAllowed,
        hostingSleepingArrangement,
        hostingGuestShare,
        hostingTransitAccess,
        hostingNotes,
        houseRules,
        avatarUrl,
      }),
    [
      displayName,
      username,
      country,
      city,
      nationality,
      danceSkills,
      roles,
      languages,
      interests,
      availability,
      instagramHandle,
      whatsappHandle,
      youtubeUrl,
      acceptingHosting,
      hostingStatus,
      maxGuests,
      hostingLastMinuteOk,
      hostingPreferredGuestGender,
      hostingKidFriendly,
      hostingPetFriendly,
      hostingSmokingAllowed,
      hostingSleepingArrangement,
      hostingGuestShare,
      hostingTransitAccess,
      hostingNotes,
      houseRules,
      avatarUrl,
    ]
  );

  const hasUnsavedChanges = initialSnapshot.length > 0 && currentSnapshot !== initialSnapshot;

  const normalizedIg = useMemo(() => normalizeHandle(instagramHandle), [instagramHandle]);
  const normalizedWa = useMemo(() => whatsappHandle.trim(), [whatsappHandle]);
  const normalizedYt = useMemo(() => youtubeUrl.trim(), [youtubeUrl]);
  const displayNameLength = displayName.length;
  const nationalityLength = nationality.length;
  const customStyleLength = customStyleDraft.length;
  const normalizedDisplayName = useMemo(() => displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH), [displayName]);
  const suggestedUsername = useMemo(() => suggestProfileUsername(displayName), [displayName]);
  const normalizedUsername = useMemo(() => normalizeProfileUsernameInput(username), [username]);
  const normalizedInitialUsername = useMemo(() => normalizeProfileUsernameInput(initialUsername), [initialUsername]);
  const usernameFormat = useMemo(() => validateUsernameFormat(normalizedUsername), [normalizedUsername]);
  const usernameError = usernameFormat.valid ? null : usernameFormat.error ?? "Username must be between 3 and 20 characters.";
  const usernameChanged = normalizedUsername !== normalizedInitialUsername;
  const usernameChangeLocked = useMemo(
    () => usernameChanged && !canChangeUsername(usernameUpdatedAt),
    [usernameChanged, usernameUpdatedAt]
  );
  const usernameCooldownMessage = useMemo(
    () => (usernameChanged ? getUsernameChangeCooldownMessage(usernameUpdatedAt) : null),
    [usernameChanged, usernameUpdatedAt]
  );
  const normalizedNationality = useMemo(() => nationality.trim().slice(0, MAX_NATIONALITY_LENGTH), [nationality]);
  const normalizedCountry = useMemo(() => country.trim(), [country]);
  const normalizedCity = useMemo(() => city.trim(), [city]);
  const stylesMissingLevel = useMemo(
    () => selectedStyles.filter((style) => !(danceSkills[style]?.level ?? "").trim()),
    [danceSkills, selectedStyles]
  );

  useEffect(() => {
    if (!meId) return;
    if (!normalizedUsername) {
      setUsernameAvailability({
        checking: false,
        available: false,
        error: "Username must be between 3 and 20 characters.",
        suggestion: suggestedUsername || null,
      });
      return;
    }

    if (!usernameFormat.valid) {
      setUsernameAvailability({
        checking: false,
        available: false,
        error: usernameFormat.error ?? "Username must be between 3 and 20 characters.",
        suggestion: suggestedUsername || null,
      });
      return;
    }

    if (!usernameChanged) {
      setUsernameAvailability({
        checking: false,
        available: true,
        error: null,
        suggestion: normalizedInitialUsername || null,
      });
      return;
    }

    let cancelled = false;
    setUsernameAvailability((prev) => ({ ...prev, checking: true, error: null }));

    const timeoutId = window.setTimeout(() => {
      void requestUsernameCheck({
        username: normalizedUsername,
        seed: normalizedDisplayName || suggestedUsername,
        currentUserId: meId,
      }).then((result) => {
        if (cancelled) return;
        setUsernameAvailability({
          checking: false,
          available: result.available,
          error: result.available ? null : result.error,
          suggestion: result.suggestion,
        });
      });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    meId,
    normalizedDisplayName,
    normalizedInitialUsername,
    normalizedUsername,
    suggestedUsername,
    usernameChanged,
    usernameFormat.error,
    usernameFormat.valid,
  ]);

  useEffect(() => {
    if (!error) return;
    const timeoutId = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [error]);

  useEffect(() => {
    if (!verificationNotice) return;
    const timeoutId = window.setTimeout(() => setVerificationNotice(null), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [verificationNotice]);

  const editTabs: Array<{ id: EditProfileTab; label: string }> = [
    { id: "profile", label: "Profile info" },
    { id: "media", label: "Media" },
    { id: "hosting", label: "Hosting" },
    { id: "teacher_services", label: "Inquiries" },
    { id: "teacher_profile", label: "Teacher profile" },
  ];

  const countryIso = useMemo(() => countriesAll.find((entry) => entry.name === country)?.isoCode ?? "", [countriesAll, country]);

  const cityOptions = useMemo(() => {
    if (!city) return availableCities;
    if (availableCities.includes(city)) return availableCities;
    return [city, ...availableCities];
  }, [availableCities, city]);

  const cropPreview = useMemo(() => {
    if (!cropSource || !cropNaturalSize) return null;

    const minSide = Math.min(cropNaturalSize.width, cropNaturalSize.height);
    if (!minSide) return null;

    const scale = (CROP_FRAME_SIZE / minSide) * Math.max(cropZoom, 1);
    const renderWidth = cropNaturalSize.width * scale;
    const renderHeight = cropNaturalSize.height * scale;

    const maxOffsetX = Math.max((renderWidth - CROP_FRAME_SIZE) / 2, 0);
    const maxOffsetY = Math.max((renderHeight - CROP_FRAME_SIZE) / 2, 0);

    return {
      renderWidth,
      renderHeight,
      maxOffsetX,
      maxOffsetY,
      offsetX: cropPanX * maxOffsetX,
      offsetY: cropPanY * maxOffsetY,
    };
  }, [cropNaturalSize, cropPanX, cropPanY, cropSource, cropZoom]);
  const displayAvatarUrl = localAvatarPreviewUrl ?? avatarUrl;

  function clearBrokenAvatarPreview() {
    setAvatarUrl(null);
    setLocalAvatarPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }

  useEffect(() => {
    return () => {
      if (localAvatarPreviewUrl) {
        URL.revokeObjectURL(localAvatarPreviewUrl);
      }
    };
  }, [localAvatarPreviewUrl]);

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

    if (!countryIso) {
      setAvailableCities([]);
      return () => {
        cancelled = true;
      };
    }

    const cachedCities = getCachedCitiesOfCountry(countryIso);
    if (cachedCities.length > 0) {
      setAvailableCities(cachedCities);
      return () => {
        cancelled = true;
      };
    }

    void getCitiesOfCountry(countryIso)
      .then((nextCities) => {
        if (cancelled) return;
        setAvailableCities(nextCities);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableCities([]);
      });

    return () => {
      cancelled = true;
    };
  }, [countryIso]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const authRes = await supabase.auth.getUser();
        const user = authRes.data.user;
        if (!user) {
          router.replace("/auth");
          return;
        }
        if (cancelled) return;

        setMeId(user.id);

        void (async () => {
          const [followersRes, followingRes] = await Promise.all([
            supabase.from("dance_contacts").select("user_id", { count: "exact", head: true }).eq("linked_user_id", user.id).eq("is_following", true).eq("contact_type", "member"),
            supabase.from("dance_contacts").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_following", true).eq("contact_type", "member"),
          ]);
          if (!cancelled) {
            setFollowersCount(followersRes.count ?? 0);
            setFollowingCount(followingRes.count ?? 0);
          }
        })();

        const profileRes = await supabase.from("profiles").select(PROFILE_EDIT_SELECT).eq("user_id", user.id).maybeSingle();
        if (cancelled) return;

        if (profileRes.error) {
          setError(profileRes.error.message);
          return;
        }

        if (!profileRes.data) {
          router.replace("/onboarding");
          return;
        }

        const profile = (profileRes.data ?? null) as unknown as Profile;

        const nextDisplayName = (profile.display_name ?? "").slice(0, MAX_DISPLAY_NAME_LENGTH);
        const nextUsername = normalizeProfileUsernameInput(profile.username ?? suggestProfileUsername(nextDisplayName));
        const nextCountry = profile.country ?? "";
        const nextCity = profile.city ?? "";
        const nextNationality = (profile.nationality ?? "").slice(0, MAX_NATIONALITY_LENGTH);
        const nextRoles = toStringArray(profile.roles);
        const nextInterests = normalizeInterests(toStringArray(profile.interests));
        const nextAvailability = toStringArray(profile.availability);
        const nextLanguages = toStringArray(profile.languages);
        const nextInstagram = profile.instagram_handle ?? "";
        const nextWhatsapp = profile.whatsapp_handle ?? "";
        const nextYoutube = profile.youtube_url ?? "";
        const nextAcceptingHosting = profile.can_host === true;
        const nextHostingStatus = (profile.hosting_status ?? "inactive").trim() || "inactive";
        const nextMaxGuests =
          typeof profile.max_guests === "number" && Number.isFinite(profile.max_guests) ? String(profile.max_guests) : "";
        const nextHostingLastMinuteOk = profile.hosting_last_minute_ok === true;
        const nextHostingPreferredGuestGender = normalizeHostingPreferredGuestGender(profile.hosting_preferred_guest_gender);
        const nextHostingKidFriendly = profile.hosting_kid_friendly === true;
        const nextHostingPetFriendly = profile.hosting_pet_friendly === true;
        const nextHostingSmokingAllowed = profile.hosting_smoking_allowed === true;
        const nextHostingSleepingArrangement = normalizeHostingSleepingArrangement(profile.hosting_sleeping_arrangement);
        const nextHostingGuestShare = profile.hosting_guest_share ?? "";
        const nextHostingTransitAccess = profile.hosting_transit_access ?? "";
        const nextHostingNotes = profile.hosting_notes ?? "";
        const nextHouseRules = profile.house_rules ?? "";
        const nextAvatarUrl = resolveAvatarUrl({
          avatarUrl: profile.avatar_url,
          avatarPath: profile.avatar_path,
        });

        const dbSkills =
          profile.dance_skills && typeof profile.dance_skills === "object"
            ? (profile.dance_skills as Record<string, DanceSkill>)
            : {};

        let nextDanceSkills: Record<string, DanceSkill>;
        if (Object.keys(dbSkills).length > 0) {
          nextDanceSkills = dbSkills;
        } else {
          const fallback: Record<string, DanceSkill> = {};
          toStringArray(profile.dance_styles).forEach((style) => {
            const key = normalizeStyleKey(style);
            if (!key) return;
            fallback[key] = { level: "" };
          });
          nextDanceSkills = fallback;
        }

        setDisplayName(nextDisplayName);
        setUsername(nextUsername);
        setInitialUsername(nextUsername);
        setUsernameUpdatedAt(
          typeof profile.username_updated_at === "string"
            ? profile.username_updated_at
            : typeof profile.username_changed_at === "string"
              ? profile.username_changed_at
              : null
        );
        setCountry(nextCountry);
        setCity(nextCity);
        setNationality(nextNationality);
        setDanceSkills(nextDanceSkills);
        const existingOtherStyle =
          Object.keys(nextDanceSkills).find((style) => !CORE_STYLES.includes(style as (typeof CORE_STYLES)[number])) ?? "";
        setOtherStyleEnabled(Boolean(existingOtherStyle));
        setCustomStyleDraft(existingOtherStyle);
        const normalizedRoles = normalizeLegacyRoles(nextRoles);
        setRoles(normalizedRoles.length > 0 ? normalizedRoles : ["Social Dancer"]);
        setDisplayRole(typeof profile.display_role === "string" && profile.display_role ? profile.display_role : null);
        setInterests(nextInterests.length > 0 ? nextInterests : ["Social dancing"]);
        setAvailability(nextAvailability.length > 0 ? nextAvailability : ["Rather not say"]);
        setLanguages(nextLanguages);
        setInstagramHandle(nextInstagram);
        setWhatsappHandle(nextWhatsapp);
        setYoutubeUrl(nextYoutube);
        setAcceptingHosting(nextAcceptingHosting);
        setHostingStatus(nextHostingStatus);
        setMaxGuests(nextMaxGuests);
        setHostingLastMinuteOk(nextHostingLastMinuteOk);
        setHostingPreferredGuestGender(nextHostingPreferredGuestGender);
        setHostingKidFriendly(nextHostingKidFriendly);
        setHostingPetFriendly(nextHostingPetFriendly);
        setHostingSmokingAllowed(nextHostingSmokingAllowed);
        setHostingSleepingArrangement(nextHostingSleepingArrangement);
        setHostingGuestShare(nextHostingGuestShare);
        setHostingTransitAccess(nextHostingTransitAccess);
        setHostingNotes(nextHostingNotes);
        setHouseRules(nextHouseRules);
        setPaymentVerified(profile?.verified === true);
        setAvatarUrl(nextAvatarUrl);
        setLocalAvatarPreviewUrl(null);

        setInitialSnapshot(
          serializeDraft({
            displayName: nextDisplayName,
            username: nextUsername,
            country: nextCountry,
            city: nextCity,
            nationality: nextNationality,
            danceSkills: nextDanceSkills,
            roles: nextRoles,
            languages: nextLanguages,
            interests: nextInterests,
            availability: nextAvailability,
            instagramHandle: nextInstagram,
            whatsappHandle: nextWhatsapp,
            youtubeUrl: nextYoutube,
            acceptingHosting: nextAcceptingHosting,
            hostingStatus: nextHostingStatus,
            maxGuests: nextMaxGuests,
            hostingLastMinuteOk: nextHostingLastMinuteOk,
            hostingPreferredGuestGender: nextHostingPreferredGuestGender,
            hostingKidFriendly: nextHostingKidFriendly,
            hostingPetFriendly: nextHostingPetFriendly,
            hostingSmokingAllowed: nextHostingSmokingAllowed,
            hostingSleepingArrangement: nextHostingSleepingArrangement,
            hostingGuestShare: nextHostingGuestShare,
            hostingTransitAccess: nextHostingTransitAccess,
            hostingNotes: nextHostingNotes,
            houseRules: nextHouseRules,
            avatarUrl: nextAvatarUrl,
          })
        );

        setLoading(false);

        // Fetch teacher profile trial status + on/off states in background.
        void (async () => {
          try {
            const [tpRes, inqRes] = await Promise.all([
              supabase
                .from("teacher_profiles")
                .select("teacher_profile_trial_ends_at, teacher_profile_trial_started_at, teacher_profile_enabled")
                .eq("user_id", user.id)
                .maybeSingle(),
              supabase
                .from("teacher_info_profile")
                .select("is_enabled")
                .eq("user_id", user.id)
                .maybeSingle(),
            ]);
            if (!cancelled) {
              if (tpRes.data) {
                const endsAt = tpRes.data.teacher_profile_trial_ends_at as string | null;
                const startedAt = tpRes.data.teacher_profile_trial_started_at as string | null;
                if (endsAt) {
                  const diff = new Date(endsAt).getTime() - Date.now();
                  if (diff > 0) {
                    setTrialDaysLeft(Math.ceil(diff / (1000 * 60 * 60 * 24)));
                  } else if (startedAt) {
                    setTrialExpiredBadge(true);
                  }
                }
                setTeacherProfileOn(tpRes.data.teacher_profile_enabled === true);
              }
              if (inqRes.data) {
                setInquiriesOn(inqRes.data.is_enabled === true);
              }
            }
          } catch { /* ignore */ }
        })();

        // Run this in the background so the page becomes interactive immediately.
        void (async () => {
          try {
            const pendingRes = await supabase
              .from("style_verification_requests")
              .select("id")
              .eq("user_id", user.id)
              .eq("status", "pending")
              .limit(1);
            if (!cancelled) {
              setVerificationFeatureAvailable(!pendingRes.error);
            }
          } catch {
            if (!cancelled) {
              setVerificationFeatureAvailable(false);
            }
          }
        })();
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load your profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const onClickCapture = (event: MouseEvent) => {
      if (!hasUnsavedChanges) return;
      if (!(event.target instanceof Element)) return;

      const anchor = event.target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.hasAttribute("data-ignore-unsaved-guard")) return;

      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.origin !== currentUrl.origin) return;

      const sameDestination =
        nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search && nextUrl.hash === currentUrl.hash;
      if (sameDestination) return;

      const leave = window.confirm("You have unsaved changes. Leave this page?");
      if (!leave) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [hasUnsavedChanges]);

  function toggleString(list: string[], setter: (next: string[]) => void, value: string) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  function toggleStyle(style: string) {
    setDanceSkills((prev) => {
      const next = { ...prev };
      if (next[style]) {
        delete next[style];
      } else {
        next[style] = { level: "" };
      }
      return next;
    });

  }

  function setStyleLevel(style: string, level: string) {
    setDanceSkills((prev) => ({
      ...prev,
      [style]: {
        ...(prev[style] ?? {}),
        level,
      },
    }));
  }

  async function requestStyleVerification(style: string) {
    if (!meId) return;

    const currentSkill = danceSkills[style] ?? {};
    const level = (currentSkill.level ?? "").trim();
    if (!level) {
      setError(`Please set a level for ${titleCase(style)} before requesting verification.`);
      return;
    }

    if (!verificationFeatureAvailable) {
      setError("Style verification requests are temporarily unavailable.");
      return;
    }

    setVerificationNotice(null);
    setError(null);

    const insertRes = await supabase.from("style_verification_requests").insert({
      user_id: meId,
      style,
      level,
      status: "pending",
    });

    if (insertRes.error) {
      const message = insertRes.error.message ?? "Could not request verification.";
      const duplicate = insertRes.error.code === "23505" || message.toLowerCase().includes("duplicate");

      if (duplicate) {
        setVerificationNotice(`${titleCase(style)} is already in verification queue.`);
        return;
      }

      if (isMissingSchemaError(message)) {
        setVerificationFeatureAvailable(false);
        setError("Style verification requests are temporarily unavailable.");
        return;
      }

      setError(message);
      return;
    }

    setVerificationNotice(`${titleCase(style)} verification request submitted.`);
  }

  function toggleOtherStyle() {
    setOtherStyleEnabled((prevEnabled) => {
      const nextEnabled = !prevEnabled;
      if (!nextEnabled) {
        setCustomStyleDraft("");
        setDanceSkills((prev) => {
          const next: Record<string, DanceSkill> = {};
          for (const [style, skill] of Object.entries(prev)) {
            if (CORE_STYLES.includes(style as (typeof CORE_STYLES)[number])) {
              next[style] = skill;
            }
          }
          return next;
        });
      }
      return nextEnabled;
    });
  }

  function onOtherStyleNameChange(value: string) {
    const raw = value.slice(0, MAX_CUSTOM_STYLE_LENGTH);
    const normalized = normalizeStyleKey(raw);
    setCustomStyleDraft(raw);

    setDanceSkills((prev) => {
      const next: Record<string, DanceSkill> = {};
      let previousOtherSkill: DanceSkill | undefined;

      for (const [style, skill] of Object.entries(prev)) {
        if (CORE_STYLES.includes(style as (typeof CORE_STYLES)[number])) {
          next[style] = skill;
        } else if (!previousOtherSkill) {
          previousOtherSkill = skill;
        }
      }

      if (normalized) {
        next[normalized] = previousOtherSkill ?? { level: "" };
      }

      return next;
    });

  }

  function addLanguage(nextValue?: string) {
    const normalized = (nextValue ?? languageDraft).trim();
    if (!normalized) return;
    if (languages.includes(normalized)) {
      setLanguageDraft("");
      return;
    }
    if (languages.length >= 5) return;
    setLanguages((prev) => [...prev, normalized]);
    setLanguageDraft("");
  }

  async function onRawFilePicked(file: File) {
    setError(null);
    setCropError(null);

    try {
      if (!file.type.startsWith("image/")) throw new Error("Please upload an image.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Max image size is 5MB.");

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") resolve(reader.result);
          else reject(new Error("Could not read image."));
        };
        reader.onerror = () => reject(new Error("Could not read image."));
        reader.readAsDataURL(file);
      });

      const naturalSize = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new window.Image();
        image.onload = () => {
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          if (!width || !height) {
            reject(new Error("Invalid image dimensions."));
            return;
          }
          resolve({ width, height });
        };
        image.onerror = () => reject(new Error("Could not read image."));
        image.src = dataUrl;
      });

      setCropZoom(1);
      setCropPanX(0);
      setCropPanY(0);
      setCropNaturalSize(naturalSize);
      setCropSource(dataUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not prepare image.");
    }
  }

  async function confirmCropUpload() {
    if (!cropSource || !meId || !cropPreview) return;

    setUploading(true);
    setError(null);
    setCropError(null);

    let nextLocalPreviewUrl: string | null = null;

    try {
      const blob = await makePreviewMatchedCroppedBlob({
        src: cropSource,
        preview: cropPreview,
      });
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token?.trim() ?? "";
      if (!accessToken) throw new Error("Please sign in again.");

      const formData = new FormData();
      formData.append("file", new File([blob], "avatar.jpg", { type: "image/jpeg" }));

      const uploadResponse = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      const uploadPayload = (await uploadResponse.json().catch(() => null)) as
        | { ok?: boolean; error?: string; url?: string }
        | null;

      if (!uploadResponse.ok || !uploadPayload?.ok || !uploadPayload.url) {
        throw new Error(uploadPayload?.error?.trim() || "Upload failed.");
      }

      const publicUrl = uploadPayload.url;

      nextLocalPreviewUrl = URL.createObjectURL(blob);
      setLocalAvatarPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextLocalPreviewUrl;
      });
      setAvatarUrl(publicUrl);
      setCropError(null);
      setCropSource(null);
      setCropNaturalSize(null);

      setInitialSnapshot(
        serializeDraft({
          displayName,
          username,
          country,
          city,
          nationality,
          danceSkills,
          roles,
          languages,
          interests,
          availability,
          instagramHandle,
          whatsappHandle,
          youtubeUrl,
          acceptingHosting,
          hostingStatus,
          maxGuests,
          hostingLastMinuteOk,
          hostingPreferredGuestGender,
          hostingKidFriendly,
          hostingPetFriendly,
          hostingSmokingAllowed,
          hostingSleepingArrangement,
          hostingGuestShare,
          hostingTransitAccess,
          hostingNotes,
          houseRules,
          avatarUrl: publicUrl,
        })
      );
    } catch (err: unknown) {
      if (nextLocalPreviewUrl) {
        URL.revokeObjectURL(nextLocalPreviewUrl);
      }
      setCropError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function doSave(): Promise<boolean> {
    if (!meId) return false;
    setSaving(true);
    setSaveStage("saving");
    setError(null);

    const sanitizedDanceSkills = sanitizeDanceSkillsForSave(danceSkills);
    const maxGuestsValue = maxGuests.trim();
    const parsedMaxGuests = maxGuestsValue ? Number(maxGuestsValue) : Number.NaN;

    if (maxGuestsValue && (!Number.isFinite(parsedMaxGuests) || parsedMaxGuests < 0 || parsedMaxGuests > 20)) {
      setSaving(false);
      setSaveStage("idle");
      setError("Max guests must be between 0 and 20.");
      return false;
    }

    const payload: ProfileUpdate = {
      display_name: normalizedDisplayName,
      username: normalizedUsername,
      country: normalizedCountry || null,
      city: normalizedCity,
      nationality: normalizedNationality || null,
      dance_styles: Object.keys(sanitizedDanceSkills).sort(styleSort),
      dance_skills: sanitizedDanceSkills,
      roles,
      display_role: displayRole && roles.includes(displayRole) ? displayRole : (roles[0] ?? null),
      languages,
      interests: normalizeInterests(interests),
      availability,
      instagram_handle: normalizedIg || null,
      whatsapp_handle: normalizedWa || null,
      youtube_url: normalizedYt || null,
      can_host: acceptingHosting,
      hosting_status: acceptingHosting ? (hostingStatus === "inactive" ? "available" : hostingStatus) : "inactive",
      max_guests: maxGuestsValue ? parsedMaxGuests : null,
      hosting_last_minute_ok: hostingLastMinuteOk,
      hosting_preferred_guest_gender: hostingPreferredGuestGender,
      hosting_kid_friendly: hostingKidFriendly,
      hosting_pet_friendly: hostingPetFriendly,
      hosting_smoking_allowed: hostingSmokingAllowed,
      hosting_sleeping_arrangement: hostingSleepingArrangement,
      hosting_guest_share: hostingGuestShare.trim() || null,
      hosting_transit_access: hostingTransitAccess.trim() || null,
      hosting_notes: hostingNotes.trim() || null,
      house_rules: houseRules.trim() || null,
    };

    try {
      const updateRes = await supabase.from("profiles").update(payload).eq("user_id", meId);
      if (updateRes.error) {
        setError(mapUsernameServerError(updateRes.error.message ?? "Could not save profile."));
        setSaving(false);
        setSaveStage("idle");
        return false;
      }
      if (usernameChanged) {
        setInitialUsername(normalizedUsername);
        setUsernameUpdatedAt(new Date().toISOString());
      }
      setInitialSnapshot(currentSnapshot);
      setSaving(false);
      setSaveStage("idle");
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
      setSaveStage("idle");
      setSaving(false);
      return false;
    }
  }

  async function saveProfile(sectionId?: string) {
    if (!meId) return;
    if (normalizedDisplayName.length < 2) { setError("Please enter your display name."); return; }
    const ok = await doSave();
    if (ok && sectionId) closeSection(sectionId);
  }

  function cancelSection(id: string) {
    const snapshot = sectionSnapshots[id];
    if (snapshot) {
      try {
        const data = JSON.parse(snapshot) as Record<string, unknown>;
        if (id === "info") {
          if (typeof data.displayName === "string") setDisplayName(data.displayName);
          if (typeof data.username === "string") setUsername(data.username);
          if (typeof data.country === "string") setCountry(data.country);
          if (typeof data.city === "string") setCity(data.city);
        } else if (id === "dance") {
          if (data.danceSkills && typeof data.danceSkills === "object") setDanceSkills(data.danceSkills as Record<string, DanceSkill>);
        } else if (id === "roles") {
          if (Array.isArray(data.roles)) setRoles(data.roles as string[]);
          if (Array.isArray(data.interests)) setInterests(data.interests as string[]);
          if (Array.isArray(data.availability)) setAvailability(data.availability as string[]);
          setDisplayRole(typeof data.displayRole === "string" ? data.displayRole : null);
        } else if (id === "langs") {
          if (Array.isArray(data.languages)) setLanguages(data.languages as string[]);
        }
      } catch { /* ignore */ }
    }
    closeSection(id);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!meId) return;

    if (normalizedDisplayName.length < 2) {
      setError("Please enter your display name.");
      return;
    }

    if (usernameError) {
      setError(usernameError);
      return;
    }

    if (usernameChanged && usernameChangeLocked) {
      setError(usernameCooldownMessage ?? "You can change your username once every 30 days.");
      return;
    }

    if (usernameChanged && usernameAvailability.checking) {
      setError("Checking username...");
      return;
    }

    if (usernameChanged && !usernameAvailability.available) {
      setError(usernameAvailability.error ?? "This username is already taken.");
      return;
    }

    if (!normalizedCountry || !normalizedCity) {
      setError("Please select your country and city.");
      return;
    }

    if (selectedStyles.length < 1) {
      setError("Please select at least one dance style.");
      return;
    }

    if (roles.length < 1) {
      setError("Please select at least one role.");
      return;
    }

    const ok = await doSave();
    if (!ok) return;

    setSaveStage("redirecting");
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    setSaveStage("idle");
  }

  function handleLeaveToAccountSettings() {
    if (hasUnsavedChanges) {
      const leave = window.confirm("You have unsaved changes. Leave this page?");
      if (!leave) return;
    }
    router.replace("/account-settings");
  }

  function handlePreviewPublic() {
    if (hasUnsavedChanges) {
      const leave = window.confirm("You have unsaved changes. Leave this page?");
      if (!leave) return;
    }
    if (meId) {
      router.replace(`/profile/${meId}`);
      return;
    }
    router.replace("/account-settings");
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05080f] text-slate-100">
        <Nav />
        <div className="mx-auto max-w-[1240px] px-4 pb-20 pt-8 sm:px-6 lg:px-8">
          <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
            <div className="rounded-3xl border border-white/10 bg-[#0b1418]/88 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.48)] backdrop-blur-sm">
              <div className="mx-auto h-56 w-56 animate-pulse rounded-3xl bg-white/10 sm:h-64 sm:w-64" />
              <div className="mt-4 h-11 animate-pulse rounded-xl bg-white/10" />
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
                <div className="mt-3 h-6 w-36 animate-pulse rounded bg-white/10" />
                <div className="mt-2 h-4 w-28 animate-pulse rounded bg-white/10" />
              </div>
            </div>
            <div className="space-y-6">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="rounded-3xl border border-white/10 bg-[#0b1418]/88 p-6 shadow-[0_22px_60px_rgba(0,0,0,0.42)] backdrop-blur-sm">
                  <div className="h-8 w-40 animate-pulse rounded bg-white/10" />
                  <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    <div className="h-14 animate-pulse rounded-xl bg-black/25" />
                    <div className="h-14 animate-pulse rounded-xl bg-black/25" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#05080f] text-slate-100"
      data-testid="profile-edit-page"
    >
      <Nav />

      <main className="mx-auto max-w-[1240px] px-4 pb-28 pt-6 sm:px-6 lg:px-8">
        <form onSubmit={save} className="grid min-w-0 gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="min-w-0 xl:self-start flex justify-center xl:block">
            <div className="w-52 sm:w-64 lg:w-72 overflow-hidden rounded-3xl border border-white/10 bg-[#0b1418]/88 shadow-[0_22px_60px_rgba(0,0,0,0.48)] backdrop-blur-sm">
              <div className="relative mt-0 w-full">
                <button
                  type="button"
                  onClick={() => { if (displayAvatarUrl) setPhotoOpen(true); }}
                  className="block"
                  title={displayAvatarUrl ? "Open photo" : "Add a photo"}
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-3xl border border-white/10 bg-black/30">
                    {displayAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={displayAvatarUrl}
                        alt="Profile avatar"
                        className="h-full w-full object-cover object-center"
                        onError={clearBrokenAvatarPreview}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">No photo yet</div>
                    )}
                  </div>
                </button>
                {/* Camera button */}
                <label className="absolute bottom-2.5 right-2.5 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-[#1a2228]/90 shadow-lg transition hover:bg-[#243040]/90">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void onRawFilePicked(file);
                    }}
                  />
                  {uploading
                    ? <span className="material-symbols-outlined text-[16px] animate-spin text-white/60">progress_activity</span>
                    : <span className="material-symbols-outlined text-[16px] text-white/80">photo_camera</span>
                  }
                </label>
              </div>

              <div className="mt-4 space-y-2.5 px-4 pb-4">
                <div>
                  <div className="flex min-w-0 items-center gap-2">
                    {meId ? (
                      <Link href={`/profile/${meId}`} className="min-w-0 break-words text-base font-semibold leading-tight text-white transition hover:text-[#0df2f2]">
                        {displayName || "Your name"}
                      </Link>
                    ) : (
                      <p className="min-w-0 break-words text-base font-semibold leading-tight text-white">{displayName || "Your name"}</p>
                    )}
                    {paymentVerified ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0df2f2]/80">
                        <VerifiedBadge size={20} title={VERIFIED_VIA_PAYMENT_LABEL} />
                        Verified
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-400">{[city, country].filter(Boolean).join(", ") || "City, Country"}</p>
                  {(followersCount !== null || followingCount !== null) && (
                    <p className="mt-1 text-[12px] text-white/45">
                      {followersCount !== null && <><span className="font-semibold text-white/70">{followersCount}</span> followers</>}
                      {followersCount !== null && followingCount !== null && <span className="mx-1.5 text-white/20">·</span>}
                      {followingCount !== null && <><span className="font-semibold text-white/70">{followingCount}</span> following</>}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-x-3 gap-y-1 pt-1">
                  <div className="space-y-1.5">
                    <span className="material-symbols-outlined text-[16px] text-cyan-300/70">badge</span>
                    {(roles.length > 0 ? roles : ["—"]).slice(0, 4).map((role) => (
                      <p key={role} className="text-[11px] text-white/65">{role}</p>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <span className="material-symbols-outlined text-[16px] text-fuchsia-300/70">music_note</span>
                    {(selectedStyles.length > 0 ? selectedStyles : ["—"]).slice(0, 4).map((style) => (
                      <p key={style} className="text-[11px] capitalize text-white/65">{style}</p>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <span className="material-symbols-outlined text-[16px] text-cyan-300/70">translate</span>
                    {(languages.length > 0 ? languages : ["—"]).slice(0, 4).map((lang) => (
                      <p key={lang} className="text-[11px] text-white/65">{lang}</p>
                    ))}
                  </div>
                </div>
              </div>

              {!paymentVerified && (
                <div className="mx-4 mb-4 mt-4 border-t border-white/[0.07] pt-4">
                  <GetVerifiedButton
                    className="w-full rounded-xl border border-fuchsia-300/25 bg-gradient-to-r from-cyan-400/15 via-fuchsia-500/15 to-purple-500/15 px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:brightness-110"
                    returnTo="/me/edit"
                    onError={(message) => setError(message)}
                  >
                    ✦ Get verified
                  </GetVerifiedButton>
                </div>
              )}
            </div>
          </aside>

	          <section className="min-w-0 space-y-6">
              <header className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h1 className="text-2xl font-extrabold tracking-tight text-white" data-testid="profile-edit-title">
                      Edit your profile
                    </h1>

                    {trialExpiredBadge && activeTab === "teacher_profile" && (
                      <Link href="/me/edit?tab=teacher_profile" className="text-sm text-rose-400 hover:underline">
                        Trial ended · Upgrade
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {teacherProfileOn && (
                      <span className="inline-flex items-center rounded-full border border-cyan-300/35 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                        Teacher on
                      </span>
                    )}
                    {inquiriesOn && (
                      <span className="inline-flex items-center rounded-full border border-fuchsia-300/35 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold text-fuchsia-100">
                        Inquiries on
                      </span>
                    )}
                    {acceptingHosting && (
                      <span className="inline-flex items-center rounded-full border border-emerald-300/35 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                        Hosting on
                      </span>
                    )}
                  </div>
                </div>
                <div className="relative flex max-w-full gap-1 overflow-x-auto border-b border-white/10 px-1 no-scrollbar">
                  {editTabs.map((tab) => {
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(tab.id);
                          const url = new URL(window.location.href);
                          url.searchParams.set("tab", tab.id);
                          router.replace(url.pathname + url.search, { scroll: false });
                        }}
                        className={cx(
                          "relative min-h-11 shrink-0 whitespace-nowrap px-3 pb-3 pt-2 text-xs font-bold uppercase tracking-wider transition",
                          active ? "text-white" : "text-white/40 hover:text-white/65"
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          {tab.label}
                          {tab.id === "teacher_profile" && trialDaysLeft != null && (
                            <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber-300">
                              {trialDaysLeft}d left
                            </span>
                          )}
                        </span>
                        {active && (
                          <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-cyan-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </header>

	            {activeTab === "profile" || activeTab === "media" ? (
              <div
                className={cx(
                  activeTab === "media"
                    ? "space-y-3"
                    : cx("rounded-3xl border border-white/10 bg-[#0b1418]/88 shadow-[0_22px_60px_rgba(0,0,0,0.42)] backdrop-blur-sm transition-all", openSections.info ? "p-6 sm:p-7" : "px-5 py-3.5")
                )}
              >

              <div className="space-y-2" data-testid="profile-edit-error">
                <DismissibleBanner message={error} tone="error" onDismiss={() => setError(null)} />
                <DismissibleBanner message={verificationNotice} tone="info" onDismiss={() => setVerificationNotice(null)} />
              </div>

              {activeTab === "profile" ? (
              <>
              {/* Basic info section header */}
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="material-symbols-outlined text-[16px] text-white/40 shrink-0">person</span><h2 className="shrink-0 text-sm font-semibold text-white/70">Basic Info</h2>
                  {!openSections.info && (
                    <p className="truncate text-sm">
                      <span className="font-medium text-[#0df2f2]/80">{displayName || "—"}</span>
                      <span className="mx-1.5 text-white/20">·</span>
                      <span className="text-fuchsia-300/60">@{normalizedUsername || "—"}</span>
                      <span className="mx-1.5 text-white/20">·</span>
                      <span className="text-white/50">{[country, city].filter(Boolean).join(", ") || "—"}</span>
                    </p>
                  )}
                </div>
                {openSections.info ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => cancelSection("info")} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white/50 transition hover:bg-white/[0.05]">Cancel</button>
                    <button type="button" onClick={() => void saveProfile("info")} disabled={saving || !isSectionDirty("info", { displayName, username, country, city })} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-[#0df2f2]/80 transition hover:bg-white/[0.05] disabled:opacity-35 disabled:cursor-not-allowed">Save</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openSection("info", { displayName, username, country, city })}
                    className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-white/40 transition hover:bg-white/[0.05] hover:text-white/70"
                    data-testid="profile-edit-open-info"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                )}
              </div>
              {openSections.info && (
              <div className={cx("grid gap-4 lg:grid-cols-2", error || verificationNotice ? "mt-2" : "mt-2")}>
                <label className="block text-sm font-medium text-slate-300">
                  Display name
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value.slice(0, MAX_DISPLAY_NAME_LENGTH))}
                    maxLength={MAX_DISPLAY_NAME_LENGTH}
                    className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
                    placeholder="How you appear to dancers"
                    data-testid="profile-edit-display-name"
                  />
                  <div className="mt-1 text-right text-xs text-slate-500">
                    {displayNameLength}/{MAX_DISPLAY_NAME_LENGTH}
                  </div>
                </label>

                <label className="block text-sm font-medium text-slate-300">
                  Username
                  <div
                    className={cx(
                      "mt-1.5 flex items-center rounded-xl border border-white/15 bg-black/25 px-4 py-3 focus-within:border-cyan-300/70 focus-within:ring-2 focus-within:ring-cyan-300/35",
                      usernameChangeLocked ? "opacity-70" : ""
                    )}
                  >
                    <span className="mr-2 text-slate-500">@</span>
                    <input
                      value={username}
                      onChange={(event) => setUsername(normalizeProfileUsernameInput(event.target.value).slice(0, USERNAME_MAX_LENGTH))}
                      className="w-full bg-transparent text-white outline-none placeholder:text-slate-500 disabled:cursor-not-allowed"
                      placeholder={suggestedUsername || "your.name"}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={USERNAME_MAX_LENGTH}
                      disabled={usernameChangeLocked}
                    />
                  </div>
                  <div className="mt-1 space-y-1 text-xs">
                    <p className="text-white/35">conxion.social/u/{normalizedUsername || suggestedUsername || "your.name"} · 1 change allowed every 30 days</p>
                    {usernameAvailability.checking ? <p className="text-slate-400">Checking username...</p> : null}
                    {!usernameAvailability.checking && usernameError ? <p className="text-rose-300">{usernameError}</p> : null}
                    {!usernameAvailability.checking && !usernameError && usernameCooldownMessage ? (
                      <p className="text-amber-200">{usernameCooldownMessage}</p>
                    ) : null}
                    {!usernameAvailability.checking && !usernameError && !usernameCooldownMessage && usernameChanged && usernameAvailability.available ? (
                      <p className="text-emerald-300">Username available.</p>
                    ) : null}
                    {!usernameAvailability.checking &&
                    !usernameError &&
                    !usernameCooldownMessage &&
                    usernameChanged &&
                    !usernameAvailability.available &&
                    usernameAvailability.error ? (
                      <p className="text-rose-300">{usernameAvailability.error}</p>
                    ) : null}
                    {!usernameAvailability.checking &&
                    !usernameError &&
                    !usernameCooldownMessage &&
                    usernameAvailability.suggestion &&
                    usernameAvailability.suggestion !== normalizedUsername ? (
                      <button
                        type="button"
                        onClick={() => setUsername(usernameAvailability.suggestion ?? "")}
                        className="text-left text-cyan-200 hover:text-cyan-100"
                      >
                        Try @{usernameAvailability.suggestion}
                      </button>
                    ) : null}
                  </div>
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <label className="block text-sm font-medium text-slate-300">
                    Country
                    <div className="mt-1.5 sm:hidden">
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
                        buttonClassName="w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-left text-sm text-white outline-none"
                      />
                    </div>
                    <select
                      value={country}
                      onChange={(event) => {
                        const nextCountry = event.target.value;
                        setCountry(nextCountry);
                        setCity("");
                      }}
                      className="mt-1.5 hidden w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none transition-all duration-150 ease-out hover:border-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35 focus:shadow-[0_0_16px_rgba(34,211,238,0.18)] sm:block"
                    >
                      <option value="">Select country</option>
                      {countryNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-300">
                    City
                    {country && cityOptions.length === 0 ? (
                      <input
                        value={city}
                        onChange={(event) => setCity(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
                        placeholder="Type your city"
                      />
                    ) : (
                      <>
                        <div className="mt-1.5 sm:hidden">
                          <SearchableMobileSelect
                            label="City"
                            value={city}
                            options={cityOptions}
                            placeholder={country ? "Select city" : "Pick country first"}
                            searchPlaceholder="Search cities..."
                            disabled={!country}
                            emptyMessage={!country ? "Choose a country first." : "No cities found."}
                            onSelect={(nextCity) => setCity(nextCity)}
                            buttonClassName="w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-left text-sm text-white outline-none disabled:opacity-55"
                          />
                        </div>
                        <select
                          value={city}
                          onChange={(event) => setCity(event.target.value)}
                          disabled={!country}
                          className="mt-1.5 hidden w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none transition-all duration-150 ease-out hover:border-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35 focus:shadow-[0_0_16px_rgba(34,211,238,0.18)] disabled:opacity-55 sm:block"
                        >
                          <option value="">{country ? "Select city" : "Pick country first"}</option>
                          {cityOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </label>
                </div>

              </div>
              )}
              </>
              ) : activeTab === "media" ? (
                <div className={cx("min-w-0", error || verificationNotice ? "mt-3" : "")}>
                  <ProfileMediaManager embedded />
                </div>
              ) : null}
            </div>
              ) : null}

            {activeTab === "hosting" ? (
            <div className="rounded-3xl border border-white/10 bg-[#0b1418]/88 p-6 shadow-[0_22px_60px_rgba(0,0,0,0.42)] backdrop-blur-sm sm:p-7">
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Accepting hosting</p>
                    <p className="mt-0.5 text-xs text-slate-400">Turn this on to appear in Hosting and receive guest requests.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={acceptingHosting}
                    aria-label="Accepting hosting"
                    onClick={() => {
                      const nextAcceptingHosting = !acceptingHosting;
                      setAcceptingHosting(nextAcceptingHosting);
                      setHostingStatus((prev) => (nextAcceptingHosting ? (prev === "inactive" ? "available" : prev) : "inactive"));
                    }}
                    className="shrink-0"
                  >
                    <span className={cx("relative inline-flex h-7 w-12 rounded-full transition", acceptingHosting ? "bg-cyan-300/65" : "bg-white/15")}>
                      <span className={cx("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all", acceptingHosting ? "left-6" : "left-1")} />
                    </span>
                  </button>
                </div>

                {acceptingHosting ? (
                  <>
                    {/* Main fields — 3-col grid */}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="block text-sm font-medium text-slate-300">
                        Max guests
                        <input
                          type="number"
                          min={0}
                          max={20}
                          value={maxGuests}
                          onChange={(event) => setMaxGuests(event.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
                          placeholder="e.g. 2"
                        />
                      </label>

                      <label className="block text-sm font-medium text-slate-300">
                        Preferred guest gender
                        <select
                          value={hostingPreferredGuestGender}
                          onChange={(event) => setHostingPreferredGuestGender(normalizeHostingPreferredGuestGender(event.target.value))}
                          className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none transition-all duration-150 ease-out hover:border-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
                        >
                          {HOSTING_GUEST_GENDER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-sm font-medium text-slate-300">
                        Space type
                        <select
                          value={hostingSleepingArrangement}
                          onChange={(event) => setHostingSleepingArrangement(normalizeHostingSleepingArrangement(event.target.value))}
                          className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none transition-all duration-150 ease-out hover:border-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
                        >
                          {HOSTING_SLEEPING_ARRANGEMENT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="block text-sm font-medium text-slate-300">
                      What I can share with guests
                      <textarea
                        value={hostingGuestShare}
                        onChange={(event) => setHostingGuestShare(event.target.value.slice(0, 500))}
                        rows={3}
                        className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
                        placeholder="Meals, local recommendations, time together, workspace, laundry, or anything else guests can expect."
                      />
                    </label>

                    <label className="block text-sm font-medium text-slate-300">
                      Public transportation access
                      <textarea
                        value={hostingTransitAccess}
                        onChange={(event) => setHostingTransitAccess(event.target.value.slice(0, 300))}
                        rows={2}
                        className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
                        placeholder="Metro, tram, buses, distance to station, or anything guests should know."
                      />
                    </label>

                    {/* Additional information collapsible */}
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowAdditionalHostingInfo((v) => !v)}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm font-medium text-slate-300 hover:bg-black/30"
                      >
                        <span>Additional information</span>
                        <span className="material-symbols-outlined text-[18px] text-white/40">{showAdditionalHostingInfo ? "expand_less" : "expand_more"}</span>
                      </button>
                      {showAdditionalHostingInfo && (
                        <div className="mt-3 space-y-4">
                          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                            <label className="block text-sm font-medium text-slate-300">
                              Kid friendly
                              <select value={hostingKidFriendly ? "yes" : "no"} onChange={(e) => setHostingKidFriendly(e.target.value === "yes")} className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-3 py-3 text-white outline-none hover:border-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35">
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                              </select>
                            </label>
                            <label className="block text-sm font-medium text-slate-300">
                              Pet friendly
                              <select value={hostingPetFriendly ? "yes" : "no"} onChange={(e) => setHostingPetFriendly(e.target.value === "yes")} className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-3 py-3 text-white outline-none hover:border-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35">
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                              </select>
                            </label>
                            <label className="block text-sm font-medium text-slate-300">
                              Smoking
                              <select value={hostingSmokingAllowed ? "yes" : "no"} onChange={(e) => setHostingSmokingAllowed(e.target.value === "yes")} className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-3 py-3 text-white outline-none hover:border-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35">
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                              </select>
                            </label>
                            <label className="block text-sm font-medium text-slate-300">
                              Last-minute
                              <select value={hostingLastMinuteOk ? "yes" : "no"} onChange={(e) => setHostingLastMinuteOk(e.target.value === "yes")} className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-3 py-3 text-white outline-none hover:border-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35">
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                              </select>
                            </label>
                          </div>
                          <label className="block text-sm font-medium text-slate-300">
                            House rules
                            <textarea
                              value={houseRules}
                              onChange={(event) => setHouseRules(event.target.value.slice(0, 500))}
                              rows={4}
                              className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
                              placeholder="Share the important rules guests should know before they request hosting."
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
            ) : null}

            {activeTab === "profile" ? (
            <div className={cx("rounded-3xl border border-white/10 bg-[#0b1418]/88 shadow-[0_22px_60px_rgba(0,0,0,0.42)] backdrop-blur-sm transition-all", openSections.dance ? "p-6 sm:p-7" : "px-5 py-3.5")}>
              <header className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="material-symbols-outlined text-[16px] text-white/40 shrink-0">music_note</span><h2 className="shrink-0 text-sm font-semibold text-white/70">Dance Style</h2>
                  {!openSections.dance && selectedStyles.length > 0 && (
                    <p className="truncate text-sm">
                      <span className="text-white/50">{selectedStyles.map(titleCase).join(", ")}</span>
                    </p>
                  )}
                </div>
                {openSections.dance ? (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => cancelSection("dance")} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white/50 transition hover:bg-white/[0.05]">Cancel</button>
                    <button type="button" onClick={() => void saveProfile("dance")} disabled={saving || !isSectionDirty("dance", { danceSkills })} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-[#0df2f2]/80 transition hover:bg-white/[0.05] disabled:opacity-35 disabled:cursor-not-allowed">Save</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => openSection("dance", { danceSkills })} className="flex items-center justify-center rounded-lg p-1.5 text-white/40 transition hover:bg-white/[0.05] hover:text-white/70">
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                )}
              </header>

              {openSections.dance && <div className="mt-5 space-y-0.5">
                {CORE_STYLES.map((style) => {
                  const active = !!danceSkills[style];
                  const skill = danceSkills[style] ?? {};
                  const isVerified = skill.verified === true;
                  return (
                    <div key={style} className="rounded-xl hover:bg-white/[0.025]">
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => toggleStyle(style)}
                          className="h-4 w-4 shrink-0 accent-cyan-300"
                        />
                        <span className={cx("text-sm", active ? "font-medium text-white" : "text-slate-300")}>
                          {titleCase(style)}
                          {isVerified && <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-emerald-300/80"><VerifiedBadge size={10} /> Verified</span>}
                        </span>
                        {active && (
                          <select
                            value={skill.level ?? ""}
                            onChange={(e) => { e.stopPropagation(); setStyleLevel(style, e.target.value); }}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-lg border border-white/15 bg-black/30 px-2.5 py-1.5 text-xs text-white/80 outline-none hover:border-white/30 focus:border-cyan-300/60"
                          >
                            <option value="">— level —</option>
                            {LEVELS.map((level) => (
                              <option key={level} value={level}>{level}</option>
                            ))}
                          </select>
                        )}
                      </label>
                    </div>
                  );
                })}
                <div className="rounded-xl hover:bg-white/[0.025]">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={otherStyleEnabled}
                      onChange={toggleOtherStyle}
                      className="h-4 w-4 shrink-0 accent-fuchsia-400"
                    />
                    <span className={cx("flex-1 text-sm", otherStyleEnabled ? "font-medium text-white" : "text-slate-300")}>Other</span>
                  </label>
                  {otherStyleEnabled && (
                    <div className="px-3 pb-3">
                      <input
                        value={customStyleDraft}
                        onChange={(event) => onOtherStyleNameChange(event.target.value)}
                        maxLength={MAX_CUSTOM_STYLE_LENGTH}
                        className="w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35"
                        placeholder="Style name"
                      />
                    </div>
                  )}
                </div>
                {selectedStyles.length === 0 && (
                  <p className="mt-2 rounded-xl border border-amber-300/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/70">
                    Select at least one dance style — required.
                  </p>
                )}
              </div>}
            </div>
            ) : null}

            {activeTab === "profile" ? (
            <div className={cx("rounded-3xl border border-white/10 bg-[#0b1418]/88 shadow-[0_22px_60px_rgba(0,0,0,0.42)] backdrop-blur-sm transition-all", openSections.roles ? "p-6 sm:p-7" : "px-5 py-3.5")}>
              <header className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="material-symbols-outlined text-[16px] text-white/40 shrink-0">interests</span><h2 className="shrink-0 text-sm font-semibold text-white/70">Roles & preferences</h2>
                  {!openSections.roles && roles.length > 0 && (
                    <p className="truncate text-sm text-white/50">
                      {[(displayRole ?? roles[0]), interests[0], availability[0]].filter(Boolean).join(", ") || "—"}
                    </p>
                  )}
                </div>
                {openSections.roles ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => cancelSection("roles")} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white/50 transition hover:bg-white/[0.05]">Cancel</button>
                    <button type="button" onClick={() => void saveProfile("roles")} disabled={saving || !isSectionDirty("roles", { roles, displayRole, interests, availability })} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-[#0df2f2]/80 transition hover:bg-white/[0.05] disabled:opacity-35 disabled:cursor-not-allowed">Save</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => openSection("roles", { roles, displayRole, interests, availability })} className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-white/40 transition hover:bg-white/[0.05] hover:text-white/70">
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                )}
              </header>

              {openSections.roles && <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-3">
                <div>
                  <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-white/45">Roles</p>
                  <div className="space-y-1.5">
                    {roleOptions.map((item) => {
                      const active = roles.includes(item);
                      const isPrimary = active && (displayRole ?? roles[0]) === item;
                      return (
                        <label key={item} className="flex cursor-pointer items-center gap-2.5 py-0.5">
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => {
                              toggleString(roles, setRoles, item);
                              if (active && displayRole === item) setDisplayRole(null);
                            }}
                            className="h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-black/30 accent-cyan-400"
                          />
                          <span className={cx("text-sm", active ? "text-white" : "text-white/55")}>{item}</span>
                          {active && (
                            <button
                              type="button"
                              title={isPrimary ? "Display role" : "Set as display role"}
                              onClick={() => setDisplayRole(item)}
                              className={cx("ml-auto text-[10px] font-semibold transition", isPrimary ? "text-fuchsia-300" : "text-white/20 hover:text-white/50")}
                            >
                              {isPrimary ? "★ display" : "☆"}
                            </button>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  {roles.length === 0 && <p className="mt-1.5 text-[11px] text-amber-300/70">Select at least one role</p>}
                </div>

                <div>
                  <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-white/45">Interests</p>
                  <div className="space-y-1.5">
                    {interestOptions.map((item) => {
                      const active = interests.includes(item);
                      return (
                        <label key={item} className="flex cursor-pointer items-center gap-2.5 py-0.5">
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleString(interests, setInterests, item)}
                            className="h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-black/30 accent-fuchsia-400"
                          />
                          <span className={cx("text-sm", active ? "text-white" : "text-white/55")}>{item}</span>
                        </label>
                      );
                    })}
                  </div>
                  {interests.length === 0 && <p className="mt-1.5 text-[11px] text-amber-300/70">Select at least one interest</p>}
                </div>

                <div>
                  <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-white/45">Availability</p>
                  <div className="space-y-1.5">
                    {availabilityOptions.map((item) => {
                      const active = availability.includes(item);
                      return (
                        <label key={item} className="flex cursor-pointer items-center gap-2.5 py-0.5">
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleString(availability, setAvailability, item)}
                            className="h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-black/30 accent-cyan-400"
                          />
                          <span className={cx("text-sm", active ? "text-white" : "text-white/55")}>{item}</span>
                        </label>
                      );
                    })}
                  </div>
                  {availability.length === 0 && <p className="mt-1.5 text-[11px] text-amber-300/70">Select at least one option</p>}
                </div>
              </div>}
            </div>
            ) : null}

            {activeTab === "profile" ? (
            <div className={cx("rounded-3xl border border-white/10 bg-[#0b1418]/88 shadow-[0_22px_60px_rgba(0,0,0,0.42)] backdrop-blur-sm transition-all", openSections.langs ? "p-6 sm:p-7" : "px-5 py-3.5")}>
              <header className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="material-symbols-outlined text-[16px] text-white/40 shrink-0">translate</span><h2 className="shrink-0 text-sm font-semibold text-white/70">Languages</h2>
                  {!openSections.langs && languages.length > 0 && (
                    <p className="truncate text-sm text-white/50">
                      {languages.slice(0, 3).join(", ")}{languages.length > 3 ? ` +${languages.length - 3}` : ""}
                    </p>
                  )}
                </div>
                {openSections.langs ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => cancelSection("langs")} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white/50 transition hover:bg-white/[0.05]">Cancel</button>
                    <button type="button" onClick={() => void saveProfile("langs")} disabled={saving || !isSectionDirty("langs", { languages })} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-[#0df2f2]/80 transition hover:bg-white/[0.05] disabled:opacity-35 disabled:cursor-not-allowed">Save</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => openSection("langs", { languages })} className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-white/40 transition hover:bg-white/[0.05] hover:text-white/70">
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                )}
              </header>

              {openSections.langs && <div className="mt-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-300">Languages spoken</p>
                  <p className="text-xs text-slate-500">{languages.length}/5</p>
                </div>
                <div className="flex gap-2">
                  <input
                    value={languageDraft}
                    onChange={(event) => setLanguageDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLanguage(); } }}
                    list="language-options-list"
                    disabled={languages.length >= 5}
                    className="w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 transition hover:border-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/35 disabled:opacity-50"
                    placeholder={languages.length >= 5 ? "Max 5 languages reached" : "Type to search languages…"}
                    autoComplete="off"
                  />
                  <datalist id="language-options-list">
                    {LANGUAGE_OPTIONS.filter((item) => !languages.includes(item)).map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={() => addLanguage()}
                    disabled={languages.length >= 5 || !languageDraft.trim()}
                    className="rounded-xl border border-cyan-300/35 bg-cyan-300/15 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {languages.length > 0 ? (
                    languages.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setLanguages((prev) => prev.filter((v) => v !== item))}
                        className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.08]"
                        title="Remove"
                      >
                        {item} <span className="text-slate-400">×</span>
                      </button>
                    ))
                  ) : (
                    <p className="text-sm text-slate-400">No languages selected.</p>
                  )}
                </div>
              </div>}
            </div>
            ) : null}

            {activeTab === "teacher_services" ? <TeacherInfoManager embedded /> : null}

            {activeTab === "teacher_profile" ? <TeacherProfilePage embedded /> : null}


            {activeTab === "hosting" ? (
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleLeaveToAccountSettings}
                disabled={saving || uploading}
                className="w-full rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white/85 hover:bg-white/[0.08] sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || uploading || !hasUnsavedChanges}
                className="w-full rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-5 py-2.5 text-sm font-bold text-[#071018] shadow-[0_0_18px_rgba(34,211,238,0.22)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                data-testid="profile-edit-save"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
            ) : null}
          </section>
        </form>
      </main>

      {photoOpen && displayAvatarUrl ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/85 px-4 py-4 sm:items-center" onClick={() => setPhotoOpen(false)}>
          <div className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPhotoOpen(false)}
              className="absolute right-3 top-3 z-10 rounded-full border border-white/20 bg-black/45 px-3 py-1 text-sm text-white hover:bg-black/70"
            >
              Close
            </button>
            <div className="relative h-[min(75vh,calc(100dvh-6rem))] overflow-hidden rounded-2xl border border-white/15 bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayAvatarUrl} alt="Profile avatar enlarged" className="h-full w-full object-contain" onError={clearBrokenAvatarPreview} />
            </div>
          </div>
        </div>
      ) : null}

      {saveStage !== "idle" ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#05080f]/92 px-4 py-4">
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[#0b1418] p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.65)]">
            <div className="mx-auto w-44">
              <Image
                src="/branding/CONXION-3-tight.png"
                alt="ConXion"
                width={352}
                height={160}
                className="h-auto w-full"
                priority
              />
            </div>
            <h3 className="mt-5 text-2xl font-extrabold text-white">
              {saveStage === "saving" ? "Saving your profile" : "Profile saved"}
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              {saveStage === "saving" ? "Syncing changes across your profile..." : "Your changes have been saved."}
            </p>
            <div className="mt-6 flex items-center justify-center gap-2">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:140ms]" />
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:280ms]" />
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:420ms]" />
            </div>
          </div>
        </div>
      ) : null}

      {cropSource ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/88 px-4 py-4 sm:items-center" onClick={() => setCropSource(null)}>
          <div
            className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/15 bg-[#0b1418] shadow-[0_20px_50px_rgba(0,0,0,0.55)] sm:max-h-[min(92dvh,860px)] sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="min-h-0 overflow-y-auto overscroll-contain p-5">
            <h3 className="text-lg font-bold text-white">Crop avatar</h3>
            <p className="mt-1 text-sm text-slate-300">Adjust zoom and position, then confirm your square profile image.</p>

            {cropError ? (
              <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {cropError}
              </div>
            ) : null}

            <div className="mt-4 flex justify-center">
              <div className="relative h-[320px] w-[320px] overflow-hidden rounded-2xl border border-white/15 bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cropSource}
                  alt="Avatar crop preview"
                  className="absolute left-1/2 top-1/2 max-w-none select-none"
                  style={{
                    width: cropPreview ? `${cropPreview.renderWidth}px` : undefined,
                    height: cropPreview ? `${cropPreview.renderHeight}px` : undefined,
                    transform: `translate(calc(-50% + ${cropPreview?.offsetX ?? 0}px), calc(-50% + ${cropPreview?.offsetY ?? 0}px))`,
                  }}
                  draggable={false}
                />
                <div className="pointer-events-none absolute inset-0 border border-cyan-300/50" />
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-slate-300">Zoom</label>
              <input
                type="range"
                min={1}
                max={4}
                step={0.01}
                value={cropZoom}
                onChange={(event) => setCropZoom(Number(event.target.value))}
                className="mt-2 w-full"
              />
              <label className="block text-sm font-medium text-slate-300">Horizontal position</label>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={Math.round(cropPanX * 100)}
                onChange={(event) => setCropPanX(Number(event.target.value) / 100)}
                className="w-full"
                disabled={!cropPreview || cropPreview.maxOffsetX === 0}
              />
              <label className="block text-sm font-medium text-slate-300">Vertical position</label>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={Math.round(cropPanY * 100)}
                onChange={(event) => setCropPanY(Number(event.target.value) / 100)}
                className="w-full"
                disabled={!cropPreview || cropPreview.maxOffsetY === 0}
              />
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setCropSource(null);
                  setCropNaturalSize(null);
                  setCropError(null);
                }}
                className="rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-medium text-white/85 hover:bg-white/[0.08]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void confirmCropUpload();
                }}
                disabled={uploading}
                className="rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-5 py-2 text-sm font-bold text-[#071018] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? "Uploading..." : "Use this crop"}
              </button>
            </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function EditMePageWrapper() {
  return (
    <Suspense>
      <EditMePage />
    </Suspense>
  );
}
