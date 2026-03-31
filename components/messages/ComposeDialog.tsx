"use client";

import Image, { type ImageLoaderProps } from "next/image";
import Link from "next/link";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type ComposeConnectionTarget = {
  connectionId: string;
  otherUserId: string;
  displayName: string;
  subtitle: string;
  avatarUrl: string | null;
};

type ComposeTripTarget = {
  tripId: string;
  displayName: string;
  subtitle: string;
};

type ComposeDialogProps = {
  composeQuery: string;
  filteredComposeConnections: ComposeConnectionTarget[];
  filteredComposeTrips: ComposeTripTarget[];
  setComposeQuery: (value: string) => void;
  onClose: () => void;
  onSelectConnection: (target: ComposeConnectionTarget) => void;
  onSelectTrip: (target: ComposeTripTarget) => void;
};

const remoteImageLoader = ({ src }: ImageLoaderProps) => src;

export default function ComposeDialog({
  composeQuery,
  filteredComposeConnections,
  filteredComposeTrips,
  setComposeQuery,
  onClose,
  onSelectConnection,
  onSelectTrip,
}: ComposeDialogProps) {
  useBodyScrollLock(true);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 px-4 py-4 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#121414] shadow-[0_30px_60px_rgba(0,0,0,0.45)] sm:max-h-[min(88dvh,760px)] sm:rounded-2xl">
        <div className="h-px w-full bg-gradient-to-r from-[#0df2f2]/60 via-[#0df2f2]/10 to-[#f20db1]/60" />
        <div className="flex min-h-0 flex-1 flex-col p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">Start New Thread</h3>
            <button type="button" onClick={onClose} className="text-white/55 hover:text-white" aria-label="Close composer">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="mt-3 relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">search</span>
            <input
              value={composeQuery}
              onChange={(event) => setComposeQuery(event.target.value)}
              placeholder="Search connection or trip..."
              className="w-full rounded-xl border border-white/15 bg-black/25 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none"
            />
          </div>

          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
            {filteredComposeConnections.length === 0 && filteredComposeTrips.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-slate-400 space-y-3">
                <p>No eligible connections or trips available yet.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href="/connections"
                    className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                  >
                    Find Connections
                  </Link>
                  <Link
                    href="/trips"
                    className="rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-300/30 hover:text-cyan-100"
                  >
                    Browse Trips
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {filteredComposeConnections.length > 0 ? (
                  <div className="space-y-2">
                    <p className="px-1 text-[11px] font-bold uppercase tracking-widest text-cyan-200/80">Connections</p>
                    {filteredComposeConnections.map((target) => (
                      <button
                        key={target.connectionId}
                        type="button"
                        onClick={() => onSelectConnection(target)}
                        className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-left hover:border-cyan-300/30 hover:bg-[#1e2f2f]"
                      >
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[#223838]">
                          {target.avatarUrl ? (
                            <Image
                              src={target.avatarUrl}
                              alt={target.displayName}
                              fill
                              sizes="40px"
                              loader={remoteImageLoader}
                              unoptimized
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-cyan-100/80">
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                                person
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{target.displayName}</p>
                          <p className="truncate text-xs text-slate-400">{target.subtitle}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {filteredComposeTrips.length > 0 ? (
                  <div className="space-y-2">
                    <p className="px-1 text-[11px] font-bold uppercase tracking-widest text-cyan-200/80">Trips</p>
                    {filteredComposeTrips.map((target) => (
                      <button
                        key={target.tripId}
                        type="button"
                        onClick={() => onSelectTrip(target)}
                        className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-left hover:border-cyan-300/30 hover:bg-[#1e2f2f]"
                      >
                        <div className="h-10 w-10 shrink-0 rounded-full bg-[#223838] flex items-center justify-center text-cyan-200">
                          <span className="material-symbols-outlined">luggage</span>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{target.displayName}</p>
                          <p className="truncate text-xs text-slate-400">{target.subtitle}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
