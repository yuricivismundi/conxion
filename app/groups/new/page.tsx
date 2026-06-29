"use client";
/* eslint-disable @next/next/no-img-element */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import EventCoverCropDialog from "@/components/events/EventCoverCropDialog";
import SearchableMobileSelect from "@/components/SearchableMobileSelect";
import {
  getCachedCitiesOfCountry,
  getCachedCountriesAll,
  getCitiesOfCountry,
  getCountriesAll,
  type CountryEntry,
} from "@/lib/country-city-client";
import { PRIVATE_GROUP_CHAT_MODE_OPTIONS, type EventChatMode } from "@/lib/events/access";
import { validateEventCoverSourceFile } from "@/lib/events/cover-upload";
import { supabase } from "@/lib/supabase/client";

const MIN_TITLE_LENGTH = 8;
const MAX_TITLE_LENGTH = 50;
const MIN_DESCRIPTION_LENGTH = 24;
const MAX_DESCRIPTION_LENGTH = 4000;

function resolveCountryEntry(countries: CountryEntry[], value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return (
    countries.find((e) => e.name.trim().toLowerCase() === normalized) ??
    countries.find((e) => e.isoCode.trim().toLowerCase() === normalized) ??
    null
  );
}

export default function CreateGroupPage() {
  return (
    <Suspense>
      <CreateGroupForm />
    </Suspense>
  );
}

function CreateGroupForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  // Form fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [chatMode, setChatMode] = useState<EventChatMode>("discussion");
  const [coverUrl, setCoverUrl] = useState("");
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // Location (optional)
  const [countriesAll, setCountriesAll] = useState<CountryEntry[]>(() => getCachedCountriesAll());
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const countryNames = useMemo(() => countriesAll.map((e) => e.name), [countriesAll]);
  const selectedCountryEntry = useMemo(() => resolveCountryEntry(countriesAll, country), [countriesAll, country]);
  const selectedCountryIso = selectedCountryEntry?.isoCode ?? "";
  const cityMenuOptions = useMemo(() => cityOptions.slice(0, 500), [cityOptions]);

  const canCreate = useMemo(() => {
    const t = title.trim();
    const d = description.trim();
    return t.length >= MIN_TITLE_LENGTH && t.length <= MAX_TITLE_LENGTH &&
      d.length >= MIN_DESCRIPTION_LENGTH && d.length <= MAX_DESCRIPTION_LENGTH;
  }, [title, description]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr || !authData.user) { router.replace("/auth"); return; }
        setMeId(authData.user.id);
        const { data: sessionData } = await supabase.auth.getSession();
        if (cancelled) return;
        setAccessToken(sessionData.session?.access_token ?? null);
        if (countriesAll.length === 0) {
          const fetched = await getCountriesAll();
          if (!cancelled && fetched.length > 0) setCountriesAll(fetched);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load form.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [countriesAll.length, router]);

  useEffect(() => {
    if (!selectedCountryIso) { setCityOptions([]); setLoadingCities(false); return; }
    const cached = getCachedCitiesOfCountry(selectedCountryIso);
    if (cached.length) { setCityOptions(cached); setLoadingCities(false); return; }
    setLoadingCities(true);
    let cancelled = false;
    (async () => {
      try {
        const fetched = await getCitiesOfCountry(selectedCountryIso);
        if (!cancelled) { setCityOptions(fetched); setLoadingCities(false); }
      } catch {
        if (!cancelled) {
          const c = getCachedCitiesOfCountry(selectedCountryIso);
          setCityOptions(c.length ? c : []);
          setLoadingCities(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCountryIso]);

  async function onPickCover(file: File | null) {
    if (!file || !meId) return;
    setError(null);
    try {
      validateEventCoverSourceFile(file);
      setPendingCoverFile(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cover upload failed.");
    }
  }

  async function uploadPreparedCover(preparedFile: File) {
    if (!meId) throw new Error("Missing user session.");
    setError(null);
    setUploadingCover(true);
    try {
      if (!accessToken) throw new Error("Missing auth session. Please sign in again.");
      const formData = new FormData();
      formData.append("file", preparedFile);
      formData.append("prefix", "group-cover");
      const res = await fetch("/api/uploads/cover", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      const json = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!json.ok || !json.url) throw new Error(json.error ?? "Cover upload failed.");
      setCoverUrl(json.url);
      setPendingCoverFile(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Cover upload failed.";
      setError(msg);
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      setUploadingCover(false);
    }
  }

  async function handleCreate() {
    if (!accessToken) { setError("Missing auth session. Please sign in again."); return; }
    if (uploadingCover) { setError("Please wait for cover upload to finish."); return; }
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (trimmedTitle.length < MIN_TITLE_LENGTH) { setError(`Title must be at least ${MIN_TITLE_LENGTH} characters.`); return; }
    if (trimmedTitle.length > MAX_TITLE_LENGTH) { setError(`Title must be no more than ${MAX_TITLE_LENGTH} characters.`); return; }
    if (trimmedDescription.length < MIN_DESCRIPTION_LENGTH) { setError(`Description must be at least ${MIN_DESCRIPTION_LENGTH} characters.`); return; }
    if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) { setError(`Description must be no more than ${MAX_DESCRIPTION_LENGTH} characters.`); return; }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          chatMode,
          city: city.trim() || null,
          country: country.trim() || null,
          coverUrl: coverUrl.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; group_id?: string } | null;
      if (!res.ok || !json?.ok || !json.group_id) {
        setSubmitting(false);
        setError(json?.error ?? "Failed to create group.");
        return;
      }
      router.push("/activity?tab=groups");
    } catch {
      setSubmitting(false);
      setError("Could not create group. Check your connection and try again.");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05060a] text-white">
        <Nav />
        <main className="mx-auto w-full max-w-[680px] px-4 pb-24 pt-7 sm:px-6">
          <div className="animate-pulse space-y-5">
            <div className="h-12 rounded-2xl bg-white/[0.04]" />
            <div className="h-[500px] rounded-3xl bg-white/[0.04]" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05060a] text-slate-100">
      <Nav />

      {pendingCoverFile ? (
        <EventCoverCropDialog
          file={pendingCoverFile}
          onConfirm={(prepared) => void uploadPreparedCover(prepared)}
          onClose={() => setPendingCoverFile(null)}
        />
      ) : null}

      <main className="mx-auto w-full max-w-[640px] px-4 pb-14 pt-7 sm:px-6">
        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#14161c] shadow-[0_28px_80px_rgba(0,0,0,0.5)]">
          {/* Header row */}
          <div className="flex items-center justify-between px-5 py-4">
            <h1 className="text-xl font-bold text-white">Create Group</h1>
            <button
              type="button"
              onClick={() => router.back()}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-slate-300 hover:bg-white/20"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {/* Cover — flush, full-width */}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { void onPickCover(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }}
          />
          {coverUrl ? (
            <div className="relative h-52 bg-black sm:h-64">
              <img src={coverUrl} alt="Group cover" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <div className="absolute bottom-4 left-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-black/85"
                >
                  <span className="material-symbols-outlined text-[16px]">add_photo_alternate</span>
                  {uploadingCover ? "Uploading..." : "Change photo"}
                </button>
                <button
                  type="button"
                  onClick={() => setCoverUrl("")}
                  className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-black/85"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 bg-[#1e2028] text-center hover:bg-[#22242c]"
            >
              <span className="material-symbols-outlined text-[36px] text-slate-400">add_photo_alternate</span>
              <p className="text-sm font-semibold text-slate-300">{uploadingCover ? "Uploading..." : "Add cover photo"}</p>
            </button>
          )}

          {/* Form body */}
          <div className="space-y-5 px-5 py-6">
            {/* Name & Description */}
            <section data-tour="tour-group-details" className="space-y-3">
              <h2 className="text-lg font-bold text-white">Group Details</h2>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Group Name <span className="text-rose-400">*</span></label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE_LENGTH))}
                  placeholder="e.g. Barcelona bachata practice group"
                  autoComplete="off"
                  autoCapitalize="sentences"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <div className="flex justify-between text-xs">
                  <span className={title.trim().length > 0 && title.trim().length < MIN_TITLE_LENGTH ? "text-amber-300" : "text-slate-500"}>
                    {title.trim().length < MIN_TITLE_LENGTH ? `Min ${MIN_TITLE_LENGTH} chars` : ""}
                  </span>
                  <span className={title.length > MAX_TITLE_LENGTH ? "text-rose-400" : "text-slate-500"}>{title.length}/{MAX_TITLE_LENGTH}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-300">Description <span className="text-rose-400">*</span></label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
                  rows={4}
                  placeholder="Describe what this group is about, who it's for, and what members can expect..."
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <div className="flex justify-between text-xs">
                  <span className={description.trim().length > 0 && description.trim().length < MIN_DESCRIPTION_LENGTH ? "text-amber-300" : "text-slate-500"}>
                    {description.trim().length < MIN_DESCRIPTION_LENGTH ? `Min ${MIN_DESCRIPTION_LENGTH} chars` : ""}
                  </span>
                  <span className={description.length > MAX_DESCRIPTION_LENGTH ? "text-rose-400" : "text-slate-500"}>{description.length}/{MAX_DESCRIPTION_LENGTH}</span>
                </div>
              </div>
            </section>

            {/* Chat Mode */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">Chat Mode</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {PRIVATE_GROUP_CHAT_MODE_OPTIONS.map((option) => {
                  const selected = chatMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setChatMode(option.value)}
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        selected
                          ? "border-cyan-300/30 bg-[linear-gradient(135deg,rgba(0,245,255,0.08),rgba(217,70,239,0.06))] text-white"
                          : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      <p className="text-sm font-semibold">{option.label}</p>
                      <p className="mt-1 text-xs text-slate-400">{option.helper}</p>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-cyan-200/75">Can be changed later from group settings.</p>
            </section>

            {/* Location — optional */}
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-bold text-white">Location <span className="text-sm font-normal text-slate-500">(optional)</span></h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Country</span>
                  <div className="sm:hidden">
                    <SearchableMobileSelect
                      label="Country"
                      value={country}
                      options={countryNames}
                      placeholder="Select country"
                      searchPlaceholder="Search countries..."
                      onSelect={(v) => { setCountry(v); setCity(""); }}
                      buttonClassName="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-white"
                    />
                  </div>
                  <div className="relative hidden sm:block">
                    <select
                      value={country}
                      onChange={(e) => { setCountry(e.target.value); setCity(""); }}
                      className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 pr-11 text-white focus:border-cyan-300/35 focus:outline-none"
                    >
                      <option value="">Select country</option>
                      {countryNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-500">expand_more</span>
                  </div>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">City</span>
                  {selectedCountryIso ? (
                    <>
                      <div className="sm:hidden">
                        <SearchableMobileSelect
                          label="City"
                          value={city}
                          options={cityMenuOptions}
                          placeholder={loadingCities ? "Loading cities..." : cityMenuOptions.length > 0 ? "Select city" : "Select country first"}
                          searchPlaceholder="Search cities..."
                          disabled={!selectedCountryIso}
                          allowCustomValue
                          customValueLabel={(v) => `Use "${v}"`}
                          onSelect={(v) => setCity(v)}
                          buttonClassName="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-white disabled:opacity-55"
                        />
                      </div>
                      <div className="hidden sm:block">
                        {city && city !== "custom" && !cityMenuOptions.includes(city) ? (
                          <input
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                            placeholder="Type city name"
                            autoFocus
                          />
                        ) : (
                          <div className="relative">
                            <select
                              value={city === "custom" ? "custom" : city}
                              onChange={(e) => {
                                if (e.target.value === "custom") setCity("custom");
                                else setCity(e.target.value);
                              }}
                              disabled={!selectedCountryIso || loadingCities}
                              className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 pr-11 text-white focus:border-cyan-300/35 focus:outline-none disabled:opacity-55"
                            >
                              <option value="">{loadingCities ? "Loading cities..." : cityMenuOptions.length > 0 ? "Select city" : "No cities found"}</option>
                              {cityMenuOptions.map((name) => (
                                <option key={name} value={name}>{name}</option>
                              ))}
                              {cityMenuOptions.length > 0 && (
                                <>
                                  <option value="" disabled>───</option>
                                  <option value="custom">Type custom city...</option>
                                </>
                              )}
                            </select>
                            <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-500">expand_more</span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-500">
                      Select country first
                    </div>
                  )}
                </label>
              </div>
            </section>
          </div>

          {/* Footer */}
          <div data-tour="tour-group-create-btn" className="flex items-center justify-between border-t border-white/10 px-5 py-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-sm font-semibold text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!canCreate || submitting || uploadingCover}
              className="rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400 px-7 py-2.5 text-sm font-bold text-[#052328] hover:opacity-95 disabled:opacity-60"
            >
              {submitting ? "Creating..." : "Create Group"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
