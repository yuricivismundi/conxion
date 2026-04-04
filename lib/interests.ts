export const INTEREST_OPTIONS = [
  "Social dancing",
  "Practice partner",
  "Festival buddy",
  "Travel / hosting buddy",
  "Private lessons",
  "Group classes",
  "Local recommendations",
  "Content collaboration",
  "Event / booking collaboration",
] as const;

export type ProfileInterest = (typeof INTEREST_OPTIONS)[number];

const INTEREST_INDEX = new Map<string, number>(INTEREST_OPTIONS.map((item, index) => [item, index]));

const LEGACY_INTEREST_ALIASES = new Map<string, ProfileInterest>([
  ["dance at local socials and events", "Social dancing"],
  ["social dance party", "Social dancing"],
  ["find practice partners", "Practice partner"],
  ["practice / dance partner", "Practice partner"],
  ["festival travel buddy", "Festival buddy"],
  ["find buddies for workshops, socials, accommodations, or rides", "Travel / hosting buddy"],
  ["get tips on the local dance scene", "Local recommendations"],
  ["collaborate on video projects", "Content collaboration"],
  ["video collabs", "Content collaboration"],
  ["feature in promo videos/socials", "Content collaboration"],
  ["collaborate on tracks or live sets", "Content collaboration"],
  ["private lessons", "Private lessons"],
  ["offer private/group lessons", "Private lessons"],
  ["group lessons", "Group classes"],
  ["teach regular classes", "Group classes"],
  ["lead festival workshops", "Group classes"],
  ["co-teach sessions", "Group classes"],
  ["collaborate with artists/teachers for events/festivals", "Event / booking collaboration"],
  ["organize recurring local events", "Event / booking collaboration"],
  ["secure sponsorships and org collabs", "Event / booking collaboration"],
  ["offer volunteer roles for events", "Event / booking collaboration"],
  ["recruit guest dancers", "Event / booking collaboration"],
  ["promote special workshops and events", "Event / booking collaboration"],
  ["organize classes and schedules", "Event / booking collaboration"],
  ["collaborate with other studio owners", "Event / booking collaboration"],
  ["secure sponsorships and hire talent", "Event / booking collaboration"],
  ["partner to promote festivals", "Event / booking collaboration"],
  ["refer artists, djs, and teachers", "Event / booking collaboration"],
  ["co-promote local parties/socials", "Event / booking collaboration"],
  ["exchange guest lists and shoutouts", "Event / booking collaboration"],
  ["share promo materials and audiences", "Event / booking collaboration"],
  ["produce new songs and tracks", "Event / booking collaboration"],
  ["network for festival gigs", "Event / booking collaboration"],
  ["dj international and local events", "Event / booking collaboration"],
  ["exchange tips, curricula, and student referrals", "Event / booking collaboration"],
]);

const ROLE_INTEREST_OPTIONS: Record<string, readonly ProfileInterest[]> = {
  "Social Dancer": [
    "Social dancing",
    "Practice partner",
    "Festival buddy",
    "Travel / hosting buddy",
    "Private lessons",
    "Group classes",
    "Local recommendations",
  ],
  Student: [
    "Social dancing",
    "Practice partner",
    "Festival buddy",
    "Travel / hosting buddy",
    "Private lessons",
    "Group classes",
    "Local recommendations",
  ],
  Teacher: [
    "Private lessons",
    "Group classes",
    "Event / booking collaboration",
    "Content collaboration",
    "Travel / hosting buddy",
    "Local recommendations",
  ],
  Organizer: [
    "Event / booking collaboration",
    "Festival buddy",
    "Travel / hosting buddy",
    "Content collaboration",
    "Local recommendations",
  ],
  "Studio Owner": [
    "Event / booking collaboration",
    "Group classes",
    "Private lessons",
    "Content collaboration",
    "Local recommendations",
  ],
  Promoter: [
    "Event / booking collaboration",
    "Festival buddy",
    "Content collaboration",
    "Travel / hosting buddy",
    "Local recommendations",
  ],
  DJ: [
    "Event / booking collaboration",
    "Content collaboration",
    "Festival buddy",
    "Social dancing",
    "Local recommendations",
  ],
  Artist: [
    "Content collaboration",
    "Event / booking collaboration",
    "Festival buddy",
    "Social dancing",
    "Travel / hosting buddy",
  ],
};

export const DEFAULT_ROLE_INTERESTS = ROLE_INTEREST_OPTIONS["Social Dancer"];

function cleanInterestLabel(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeInterestLabel(value: string): string | null {
  const cleaned = cleanInterestLabel(value);
  if (!cleaned) return null;

  const alias = LEGACY_INTEREST_ALIASES.get(cleaned.toLowerCase());
  if (alias) return alias;

  const canonical = INTEREST_OPTIONS.find((item) => item.toLowerCase() === cleaned.toLowerCase());
  return canonical ?? cleaned;
}

export function normalizeInterests(values: readonly string[] | null | undefined): string[] {
  if (!values?.length) return [];

  const seen = new Set<string>();
  const next: string[] = [];

  for (const raw of values) {
    const normalized = normalizeInterestLabel(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }

  return next.sort((a, b) => {
    const ai = INTEREST_INDEX.get(a);
    const bi = INTEREST_INDEX.get(b);
    if (ai === undefined && bi === undefined) return a.localeCompare(b);
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  });
}

export function getInterestOptionsForRole(role: string): readonly ProfileInterest[] {
  return ROLE_INTEREST_OPTIONS[role] ?? DEFAULT_ROLE_INTERESTS;
}
