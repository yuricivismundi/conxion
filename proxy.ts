import { NextResponse, type NextRequest } from "next/server";
import { canUseTeacherProfile } from "@/lib/teacher-profile/access";
import { hasTeacherBadgeRole } from "@/lib/teacher-info/roles";
import { normalizeProfileUsernameInput } from "@/lib/profile-username";
import { isPaymentVerified } from "@/lib/verification";

type ProfileLookupRow = {
  user_id?: string | null;
  roles?: unknown;
  verified?: unknown;
  verified_label?: unknown;
  username?: string | null;
};

type TeacherProfileLookupRow = {
  default_public_view?: string | null;
  teacher_profile_enabled?: boolean | null;
  is_public?: boolean | null;
  teacher_profile_trial_ends_at?: string | null;
};

function getSupabaseRestBaseUrl() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/rest/v1`;
}

function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === "string");
}

async function supabaseRestFetch<T>(path: string): Promise<T | null> {
  const baseUrl = getSupabaseRestBaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!baseUrl || !anonKey) return null;

  const response = await fetch(`${baseUrl}/${path}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) return null;
  const data = (await response.json()) as unknown;
  return (Array.isArray(data) ? (data[0] ?? null) : data) as T | null;
}

async function resolveTeacherRedirectUserId(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;

  let profileRow: ProfileLookupRow | null = null;

  if (parts[0] === "profile") {
    profileRow = await supabaseRestFetch<ProfileLookupRow>(
      `profiles?select=user_id,roles,verified,verified_label,username&user_id=eq.${encodeURIComponent(parts[1])}&limit=1`
    );
  } else if (parts[0] === "u") {
    const normalizedUsername = normalizeProfileUsernameInput(parts[1]);
    if (!normalizedUsername) return null;
    profileRow = await supabaseRestFetch<ProfileLookupRow>(
      `profiles?select=user_id,roles,verified,verified_label,username&username=eq.${encodeURIComponent(normalizedUsername)}&limit=1`
    );
  } else {
    return null;
  }

  if (!profileRow?.user_id) return null;
  const roles = asStringArray(profileRow.roles);
  if (!hasTeacherBadgeRole(roles)) return null;

  const teacherProfileRow = await supabaseRestFetch<TeacherProfileLookupRow>(
    `teacher_profiles?select=default_public_view,teacher_profile_enabled,is_public,teacher_profile_trial_ends_at&user_id=eq.${encodeURIComponent(profileRow.user_id)}&limit=1`
  );

  if (!teacherProfileRow) return null;

  const teacherEnabled = teacherProfileRow.teacher_profile_enabled === true;
  const isPublic = teacherProfileRow.is_public === true;
  const defaultView = (teacherProfileRow.default_public_view ?? "").toLowerCase();

  if (
    defaultView !== "teacher" ||
    !isPublic ||
    !canUseTeacherProfile({
      roles,
      teacherProfileEnabled: teacherEnabled,
      trialEndsAt:
        typeof teacherProfileRow.teacher_profile_trial_ends_at === "string"
          ? teacherProfileRow.teacher_profile_trial_ends_at
          : null,
      isVerified: isPaymentVerified(profileRow),
    })
  ) {
    return null;
  }

  return profileRow.user_id;
}

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const parts = pathname.split("/").filter(Boolean);

  const isBaseProfileRoute =
    (parts[0] === "profile" && parts.length === 2) ||
    (parts[0] === "u" && parts.length === 2);

  if (!isBaseProfileRoute) {
    return NextResponse.next();
  }

  if (searchParams.get("view") === "social") {
    return NextResponse.next();
  }

  try {
    const redirectUserId = await resolveTeacherRedirectUserId(pathname);
    if (!redirectUserId) return NextResponse.next();

    const url = request.nextUrl.clone();
    url.pathname = `/profile/${redirectUserId}/teacher`;
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/profile/:path*", "/u/:path*"],
};
