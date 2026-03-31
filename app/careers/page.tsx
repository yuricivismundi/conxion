"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import InfoPageShell from "@/components/InfoPageShell";
import {
  AMBASSADOR_CALL_DAY_UTC,
  AMBASSADOR_ROLE_ID,
  CAREER_DAILY_SUBMISSION_LIMIT,
  CAREER_ROLES,
} from "@/lib/careers";

type SubmitState =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const THEME_STYLES: Record<string, string> = {
  "Ambassador Program": "border-amber-300/35 bg-amber-300/10 text-amber-100",
  "Trust Infrastructure": "border-cyan-300/35 bg-cyan-300/10 text-cyan-100",
  "Growth Experience": "border-fuchsia-300/35 bg-fuchsia-400/10 text-fuchsia-100",
  "Network Quality": "border-emerald-300/35 bg-emerald-400/10 text-emerald-100",
  "City Expansion": "border-violet-300/35 bg-violet-400/10 text-violet-100",
  "Brand Storytelling": "border-pink-300/35 bg-pink-400/10 text-pink-100",
  "Event Ecosystem": "border-indigo-300/35 bg-indigo-400/10 text-indigo-100",
};

const DEFAULT_CALENDLY_URL = "https://calendly.com/conxion/ambassador-intro";

function formatUtcDate(value: Date) {
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function CareersPage() {
  const formRef = useRef<HTMLElement | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState(CAREER_ROLES[0]?.id ?? "");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [cvUrl, setCvUrl] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  const isAmbassadorRole = selectedRoleId === AMBASSADOR_ROLE_ID;
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_AMBASSADOR_URL || DEFAULT_CALENDLY_URL;
  const nowUtcDay = new Date().getUTCDay();
  const isAmbassadorCallOpen = nowUtcDay === AMBASSADOR_CALL_DAY_UTC;
  const nextAmbassadorCallDate = useMemo(() => {
    const now = new Date();
    const delta = (AMBASSADOR_CALL_DAY_UTC - now.getUTCDay() + 7) % 7 || 7;
    const next = new Date(now);
    next.setUTCDate(now.getUTCDate() + delta);
    return formatUtcDate(next);
  }, []);

  const selectedRole = useMemo(
    () => CAREER_ROLES.find((role) => role.id === selectedRoleId) ?? CAREER_ROLES[0] ?? null,
    [selectedRoleId]
  );

  const selectedRoleTitle = selectedRole?.title ?? "ConXion Role";
  const teamCount = useMemo(() => new Set(CAREER_ROLES.map((role) => role.team)).size, []);
  const coverLetterLength = coverLetter.trim().length;
  const hasCvInput = Boolean(cvFile || cvUrl.trim());

  const focusApplyForm = (roleId: string) => {
    setSelectedRoleId(roleId);
    setSubmitState({ kind: "idle" });
    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitState({ kind: "idle" });

    try {
      const formData = new FormData();
      formData.set("roleId", selectedRoleId);
      formData.set("fullName", fullName);
      formData.set("email", email);
      formData.set("location", location);
      formData.set("linkedinUrl", linkedinUrl);
      formData.set("portfolioUrl", portfolioUrl);
      formData.set("cvUrl", cvUrl);
      formData.set("coverLetter", coverLetter);
      if (cvFile) {
        formData.set("cvFile", cvFile);
      }

      const response = await fetch("/api/careers/apply", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setSubmitState({
          kind: "error",
          message: payload?.error ?? "Unable to submit your application right now.",
        });
        setIsSubmitting(false);
        return;
      }

      setSubmitState({
        kind: "success",
        message: `Application sent for ${selectedRoleTitle}. Our team will review it and contact you by email.`,
      });
      setCvUrl("");
      setCvFile(null);
      setCoverLetter("");
    } catch {
      setSubmitState({ kind: "error", message: "Network error. Please retry in a moment." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <InfoPageShell
      title="Careers at ConXion"
      description="Build trust-first products for dancers worldwide. Explore open roles and submit your CV with a focused cover letter."
    >
      <section className="overflow-hidden rounded-3xl border border-cyan-300/25 bg-[linear-gradient(135deg,rgba(13,242,242,0.12),rgba(219,39,119,0.12),rgba(255,255,255,0.02))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.3)] sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_320px] lg:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100/90">Hiring now</p>
            <h2 className="mt-2 text-2xl font-black text-white sm:text-3xl">Product, Community, and Growth Roles</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-200/90">
              We hire builders who care about safety, clarity, and execution quality. Submit a direct application with a CV link
              and a short cover letter tailored to one role.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100">
                Trust-first hiring
              </span>
              <span className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
                Direct applications
              </span>
              <span className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
                Daily cap: {CAREER_DAILY_SUBMISSION_LIMIT}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Roles</p>
              <p className="mt-1 text-2xl font-black text-white">{CAREER_ROLES.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Teams</p>
              <p className="mt-1 text-2xl font-black text-white">{teamCount}</p>
            </div>
            <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-100/75">Priority</p>
              <p className="mt-1 text-sm font-bold text-amber-50">Ambassador</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {CAREER_ROLES.map((role) => {
          const themeClass = THEME_STYLES[role.theme] ?? "border-white/20 bg-white/10 text-white";
          const isSelected = role.id === selectedRoleId;
          return (
            <article
              key={role.id}
              className={[
                "rounded-3xl border p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)] transition-all",
                isSelected
                  ? "border-cyan-300/35 bg-[linear-gradient(160deg,rgba(13,242,242,0.10),rgba(255,255,255,0.04))] shadow-[0_20px_50px_rgba(6,182,212,0.16)]"
                  : "border-white/10 bg-white/[0.03]",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${themeClass}`}>
                  {role.theme}
                </span>
                {role.id === AMBASSADOR_ROLE_ID ? (
                  <span className="rounded-full border border-amber-300/35 bg-amber-300/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-100">
                    Most important
                  </span>
                ) : null}
                <span className="rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
                  {role.workMode}
                </span>
                <span className="rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
                  {role.level}
                </span>
                {isSelected ? (
                  <span className="rounded-full border border-cyan-300/35 bg-cyan-300/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100">
                    Selected in form
                  </span>
                ) : null}
              </div>

              <h3 className="mt-3 text-xl font-bold text-white">{role.title}</h3>
              <p className="mt-1 text-sm text-cyan-100/80">{role.team} • {role.location}</p>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">{role.summary}</p>

              <div className="mt-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/75">Role focus</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-300">
                  {role.responsibilities.map((item) => (
                    <li key={`${role.id}-r-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="mt-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/75">Requirements</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-300">
                  {role.requirements.map((item) => (
                    <li key={`${role.id}-q-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                onClick={() => focusApplyForm(role.id)}
                className="mt-5 inline-flex items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-300/12 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20"
              >
                <span className="material-symbols-outlined text-[17px]">description</span>
                Apply for this role
              </button>
              {role.id === AMBASSADOR_ROLE_ID ? (
                isAmbassadorCallOpen ? (
                  <a
                    href={calendlyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-2 rounded-xl border border-amber-300/35 bg-amber-300/12 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/20"
                  >
                    <span className="material-symbols-outlined text-[17px]">event_available</span>
                    Schedule ambassador call (today)
                  </a>
                ) : (
                  <p className="mt-2 text-xs text-amber-100/90">
                    Ambassador intro calls open on Wednesdays (UTC). Next slot: {nextAmbassadorCallDate}.
                  </p>
                )
              ) : null}
            </article>
          );
        })}
      </section>

      <section
        ref={formRef}
        className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)] sm:p-6"
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <h2 className="text-xl font-bold text-white">Submit your CV</h2>
            <p className="mt-2 text-sm text-slate-300">
              Apply to one position at a time. Include a concise cover letter with your impact, role fit, and expected
              contribution.
            </p>
            {isAmbassadorRole ? (
              <div className="mt-3 rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                City Ambassador is a priority role.{" "}
                {isAmbassadorCallOpen ? "Call booking is open today." : `Call booking opens Wednesdays (UTC). Next: ${nextAmbassadorCallDate}.`}{" "}
                {isAmbassadorCallOpen ? (
                  <a href={calendlyUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
                    Schedule intro call
                  </a>
                ) : null}
              </div>
            ) : null}

            <form className="mt-5 grid gap-3" onSubmit={onSubmit}>
              <label className="text-sm text-white/85">
                Role
                <select
                  value={selectedRoleId}
                  onChange={(event) => setSelectedRoleId(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/40"
                >
                  {CAREER_ROLES.map((role) => (
                    <option key={role.id} value={role.id} className="bg-[#101214]">
                      {role.title}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-white/85">
                  Full name
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    required
                    maxLength={120}
                    className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
                    placeholder="Your full name"
                  />
                </label>
                <label className="text-sm text-white/85">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    maxLength={190}
                    className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
                    placeholder="you@email.com"
                  />
                </label>
              </div>

              <label className="text-sm text-white/85">
                Location
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  maxLength={120}
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
                  placeholder="City, Country"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-white/85">
                  CV link (optional if you upload file)
                  <input
                    type="url"
                    value={cvUrl}
                    onChange={(event) => setCvUrl(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
                    placeholder="https://..."
                  />
                </label>
                <label className="text-sm text-white/85">
                  LinkedIn (optional)
                  <input
                    type="url"
                    value={linkedinUrl}
                    onChange={(event) => setLinkedinUrl(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
                    placeholder="https://linkedin.com/in/..."
                  />
                </label>
              </div>

              <label className="text-sm text-white/85">
                Attach CV file (PDF/DOC/DOCX, max 8MB)
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => setCvFile(event.target.files?.[0] ?? null)}
                  className="mt-1.5 block w-full cursor-pointer rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-cyan-300/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-cyan-100"
                />
                {cvFile ? <span className="mt-1 block text-xs text-cyan-100/90">Selected: {cvFile.name}</span> : null}
              </label>

              <label className="text-sm text-white/85">
                Portfolio (optional)
                <input
                  type="url"
                  value={portfolioUrl}
                  onChange={(event) => setPortfolioUrl(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
                  placeholder="https://..."
                />
              </label>

              <label className="text-sm text-white/85">
                Cover letter
                <textarea
                  value={coverLetter}
                  onChange={(event) => setCoverLetter(event.target.value)}
                  required
                  minLength={120}
                  maxLength={3000}
                  rows={8}
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
                  placeholder="Explain why this role matches your experience, what you will own in the first months, and examples of outcomes you shipped."
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300/90">
                <span>Max {CAREER_DAILY_SUBMISSION_LIMIT} submissions/day. Provide CV link or file attachment.</span>
                <span className={coverLetterLength >= 120 ? "text-emerald-200" : "text-amber-100"}>
                  {coverLetterLength}/3000
                </span>
              </div>

              {submitState.kind === "error" ? (
                <div className="rounded-xl border border-rose-300/35 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{submitState.message}</div>
              ) : null}
              {submitState.kind === "success" ? (
                <div className="rounded-xl border border-emerald-300/35 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                  {submitState.message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-300/12 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[17px]">send</span>
                {isSubmitting ? "Submitting..." : "Submit application"}
              </button>
            </form>
          </div>

          <aside className="xl:sticky xl:top-24">
            <div className="rounded-3xl border border-white/10 bg-black/25 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.24)]">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100/90">Application summary</p>
              <h3 className="mt-2 text-lg font-bold text-white">{selectedRole?.title ?? "Select a role"}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedRole ? (
                  <>
                    <span className="rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
                      {selectedRole.team}
                    </span>
                    <span className="rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
                      {selectedRole.workMode}
                    </span>
                    <span className="rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
                      {selectedRole.level}
                    </span>
                  </>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                {selectedRole?.summary ?? "Choose one role and tailor the application tightly to that scope."}
              </p>

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">Strong applications include</p>
                <div className="mt-3 space-y-2 text-sm text-slate-300">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-cyan-300" />
                    <span>Direct evidence of shipped work, not generic ambition.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-cyan-300" />
                    <span>Role-specific outcomes from the first 60 to 90 days.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-cyan-300" />
                    <span>One CV source attached: file upload or a reliable public link.</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">CV status</p>
                  <p className={`mt-1 text-sm font-semibold ${hasCvInput ? "text-emerald-100" : "text-amber-100"}`}>
                    {hasCvInput ? "Ready to submit" : "Add CV link or file"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Cover letter</p>
                  <p className={`mt-1 text-sm font-semibold ${coverLetterLength >= 120 ? "text-emerald-100" : "text-amber-100"}`}>
                    {coverLetterLength >= 120 ? "Minimum reached" : "Needs more detail"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Location</p>
                  <p className="mt-1 text-sm font-semibold text-white/85">{selectedRole?.location ?? "Global"}</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </InfoPageShell>
  );
}
