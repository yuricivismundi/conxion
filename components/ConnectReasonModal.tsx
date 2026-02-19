// /components/ConnectReasonModal.tsx
"use client";

import { useMemo, useState } from "react";
import type { ConnectContext, ReasonItem } from "@/lib/connectReasons";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Props = {
  open: boolean;
  onClose: () => void;

  targetName: string;
  targetRoles: string[];

  context: ConnectContext;
  reasons: ReasonItem[];
  tripSummary?: { destination: string; dates: string } | null;
  error?: string | null;

  loading?: boolean;
  onConfirm: (reasonKey: string) => void;
};

export default function ConnectReasonModal({
  open,
  onClose,
  targetName,
  targetRoles,
  context,
  reasons,
  tripSummary = null,
  error = null,
  loading = false,
  onConfirm,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string>("");

  const resetSelection = () => {
    setSelectedKey("");
  };

  const grouped = useMemo(() => {
    const map = new Map<string, ReasonItem[]>();

    for (const r of reasons ?? []) {
      // allow passing all reasons, and filter by current context
      if (r.context !== context) continue;

      const groupKey = r.role || "Other";
      if (!map.has(groupKey)) map.set(groupKey, []);
      map.get(groupKey)!.push(r);
    }

    return Array.from(map.entries());
  }, [reasons, context]);

  if (!open) return null;

  const isTrip = context === "trip";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* overlay */}
      <button
        type="button"
        className={cx("absolute inset-0", isTrip ? "bg-black/70" : "bg-black/50")}
        onClick={() => {
          if (loading) return;
          resetSelection();
          onClose();
        }}
        aria-label="Close"
      />

      {/* modal */}
      <div
        className={cx(
          "relative w-full max-w-lg rounded-2xl shadow-xl",
          isTrip ? "border border-[#224949] bg-[#0F1212]" : "border border-zinc-200 bg-white"
        )}
      >
        <div
          className={cx(
            "flex items-start justify-between gap-3 px-5 py-4",
            isTrip ? "border-b border-[#224949]" : "border-b border-zinc-200"
          )}
        >
          <div className="min-w-0">
            <div className={cx("text-sm font-semibold truncate", isTrip ? "text-white" : "text-zinc-900")}>
              Connect with {targetName}
            </div>
            <div className={cx("mt-1 text-xs", isTrip ? "text-[#90cbcb]" : "text-zinc-600")}>
              Roles: {(targetRoles ?? []).length ? targetRoles.join(", ") : "—"}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (loading) return;
              resetSelection();
              onClose();
            }}
            className={cx(
              "h-9 w-9 rounded-xl border",
              isTrip ? "border-[#224949] text-white/70 hover:text-white hover:bg-white/5" : "border-zinc-200 text-zinc-700 hover:bg-zinc-50",
              loading && "opacity-50 cursor-not-allowed"
            )}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          {context === "trip" ? (
            <div className="space-y-4">
              {tripSummary ? (
                <div
                  className={cx(
                    "rounded-xl border px-4 py-3 text-sm",
                    isTrip ? "border-[#224949] bg-[#161b1b]/60" : "border-zinc-200 bg-zinc-50"
                  )}
                >
                  <div className={cx("font-semibold", isTrip ? "text-white" : "text-zinc-900")}>{tripSummary.destination}</div>
                  <div className={cx("mt-1 text-xs", isTrip ? "text-[#90cbcb]" : "text-zinc-600")}>{tripSummary.dates}</div>
                </div>
              ) : null}

              <div>
                <label className={cx("text-xs font-semibold", isTrip ? "text-[#90cbcb]" : "text-zinc-600")}>
                  Select a reason
                </label>
                <select
                  className={cx(
                    "mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none",
                    isTrip
                      ? "border-[#224949] bg-[#0F1212] text-white focus:border-[#0df2f2]"
                      : "border-zinc-200 bg-white text-zinc-900 focus:border-zinc-400"
                  )}
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                >
                  <option value="">Select a reason…</option>
                  {(reasons ?? []).filter((r) => r.context === "trip").map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {selectedKey ? (
                <div
                  className={cx(
                    "rounded-xl border px-4 py-3 text-xs",
                    isTrip ? "border-[#224949] bg-[#161b1b]/60 text-[#90cbcb]" : "border-zinc-200 bg-white text-zinc-700"
                  )}
                >
                  Selected reason:{" "}
                  <span className={cx("font-semibold", isTrip ? "text-white" : "text-zinc-900")}>
                    {(reasons ?? []).find((r) => r.key === selectedKey)?.label ?? "—"}
                  </span>
                </div>
              ) : null}

              {error ? <div className={cx("text-xs", isTrip ? "text-red-300" : "text-red-600")}>{error}</div> : null}
            </div>
          ) : (
            <div className="max-h-[50vh] overflow-auto pr-1 space-y-4">
              {grouped.length === 0 ? (
                <div className="text-sm text-zinc-600">No reasons available for these roles.</div>
              ) : (
                grouped.map(([role, items]) => (
                  <div key={role}>
                    <div className="text-[11px] font-semibold tracking-wide text-zinc-700 uppercase">{role}</div>

                    <div className="mt-2 space-y-2">
                      {items.map((r) => {
                        const active = selectedKey === r.key;
                        return (
                          <button
                            key={r.key}
                            type="button"
                            onClick={() => setSelectedKey(r.key)}
                            className={cx(
                              "w-full text-left rounded-xl border px-3 py-2 text-sm transition",
                              active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                            )}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* actions */}
          <div className={cx("mt-4 flex items-center justify-end gap-2 pt-4", isTrip ? "border-t border-[#224949]" : "border-t border-zinc-200")}>
            <button
              type="button"
              onClick={() => {
                if (loading) return;
                resetSelection();
                onClose();
              }}
              className={cx(
                "rounded-xl border px-4 py-2 text-sm font-semibold",
                isTrip
                  ? "border-[#224949] bg-[#0F1212] text-white/70 hover:text-white hover:bg-white/5"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              )}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={() => {
                if (!selectedKey || loading) return;
                const reasonKey = selectedKey;
                resetSelection();
                onConfirm(reasonKey);
              }}
              className={cx(
                "rounded-xl px-4 py-2 text-sm font-semibold",
                selectedKey && !loading
                  ? isTrip
                    ? "bg-gradient-to-r from-[#0df2f2] to-[#f20db1] text-white hover:opacity-90"
                    : "bg-zinc-900 text-white hover:bg-zinc-800"
                  : isTrip
                    ? "bg-white/10 text-white/40 cursor-not-allowed"
                    : "bg-zinc-200 text-zinc-600 cursor-not-allowed"
              )}
              disabled={!selectedKey || loading}
            >
              {loading ? "Sending…" : context === "trip" ? "Send request" : "Connect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
