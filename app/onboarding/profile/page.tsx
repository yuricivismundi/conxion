"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import OnboardingShell from "@/components/OnboardingShell";
import SearchableMobileSelect from "@/components/SearchableMobileSelect";
import {
  getCachedCitiesOfCountry,
  getCachedCountriesAll,
  getCitiesOfCountry,
  getCountriesAll,
  type CountryEntry,
} from "@/lib/country-city-client";
import { getAvatarStorageUrl } from "@/lib/avatar-storage";
import { requestUsernameCheck } from "@/lib/username/client";
import { buildUsernameSuggestionBase, normalizeUsername, USERNAME_MAX_LENGTH } from "@/lib/username/normalize";
import { validateUsernameFormat } from "@/lib/username/validate";
import { readOnboardingDraft, writeOnboardingDraft } from "@/lib/onboardingDraft";
import { GENDER_OPTIONS, normalizeGender, type Gender } from "@/lib/profile/gender";
import { supabase } from "@/lib/supabase/client";

const CROP_FRAME_SIZE = 320;

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

const ROLES = [
  "Social Dancer",
  "Student",
  "Organizer",
  "Studio Owner",
  "Promoter",
  "DJ",
  "Artist",
  "Teacher",
] as const;
const MAX_DISPLAY_NAME_LENGTH = 48;

const LEGACY_ROLES_REMOVE = new Set([
  "social dancer / student",
  "social dancer/student",
  "organiser",
]);
function normalizeLegacyRoles(roles: string[]): Role[] {
  return roles.filter(
    (r): r is Role =>
      !LEGACY_ROLES_REMOVE.has(r.toLowerCase().trim()) &&
      (ROLES as readonly string[]).includes(r)
  );
}

type Role = (typeof ROLES)[number];

export default function OnboardingProfilePage() {
  const router = useRouter();

  const [countriesAll, setCountriesAll] = useState<CountryEntry[]>(() => getCachedCountriesAll());
  const [cityNames, setCityNames] = useState<string[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const countryNames = useMemo(() => countriesAll.map((c) => c.name), [countriesAll]);

  const [meId, setMeId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [gender, setGender] = useState<Gender>("prefer_not_to_say");
  const [usernameDirty, setUsernameDirty] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean;
    error: string | null;
    suggestion: string | null;
  }>({
    checking: false,
    available: false,
    error: null,
    suggestion: null,
  });

  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | undefined>(undefined);
  const [avatarStatus, setAvatarStatus] = useState<"pending" | "approved" | "rejected" | undefined>(undefined);
  const [avatarPath, setAvatarPath] = useState<string | undefined>(undefined);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPanX, setCropPanX] = useState(0);
  const [cropPanY, setCropPanY] = useState(0);
  const [cropNaturalSize, setCropNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rolesScrollRef = useRef<HTMLDivElement | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const el = rolesScrollRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const left = el.scrollLeft;
    const maxLeft = el.scrollWidth - el.clientWidth;

    // Small epsilon to avoid flicker due to sub-pixel values
    const EPS = 2;

    setCanScrollLeft(left > EPS);
    setCanScrollRight(maxLeft - left > EPS);
  }, []);

  function scrollRolesBy(delta: number) {
    const el = rolesScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: "smooth" });
    // Update after scroll animation kicks in
    window.setTimeout(updateScrollButtons, 180);
  }

  // Prefill when coming back from later steps
  useEffect(() => {
    (async () => {
      // Ensure we have a logged-in user id for Storage paths
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      const draftAgeConfirmed = readOnboardingDraft().ageConfirmed === true;
      const metadataAgeConfirmed = Boolean(user.user_metadata?.age_confirmed_at || user.user_metadata?.age_confirmed === true);
      if (!draftAgeConfirmed && !metadataAgeConfirmed) {
        router.replace("/onboarding/age");
        return;
      }
      setMeId(user.id);

      const d = readOnboardingDraft();
      if (typeof d.displayName === "string") setDisplayName(d.displayName.slice(0, MAX_DISPLAY_NAME_LENGTH));
      if (typeof d.username === "string") {
        setUsername(normalizeUsername(d.username).slice(0, USERNAME_MAX_LENGTH));
        setUsernameDirty(d.username.trim().length > 0);
      }
      if (typeof d.country === "string") setCountry(d.country);
      if (typeof d.city === "string") setCity(d.city);
      if (Array.isArray(d.roles)) setRoles(normalizeLegacyRoles(d.roles.filter(Boolean)));
      if (typeof d.gender === "string") setGender(normalizeGender(d.gender));
      const draftAvatarPath = typeof d.avatarPath === "string" && d.avatarPath.trim() ? d.avatarPath.trim() : undefined;
      const draftAvatarUrl =
        typeof d.avatarDataUrl === "string" && d.avatarDataUrl
          ? d.avatarDataUrl
          : getAvatarStorageUrl(draftAvatarPath) ?? undefined;
      if (draftAvatarUrl) setAvatarPreviewUrl(draftAvatarUrl);
      if (draftAvatarPath) setAvatarPath(draftAvatarPath);
      if (typeof d.avatarStatus === "string") setAvatarStatus(d.avatarStatus);

      setHydrated(true);
      // After hydration, compute arrow visibility
      window.setTimeout(updateScrollButtons, 0);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Persist draft as user types/selects
  useEffect(() => {
    if (!hydrated) return;
    writeOnboardingDraft({
      displayName,
      username,
      country,
      city,
      roles,
      gender,
      avatarDataUrl: avatarPreviewUrl,
      avatarPath,
      avatarStatus,
    });
  }, [hydrated, displayName, username, country, city, roles, gender, avatarPreviewUrl, avatarPath, avatarStatus]);

  const suggestedUsernameBase = useMemo(() => buildUsernameSuggestionBase(displayName), [displayName]);
  const normalizedUsername = useMemo(() => normalizeUsername(username).slice(0, USERNAME_MAX_LENGTH), [username]);
  const usernameFormat = useMemo(() => validateUsernameFormat(normalizedUsername), [normalizedUsername]);

  useEffect(() => {
    if (!hydrated || usernameDirty) return;
    if (!suggestedUsernameBase) {
      setUsername("");
      return;
    }
    setUsername((prev) => (prev === suggestedUsernameBase ? prev : suggestedUsernameBase));
  }, [hydrated, suggestedUsernameBase, usernameDirty]);

  useEffect(() => {
    if (!hydrated) return;
    if (!normalizedUsername) {
      setUsernameStatus({
        checking: false,
        available: false,
        error: suggestedUsernameBase ? "Username must be between 3 and 20 characters." : null,
        suggestion: suggestedUsernameBase || null,
      });
      return;
    }

    if (!usernameFormat.valid) {
      setUsernameStatus({
        checking: false,
        available: false,
        error: usernameFormat.error ?? "Username must be between 3 and 20 characters.",
        suggestion: suggestedUsernameBase || null,
      });
      return;
    }

    let cancelled = false;
    setUsernameStatus((prev) => ({ ...prev, checking: true, error: null }));

    const timeoutId = window.setTimeout(() => {
      void requestUsernameCheck({
        username: normalizedUsername,
        seed: suggestedUsernameBase || displayName,
        currentUserId: meId,
      }).then((result) => {
        if (cancelled) return;
        setUsernameStatus({
          checking: false,
          available: result.available,
          error: result.available ? null : result.error,
          suggestion: result.suggestion,
        });
        if (!usernameDirty && result.suggestion && result.suggestion !== normalizedUsername) {
          setUsername(result.suggestion);
        }
      });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [displayName, hydrated, meId, normalizedUsername, suggestedUsernameBase, usernameDirty, usernameFormat]);

  // Keep arrow buttons accurate on resize/content changes
  useEffect(() => {
    updateScrollButtons();

    const onResize = () => updateScrollButtons();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateScrollButtons, roles.length, country, city]);

  function toggleRole(r: Role) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  const cropPreview = useMemo(() => {
    if (!cropSource || !cropNaturalSize) return null;
    const minSide = Math.min(cropNaturalSize.width, cropNaturalSize.height);
    if (!minSide) return null;
    const scale = (CROP_FRAME_SIZE / minSide) * Math.max(cropZoom, 1);
    const renderWidth = cropNaturalSize.width * scale;
    const renderHeight = cropNaturalSize.height * scale;
    const maxOffsetX = Math.max((renderWidth - CROP_FRAME_SIZE) / 2, 0);
    const maxOffsetY = Math.max((renderHeight - CROP_FRAME_SIZE) / 2, 0);
    return { renderWidth, renderHeight, maxOffsetX, maxOffsetY, offsetX: cropPanX * maxOffsetX, offsetY: cropPanY * maxOffsetY };
  }, [cropNaturalSize, cropPanX, cropPanY, cropSource, cropZoom]);

  function onPickPhotoClick() {
    fileInputRef.current?.click();
  }

  async function onRawFilePicked(file: File | null) {
    if (!file) return;
    setError(null);
    setCropError(null);
    try {
      if (!file.type.startsWith("image/")) throw new Error("Please upload an image.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Max size is 5MB.");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { if (typeof reader.result === "string") resolve(reader.result); else reject(new Error("Could not read image.")); };
        reader.onerror = () => reject(new Error("Could not read image."));
        reader.readAsDataURL(file);
      });
      const naturalSize = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => { const w = img.naturalWidth || img.width; const h = img.naturalHeight || img.height; if (!w || !h) { reject(new Error("Invalid image dimensions.")); return; } resolve({ width: w, height: h }); };
        img.onerror = () => reject(new Error("Could not read image."));
        img.src = dataUrl;
      });
      setCropZoom(1);
      setCropPanX(0);
      setCropPanY(0);
      setCropNaturalSize(naturalSize);
      setCropSource(dataUrl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not prepare image.");
    }
  }

  async function confirmCropUpload() {
    if (!cropSource || !meId || !cropPreview) return;
    setUploading(true);
    setError(null);
    setCropError(null);
    try {
      const blob = await makePreviewMatchedCroppedBlob({ src: cropSource, preview: cropPreview });
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token?.trim() ?? "";
      if (!accessToken) throw new Error("Please sign in again.");
      const formData = new FormData();
      formData.append("file", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
      const uploadResponse = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      const uploadPayload = (await uploadResponse.json().catch(() => null)) as { ok?: boolean; error?: string; url?: string; path?: string } | null;
      if (!uploadResponse.ok || !uploadPayload?.ok) {
        throw new Error(uploadPayload?.error?.trim() || "Upload failed.");
      }
      const previewUrl = URL.createObjectURL(blob);
      setAvatarPreviewUrl(previewUrl);
      setAvatarPath(uploadPayload.path ?? "");
      setAvatarStatus("pending");
      setCropSource(null);
      setCropNaturalSize(null);
      setCropError(null);
      writeOnboardingDraft({ avatarPath: uploadPayload.path ?? "", avatarStatus: "pending", avatarDataUrl: undefined });
    } catch (e: unknown) {
      setCropError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const iso = useMemo(() => countriesAll.find((c) => c.name === country)?.isoCode ?? "", [countriesAll, country]);

  useEffect(() => {
    let cancelled = false;

    if (!iso) {
      setCityNames([]);
      setLoadingCities(false);
      return () => {
        cancelled = true;
      };
    }

    const cachedCities = getCachedCitiesOfCountry(iso);
    if (cachedCities.length > 0) {
      setCityNames(cachedCities);
      setLoadingCities(false);
      return () => {
        cancelled = true;
      };
    }

    setLoadingCities(true);
    void getCitiesOfCountry(iso)
      .then((cities) => {
        if (cancelled) return;
        setCityNames(cities);
        setLoadingCities(false);
      })
      .catch(() => {
        if (cancelled) return;
        setCityNames([]);
        setLoadingCities(false);
      });

    return () => {
      cancelled = true;
    };
  }, [iso]);

  const canContinue =
    displayName.trim().length >= 2 &&
    country.trim().length >= 2 &&
    city.trim().length >= 1 &&
    roles.length > 0 &&
    usernameStatus.available &&
    !usernameStatus.checking;

  if (!hydrated) {
    return (
      <OnboardingShell step={1} title="Setup your profile" subtitle={""}>
        <div className="mt-6 animate-pulse space-y-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
            <div className="sm:col-span-4">
              <div className="mx-auto h-40 w-40 rounded-2xl border border-white/10 bg-white/5 sm:h-44 sm:w-44 lg:mx-0 lg:h-48 lg:w-48" />
            </div>
            <div className="space-y-4 lg:col-span-8">
              <div className="h-12 rounded-xl bg-white/5" />
              <div className="h-16 rounded-xl bg-white/5" />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="h-12 rounded-xl bg-white/5" />
                <div className="h-12 rounded-xl bg-white/5" />
              </div>
            </div>
          </div>
          <div className="flex gap-3 overflow-hidden">
            <div className="h-20 w-[82%] rounded-2xl bg-white/5 sm:w-[55%] md:w-[42%] lg:w-[30%]" />
            <div className="h-20 w-[82%] rounded-2xl bg-white/5 sm:w-[55%] md:w-[42%] lg:w-[30%]" />
          </div>
          <div className="h-14 rounded-2xl bg-white/5" />
        </div>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell step={1} title="Setup your profile" subtitle={""}>
      <div className="mt-6 space-y-6">
        {error ? (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        {/* Photo + Display name (same row) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
          <div className="sm:col-span-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { void onRawFilePicked(e.target.files?.[0] ?? null); e.target.value = ""; }}
            />

            <div className="flex flex-col items-center lg:items-start">
              <button
                type="button"
                onClick={onPickPhotoClick}
                className="group mx-auto flex h-40 w-40 flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-white/15 transition hover:border-[#00F5FF]/60 sm:h-44 sm:w-44 lg:mx-0 lg:h-48 lg:w-48"
                title="Add photo"
              >
                {avatarPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarPreviewUrl} alt="Selected avatar preview" className="h-full w-full object-cover" />
                ) : (
                  <>
                    <div
                      className="text-transparent bg-clip-text"
                      style={{ backgroundImage: "linear-gradient(90deg, #00F5FF 0%, #FF00FF 100%)" }}
                    >
                      <span className="text-3xl">+</span>
                    </div>
                    <span className="mt-1 text-[10px] font-bold text-white/60 group-hover:text-white/80">
                      {uploading ? "Uploading…" : "Add photo"}
                    </span>
                  </>
                )}
              </button>
              {avatarStatus === "pending" ? (
                <p className="mt-2 text-center text-[11px] text-white/45 lg:text-left">Your photo will be reviewed</p>
              ) : !avatarPath ? (
                <p className="mt-2 text-center text-[11px] text-white/40 lg:text-left">Optional — you can add later</p>
              ) : null}
            </div>
          </div>

          <div className="lg:col-span-8">
            <label className="ml-1 text-xs font-semibold uppercase tracking-wider text-white/70">Display Name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, MAX_DISPLAY_NAME_LENGTH))}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              placeholder="e.g. Maria Dance"
              autoComplete="name"
              autoCapitalize="words"
              className="mt-2 w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
            />
            <div className="mt-1 text-right text-xs text-white/45">
              {displayName.length}/{MAX_DISPLAY_NAME_LENGTH}
            </div>

            <div className="mt-5">
              <label className="ml-1 text-xs font-semibold uppercase tracking-wider text-white/70">Username</label>
              <div className="mt-2 flex items-center rounded-xl border border-white/10 bg-[#121212] px-4 py-3 focus-within:border-[#00F5FF]/60 focus-within:ring-1 focus-within:ring-[#00F5FF]/30">
                <span className="mr-2 text-white/40">@</span>
                <input
                  value={username}
                  onChange={(e) => {
                    setUsernameDirty(true);
                    setUsername(normalizeUsername(e.target.value).slice(0, USERNAME_MAX_LENGTH));
                  }}
                  maxLength={USERNAME_MAX_LENGTH}
                  placeholder={suggestedUsernameBase || "your.name"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full bg-transparent text-[#E0E0E0] outline-none placeholder:text-white/25"
                />
              </div>
              <div className="mt-2 space-y-1 text-xs">
                <p className="text-white/55">Your username is part of your public profile link.</p>
                <p className="text-cyan-200/85">conxion.social/u/{normalizedUsername || suggestedUsernameBase || "your.name"}</p>
                {usernameStatus.checking ? <p className="text-white/45">Checking username...</p> : null}
                {!usernameStatus.checking && usernameStatus.error ? <p className="text-rose-300">{usernameStatus.error}</p> : null}
                {!usernameStatus.checking && !usernameStatus.error && usernameStatus.available ? (
                  <p className="text-emerald-300">Username available.</p>
                ) : null}
                {!usernameStatus.checking &&
                !usernameStatus.available &&
                usernameStatus.suggestion &&
                usernameStatus.suggestion !== normalizedUsername ? (
                  <button
                    type="button"
                    onClick={() => {
                      setUsernameDirty(true);
                      setUsername(usernameStatus.suggestion ?? "");
                    }}
                    className="text-left text-cyan-200 hover:text-cyan-100"
                  >
                    Try @{usernameStatus.suggestion}
                  </button>
                ) : null}
              </div>
            </div>

            {/* Country + City */}
            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label className="ml-1 text-xs font-semibold uppercase tracking-wider text-white/70">Country</label>
                <div className="mt-2 sm:hidden">
                  <SearchableMobileSelect
                    label="Country"
                    value={country}
                    options={countryNames}
                    placeholder="Select country..."
                    searchPlaceholder="Search countries..."
                    onSelect={(nextCountry) => {
                      setCountry(nextCountry);
                      setCity("");
                    }}
                    buttonClassName="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-left text-sm text-[#E0E0E0] outline-none"
                  />
                </div>
                <select
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value);
                    setCity("");
                  }}
                  className="mt-2 hidden w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 sm:block"
                >
                  <option value="" disabled>
                    Select country…
                  </option>
                  {countryNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="ml-1 text-xs font-semibold uppercase tracking-wider text-white/70">City</label>
                <div className="mt-2 sm:hidden">
                  <SearchableMobileSelect
                    label="City"
                    value={city}
                    options={cityNames}
                    placeholder={!country ? "Select country first" : loadingCities ? "Loading cities..." : "Select or search city"}
                    searchPlaceholder="Search cities..."
                    disabled={!country}
                    allowCustomValue={Boolean(country)}
                    customValueLabel={(value) => `Use "${value}"`}
                    emptyMessage={!country ? "Choose a country first." : loadingCities ? "Loading cities..." : "No cities found."}
                    onSelect={(nextCity) => setCity(nextCity)}
                    buttonClassName="w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-left text-sm text-[#E0E0E0] outline-none disabled:opacity-50"
                  />
                </div>
                {country && cityNames.length === 0 ? (
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder={loadingCities ? "Loading cities..." : "Type your city…"}
                    className="mt-2 hidden w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 sm:block"
                  />
                ) : (
                  <select
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={!country}
                    className="mt-2 hidden w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:opacity-50 sm:block"
                  >
                    <option value="" disabled>
                      {!country ? "Select country first" : "Select city…"}
                    </option>
                    {cityNames.map((n, idx) => (
                      <option key={`${n}-${idx}`} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Gender (optional, friendly) */}
        <div className="pt-2">
          <div className="flex items-end justify-between">
            <label className="ml-1 text-xs font-semibold uppercase tracking-wider text-white/70">Gender</label>
            <span className="text-[10px] text-white/40">Optional · used for hosting matches</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GENDER_OPTIONS.map((option) => {
              const active = gender === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setGender(option.value)}
                  className={[
                    "rounded-2xl border px-3 py-3 text-center text-[13px] font-semibold transition",
                    active
                      ? "border-[#00F5FF] bg-black/30 text-white shadow-[0_0_14px_rgba(0,245,255,0.18)]"
                      : "border-white/10 bg-black/20 text-white/70 hover:border-white/25 hover:text-white",
                  ].join(" ")}
                  aria-pressed={active}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Roles (multi-select) */}
        <div className="pt-2">
          <div className="flex items-end justify-between">
            <label className="ml-1 text-xs font-semibold uppercase tracking-wider text-white/70">Your Roles</label>
            <span className="text-[10px] text-white/40">Select one or more</span>
          </div>

          <div
            className="relative mt-3"
          >
            <div
              className="flex gap-3 overflow-x-auto pb-2 pl-0 pr-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:pr-10"
              ref={rolesScrollRef}
              onScroll={updateScrollButtons}
            >
              {ROLES.map((r) => {
                const active = roles.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRole(r)}
                    className={[
                      "shrink-0 w-[82%] sm:w-[55%] md:w-[42%] lg:w-[30%] rounded-2xl border px-4 py-4 text-left transition",
                      active
                        ? "border-[#00F5FF] bg-black/30 shadow-[0_0_18px_rgba(0,245,255,0.18)]"
                        : "border-white/10 bg-black/20 hover:border-white/20",
                    ].join(" ")}
                  >
                    <div className={active ? "text-[#00F5FF] font-extrabold" : "text-white/70 font-bold"}>{r}</div>
                    <div className={active ? "mt-1 text-[11px] text-white/70" : "mt-1 text-[11px] text-white/40"}>
                      {active ? "Selected" : "Tap to select"}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Clickable scroll buttons */}
            {canScrollLeft ? (
              <button
                type="button"
                aria-label="Scroll roles left"
                onClick={() => scrollRolesBy(-320)}
                className="absolute left-[-18px] top-1/2 hidden -translate-y-1/2 text-white/60 transition hover:text-white lg:block"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/30 border border-white/10">&lt;</span>
              </button>
            ) : null}
            {canScrollRight ? (
              <button
                type="button"
                aria-label="Scroll roles right"
                onClick={() => scrollRolesBy(320)}
                className="absolute right-0 top-1/2 hidden -translate-y-1/2 text-white/60 transition hover:text-white lg:block"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/30 border border-white/10">&gt;</span>
              </button>
            ) : null}
          </div>
        </div>

        {roles.length > 0 && (
          <div className="-mt-2 text-[11px] text-white/50">
            Selected: <span className="text-white/80">{roles.join(", ")}</span>
          </div>
        )}

        {/* Continue */}
        <button
          type="button"
          disabled={!canContinue || uploading}
          onClick={() => {
            writeOnboardingDraft({ displayName, username: normalizedUsername, country, city, roles, avatarDataUrl: avatarPreviewUrl, avatarPath, avatarStatus });
            router.push("/onboarding/interests");
          }}
          className={[
            "mt-2 w-full rounded-2xl py-4 font-black uppercase tracking-wide transition",
            canContinue && !uploading
              ? "text-[#0A0A0A] shadow-[0_0_22px_rgba(0,245,255,0.18)]"
              : "bg-white/10 text-white/40 cursor-not-allowed",
          ].join(" ")}
          style={
            canContinue && !uploading ? { backgroundImage: "linear-gradient(90deg, #00F5FF 0%, #FF00FF 100%)" } : undefined
          }
        >
          Continue to step 2
        </button>
      </div>

      {cropSource ? (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/88 px-4 py-4 sm:items-center"
          onClick={() => { setCropSource(null); setCropNaturalSize(null); setCropError(null); }}
        >
          <div
            className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/15 bg-[#0b1418] shadow-[0_20px_50px_rgba(0,0,0,0.55)] sm:max-h-[min(92dvh,860px)] sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-h-0 overflow-y-auto overscroll-contain p-5">
              <h3 className="text-lg font-bold text-white">Crop photo</h3>
              <p className="mt-1 text-sm text-slate-300">Adjust zoom and position, then confirm your profile photo.</p>

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
                    alt="Crop preview"
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
                  onChange={(e) => setCropZoom(Number(e.target.value))}
                  className="mt-2 w-full"
                />
                <label className="block text-sm font-medium text-slate-300">Horizontal position</label>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={Math.round(cropPanX * 100)}
                  onChange={(e) => setCropPanX(Number(e.target.value) / 100)}
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
                  onChange={(e) => setCropPanY(Number(e.target.value) / 100)}
                  className="w-full"
                  disabled={!cropPreview || cropPreview.maxOffsetY === 0}
                />
              </div>

              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setCropSource(null); setCropNaturalSize(null); setCropError(null); }}
                  className="rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-medium text-white/85 hover:bg-white/[0.08]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void confirmCropUpload(); }}
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
    </OnboardingShell>
  );
}
