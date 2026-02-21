"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Country, City } from "country-state-city";
import { useRouter } from "next/navigation";
import OnboardingShell from "@/components/OnboardingShell";
import { readOnboardingDraft, writeOnboardingDraft } from "@/lib/onboardingDraft";
import { supabase } from "@/lib/supabase/client";

const ROLES = [
  "Social dancer / Student",
  "Organizer",
  "Studio Owner",
  "Promoter",
  "DJ",
  "Artist",
  "Teacher",
] as const;

type Role = (typeof ROLES)[number];

export default function OnboardingProfilePage() {
  const router = useRouter();

  const countriesAll = useMemo(() => Country.getAllCountries(), []);
  const countryNames = useMemo(() => countriesAll.map((c) => c.name), [countriesAll]);

  const [meId, setMeId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);

  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | undefined>(undefined);
  const [avatarStatus, setAvatarStatus] = useState<"pending" | "approved" | "rejected" | undefined>(undefined);
  const [avatarPath, setAvatarPath] = useState<string | undefined>(undefined);
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
      setMeId(user.id);

      const d = readOnboardingDraft();
      if (typeof d.displayName === "string") setDisplayName(d.displayName);
      if (typeof d.country === "string") setCountry(d.country);
      if (typeof d.city === "string") setCity(d.city);
      if (Array.isArray(d.roles)) setRoles(d.roles.filter(Boolean) as Role[]);
      if (typeof d.avatarDataUrl === "string" && d.avatarDataUrl) setAvatarPreviewUrl(d.avatarDataUrl);
      if (typeof d.avatarPath === "string") setAvatarPath(d.avatarPath);
      if (typeof d.avatarStatus === "string") setAvatarStatus(d.avatarStatus);

      setHydrated(true);
      // After hydration, compute arrow visibility
      window.setTimeout(updateScrollButtons, 0);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist draft as user types/selects
  useEffect(() => {
    if (!hydrated) return;
    writeOnboardingDraft({
      displayName,
      country,
      city,
      roles,
      avatarDataUrl: avatarPreviewUrl,
      avatarPath,
      avatarStatus,
    });
  }, [hydrated, displayName, country, city, roles, avatarPreviewUrl, avatarPath, avatarStatus]);

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

  function onPickPhotoClick() {
    fileInputRef.current?.click();
  }

  async function onPhotoSelected(file: File | null) {
    if (!file) return;

    setError(null);

    if (!meId) {
      setError("Please sign in again.");
      router.replace("/auth");
      return;
    }

    setUploading(true);

    try {
      if (!file.type.startsWith("image/")) throw new Error("Please upload an image.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Max size is 5MB.");

      // IMPORTANT: Use a PRIVATE bucket in Supabase (set the bucket visibility to private).
      // Keep the bucket name as "avatars" if you already have it, just make it private.
      const bucket = "avatars";

      const ext = file.name.split(".").pop() || "jpg";
      const path = `${meId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      // Create a short-lived signed URL for preview (works with private buckets)
      const { data: signed, error: signErr } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
      if (signErr) throw signErr;

      const signedUrl = signed?.signedUrl;
      if (!signedUrl) throw new Error("Could not generate preview URL.");

      setAvatarPath(path);
      setAvatarStatus("pending");
      setAvatarPreviewUrl(signedUrl);

      writeOnboardingDraft({
        avatarPath: path,
        avatarStatus: "pending",
        avatarDataUrl: signedUrl,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const iso = countriesAll.find((c) => c.name === country)?.isoCode ?? "";
  const cityNames = useMemo(() => {
    if (!iso) return [];
    return (City.getCitiesOfCountry(iso) ?? []).map((c) => c.name);
  }, [iso]);

  const canContinue =
    displayName.trim().length >= 2 && country.trim().length >= 2 && city.trim().length >= 1 && roles.length > 0;

  return (
    <OnboardingShell step={1} title="Setup your profile" subtitle={""}>
      <div className="mt-6 space-y-6">
        {error ? (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        {/* Photo + Display name (same row) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-start">
          <div className="sm:col-span-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPhotoSelected(e.target.files?.[0] ?? null)}
            />

            <button
              type="button"
              onClick={onPickPhotoClick}
              className="group flex h-44 w-44 sm:h-48 sm:w-48 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/15 hover:border-[#00F5FF]/60 transition overflow-hidden"
              title="Add photo"
            >
              {avatarPreviewUrl ? (
                <div className="relative h-full w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={avatarPreviewUrl} alt="Selected avatar preview" className="h-full w-full object-cover" />
                  {avatarStatus === "pending" ? (
                    <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/80 border border-white/10">
                      Pending approval
                    </span>
                  ) : null}
                </div>
              ) : (
                <>
                  <div
                    className="text-transparent bg-clip-text"
                    style={{ backgroundImage: "linear-gradient(90deg, #00F5FF 0%, #FF00FF 100%)" }}
                  >
                    <span className="text-3xl">+</span>
                  </div>
                  <span className="mt-1 text-[10px] font-bold text-white/60 group-hover:text-white/80">
                    {uploading ? "UPLOADING…" : "ADD PHOTO"}
                  </span>
                </>
              )}
            </button>
          </div>

          <div className="sm:col-span-8">
            <label className="ml-1 text-xs font-semibold uppercase tracking-wider text-white/70">Display Name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Maria Dance"
              className="mt-2 w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
            />

            {/* Country + City */}
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="ml-1 text-xs font-semibold uppercase tracking-wider text-white/70">Country</label>
                <select
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value);
                    setCity("");
                  }}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30"
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
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  disabled={!country || cityNames.length === 0}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-[#E0E0E0] outline-none focus:border-[#00F5FF]/60 focus:ring-1 focus:ring-[#00F5FF]/30 disabled:opacity-50"
                >
                  <option value="" disabled>
                    {!country ? "Select country first" : cityNames.length === 0 ? "No cities found" : "Select city…"}
                  </option>
                  {cityNames.map((n, idx) => (
                    <option key={`${n}-${idx}`} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
              className="flex gap-3 overflow-x-auto pb-2 pl-0 pr-10 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                      "shrink-0 w-[70%] sm:w-[45%] md:w-[30%] rounded-2xl px-4 py-4 text-left transition border",
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
                className="absolute left-[-18px] top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/30 border border-white/10">&lt;</span>
              </button>
            ) : null}
            {canScrollRight ? (
              <button
                type="button"
                aria-label="Scroll roles right"
                onClick={() => scrollRolesBy(320)}
                className="absolute right-0 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition"
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
            writeOnboardingDraft({ displayName, country, city, roles, avatarDataUrl: avatarPreviewUrl, avatarPath, avatarStatus });
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
          Continue to Step 2
        </button>
      </div>
    </OnboardingShell>
  );
}
