"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import Nav from "@/components/Nav";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ConnectionStatus = "pending" | "accepted" | "blocked";
type ConnectContext = "member" | "traveller" | null;

type ConnectionRow = {
  id: string;
  requester_id: string;
  target_id: string;
  status: ConnectionStatus;
  created_at?: string;

  // metadata
  connect_context?: ConnectContext;
  connect_reason?: string | null;
  connect_reason_role?: string | null;
  trip_id?: string | null;

  // trip preview (optional)
  trip_destination_city?: string | null;
  trip_destination_country?: string | null;
  trip_start_date?: string | null;
  trip_end_date?: string | null;
  trip_purpose?: string | null;
};

type ProfileLite = {
  user_id: string;
  display_name: string;
  city: string;
  country: string | null;
};

type RowWithProfile = {
  conn: ConnectionRow;
  other: ProfileLite | null;
};

type TripPreview = {
  destination_city: string;
  destination_country: string;
  start_date: string;
  end_date: string;
  purpose: string;
} | null;

type ReasonMeta = { label: string; emoji: string };

const REASON_LABELS: Record<string, ReasonMeta> = {
  holiday: { label: "Holidays", emoji: "🏖️" },
  dance_festival: { label: "Dance Festival / Congress", emoji: "💃" },
  event_collab: { label: "Event / Collab", emoji: "🤝" },
};

function formatReason(key?: string | null) {
  const k = (key ?? "").trim();
  if (!k) return { text: "—", emoji: "💬" };
  const hit = REASON_LABELS[k];
  if (hit) return { text: hit.label, emoji: hit.emoji };
  return { text: k, emoji: "🧩" };
}

function formatDateTime(iso?: string) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toIsoDate(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "";
  return x.toISOString().slice(0, 10);
}

function formatDateShort(iso?: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function getTripPreview(conn: ConnectionRow): TripPreview {
  if (!conn.trip_id) return null;
  const city = (conn.trip_destination_city ?? "").trim();
  const country = (conn.trip_destination_country ?? "").trim();
  const start = toIsoDate(conn.trip_start_date ?? "");
  const end = toIsoDate(conn.trip_end_date ?? "");
  const purpose = (conn.trip_purpose ?? "").trim();

  // If we don't have the preview fields persisted on the connection row yet, we simply omit the preview.
  if (!city || !country || !start || !end) return null;
  return {
    destination_city: city,
    destination_country: country,
    start_date: start,
    end_date: end,
    purpose: purpose || "Trip",
  };
}

export default function RequestsPage() {
  const router = useRouter();

  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [incoming, setIncoming] = useState<RowWithProfile[]>([]);
  const [sent, setSent] = useState<RowWithProfile[]>([]);
  const [accepted, setAccepted] = useState<RowWithProfile[]>([]);
  const [blocked, setBlocked] = useState<RowWithProfile[]>([]);

  const rowById = useMemo(() => {
    const m: Record<string, RowWithProfile> = {};
    for (const r of incoming) m[r.conn.id] = r;
    for (const r of sent) m[r.conn.id] = r;
    for (const r of accepted) m[r.conn.id] = r;
    for (const r of blocked) m[r.conn.id] = r;
    return m;
  }, [incoming, sent, accepted, blocked]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      setMeId(user.id);

      // NOTE: We intentionally use `select("*")` to avoid hard-failing when some optional metadata
      // columns (trip preview fields, connect_* fields) are not present in the connections table yet.
      // Supabase/PostgREST throws an error if you request a non-existent column explicitly.
      const { data: connRows, error: connErr } = await supabase
        .from("connections")
        .select("*")
        .or(`requester_id.eq.${user.id},target_id.eq.${user.id}`)
        .limit(500);

      if (connErr) {
        setError(connErr.message);
        setLoading(false);
        return;
      }

      const conns = ((connRows ?? []) as any[]).map((c) => {
        const row: ConnectionRow = {
          id: String(c.id),
          requester_id: String(c.requester_id),
          target_id: String(c.target_id),
          status: c.status as ConnectionStatus,
          created_at: c.created_at,

          // metadata (optional)
          connect_context: (c.connect_context ?? null) as ConnectContext,
          connect_reason: (c.connect_reason ?? null) as string | null,
          connect_reason_role: (c.connect_reason_role ?? null) as string | null,
          trip_id: (c.trip_id ?? null) as string | null,

          // trip preview (optional)
          trip_destination_city: (c.trip_destination_city ?? null) as string | null,
          trip_destination_country: (c.trip_destination_country ?? null) as string | null,
          trip_start_date: (c.trip_start_date ?? null) as string | null,
          trip_end_date: (c.trip_end_date ?? null) as string | null,
          trip_purpose: (c.trip_purpose ?? null) as string | null,
        };
        return row;
      });
      const otherIds = Array.from(new Set(conns.map((c) => (c.requester_id === user.id ? c.target_id : c.requester_id))));

      let profilesById: Record<string, ProfileLite> = {};
      if (otherIds.length) {
        const { data: profs, error: profErr } = await supabase.from("profiles").select("user_id,display_name,city,country").in("user_id", otherIds);

        if (profErr) {
          setError(profErr.message);
          setLoading(false);
          return;
        }

        profilesById = Object.fromEntries(((profs ?? []) as ProfileLite[]).map((p) => [p.user_id, p]));
      }

      const toRow = (c: ConnectionRow): RowWithProfile => {
        const otherId = c.requester_id === user.id ? c.target_id : c.requester_id;
        return { conn: c, other: profilesById[otherId] ?? null };
      };

      setIncoming(conns.filter((c) => c.status === "pending" && c.target_id === user.id).map(toRow));
      setSent(conns.filter((c) => c.status === "pending" && c.requester_id === user.id).map(toRow));
      setAccepted(conns.filter((c) => c.status === "accepted").map(toRow));
      setBlocked(conns.filter((c) => c.status === "blocked").map(toRow));

      setLoading(false);
    })();
  }, [router]);

  async function cancelSent(connId: string) {
    if (!meId) return;
    setBusyId(connId);
    setError(null);

    const { error } = await supabase.from("connections").delete().eq("id", connId);

    setBusyId(null);

    if (error) {
      setError(error.message);
      return;
    }

    setSent((prev) => prev.filter((r) => r.conn.id !== connId));
  }

  async function acceptIncoming(connId: string) {
    if (!meId) return;
    setBusyId(connId);
    setError(null);

    const { error } = await supabase.from("connections").update({ status: "accepted" }).eq("id", connId);

    setBusyId(null);

    if (error) {
      setError(error.message);
      return;
    }

    const row = rowById[connId];
    setIncoming((prev) => prev.filter((r) => r.conn.id !== connId));
    if (row) setAccepted((prev) => [{ conn: { ...row.conn, status: "accepted" }, other: row.other }, ...prev]);
  }

  async function declineIncoming(connId: string) {
    if (!meId) return;
    setBusyId(connId);
    setError(null);

    const { error } = await supabase.from("connections").delete().eq("id", connId);

    setBusyId(null);

    if (error) {
      setError(error.message);
      return;
    }

    setIncoming((prev) => prev.filter((r) => r.conn.id !== connId));
  }

  async function blockFromRow(connId: string) {
    if (!meId) return;
    const row = rowById[connId];
    if (!row) return;

    setBusyId(connId);
    setError(null);

    // mark as blocked
    const { error } = await supabase.from("connections").update({ status: "blocked" }).eq("id", connId);

    setBusyId(null);

    if (error) {
      setError(error.message);
      return;
    }

    // remove from other lists + add to blocked
    setIncoming((prev) => prev.filter((r) => r.conn.id !== connId));
    setSent((prev) => prev.filter((r) => r.conn.id !== connId));
    setAccepted((prev) => prev.filter((r) => r.conn.id !== connId));

    setBlocked((prev) => [{ conn: { ...row.conn, status: "blocked" }, other: row.other }, ...prev]);
  }

  async function disconnect(connId: string) {
    if (!meId) return;
    setBusyId(connId);
    setError(null);

    const { error } = await supabase.from("connections").delete().eq("id", connId);

    setBusyId(null);

    if (error) {
      setError(error.message);
      return;
    }

    setAccepted((prev) => prev.filter((r) => r.conn.id !== connId));
  }

  async function blockByConnId(connId: string) {
    return blockFromRow(connId);
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-6xl">
        <Nav title="Requests" />

        {error && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}

        <Section title="Pending">
          {incoming.length === 0 ? (
            <div className="text-zinc-600">No pending requests.</div>
          ) : (
            <div className="space-y-3">
              {incoming.map(({ conn, other }) => {
                const isTrip = conn.connect_context === "traveller" || !!conn.trip_id;

                return (
                  <Card
                    key={conn.id}
                    name={other?.display_name ?? "—"}
                    sub={`${other?.city ?? "—"}${other?.country ? `, ${other.country}` : ""}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={
                              "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold " +
                              (isTrip ? "border-red-200 bg-red-50 text-red-800" : "border-zinc-200 bg-white text-zinc-700")
                            }
                          >
                            {isTrip ? "✈️ Trip request" : "👤 Member request"}
                          </span>

                          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-700">
                            {formatReason(conn.connect_reason).emoji} Reason: <b className="ml-1">{formatReason(conn.connect_reason).text}</b>
                          </span>

                          {(() => {
                            const trip = getTripPreview(conn);
                            if (!trip) return null;
                            return (
                              <span className="inline-flex flex-wrap items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-700">
                                <span>🗺️ {trip.destination_city}, {trip.destination_country}</span>
                                <span>•</span>
                                <span>📅 {formatDateShort(trip.start_date)} → {formatDateShort(trip.end_date)}</span>
                                <span>•</span>
                                <span>✈️ {trip.purpose}</span>
                              </span>
                            );
                          })()}

                          {conn.created_at ? (
                            <span className="text-[11px] text-zinc-500">{formatDateTime(conn.created_at)}</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
                        {other?.user_id ? (
                          <Link className="rounded-xl border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50" href={`/profile/${other.user_id}`}>
                            View
                          </Link>
                        ) : null}

                        <button
                          onClick={() => blockFromRow(conn.id)}
                          disabled={busyId === conn.id}
                          className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
                          title="Block this user"
                        >
                          {busyId === conn.id ? "Working…" : "Block"}
                        </button>

                        <button
                          onClick={() => declineIncoming(conn.id)}
                          disabled={busyId === conn.id}
                          className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
                        >
                          {busyId === conn.id ? "Working…" : "Decline"}
                        </button>

                        <button
                          onClick={() => acceptIncoming(conn.id)}
                          disabled={busyId === conn.id}
                          className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                        >
                          {busyId === conn.id ? "Working…" : "Accept"}
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Sent">
          {sent.length === 0 ? (
            <div className="text-zinc-600">No sent requests.</div>
          ) : (
            <div className="space-y-3">
              {sent.map(({ conn, other }) => {
                const isTrip = conn.connect_context === "traveller" || !!conn.trip_id;
                const reason = formatReason(conn.connect_reason);

                return (
                  <Card
                    key={conn.id}
                    name={other?.display_name ?? "—"}
                    sub={`${other?.city ?? "—"}${other?.country ? `, ${other.country}` : ""}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={
                              "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold " +
                              (isTrip ? "border-red-200 bg-red-50 text-red-800" : "border-zinc-200 bg-white text-zinc-700")
                            }
                          >
                            {isTrip ? "✈️ Trip request" : "👤 Member request"}
                          </span>

                          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-700">
                            {reason.emoji} Reason: <b className="ml-1">{reason.text}</b>
                          </span>

                          {(() => {
                            const trip = getTripPreview(conn);
                            if (!trip) return null;
                            return (
                              <span className="inline-flex flex-wrap items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-700">
                                <span>🗺️ {trip.destination_city}, {trip.destination_country}</span>
                                <span>•</span>
                                <span>📅 {formatDateShort(trip.start_date)} → {formatDateShort(trip.end_date)}</span>
                                <span>•</span>
                                <span>✈️ {trip.purpose}</span>
                              </span>
                            );
                          })()}

                          {conn.created_at ? <span className="text-[11px] text-zinc-500">{formatDateTime(conn.created_at)}</span> : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
                        {other?.user_id ? (
                          <Link className="rounded-xl border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50" href={`/profile/${other.user_id}`}>
                            View
                          </Link>
                        ) : null}

                        <button
                          onClick={() => blockByConnId(conn.id)}
                          disabled={busyId === conn.id}
                          className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
                          title="Block this user"
                        >
                          {busyId === conn.id ? "Working…" : "Block"}
                        </button>

                        <button
                          onClick={() => cancelSent(conn.id)}
                          disabled={busyId === conn.id}
                          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
                        >
                          {busyId === conn.id ? "Canceling…" : "Cancel"}
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Connections">
          {accepted.length === 0 ? (
            <div className="text-zinc-600">No connections yet.</div>
          ) : (
            <div className="space-y-3">
              {accepted.map(({ conn, other }) => {
                const isTrip = conn.connect_context === "traveller" || !!conn.trip_id;
                const reason = formatReason(conn.connect_reason);

                return (
                  <Card
                    key={conn.id}
                    name={other?.display_name ?? "—"}
                    sub={`${other?.city ?? "—"}${other?.country ? `, ${other.country}` : ""}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={
                              "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold " +
                              (isTrip ? "border-red-200 bg-red-50 text-red-800" : "border-zinc-200 bg-white text-zinc-700")
                            }
                          >
                            {isTrip ? "✈️ Trip connection" : "👤 Member connection"}
                          </span>

                          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-700">
                            {reason.emoji} Reason: <b className="ml-1">{reason.text}</b>
                          </span>

                          {(() => {
                            const trip = getTripPreview(conn);
                            if (!trip) return null;
                            return (
                              <span className="inline-flex flex-wrap items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-700">
                                <span>🗺️ {trip.destination_city}, {trip.destination_country}</span>
                                <span>•</span>
                                <span>📅 {formatDateShort(trip.start_date)} → {formatDateShort(trip.end_date)}</span>
                                <span>•</span>
                                <span>✈️ {trip.purpose}</span>
                              </span>
                            );
                          })()}

                          {conn.created_at ? <span className="text-[11px] text-zinc-500">{formatDateTime(conn.created_at)}</span> : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
                        {other?.user_id ? (
                          <Link className="rounded-xl border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50" href={`/profile/${other.user_id}`}>
                            View
                          </Link>
                        ) : null}

                        <button
                          onClick={() => blockByConnId(conn.id)}
                          disabled={busyId === conn.id}
                          className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
                          title="Block this user"
                        >
                          {busyId === conn.id ? "Working…" : "Block"}
                        </button>

                        <button
                          onClick={() => disconnect(conn.id)}
                          disabled={busyId === conn.id}
                          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
                        >
                          {busyId === conn.id ? "Disconnecting…" : "Disconnect"}
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Blocked">
          {blocked.length === 0 ? (
            <div className="text-zinc-600">No blocked users.</div>
          ) : (
            <div className="space-y-3">
              {blocked.map(({ conn, other }) => (
                <Card key={conn.id} name={other?.display_name ?? "—"} sub={`${other?.city ?? "—"}${other?.country ? `, ${other.country}` : ""}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      {(() => {
                        const isTrip = conn.connect_context === "traveller" || !!conn.trip_id;
                        const reason = formatReason(conn.connect_reason);
                        const trip = getTripPreview(conn);

                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={
                                "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold " +
                                (isTrip ? "border-red-200 bg-red-50 text-red-800" : "border-zinc-200 bg-white text-zinc-700")
                              }
                            >
                              {isTrip ? "✈️ Trip blocked" : "👤 Member blocked"}
                            </span>

                            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-700">
                              {reason.emoji} Reason: <b className="ml-1">{reason.text}</b>
                            </span>

                            {trip ? (
                              <span className="inline-flex flex-wrap items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-700">
                                <span>🗺️ {trip.destination_city}, {trip.destination_country}</span>
                                <span>•</span>
                                <span>📅 {formatDateShort(trip.start_date)} → {formatDateShort(trip.end_date)}</span>
                                <span>•</span>
                                <span>✈️ {trip.purpose}</span>
                              </span>
                            ) : null}

                            {conn.created_at ? <span className="text-[11px] text-zinc-500">{formatDateTime(conn.created_at)}</span> : null}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Card({ name, sub, children }: { name: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="min-w-0">
        <div className="font-semibold truncate">{name}</div>
        <div className="text-sm text-zinc-600 truncate">{sub}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">{children}</div>
    </div>
  );
}