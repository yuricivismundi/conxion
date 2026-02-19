// /lib/connectReasons.ts

export type ConnectContext = "member" | "traveller";

export type ReasonItem = {
  key: string; // stable key for DB
  label: string; // text shown in UI (also what you can store as "interest" if you want)
  role: string; // the role that unlocks this reason
  context: ConnectContext;
};

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const ROLE_REASONS: Record<string, string[]> = {
  "Social dancer / Student": [
    "Explore local socials and parties together",
    "Find a practice partner while in town",
    "Get tips about the local dance scene (schools, socials, festivals)",
    "Find a buddy to attend workshops and socials together",
    "Share accommodation or rides to/from festival",
    "Practice specific moves/combos between workshops",
    "Coordinate passes, group photos, or video recording",
  ],

  Organizer: [
    "Collab as artist/teacher for your event/festival",
    "Sponsorship",
    "Share your event with my network",
    "Volunteer/help staff your next party",
  ],

  "Studio Owner": [
    "Collab/join your classes as traveling dancer",
    "Audition as guest teacher",
    "Promote joint workshops/events",
    "Refer students from my network",
    "Collaborate on special classes",
  ],

  Promoter: [
    "Partner to promote festivals",
    "Refer artists/DJs/teachers for your events",
    "Co-promote local parties/socials",
    "Exchange guest lists or shoutouts",
    "Share promo materials/contacts",
  ],

  DJ: [
    "Book you for my event/party",
    "Collab on tracks or live sets",
    "Get feedback on mixes for dance floors",
    "Network for festival gigs together",
    "Share event lineups",
  ],

  Artist: [
    "Invite to headline festival/event",
    "Propose performance collab",
    "Feature in promo videos/socials",
    "Exchange artist contacts",
  ],

  Teacher: [
    "Take private/group lessons while traveling",
    "Arrange co-teaching workshop",
    "Exchange teaching tips/curriculum",
    "Refer advanced students",
  ],
};

// Flat list of reasons
export const ALL_REASONS: ReasonItem[] = Object.entries(ROLE_REASONS).flatMap(([role, labels]) =>
  labels.map((label) => ({
    key: `${slug(role)}__${slug(label)}`,
    label,
    role,
    // for now, same list works for both
    context: "member" as const,
  }))
);

/**
 * Returns all reasons unlocked by any of the provided roles (union).
 * If the target has 2+ roles, you get reasons for ALL those roles.
 */
export function getReasonsForRoles(roles: string[], context: ConnectContext): ReasonItem[] {
  const normalized = new Set((roles ?? []).map((r) => r.trim().toLowerCase()));

  const out = ALL_REASONS.filter((r) => {
    if (r.context !== context) return false;
    return normalized.has(r.role.trim().toLowerCase());
  });

  // de-dup by key, preserve order
  const seen = new Set<string>();
  return out.filter((x) => {
    if (seen.has(x.key)) return false;
    seen.add(x.key);
    return true;
  });
}

/**
 * For Discover filter list: all possible reasons (union across all roles).
 */
export function getAllReasons(context: ConnectContext): ReasonItem[] {
  return ALL_REASONS.filter((r) => r.context === context);
}