"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import InfoPageShell from "@/components/InfoPageShell";
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  type HelpCategoryKey,
} from "@/lib/help-center/content";
import { supabase } from "@/lib/supabase/client";
import { cx } from "@/lib/cx";

type SupportClaimRow = {
  id: string;
  reportId: string | null;
  ticketCode: string | null;
  targetUserId: string;
  subject: string;
  reason: string;
  description: string;
  referenceExcerpt: string | null;
  reporterEmail: string | null;
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

function mapSupportClaimRows(rows: unknown[]) {
  return rows
    .map((raw) => {
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
        targetUserId,
        subject,
        reason,
        description,
        referenceExcerpt: pickNullableString(row, ["reference_excerpt"]),
        reporterEmail: pickNullableString(row, ["reporter_email"]),
        createdAt,
      } satisfies SupportClaimRow;
    })
    .filter((item): item is SupportClaimRow => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function mapReportRows(rows: unknown[]) {
  return rows
    .map((raw) => {
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
    })
    .filter((item): item is ReportRow => Boolean(item));
}

function categoryAccent(accent: string) {
  if (accent === "fuchsia") return "border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-100";
  if (accent === "slate") return "border-white/15 bg-white/[0.04] text-white";
  return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
}

export default function SupportPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claims, setClaims] = useState<SupportClaimRow[]>([]);
  const [reportsById, setReportsById] = useState<Record<string, ReportRow>>({});
  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      const [{ data: sessionData }, { data: userData, error: authErr }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.auth.getUser(),
      ]);

      const user = sessionData.session?.user ?? userData.user;
      if (authErr || !user) {
        if (!cancelled) {
          setSignedIn(false);
          setClaims([]);
          setLoading(false);
        }
        return;
      }

      setSignedIn(true);

      const claimsRes = await supabase
        .from("reference_report_claims")
        .select("*")
        .eq("reporter_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (claimsRes.error) {
        if (!cancelled) {
          setError(claimsRes.error.message);
          setLoading(false);
        }
        return;
      }

      const nextClaims = mapSupportClaimRows((claimsRes.data ?? []) as unknown[]);
      const reportIds = Array.from(new Set(nextClaims.map((item) => item.reportId).filter((value): value is string => Boolean(value))));
      const targetUserIds = Array.from(new Set(nextClaims.map((item) => item.targetUserId).filter(Boolean)));

      const [reportsRes, profilesRes] = await Promise.all([
        reportIds.length > 0
          ? supabase.from("reports").select("id,status,note,created_at").in("id", reportIds)
          : Promise.resolve({ data: [], error: null }),
        targetUserIds.length > 0
          ? supabase.from("profiles").select("user_id,display_name").in("user_id", targetUserIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const nextReportsById: Record<string, ReportRow> = {};
      mapReportRows((reportsRes.data ?? []) as unknown[]).forEach((row) => {
        nextReportsById[row.id] = row;
      });

      const nextProfilesById: Record<string, ProfileRow> = {};
      for (const raw of (profilesRes.data ?? []) as unknown[]) {
        const row = asRecord(raw);
        const userId = pickString(row, ["user_id"]);
        if (!userId) continue;
        nextProfilesById[userId] = {
          userId,
          displayName: pickString(row, ["display_name"]) || "Member",
        };
      }

      if (cancelled) return;
      setClaims(nextClaims);
      setReportsById(nextReportsById);
      setProfilesById(nextProfilesById);
      setLoading(false);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    let open = 0;
    let resolved = 0;
    for (const claim of claims) {
      const status = (reportsById[claim.reportId ?? ""]?.status ?? "open").toLowerCase();
      if (status === "resolved") resolved += 1;
      else if (status !== "dismissed") open += 1;
    }
    return { total: claims.length, open, resolved };
  }, [claims, reportsById]);

  const filteredArticles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return HELP_ARTICLES;
    return HELP_ARTICLES.filter((article) => {
      return (
        article.title.toLowerCase().includes(normalized) ||
        article.summary.toLowerCase().includes(normalized) ||
        article.body.some((paragraph) => paragraph.toLowerCase().includes(normalized))
      );
    });
  }, [query]);

  const articlesByCategory = useMemo(() => {
    const grouped = new Map<HelpCategoryKey, typeof HELP_ARTICLES>();
    for (const category of HELP_CATEGORIES) grouped.set(category.key, []);
    for (const article of filteredArticles) {
      grouped.get(article.category)?.push(article);
    }
    return grouped;
  }, [filteredArticles]);

  const topSearchResults = useMemo(() => filteredArticles.slice(0, 6), [filteredArticles]);

  return (
    <InfoPageShell
      title="Help Center"
      description="Answers for plans, upgrades, trust, references, activities, trips, and account support. Tickets and help articles live in the same place so users always have a clear next step."
    >
      {error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}

      <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),rgba(0,245,255,0.08),rgba(255,255,255,0.02))] p-5 sm:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Help Desk</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">What do you need help with?</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-200/85">
              Start with the FAQ topics below for plans, references, hosting, request-linked chat windows, and support. Open the Trust &amp; Safety Guidelines when you need policy detail, and use Support Cases only when moderation or manual review is actually needed.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="#faq-topics"
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/85 hover:border-white/30 hover:text-white"
              >
                Browse FAQ topics
              </Link>
              <Link
                href="/safety-center"
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20"
              >
                Trust &amp; Safety Guidelines
              </Link>
              <Link
                href="/account-settings/data-requests"
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/85 hover:border-white/30 hover:text-white"
              >
                Privacy Rights &amp; Contact
              </Link>
              {signedIn ? (
                <Link
                  href="#my-support-cases"
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/85 hover:border-white/30 hover:text-white"
                >
                  My Support Cases
                </Link>
              ) : null}
            </div>
          </div>
          <div className="w-full max-w-[560px]">
            <div className="flex items-center rounded-full border border-white/12 bg-[#101317] px-4 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
              <span className="material-symbols-outlined text-xl text-[#00F5FF]">search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search plans, upgrades, references, hosting, account access..."
                className="min-h-10 w-full bg-transparent px-3 text-sm text-white outline-none placeholder:text-white/30"
              />
            </div>
          </div>
        </div>
        {query.trim() ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">
                Search results for <span className="text-cyan-200">&ldquo;{query.trim()}&rdquo;</span>
              </p>
              <p className="text-xs text-white/45">{topSearchResults.length} shown</p>
            </div>
            {topSearchResults.length > 0 ? (
              <div className="mt-3 grid gap-2 xl:grid-cols-2">
                {topSearchResults.map((article) => (
                  <Link
                    key={article.slug}
                    href={`/support/articles/${article.slug}`}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-cyan-100 transition hover:border-cyan-300/30 hover:text-white"
                  >
                    <p className="font-semibold">{article.title}</p>
                    <p className="mt-1 text-xs text-white/45">{article.summary}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/55">No matches yet. Try “plus”, “verified”, “hosting”, “references”, or “account”.</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="space-y-6">
        <article id="faq-topics" className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">FAQ Topics</h2>
              <p className="mt-1 text-sm text-slate-400">Core product, upgrade, hosting, and trust questions for the current MVP.</p>
            </div>
            <Link
              href="/safety-center"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20"
            >
              Trust & Safety Guidelines
            </Link>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            {HELP_CATEGORIES.map((category) => {
              const articles = articlesByCategory.get(category.key) ?? [];
              if (articles.length === 0) return null;
              return (
                <section key={category.key} id={`topic-${category.key}`}>
                  <div className="flex items-center gap-3">
                    <span className={cx("inline-flex h-9 w-9 items-center justify-center rounded-2xl border", categoryAccent(category.accent))}>
                      <span className="material-symbols-outlined text-[18px]">{category.icon}</span>
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-white">{category.title}</h3>
                      <p className="text-sm text-slate-500">{category.description}</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {articles.slice(0, 3).map((article) => (
                      <Link
                        key={article.slug}
                        href={`/support/articles/${article.slug}`}
                        className="block rounded-lg py-1.5 text-base leading-7 text-cyan-100 transition hover:text-white"
                      >
                        {article.title}
                      </Link>
                    ))}
                    {articles.length > 3 ? (
                      <p className="pt-1 text-sm font-semibold text-white/60">See all {articles.length} articles in this topic</p>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        </article>

        <article id="my-support-cases" className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
          <h2 className="text-xl font-bold text-white">My Support Cases</h2>
          <p className="mt-1 text-sm text-slate-400">Ticket status for moderation and trust cases.</p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Tickets</p>
              <p className="mt-2 text-2xl font-black text-white">{stats.total}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Open</p>
              <p className="mt-2 text-2xl font-black text-cyan-200">{stats.open}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Resolved</p>
              <p className="mt-2 text-2xl font-black text-emerald-200">{stats.resolved}</p>
            </div>
          </div>

          {!signedIn ? (
            <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-8 text-center">
              <p className="text-sm text-slate-300">Sign in to review your tickets and moderation updates.</p>
              <div className="mt-4">
                <Link
                  href="/auth"
                  className="inline-flex min-h-[44px] items-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20"
                >
                  Sign in
                </Link>
              </div>
            </div>
          ) : loading ? (
            <div className="mt-4 space-y-3">
              {[0, 1].map((idx) => (
                <div key={idx} className="h-32 animate-pulse rounded-2xl border border-white/10 bg-black/20" />
              ))}
            </div>
          ) : claims.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-8 text-center text-sm text-slate-500">
              No support tickets yet. Report a reference from the References view if a moderation case is needed.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {claims.slice(0, 4).map((claim) => {
                const report = reportsById[claim.reportId ?? ""];
                const target = profilesById[claim.targetUserId];
                const status = report?.status ?? "open";
                return (
                  <article key={claim.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {claim.ticketCode ? (
                            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.16em] text-cyan-100">
                              {claim.ticketCode}
                            </span>
                          ) : null}
                          <p className="truncate text-sm font-semibold text-white">{claim.subject}</p>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {target?.displayName || "Member"} • {formatDate(claim.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                        <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]", statusChipClass(status))}>
                          {formatStatusLabel(status)}
                        </span>
                        <Link
                          href={`/support/cases/${claim.id}`}
                          className="inline-flex rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/20"
                        >
                          Open case
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
              <Link
                href="/account-settings"
                className="inline-flex rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-semibold text-white/85 hover:border-white/35 hover:text-white"
              >
                Open full account tools
              </Link>
            </div>
          )}
        </article>
      </section>
    </InfoPageShell>
  );
}
