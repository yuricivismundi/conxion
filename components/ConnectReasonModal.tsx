// /components/ConnectReasonModal.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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
  loading = false,
  onConfirm,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string>("");

  useEffect(() => {
    if (!open) setSelectedKey("");
  }, [open]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* overlay */}
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={() => {
          if (loading) return;
          onClose();
        }}
        aria-label="Close"
      />

      {/* modal */}
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 truncate">Connect with {targetName}</div>
            <div className="mt-1 text-xs text-zinc-600">Roles: {(targetRoles ?? []).length ? targetRoles.join(", ") : "—"}</div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (loading) return;
              onClose();
            }}
            className={cx("h-9 w-9 rounded-xl border border-zinc-200 text-zinc-700 hover:bg-zinc-50", loading && "opacity-50 cursor-not-allowed")}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          {/* list */}
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

          {/* actions */}
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-zinc-200 pt-4">
            <button
              type="button"
              onClick={() => {
                if (loading) return;
                onClose();
              }}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={() => {
                if (!selectedKey || loading) return;
                onConfirm(selectedKey);
              }}
              className={cx(
                "rounded-xl px-4 py-2 text-sm font-semibold",
                selectedKey && !loading ? "bg-zinc-900 text-white hover:bg-zinc-800" : "bg-zinc-200 text-zinc-600 cursor-not-allowed"
              )}
              disabled={!selectedKey || loading}
            >
              {loading ? "Sending…" : "Connect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}