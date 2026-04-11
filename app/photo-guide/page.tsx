"use client";

import Link from "next/link";
import Nav from "@/components/Nav";

const COVER_REQUIREMENTS = [
  { icon: "aspect_ratio", label: "Dimensions", detail: "1200 × 628 px recommended (roughly 2:1 ratio)" },
  { icon: "photo_size_select_large", label: "File size", detail: "Under 5 MB — JPG or PNG" },
  { icon: "light_mode", label: "Lighting", detail: "Well-lit, not dark or heavily filtered" },
  { icon: "crop_free", label: "Safe zone", detail: "Keep text and key subjects away from the edges" },
  { icon: "no_adult_content", label: "Content", detail: "No explicit content, logos of other platforms, or watermarks" },
  { icon: "hd", label: "Quality", detail: "Sharp and in focus — avoid pixelated or stretched images" },
];

const PROFILE_REQUIREMENTS = [
  { icon: "face", label: "Face visible", detail: "Your face should be clearly visible and centred" },
  { icon: "aspect_ratio", label: "Dimensions", detail: "Square crop (1:1) — 400 × 400 px minimum" },
  { icon: "light_mode", label: "Lighting", detail: "Well-lit, no heavy shadows across the face" },
  { icon: "person", label: "Solo shot", detail: "Just you — not a group photo where it's unclear who you are" },
  { icon: "hd", label: "Quality", detail: "Recent, sharp photo — no blurry or pixelated images" },
  { icon: "no_adult_content", label: "Content", detail: "No explicit content or offensive imagery" },
];

const COVER_EXAMPLES = [
  {
    label: "Dance event on a stage",
    description: "Wide shot of dancers performing under stage lighting. The event name is centred with strong contrast against a dark background. Safe zones are respected on all sides.",
    good: true,
  },
  {
    label: "Festival crowd at golden hour",
    description: "Aerial or wide shot of a festival crowd with warm golden-hour light. The atmosphere is immediately visible. No text is clipped at the edges.",
    good: true,
  },
  {
    label: "Branded event flyer adapted for cover",
    description: "A clean, minimal event flyer cropped to 2:1. Event name, date, and location are readable. Background has enough contrast for legible text.",
    good: true,
  },
  {
    label: "Dark, blurry club photo",
    description: "A low-light photo taken on a phone in a dark venue. Faces are barely visible and details are lost. This makes the event look low quality.",
    good: false,
  },
  {
    label: "Portrait photo used as cover",
    description: "A single face centred in a portrait (9:16) image stretched to fit the 2:1 cover ratio. The subject appears distorted and cropped awkwardly.",
    good: false,
  },
  {
    label: "Screenshot from another platform",
    description: "A cropped screenshot from Instagram or Facebook with another platform's UI visible. This looks unprofessional and may include a watermark.",
    good: false,
  },
];

export default function PhotoGuidePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-100">
      <Nav />

      <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6">

        {/* Hero */}
        <div className="mb-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80">Photo guide</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Cover &amp; profile photo requirements
          </h1>
          <p className="mt-3 text-base text-slate-400">
            Great photos make your event and profile more trustworthy and appealing.
            Follow these guidelines so your photo passes review automatically.
          </p>
        </div>

        {/* Cover photo requirements */}
        <section className="mb-10 rounded-2xl border border-white/10 bg-[#111] p-6">
          <div className="mb-5 flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-cyan-300">image</span>
            <h2 className="text-lg font-bold text-white">Event cover photo</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {COVER_REQUIREMENTS.map((r) => (
              <div key={r.label} className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-cyan-300">{r.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-white">{r.label}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{r.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Cover examples */}
        <section className="mb-10">
          <h2 className="mb-4 text-base font-bold text-white">Cover photo examples</h2>
          <div className="space-y-3">
            {COVER_EXAMPLES.map((ex) => (
              <div
                key={ex.label}
                className={[
                  "flex items-start gap-4 rounded-xl border px-4 py-4",
                  ex.good
                    ? "border-emerald-400/20 bg-emerald-500/[0.06]"
                    : "border-rose-400/20 bg-rose-500/[0.06]",
                ].join(" ")}
              >
                <span
                  className={[
                    "material-symbols-outlined mt-0.5 shrink-0 text-[20px]",
                    ex.good ? "text-emerald-400" : "text-rose-400",
                  ].join(" ")}
                >
                  {ex.good ? "check_circle" : "cancel"}
                </span>
                <div>
                  <p className={["text-sm font-semibold", ex.good ? "text-emerald-200" : "text-rose-200"].join(" ")}>
                    {ex.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">{ex.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Aspect ratio visual guide */}
        <section className="mb-10 rounded-2xl border border-white/10 bg-[#111] p-6">
          <h2 className="mb-4 text-base font-bold text-white">Aspect ratio at a glance</h2>
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            {/* Cover 2:1 */}
            <div className="w-full sm:w-64">
              <div className="relative flex h-32 w-full items-center justify-center rounded-xl border-2 border-dashed border-cyan-400/40 bg-cyan-400/5">
                <div className="absolute inset-2 rounded-lg border border-cyan-300/20 bg-cyan-300/5" />
                <span className="relative text-xs font-semibold text-cyan-300">1200 × 628</span>
              </div>
              <p className="mt-2 text-center text-xs text-slate-400">Event cover (2:1)</p>
            </div>

            {/* Profile 1:1 */}
            <div className="w-32">
              <div className="relative flex h-32 w-32 items-center justify-center rounded-full border-2 border-dashed border-fuchsia-400/40 bg-fuchsia-400/5">
                <div className="absolute inset-2 rounded-full border border-fuchsia-300/20 bg-fuchsia-300/5" />
                <span className="relative text-xs font-semibold text-fuchsia-300">400 × 400</span>
              </div>
              <p className="mt-2 text-center text-xs text-slate-400">Profile (1:1)</p>
            </div>

            <div className="flex-1 text-sm text-slate-400 sm:pl-2">
              <p className="font-semibold text-white">Tip</p>
              <p className="mt-1">
                Use image editors like{" "}
                <span className="font-medium text-slate-200">Canva</span>,{" "}
                <span className="font-medium text-slate-200">Adobe Express</span>, or{" "}
                <span className="font-medium text-slate-200">Figma</span> to crop your photo
                to the correct ratio before uploading.
              </p>
            </div>
          </div>
        </section>

        {/* Profile photo requirements */}
        <section className="mb-10 rounded-2xl border border-white/10 bg-[#111] p-6">
          <div className="mb-5 flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-fuchsia-300">account_circle</span>
            <h2 className="text-lg font-bold text-white">Profile photo</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {PROFILE_REQUIREMENTS.map((r) => (
              <div key={r.label} className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-fuchsia-300">{r.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-white">{r.label}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{r.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Review process note */}
        <section className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] p-5">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-amber-300">info</span>
            <div>
              <p className="text-sm font-semibold text-amber-200">Under review</p>
              <p className="mt-1 text-sm text-slate-400">
                Photos from new accounts are reviewed before becoming publicly visible.
                If your photo doesn&apos;t meet the guidelines above, you&apos;ll receive a message
                with instructions to upload a replacement. Most reviews complete within 24 hours.
              </p>
              <Link
                href="/events/new"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-300 hover:text-cyan-200"
              >
                <span className="material-symbols-outlined text-[16px]">add_circle</span>
                Create an event
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
