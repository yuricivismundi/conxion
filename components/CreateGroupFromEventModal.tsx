"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const MAX_MEMBERS = 25;
const MIN_TITLE = 8;
const MAX_TITLE = 50;
const MIN_DESCRIPTION = 10;

type Person = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  isAttending: boolean; // false = connection not attending
};

type Props = {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  accessToken: string;
  attendees: Person[]; // people with going/interested/waitlist status
  connections: Person[]; // user's connections (isAttending already set)
  monthlyLimit?: number | null; // max groups user can create per month
};

function Avatar({ url, name, size = 32 }: { url: string | null; name: string; size?: number }) {
  if (url) {
    return (
      <div className="relative shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
        <Image src={url} alt={name} fill sizes={`${size}px`} className="object-cover" unoptimized />
      </div>
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-[#1a2a2a] text-cyan-300/60"
      style={{ width: size, height: size }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: size * 0.5 }}>person</span>
    </div>
  );
}

export default function CreateGroupFromEventModal({
  open,
  onClose,
  eventId,
  eventTitle,
  accessToken,
  attendees,
  connections,
  monthlyLimit,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"attendees" | "connections">("attendees");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Pre-fill title when modal opens
  useEffect(() => {
    if (open) {
      const base = eventTitle.replace(/festival|congress|event/gi, "").trim();
      setTitle(base ? `${base} Crew` : "");
      setDescription("");
      setSelectedIds(new Set());
      setQuery("");
      setError(null);
      setTab("attendees");
    }
  }, [open, eventTitle]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredList = useMemo(() => {
    const list = tab === "attendees" ? attendees : connections;
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.displayName.toLowerCase().includes(q));
  }, [tab, attendees, connections, query]);

  function toggleSelect(userId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        if (next.size >= MAX_MEMBERS - 1) {
          setError(`Groups are limited to ${MAX_MEMBERS} members.`);
          return prev;
        }
        setError(null);
        next.add(userId);
      }
      return next;
    });
  }

  async function handleCreate() {
    setError(null);
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < MIN_TITLE) {
      setError(`Group name must be at least ${MIN_TITLE} characters.`);
      return;
    }
    if (trimmedTitle.length > MAX_TITLE) {
      setError(`Group name must be ${MAX_TITLE} characters or less.`);
      return;
    }
    const trimmedDesc = description.trim();
    if (trimmedDesc.length < MIN_DESCRIPTION) {
      setError(`Description must be at least ${MIN_DESCRIPTION} characters.`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: trimmedTitle,
          description: trimmedDesc,
          chatMode: "discussion",
          eventId,
          memberIds: Array.from(selectedIds),
        }),
      });
      const json = (await res.json()) as { ok: boolean; group_id?: string; error?: string };
      if (!json.ok || !json.group_id) {
        setError(json.error ?? "Failed to create group.");
        return;
      }
      onClose();
      router.push(`/groups/${json.group_id}`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const selectedCount = selectedIds.size + 1; // +1 for creator
  const canSubmit = title.trim().length >= MIN_TITLE && description.trim().length >= MIN_DESCRIPTION;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="flex w-full max-w-lg flex-col rounded-[28px] border border-white/10 bg-[#0d1117] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-bold text-white">Create Group</h2>
            {monthlyLimit != null && (
              <p className="mt-0.5 text-[12px] text-white/40">
                Up to <span className="font-semibold text-cyan-400">{monthlyLimit}</span> groups/month on your plan
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/40 hover:bg-white/8 hover:text-white"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5" style={{ maxHeight: "70vh" }}>
          {/* Group name */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-cyan-400/80">Group name</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE}
              placeholder="e.g. Barcelona Festival Crew"
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none focus:border-cyan-400/40"
            />
            <p className="mt-1 text-right text-[11px] text-white/30">{title.length}/{MAX_TITLE}</p>
          </div>

          {/* Description — required */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-cyan-400/80">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What's this group for?"
              className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none focus:border-cyan-400/40"
            />
          </div>

          {/* Member selection */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-cyan-400/80">Select members</label>
              <span className="text-[12px] font-semibold text-white/40">
                {selectedCount} / {MAX_MEMBERS} selected
              </span>
            </div>

            {/* Tabs */}
            <div className="mb-3 flex gap-1 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-1">
              {(["attendees", "connections"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTab(t); setQuery(""); }}
                  className={[
                    "flex-1 rounded-xl py-1.5 text-[12px] font-semibold transition",
                    tab === t
                      ? "bg-gradient-to-r from-cyan-500/20 to-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/30"
                      : "text-white/40 hover:text-white/60",
                  ].join(" ")}
                >
                  {t === "attendees" ? "Attendees" : "Connections"}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative mb-2">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-white/30">search</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-2 pl-8 pr-3 text-[13px] text-white placeholder-white/25 outline-none focus:border-cyan-400/30"
              />
            </div>

            {/* List */}
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {filteredList.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-white/30">
                  {tab === "attendees" ? "No attendees found" : "No connections found"}
                </p>
              ) : (
                filteredList.map((person) => {
                  const selected = selectedIds.has(person.userId);
                  return (
                    <button
                      key={person.userId}
                      type="button"
                      onClick={() => toggleSelect(person.userId)}
                      className={[
                        "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition",
                        selected ? "bg-cyan-400/10 ring-1 ring-cyan-400/20" : "hover:bg-white/[0.04]",
                      ].join(" ")}
                    >
                      <Avatar url={person.avatarUrl} name={person.displayName} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-white">{person.displayName}</p>
                        {tab === "connections" && !person.isAttending && (
                          <p className="text-[11px] text-white/35">Not attending</p>
                        )}
                      </div>
                      <div className={[
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition",
                        selected ? "border-cyan-400 bg-cyan-400" : "border-white/20",
                      ].join(" ")}>
                        {selected && <span className="material-symbols-outlined text-[12px] text-[#0d1117]">check</span>}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {error && (
            <p className="rounded-2xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[12px] text-red-300">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-white/[0.07] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-white/10 py-2.5 text-sm font-semibold text-white/60 hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy || !canSubmit}
            className="flex-1 rounded-2xl bg-gradient-to-r from-cyan-500 to-cyan-400 py-2.5 text-sm font-bold text-[#0d1117] transition hover:from-cyan-400 hover:to-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create Group"}
          </button>
        </div>
      </div>
    </div>
  );
}
