"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { supabase } from "@/lib/supabase/client";
import {
  PRIVACY_REQUEST_SCOPE_OPTIONS,
  PRIVACY_REQUEST_TYPE_OPTIONS,
  formatPrivacyRequestScopeTags,
  formatPrivacyRequestStatusLabel,
  formatPrivacyRequestTypeLabel,
  privacyRequestStatusChipClass,
  type PrivacyRequestScopeTag,
  type PrivacyRequestType,
} from "@/lib/privacy-requests";

type PrivacyRequestRow = {
  id: string;
  ticketCode: string | null;
  requestType: string;
  status: string;
  subject: string;
  description: string;
  scopeTags: string[];
  adminNote: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type MeSummary = {
  email: string | null;
  displayName: string;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(row: Record<string, unknown>, key: string, fallback = "") {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function pickNullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(parsed);
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  const diff = Date.now() - parsed.getTime();
  if (diff < 60_000) return "Just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function mapPrivacyRequestRow(raw: unknown) {
  const row = asRecord(raw);
  const id = pickString(row, "id");
  const requestType = pickString(row, "request_type");
  const status = pickString(row, "status", "open");
  const subject = pickString(row, "subject");
  const description = pickString(row, "description");
  const createdAt = pickString(row, "created_at");
  const updatedAt = pickString(row, "updated_at", createdAt);
  if (!id || !requestType || !subject || !description || !createdAt) return null;
  return {
    id,
    ticketCode: pickNullableString(row, "ticket_code"),
    requestType,
    status,
    subject,
    description,
    scopeTags: Array.isArray(row.scope_tags) ? row.scope_tags.filter((value): value is string => typeof value === "string") : [],
    adminNote: pickNullableString(row, "admin_note"),
    dueAt: pickNullableString(row, "due_at"),
    resolvedAt: pickNullableString(row, "resolved_at"),
    createdAt,
    updatedAt,
  } satisfies PrivacyRequestRow;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function DataRequestsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [me, setMe] = useState<MeSummary | null>(null);
  const [requests, setRequests] = useState<PrivacyRequestRow[]>([]);
  const [requestType, setRequestType] = useState<PrivacyRequestType>("access");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [scopeTags, setScopeTags] = useState<PrivacyRequestScopeTag[]>(["all_data"]);

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
        router.replace("/auth?next=/account-settings/data-requests");
        return;
      }

      const [profileRes, requestsRes] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("privacy_requests")
          .select("id,ticket_code,request_type,status,subject,description,scope_tags,admin_note,due_at,resolved_at,created_at,updated_at")
          .eq("requester_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (cancelled) return;

      if (requestsRes.error) {
        setError(requestsRes.error.message);
        setLoading(false);
        return;
      }

      setMe({
        email: user.email ?? null,
        displayName: pickString(asRecord(profileRes.data ?? {}), "display_name", "Member"),
      });
      setRequests(((requestsRes.data ?? []) as unknown[]).map(mapPrivacyRequestRow).filter((row): row is PrivacyRequestRow => Boolean(row)));
      setLoading(false);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const activeCount = useMemo(() => requests.filter((item) => item.status !== "resolved" && item.status !== "dismissed").length, [requests]);

  function toggleScopeTag(tag: PrivacyRequestScopeTag) {
    setScopeTags((current) => {
      if (tag === "all_data") return current.includes("all_data") ? [] : ["all_data"];
      const withoutAll = current.filter((item) => item !== "all_data");
      if (withoutAll.includes(tag)) return withoutAll.filter((item) => item !== tag);
      return [...withoutAll, tag];
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? "";
      if (!accessToken) throw new Error("Missing auth session token.");

      const response = await fetch("/api/privacy/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          requestType,
          subject,
          description,
          scopeTags,
        }),
      });

      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; request?: Record<string, unknown> | null }
        | null;

      if (!response.ok || !result?.ok || !result.request) {
        throw new Error(result?.error ?? "Could not create privacy request.");
      }

      const inserted = mapPrivacyRequestRow(result.request);
      if (!inserted) throw new Error("Privacy request was created but the response was incomplete.");

      setRequests((current) => [inserted, ...current]);
      setSuccess(`Request submitted${inserted.ticketCode ? ` as ${inserted.ticketCode}` : ""}.`);
      setRequestType("access");
      setSubject("");
      setDescription("");
      setScopeTags(["all_data"]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create privacy request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#06070b] text-slate-100">
      <Nav />
      <main className="mx-auto w-full max-w-[1240px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap gap-2">
          <Link
            href="/account-settings"
            className="inline-flex rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-semibold text-white/85 hover:border-white/35 hover:text-white"
          >
            Back to Account Settings
          </Link>
          <Link
            href="/privacy"
            className="inline-flex rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
          >
            Privacy Policy
          </Link>
        </div>

        <section className="mt-4 rounded-3xl border border-white/10 bg-[#0b1a1d]/70 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/90">Privacy & Data Rights</p>
          <h1 className="mt-2 text-3xl font-black text-white">Privacy Requests</h1>
          <p className="mt-3 max-w-[72ch] text-sm leading-relaxed text-slate-200/90">
            Submit access, portability, erasure, rectification, objection, or restriction requests from inside your account.
            Deactivation is reversible and is not the same as deletion.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Signed in as</p>
              <p className="mt-2 text-sm font-semibold text-white">{me?.displayName ?? "Member"}</p>
              <p className="mt-1 text-xs text-slate-400">{me?.email ?? "No email found"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Open requests</p>
              <p className="mt-2 text-2xl font-bold text-white">{activeCount}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Handling target</p>
              <p className="mt-2 text-sm text-white">Generally within 30 days</p>
              <p className="mt-1 text-xs text-slate-400">Complex requests can take longer where law allows.</p>
            </div>
          </div>
        </section>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}
        {success ? (
          <div className="mt-4 rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">{success}</div>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)] sm:p-6">
            <h2 className="text-lg font-bold text-white">Submit a request</h2>
            <p className="mt-2 text-sm text-slate-400">
              Use this flow for formal privacy requests. For urgent safety issues, use reporting and support flows instead.
            </p>

            <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Request type</span>
                <select
                  value={requestType}
                  onChange={(event) => setRequestType(event.target.value as PrivacyRequestType)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#11161c] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
                >
                  {PRIVACY_REQUEST_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Scope</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRIVACY_REQUEST_SCOPE_OPTIONS.map((option) => {
                    const active = scopeTags.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => toggleScopeTag(option.value)}
                        className={cx(
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                          active
                            ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100"
                            : "border-white/15 bg-white/[0.04] text-white/75 hover:border-white/30 hover:text-white"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Subject</span>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  maxLength={160}
                  placeholder="Example: Access request for profile, messages, and billing records"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#11161c] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/50"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Description</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={7}
                  maxLength={5000}
                  placeholder="Describe what you want, the data or area involved, and anything that helps locate it."
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#11161c] px-4 py-3 text-sm leading-relaxed text-white outline-none focus:border-cyan-300/50"
                />
                <p className="mt-2 text-xs text-slate-500">{description.length}/5000</p>
              </label>

              <button
                type="submit"
                disabled={submitting || loading}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Submitting..." : "Submit privacy request"}
              </button>
            </form>
          </section>

          <aside className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)] sm:p-6">
            <h2 className="text-lg font-bold text-white">What this covers</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
              <li>Access, portability, deletion, rectification, restriction, objection, and consent-withdrawal requests.</li>
              <li>Signed-in requests are linked to your account so identity review is faster.</li>
              <li>Some data may still be retained for legal claims, security, tax, billing, or safety obligations.</li>
              <li>If ConXion needs more information, the request can move to <span className="font-semibold text-white">Needs info</span>.</li>
            </ul>
          </aside>
        </div>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)] sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">Request history</h2>
              <p className="mt-1 text-sm text-slate-400">Track the ticket code, status, scope, and the latest internal note.</p>
            </div>
          </div>

          {loading ? (
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-24 animate-pulse rounded-2xl border border-white/10 bg-black/20" />
              ))}
            </div>
          ) : requests.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-8 text-center text-sm text-slate-500">
              No privacy requests submitted yet.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {requests.map((item) => (
                <article key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.ticketCode ? (
                          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.16em] text-cyan-100">
                            {item.ticketCode}
                          </span>
                        ) : null}
                        <h3 className="truncate text-base font-semibold text-white">{item.subject}</h3>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{formatPrivacyRequestTypeLabel(item.requestType)}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatPrivacyRequestScopeTags(item.scopeTags)}</p>
                    </div>
                    <span className={cx("rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.14em]", privacyRequestStatusChipClass(item.status))}>
                      {formatPrivacyRequestStatusLabel(item.status)}
                    </span>
                  </div>

                  <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{item.description}</p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-[#0c1016] px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Created</p>
                      <p className="mt-1 text-sm text-white">{formatDate(item.createdAt)}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatRelative(item.createdAt)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#0c1016] px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Target date</p>
                      <p className="mt-1 text-sm text-white">{formatDate(item.dueAt)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#0c1016] px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Last updated</p>
                      <p className="mt-1 text-sm text-white">{formatDate(item.updatedAt)}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatRelative(item.updatedAt)}</p>
                    </div>
                  </div>

                  {item.adminNote ? (
                    <div className="mt-4 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-100/75">Latest note</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-cyan-50">{item.adminNote}</p>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
