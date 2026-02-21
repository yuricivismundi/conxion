"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";

type EventLinkDraft = {
  label: string;
  url: string;
  type: string;
};

const MAX_COVER_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_COVER_MIME = ["image/jpeg", "image/png", "image/webp"];

function fileExtension(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName) return fromName;
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function toIsoOrNull(localDateTime: string) {
  if (!localDateTime) return null;
  const parsed = new Date(localDateTime);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function todayLocalDateTimeValue() {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const min = pad(now.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function plusHoursLocalDateTimeValue(hours: number) {
  const now = new Date();
  const next = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const pad = (v: number) => String(v).padStart(2, "0");
  const yyyy = next.getFullYear();
  const mm = pad(next.getMonth() + 1);
  const dd = pad(next.getDate());
  const hh = pad(next.getHours());
  const min = pad(next.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export default function CreateEventPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("Social");
  const [stylesInput, setStylesInput] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState(todayLocalDateTimeValue());
  const [endsAtLocal, setEndsAtLocal] = useState(plusHoursLocalDateTimeValue(3));
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [hasCapacity, setHasCapacity] = useState(false);
  const [capacity, setCapacity] = useState<number | "">("");
  const [links, setLinks] = useState<EventLinkDraft[]>([{ label: "Tickets", url: "", type: "tickets" }]);
  const [statusMode, setStatusMode] = useState<"published" | "draft">("published");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData.user) {
        router.replace("/auth");
        return;
      }
      setMeId(authData.user.id);

      const [{ data: sessionData }, profileRes] = await Promise.all([
        supabase.auth.getSession(),
        supabase.from("profiles").select("city,country").eq("user_id", authData.user.id).maybeSingle(),
      ]);

      if (cancelled) return;

      setAccessToken(sessionData.session?.access_token ?? null);
      if (profileRes.data) {
        const profileRow = profileRes.data as Record<string, unknown>;
        if (typeof profileRow.city === "string") setCity(profileRow.city);
        if (typeof profileRow.country === "string") setCountry(profileRow.country);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const isValidWindow = useMemo(() => {
    const start = toIsoOrNull(startsAtLocal);
    const end = toIsoOrNull(endsAtLocal);
    return Boolean(start && end && start < end);
  }, [endsAtLocal, startsAtLocal]);

  async function onPickCover(file: File | null) {
    if (!file) return;
    if (!meId) {
      setError("Missing user session. Please sign in again.");
      return;
    }

    setError(null);
    setUploadingCover(true);
    try {
      if (!ALLOWED_COVER_MIME.includes(file.type)) {
        throw new Error("Cover must be JPG, PNG, or WEBP.");
      }
      if (file.size > MAX_COVER_SIZE_BYTES) {
        throw new Error("Max cover size is 5MB.");
      }

      const ext = fileExtension(file);
      const path = `${meId}/event-cover-${crypto.randomUUID()}.${ext}`;
      const bucket = "avatars";

      const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      const publicUrl = data.publicUrl;
      if (!publicUrl) throw new Error("Could not resolve cover URL.");

      setCoverUrl(publicUrl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Cover upload failed.");
    } finally {
      setUploadingCover(false);
    }
  }

  async function submitEvent() {
    if (!accessToken) {
      setError("Missing auth session. Please sign in again.");
      return;
    }
    if (uploadingCover) {
      setError("Please wait for cover upload to finish.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const startsAt = toIsoOrNull(startsAtLocal);
    const endsAt = toIsoOrNull(endsAtLocal);

    if (!title.trim() || !city.trim() || !country.trim() || !startsAt || !endsAt) {
      setSubmitting(false);
      setError("Title, location, and valid start/end date-time are required.");
      return;
    }
    if (startsAt >= endsAt) {
      setSubmitting(false);
      setError("Event end time must be after start time.");
      return;
    }

    const cleanedLinks = links
      .map((item) => ({
        label: item.label.trim() || "Link",
        url: item.url.trim(),
        type: item.type.trim() || "link",
      }))
      .filter((item) => item.url);
    const styles = stylesInput
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)
      .slice(0, 12);

    const response = await fetch("/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        eventType,
        styles,
        visibility,
        city: city.trim(),
        country: country.trim(),
        venueName: venueName.trim(),
        venueAddress: venueAddress.trim(),
        startsAt,
        endsAt,
        capacity: hasCapacity && typeof capacity === "number" ? capacity : null,
        coverUrl: coverUrl.trim(),
        links: cleanedLinks,
        status: statusMode,
      }),
    });

    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; event_id?: string } | null;
    if (!response.ok || !json?.ok || !json.event_id) {
      setSubmitting(false);
      setError(json?.error ?? "Failed to create event.");
      return;
    }

    if (statusMode === "published") {
      router.push(`/events/published?event=${encodeURIComponent(json.event_id)}`);
      return;
    }

    router.push(`/events/${json.event_id}`);
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#071316] text-white">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#10272b,_#071316_45%,_#05090b_100%)] text-slate-100">
      <Nav />

      <main className="mx-auto w-full max-w-[980px] px-4 pb-24 pt-7 sm:px-6 lg:px-8">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Create Event</h1>
          <p className="mt-2 text-slate-300">Publish a trusted ConXion event with controlled access.</p>
        </header>

        {error ? (
          <div className="mb-5 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <div className="space-y-8 rounded-3xl border border-white/10 bg-[#0b1a1d]/75 p-6 sm:p-8">
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white">Essentials</h2>
            <div className="grid gap-4">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Event Title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Midnight Salsa Social"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Event Type</span>
                  <select
                    value={eventType}
                    onChange={(event) => setEventType(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white focus:border-cyan-300/35 focus:outline-none"
                  >
                    <option value="Social">Social</option>
                    <option value="Workshop">Workshop</option>
                    <option value="Festival">Festival</option>
                    <option value="Masterclass">Masterclass</option>
                    <option value="Competition">Competition</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Visibility</span>
                  <div className="inline-flex w-full rounded-xl border border-white/10 bg-black/20 p-1">
                    <button
                      type="button"
                      onClick={() => setVisibility("public")}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                        visibility === "public" ? "bg-cyan-300 text-[#062328]" : "text-slate-300 hover:text-white"
                      }`}
                    >
                      Public
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibility("private")}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                        visibility === "private" ? "bg-cyan-300 text-[#062328]" : "text-slate-300 hover:text-white"
                      }`}
                    >
                      Private
                    </button>
                  </div>
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Styles</span>
                <input
                  value={stylesInput}
                  onChange={(event) => setStylesInput(event.target.value)}
                  placeholder="e.g. bachata, salsa, zouk"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
                <p className="text-xs text-slate-500">Comma-separated tags, up to 12.</p>
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white">When & Where</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">City</span>
                <input
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Country</span>
                <input
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Venue Name</span>
                <input
                  value={venueName}
                  onChange={(event) => setVenueName(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Venue Address</span>
                <input
                  value={venueAddress}
                  onChange={(event) => setVenueAddress(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Starts</span>
                <input
                  type="datetime-local"
                  value={startsAtLocal}
                  onChange={(event) => setStartsAtLocal(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white focus:border-cyan-300/35 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Ends</span>
                <input
                  type="datetime-local"
                  value={endsAtLocal}
                  onChange={(event) => setEndsAtLocal(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white focus:border-cyan-300/35 focus:outline-none"
                />
              </label>
            </div>
            {!isValidWindow ? (
              <p className="text-sm text-amber-200">End date-time must be after start date-time.</p>
            ) : null}
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white">Details</h2>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
                placeholder="Tell people what makes your event special..."
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
              />
            </label>
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Event Cover</span>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  void onPickCover(event.target.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
              />

              <div className="rounded-2xl border border-dashed border-white/20 bg-black/20 p-4">
                {coverUrl ? (
                  <div className="space-y-3">
                    <div className="relative h-48 overflow-hidden rounded-xl border border-white/10 bg-[#10242a]">
                      <img src={coverUrl} alt="Event cover preview" className="h-full w-full object-cover" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/25"
                      >
                        {uploadingCover ? "Uploading..." : "Change cover"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCoverUrl("")}
                        className="rounded-full border border-white/20 bg-black/25 px-4 py-1.5 text-xs font-semibold text-slate-200 hover:bg-black/35"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
                      <span className="material-symbols-outlined text-2xl text-slate-300">add_photo_alternate</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Upload event cover</p>
                      <p className="text-xs text-slate-400">JPG, PNG, or WEBP up to 5MB</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/25"
                    >
                      {uploadingCover ? "Uploading..." : "Choose image"}
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Cover images are reviewed by admins before they appear publicly.
              </p>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Limit attendees</p>
                  <p className="text-xs text-slate-400">Set max capacity (1 to 2000)</p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={hasCapacity}
                    onChange={(event) => setHasCapacity(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-transparent accent-cyan-300"
                  />
                  <span className="text-slate-300">Enable</span>
                </label>
              </div>
              <input
                type="number"
                min={1}
                max={2000}
                value={capacity}
                onChange={(event) => setCapacity(event.target.value ? Number(event.target.value) : "")}
                disabled={!hasCapacity}
                placeholder="Enter max capacity"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-slate-500 disabled:opacity-50"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">External Links</p>
              {links.map((link, index) => (
                <div key={`event-link-${index}`} className="grid gap-2 sm:grid-cols-[1fr,1fr,180px,auto]">
                  <input
                    value={link.label}
                    onChange={(event) => {
                      setLinks((prev) => prev.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)));
                    }}
                    placeholder="Label"
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  />
                  <input
                    value={link.url}
                    onChange={(event) => {
                      setLinks((prev) => prev.map((item, i) => (i === index ? { ...item, url: event.target.value } : item)));
                    }}
                    placeholder="https://..."
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  />
                  <input
                    value={link.type}
                    onChange={(event) => {
                      setLinks((prev) => prev.map((item, i) => (i === index ? { ...item, type: event.target.value } : item)));
                    }}
                    placeholder="tickets"
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => setLinks((prev) => prev.filter((_, i) => i !== index))}
                    className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/20"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLinks((prev) => [...prev, { label: "Link", url: "", type: "link" }])}
                className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-1.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20"
              >
                + Add link
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-white">Publishing</h2>
            <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
              <button
                type="button"
                onClick={() => setStatusMode("published")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                  statusMode === "published" ? "bg-cyan-300 text-[#052328]" : "text-slate-300"
                }`}
              >
                Publish now
              </button>
              <button
                type="button"
                onClick={() => setStatusMode("draft")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                  statusMode === "draft" ? "bg-cyan-300 text-[#052328]" : "text-slate-300"
                }`}
              >
                Save as draft
              </button>
            </div>
          </section>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#071316]/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[980px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <Link href="/events" className="text-sm text-slate-400 hover:text-white">
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => void submitEvent()}
              disabled={submitting || uploadingCover}
              className="rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400 px-7 py-2.5 text-sm font-bold text-[#052328] hover:opacity-95 disabled:opacity-60"
            >
              {submitting ? "Saving..." : uploadingCover ? "Uploading cover..." : statusMode === "published" ? "Publish Event" : "Save Draft"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
