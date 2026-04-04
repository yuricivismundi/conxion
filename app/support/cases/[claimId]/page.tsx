"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import InfoPageShell from "@/components/InfoPageShell";
import { supabase } from "@/lib/supabase/client";
import { cx } from "@/lib/cx";

type SupportClaimRow = {
  id: string;
  reportId: string | null;
  ticketCode: string | null;
  referenceId: string | null;
  targetUserId: string;
  subject: string;
  reason: string;
  description: string;
  referenceExcerpt: string | null;
  reporterEmail: string | null;
  profileLink: string | null;
  evidenceLinks: string[];
  createdAt: string;
};

type ReportRow = {
  id: string;
  status: string;
  note: string | null;
  createdAt: string;
};

type ProfileRow = {
  userId: string;
  displayName: string;
};


function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatStatusLabel(value: string | null | undefined) {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "resolved") return "Resolved";
  if (key === "dismissed") return "Dismissed";
  if (key === "needs_info") return "Needs info";
  if (key === "under_review") return "Under review";
  if (key === "reopen" || key === "reopened") return "Reopened";
  return "Open";
}

function statusChipClass(value: string | null | undefined) {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "resolved") return "border-emerald-300/30 bg-emerald-300/12 text-emerald-100";
  if (key === "dismissed") return "border-rose-300/30 bg-rose-300/12 text-rose-100";
  if (key === "needs_info") return "border-amber-300/30 bg-amber-300/12 text-amber-100";
  if (key === "under_review") return "border-cyan-300/30 bg-cyan-300/12 text-cyan-100";
  return "border-white/15 bg-white/[0.05] text-white/85";
}

function mapSupportClaim(raw: unknown) {
  const row = asRecord(raw);
  const id = pickString(row, ["id"]);
  const targetUserId = pickString(row, ["target_user_id"]);
  const subject = pickString(row, ["subject"]);
  const reason = pickString(row, ["reason"]);
  const description = pickString(row, ["description"]);
  const createdAt = pickString(row, ["created_at"]);
  if (!id || !targetUserId || !subject || !reason || !description || !createdAt) return null;
  return {
    id,
    reportId: pickNullableString(row, ["report_id"]),
    ticketCode: pickNullableString(row, ["ticket_code"]),
    referenceId: pickNullableString(row, ["reference_id"]),
    targetUserId,
    subject,
    reason,
    description,
    referenceExcerpt: pickNullableString(row, ["reference_excerpt"]),
    reporterEmail: pickNullableString(row, ["reporter_email"]),
    profileLink: pickNullableString(row, ["profile_link"]),
    evidenceLinks: Array.isArray(row.evidence_links)
      ? row.evidence_links.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [],
    createdAt,
  } satisfies SupportClaimRow;
}

function mapReport(raw: unknown) {
  const row = asRecord(raw);
  const id = pickString(row, ["id"]);
  const createdAt = pickString(row, ["created_at"]);
  if (!id || !createdAt) return null;
  return {
    id,
    status: pickString(row, ["status"]) || "open",
    note: pickNullableString(row, ["note"]),
    createdAt,
  } satisfies ReportRow;
}

export default function SupportCaseDetailPage() {
  const params = useParams<{ claimId: string }>();
  const router = useRouter();
  const claimId = typeof params?.claimId === "string" ? params.claimId : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claim, setClaim] = useState<SupportClaimRow | null>(null);
  const [report, setReport] = useState<ReportRow | null>(null);
  const [target, setTarget] = useState<ProfileRow | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const [{ data: sessionData }, { data: userData, error: authErr }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.auth.getUser(),
      ]);

      const user = sessionData.session?.user ?? userData.user;
      if (authErr || !user) {
        router.replace(`/auth?next=/support/cases/${claimId}`);
        return;
      }

      const claimRes = await supabase
        .from("reference_report_claims")
        .select("*")
        .eq("id", claimId)
        .eq("reporter_id", user.id)
        .maybeSingle();

      if (claimRes.error) {
        if (!cancelled) {
          setError(claimRes.error.message);
          setLoading(false);
        }
        return;
      }

      const nextClaim = mapSupportClaim(claimRes.data);
      if (!nextClaim) {
        if (!cancelled) {
          setError("Support case not found.");
          setLoading(false);
        }
        return;
      }

      const [reportRes, targetRes] = await Promise.all([
        nextClaim.reportId
          ? supabase.from("reports").select("id,status,note,created_at").eq("id", nextClaim.reportId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase.from("profiles").select("user_id,display_name").eq("user_id", nextClaim.targetUserId).maybeSingle(),
      ]);

      if (cancelled) return;
      setClaim(nextClaim);
      setReport(mapReport(reportRes.data));
      setTarget(
        targetRes.data
          ? {
              userId: pickString(asRecord(targetRes.data), ["user_id"]),
              displayName: pickString(asRecord(targetRes.data), ["display_name"]) || "Member",
            }
          : null
      );
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [claimId, router]);

  return (
    <InfoPageShell
      title="Support Case"
      description="Review the exact report you submitted, its moderation status, and any notes attached to the case."
    >
      <div className="flex flex-wrap gap-2">
        <Link
          href="/support#my-support-cases"
          className="inline-flex rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-semibold text-white/85 hover:border-white/35 hover:text-white"
        >
          Back to Help Center
        </Link>
        {claim?.referenceId ? (
          <Link
            href="/references"
            className="inline-flex rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
          >
            Open references
          </Link>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <div className="h-36 animate-pulse rounded-2xl border border-white/10 bg-black/20" />
          <div className="h-56 animate-pulse rounded-2xl border border-white/10 bg-black/20" />
        </div>
      ) : claim ? (
        <>
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)] sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {claim.ticketCode ? (
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.16em] text-cyan-100">
                      {claim.ticketCode}
                    </span>
                  ) : null}
                  <h2 className="text-xl font-bold text-white">{claim.subject}</h2>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  Reported member: {target?.displayName ?? "Member"} • Submitted {formatDate(claim.createdAt)}
                </p>
              </div>
              <span className={cx("rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.14em]", statusChipClass(report?.status ?? "open"))}>
                {formatStatusLabel(report?.status ?? "open")}
              </span>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Reason</p>
                <p className="mt-2 text-sm text-white">{claim.reason}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Status</p>
                <p className="mt-2 text-sm text-white">{formatStatusLabel(report?.status ?? "open")}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Created</p>
                <p className="mt-2 text-sm text-white">{formatDate(report?.createdAt ?? claim.createdAt)}</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)] sm:p-6">
            <h2 className="text-lg font-bold text-white">Case Details</h2>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Your description</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{claim.description}</p>
            </div>

            {claim.referenceExcerpt ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Reference excerpt</p>
                <p className="mt-2 whitespace-pre-wrap text-sm italic leading-relaxed text-slate-300">&ldquo;{claim.referenceExcerpt}&rdquo;</p>
              </div>
            ) : null}

            {report?.note ? (
              <div className="mt-4 rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-100/75">Moderation note</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-cyan-50">{report.note}</p>
              </div>
            ) : null}

            {claim.evidenceLinks.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Evidence links</p>
                <div className="mt-3 flex flex-col gap-2">
                  {claim.evidenceLinks.map((link) => (
                    <a
                      key={link}
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm text-cyan-100 underline-offset-4 hover:text-white hover:underline"
                    >
                      {link}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {(claim.reporterEmail || claim.profileLink) ? (
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {claim.reporterEmail ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Reporter email</p>
                    <p className="mt-2 break-all text-sm text-white">{claim.reporterEmail}</p>
                  </div>
                ) : null}
                {claim.profileLink ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Profile link shared</p>
                    <a
                      href={claim.profileLink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex text-sm text-cyan-100 underline-offset-4 hover:text-white hover:underline"
                    >
                      Open shared profile link
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </InfoPageShell>
  );
}
