"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import {
  normalizeReferenceContextTag,
  referenceContextLabel,
  type ReferenceContextTag,
} from "@/lib/activities/types";
import { REFERENCE_REPORT_REASON_OPTIONS, type ReferenceReportReason } from "@/lib/references/reporting";
import { supabase } from "@/lib/supabase/client";

type ReferenceRecord = {
  id: string;
  authorId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  contextTag: ReferenceContextTag;
};

type LiteProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function pickString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function pickNullableString(row: Record<string, unknown>, keys: string[]) {
  const value = pickString(row, keys);
  return value || null;
}

function parseReference(raw: unknown): ReferenceRecord | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const id = pickString(row, ["id"]);
  const authorId = pickString(row, ["author_id", "from_user_id", "source_id"]);
  const recipientId = pickString(row, ["recipient_id", "to_user_id", "target_id"]);
  const createdAt = pickString(row, ["created_at"]);
  const body =
    pickNullableString(row, ["body", "content", "feedback", "comment", "reference_text"]) ?? "";
  const contextTag = normalizeReferenceContextTag(
    pickNullableString(row, ["context_tag", "context", "entity_type"]) ?? "collaboration"
  );
  if (!id || !authorId || !recipientId || !createdAt) return null;
  return { id, authorId, recipientId, body, createdAt, contextTag };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default function ReferenceReportPage() {
  const params = useParams<{ referenceId: string }>();
  const router = useRouter();
  const referenceId = typeof params?.referenceId === "string" ? params.referenceId : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [profileLink, setProfileLink] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState<ReferenceReportReason>(REFERENCE_REPORT_REASON_OPTIONS[0]);
  const [evidenceLinksText, setEvidenceLinksText] = useState("");
  const [reference, setReference] = useState<ReferenceRecord | null>(null);
  const [profilesById, setProfilesById] = useState<Record<string, LiteProfile>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const [{ data: authData, error: authErr }, { data: sessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
      ]);

      if (authErr || !authData.user) {
        if (!cancelled) {
          setError("Please sign in first.");
          setLoading(false);
        }
        return;
      }

      const me = authData.user;
      const token = sessionData.session?.access_token ?? null;
      const myProfileUrl = `${window.location.origin}/profile/${me.id}`;

      const referenceRes = await supabase.from("references").select("*").eq("id", referenceId).maybeSingle();
      if (referenceRes.error) {
        if (!cancelled) {
          setError(referenceRes.error.message);
          setLoading(false);
        }
        return;
      }

      const parsedReference = parseReference(referenceRes.data);
      if (!parsedReference) {
        if (!cancelled) {
          setError("Reference not found.");
          setLoading(false);
        }
        return;
      }

      const profileIds = Array.from(new Set([parsedReference.authorId, parsedReference.recipientId]));
      const profileMap: Record<string, LiteProfile> = {};
      if (profileIds.length > 0) {
        const profilesRes = await supabase
          .from("profiles")
          .select("user_id,display_name,avatar_url")
          .in("user_id", profileIds);
        if (!profilesRes.error) {
          ((profilesRes.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
            const userId = pickString(row, ["user_id"]);
            if (!userId) return;
            profileMap[userId] = {
              userId,
              displayName: pickString(row, ["display_name", "name"]) || "Member",
              avatarUrl: pickNullableString(row, ["avatar_url"]),
            };
          });
        }
      }

      if (cancelled) return;
      setReference(parsedReference);
      setProfilesById(profileMap);
      setAccessToken(token);
      setEmail(me.email ?? "");
      setProfileLink(myProfileUrl);
      setSubject(`Reference report for ${referenceContextLabel(parsedReference.contextTag)}`);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [referenceId]);

  const otherProfile = useMemo(() => {
    if (!reference) return null;
    return profilesById[reference.authorId] ?? null;
  }, [profilesById, reference]);

  async function submit() {
    if (!accessToken || !reference) {
      setError("Missing session or reference context.");
      return;
    }
    if (!email.trim() || !subject.trim() || !description.trim()) {
      setError("Email, subject, and description are required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setInfo(null);

    const evidenceLinks = evidenceLinksText
      .split(/\n+/)
      .map((value) => value.trim())
      .filter(Boolean);

    const response = await fetch("/api/references/report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        referenceId: reference.id,
        reason,
        subject,
        description,
        reporterEmail: email,
        profileLink,
        evidenceLinks,
      }),
    });

    const json = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      claimId?: string | null;
      ticketCode?: string | null;
    } | null;
    setSubmitting(false);
    if (!response.ok || !json?.ok) {
      setError(json?.error ?? "Failed to submit report.");
      return;
    }

    setInfo(
      json?.ticketCode
        ? `Report submitted. Ticket ${json.ticketCode} was created.`
        : "Report submitted. Our moderation team will review it."
    );
    const destination = json?.claimId ? `/support/cases/${json.claimId}` : "/support";
    setTimeout(() => {
      router.push(destination);
    }, 1200);
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <Nav />
      <main className="mx-auto flex w-full max-w-[1160px] flex-col gap-6 px-4 py-6 sm:gap-8 sm:py-8 md:px-8">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Link href="/network" className="hover:text-[#00F5FF]">
            References
          </Link>
          <span>/</span>
          <span className="text-white">Submit a report</span>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Submit a reference report</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-400">
            Use this form if a reference violates the trust guidelines. We review reports for spam, harassment,
            unsafe content, impersonation, and factual disputes that need moderation.
          </p>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {info ? (
          <div className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">{info}</div>
        ) : null}

        <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          {loading ? (
            <div className="space-y-4">
              <div className="h-6 w-52 animate-pulse rounded bg-white/10" />
              <div className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />
            </div>
          ) : reference ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Reported reference</p>
              <div className="mt-3 flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
                  {otherProfile?.avatarUrl ? (
                    <img src={otherProfile.avatarUrl} alt={otherProfile.displayName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold text-white">{(otherProfile?.displayName ?? "M").slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xl font-bold text-white">{otherProfile?.displayName ?? "Member"}</p>
                    <span className="rounded border border-cyan-300/25 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.15em] text-cyan-100">
                      {referenceContextLabel(reference.contextTag)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(reference.createdAt)}</p>
                  <p className="mt-4 max-w-3xl text-sm italic leading-relaxed text-slate-300">&ldquo;{reference.body}&rdquo;</p>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="grid gap-6 2xl:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-white">Your email address *</span>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#111317] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/35"
                />
              </label>

              <div className="rounded-2xl border border-[#FFB4A2]/15 bg-[#FFB4A2]/10 p-4 sm:p-5 text-sm leading-7 text-[#FFE9E1]">
                <p>
                  We can review references that appear abusive, unsafe, commercial, misleading, or otherwise in conflict
                  with ConXion trust guidelines.
                </p>
                <p className="mt-4">
                  We do not use “I do not know this person” as a report reason here, because references are only available
                  after a relationship has already been established through connection or completed activity.
                </p>
                <p className="mt-4">
                  Include concrete details, dates, and links if available. That gives moderation enough context to act.
                </p>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-white">Subject *</span>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#111317] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/35"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-white">Description *</span>
                <textarea
                  rows={8}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#111317] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/35"
                  placeholder="Describe why this reference should be reviewed."
                />
              </label>
            </div>

            <div className="space-y-5 2xl:pt-[1px]">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-white">Category *</span>
                <input
                  value="References"
                  disabled
                  className="w-full rounded-xl border border-white/10 bg-[#111317] px-4 py-3 text-sm text-white/70 outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-white">What do you need help with? *</span>
                <select
                  value={reason}
                  onChange={(event) => setReason(event.target.value as ReferenceReportReason)}
                  className="w-full rounded-xl border border-white/10 bg-[#111317] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/35"
                >
                  {REFERENCE_REPORT_REASON_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-white">Profile link</span>
                <input
                  value={profileLink}
                  onChange={(event) => setProfileLink(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#111317] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/35"
                  placeholder="https://..."
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-white">Evidence links</span>
                <textarea
                  rows={6}
                  value={evidenceLinksText}
                  onChange={(event) => setEvidenceLinksText(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#111317] px-4 py-3 text-sm text-white outline-none transition focus:border-[#00F5FF]/35"
                  placeholder="Paste one link per line."
                />
              </label>

              <div className="border-t border-white/10 pt-5">
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="w-full rounded-xl border border-white/12 px-5 py-3 text-sm font-semibold text-white/70 transition hover:text-white sm:w-auto"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submitting || loading}
                    onClick={() => void submit()}
                    className={cx(
                      "w-full rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#0A0A0A] transition sm:w-auto",
                      "disabled:cursor-not-allowed disabled:opacity-60"
                    )}
                  >
                    {submitting ? "Submitting..." : "Submit"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
