"use client";

import type { Dispatch, SetStateAction } from "react";

import type {
  DanceMoveDifficulty,
  DanceMovePracticeLog,
  DanceMoveStatus,
  DanceMoveType,
  DanceMoveUser,
} from "@/lib/growth/types";

type MoveDetailFormState = {
  confidence: "" | "1" | "2" | "3" | "4" | "5";
  difficulty: DanceMoveDifficulty;
  moveType: DanceMoveType;
  referenceUrl: string;
  keyCue: string;
  commonMistake: string;
  fixTip: string;
  note: string;
};

type MoveDetailDialogProps = {
  activeMove: DanceMoveUser;
  moveDetailForm: MoveDetailFormState;
  setMoveDetailForm: Dispatch<SetStateAction<MoveDetailFormState>>;
  moveDifficulties: DanceMoveDifficulty[];
  moveTypes: DanceMoveType[];
  practiceQuickNote: string;
  setPracticeQuickNote: Dispatch<SetStateAction<string>>;
  movePracticeLogs: DanceMovePracticeLog[];
  loadingMoveDetail: boolean;
  savingMoveDetail: boolean;
  loggingPractice: boolean;
  deletingMove: boolean;
  onClose: () => void;
  onSave: () => void;
  onLogPractice: () => void;
  onDelete: () => void;
  formatRelative: (value: string | null | undefined) => string;
  moveTypeLabel: (value: DanceMoveType) => string;
  statusToLabel: (value: DanceMoveStatus) => string;
  titleCase: (value: string) => string;
};

export default function MoveDetailDialog({
  activeMove,
  moveDetailForm,
  setMoveDetailForm,
  moveDifficulties,
  moveTypes,
  practiceQuickNote,
  setPracticeQuickNote,
  movePracticeLogs,
  loadingMoveDetail,
  savingMoveDetail,
  loggingPractice,
  deletingMove,
  onClose,
  onSave,
  onLogPractice,
  onDelete,
  formatRelative,
  moveTypeLabel,
  statusToLabel,
  titleCase,
}: MoveDetailDialogProps) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-white/15 bg-[#080b12] shadow-[0_30px_80px_rgba(0,0,0,0.65)]">
        <div className="border-b border-white/10 bg-gradient-to-r from-cyan-400/15 to-fuchsia-500/12 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-white">{activeMove.name}</h3>
              <p className="mt-1 text-sm text-slate-300">
                {titleCase(activeMove.style)} • {moveTypeLabel(activeMove.moveType)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-xs font-semibold text-slate-200">
                  {statusToLabel(activeMove.status)}
                </span>
                <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-xs font-semibold text-cyan-100">
                  Confidence {activeMove.confidence ?? "-"} / 5
                </span>
                <span className="rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-xs text-slate-300">
                  Last practiced: {formatRelative(activeMove.lastPracticedAt)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/20 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/[0.1]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto px-5 py-4">
          <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-300">Update move</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Confidence
                <select
                  value={moveDetailForm.confidence}
                  onChange={(event) =>
                    setMoveDetailForm((prev) => ({
                      ...prev,
                      confidence: event.target.value as MoveDetailFormState["confidence"],
                    }))
                  }
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                >
                  <option value="">None</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Difficulty
                <select
                  value={moveDetailForm.difficulty}
                  onChange={(event) =>
                    setMoveDetailForm((prev) => ({ ...prev, difficulty: event.target.value as DanceMoveDifficulty }))
                  }
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                >
                  {moveDifficulties.map((difficulty) => (
                    <option key={difficulty} value={difficulty}>
                      {titleCase(difficulty)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Type
                <select
                  value={moveDetailForm.moveType}
                  onChange={(event) =>
                    setMoveDetailForm((prev) => ({ ...prev, moveType: event.target.value as DanceMoveType }))
                  }
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white"
                >
                  {moveTypes.map((moveType) => (
                    <option key={moveType} value={moveType}>
                      {moveTypeLabel(moveType)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
                Reference URL
                <input
                  value={moveDetailForm.referenceUrl}
                  onChange={(event) => setMoveDetailForm((prev) => ({ ...prev, referenceUrl: event.target.value }))}
                  placeholder="https://youtube.com/..."
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                Key cue
                <input
                  maxLength={500}
                  value={moveDetailForm.keyCue}
                  onChange={(event) => setMoveDetailForm((prev) => ({ ...prev, keyCue: event.target.value }))}
                  placeholder="Keep frame, stay grounded..."
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                Common mistake
                <input
                  maxLength={500}
                  value={moveDetailForm.commonMistake}
                  onChange={(event) => setMoveDetailForm((prev) => ({ ...prev, commonMistake: event.target.value }))}
                  placeholder="Losing timing on count..."
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                Fix
                <input
                  maxLength={500}
                  value={moveDetailForm.fixTip}
                  onChange={(event) => setMoveDetailForm((prev) => ({ ...prev, fixTip: event.target.value }))}
                  placeholder="Slow down, isolate, then speed up."
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400 sm:col-span-2">
                More notes
                <textarea
                  maxLength={500}
                  rows={3}
                  value={moveDetailForm.note}
                  onChange={(event) => setMoveDetailForm((prev) => ({ ...prev, note: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
                <span className="text-[10px] text-slate-500">{moveDetailForm.note.length}/500</span>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={onSave}
                disabled={savingMoveDetail}
                className="rounded-lg bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-[#06121a] disabled:opacity-60"
              >
                {savingMoveDetail ? "Saving..." : "Save details"}
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">Log practice</h4>
            <p className="mb-3 text-xs text-slate-400">+1 session, update last practiced, optional quick note.</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                maxLength={500}
                value={practiceQuickNote}
                onChange={(event) => setPracticeQuickNote(event.target.value)}
                placeholder="How did it feel?"
                className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={onLogPractice}
                disabled={loggingPractice}
                className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-60"
              >
                {loggingPractice ? "Logging..." : "Log practice"}
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">Practice history</h4>
            {loadingMoveDetail ? (
              <p className="text-xs text-slate-500">Loading history…</p>
            ) : movePracticeLogs.length === 0 ? (
              <p className="text-xs text-slate-500">No practice logs yet.</p>
            ) : (
              <div className="space-y-2">
                {movePracticeLogs.map((item) => (
                  <div key={item.id} className="rounded-xl border border-white/10 bg-black/35 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-300">Practiced {formatRelative(item.createdAt)}</p>
                      <p className="text-[11px] text-slate-400">Confidence: {item.confidenceAfter ?? "-"}</p>
                    </div>
                    {item.quickNote ? <p className="mt-1 text-xs text-slate-400">{item.quickNote}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4">
            <h4 className="text-sm font-bold uppercase tracking-wide text-rose-100">Danger zone</h4>
            <p className="mt-1 text-xs text-rose-100/80">Delete this move permanently.</p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onDelete}
                disabled={deletingMove}
                className="rounded-lg border border-rose-300/40 bg-rose-400/20 px-4 py-2 text-sm font-semibold text-rose-100 disabled:opacity-60"
              >
                {deletingMove ? "Deleting..." : "Delete move"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
