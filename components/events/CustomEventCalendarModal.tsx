"use client";

import { useState, useMemo, useRef, useEffect } from "react";

export type TimeSlot = { id: string; start: string; end: string };
export type SelectedDate = { dateKey: string; slots: TimeSlot[] };

type Props = {
  maxDates?: number;
  initialDates?: SelectedDate[];
  defaultStartTime?: string;
  onClose: () => void;
  onDone: (dates: SelectedDate[]) => void;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Generate all 15-min intervals as "HH:MM" strings
const ALL_TIMES: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    ALL_TIMES.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function fmt12(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = (h ?? 0) >= 12 ? "PM" : "AM";
  const h12 = (h ?? 0) % 12 || 12;
  return `${h12}:${String(m ?? 0).padStart(2, "0")} ${ampm}`;
}

function toMins(t: string) {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function durationLabel(start: string, end: string): string {
  const s = toMins(start);
  let e = toMins(end);
  if (e <= s) e += 24 * 60; // overnight
  const diff = e - s;
  const hrs = Math.floor(diff / 60);
  const mins = diff % 60;
  if (hrs === 0) return `${mins} mins`;
  if (mins === 0) return `${hrs} hr${hrs !== 1 ? "s" : ""}`;
  return `${hrs} hr ${mins} mins`;
}

function isOvernight(start: string, end: string) {
  return toMins(end) <= toMins(start);
}

function defaultEnd(start: string): string {
  // 12 hours after start, wrapping
  const mins = (toMins(start) + 12 * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function newId() { return Math.random().toString(36).slice(2); }

function formatDateKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function formatDisplay(key: string) {
  return parseDateKey(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatRangeLabel(keys: string[]) {
  if (!keys.length) return "";
  const sorted = [...keys].sort();
  const fmt = (k: string) => parseDateKey(k).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return sorted.length === 1 ? fmt(sorted[0]!) : `${fmt(sorted[0]!)} – ${fmt(sorted[sorted.length - 1]!)}`;
}

function getMonthGrid(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// Scrollable time list picker
function TimePicker({
  label,
  value,
  options,
  onSelect,
  getLabel,
  disabledValue,
}: {
  label: string;
  value: string;
  options: string[];
  onSelect: (t: string) => void;
  getLabel?: (t: string) => React.ReactNode;
  disabledValue?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center" });
  }, [value]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/16 bg-[#1a1e22]">
      <p className="border-b border-white/8 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-[#00f5ff]/70">{label}</p>
      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain">
        {options.map((t) => {
          const isSelected = t === value;
          const isDisabled = t === disabledValue;
          return (
            <button
              key={t}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(t)}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left transition ${
                isDisabled ? "cursor-not-allowed text-white/20" :
                isSelected ? "bg-[#00f5ff]/10 text-[#00f5ff]" : "text-white/70 hover:bg-white/5"
              }`}
            >
              <span className="text-[13px] font-semibold">{fmt12(t)}</span>
              {getLabel ? <span className="text-[11px] text-white/35">{getLabel(t)}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Next 15-min slot from now
function nextAvailableTime(): string {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const next = Math.ceil((mins + 1) / 15) * 15;
  const h = Math.floor(next / 60) % 24;
  const m = next % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Inline Add/Edit Time picker card
function AddTimePicker({
  dateKey,
  todayKey,
  allDateKeys,
  editSlot,
  onAdd,
  onSave,
  onCancel,
}: {
  dateKey: string;
  todayKey: string;
  allDateKeys: string[];
  editSlot?: TimeSlot;
  onAdd: (slot: TimeSlot, applyAll: boolean) => void;
  onSave?: (slot: TimeSlot) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(editSlot);
  const isToday = dateKey === todayKey;
  const firstAvailable = isToday && !isEdit ? nextAvailableTime() : "00:00";

  const [startTime, setStartTime] = useState(() => {
    if (editSlot) return editSlot.start;
    return ALL_TIMES.find((t) => t >= firstAvailable) ?? "20:00";
  });
  const [endTime, setEndTime] = useState(() => editSlot ? editSlot.end : defaultEnd(startTime));
  const [applyAll, setApplyAll] = useState(false);
  const [focus, setFocus] = useState<"start" | "end">("start");

  function handleStartSelect(t: string) {
    setStartTime(t);
    setEndTime(defaultEnd(t));
    setFocus("end");
  }

  const startOptions = isToday ? ALL_TIMES.filter((t) => t >= firstAvailable) : ALL_TIMES;
  const endOptions = ALL_TIMES.filter((t) => t !== startTime);

  return (
    <div className="mt-2 rounded-2xl border border-white/12 bg-[#141618] p-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      {/* Start / End tabs */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setFocus("start")}
          className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition ${
            focus === "start" ? "border-[#00f5ff]/60 bg-[#00f5ff]/5" : "border-white/10 bg-white/[0.02]"
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Start time</p>
          <p className={`mt-0.5 text-sm font-bold ${focus === "start" ? "text-[#00f5ff]" : "text-white"}`}>{fmt12(startTime)}</p>
        </button>
        <button
          type="button"
          onClick={() => setFocus("end")}
          className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition ${
            focus === "end" ? "border-[#00f5ff]/60 bg-[#00f5ff]/5" : "border-white/10 bg-white/[0.02]"
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">End time</p>
          <p className={`mt-0.5 text-sm font-bold ${focus === "end" ? "text-[#00f5ff]" : "text-white"}`}>
            {fmt12(endTime)}{isOvernight(startTime, endTime) ? " (overnight)" : ""}
          </p>
        </button>
      </div>

      {/* Scrollable list */}
      <div className="mt-2 flex h-44 flex-col overflow-hidden rounded-xl">
        {focus === "start" ? (
          <TimePicker label="Start time" value={startTime} options={startOptions} onSelect={handleStartSelect} disabledValue={startTime} />
        ) : (
          <TimePicker
            label="End time"
            value={endTime}
            options={endOptions}
            onSelect={setEndTime}
            disabledValue={endTime}
            getLabel={(t) => {
              const label = durationLabel(startTime, t);
              const overnight = isOvernight(startTime, t);
              return overnight ? `${label} (overnight)` : label;
            }}
          />
        )}
      </div>

      {/* Apply to all dates */}
      {allDateKeys.length > 1 && (
        <label className="mt-2.5 flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <input
            type="checkbox"
            checked={applyAll}
            onChange={(e) => setApplyAll(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded accent-[#00f5ff]"
          />
          <span className="text-[13px] font-semibold text-white/80">Add this time to all dates</span>
        </label>
      )}

      {/* Cancel / Add / Save */}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-white/12 bg-white/[0.04] py-2 text-sm font-semibold text-white/60 hover:bg-white/[0.08] transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (isEdit && editSlot && onSave) {
              onSave({ ...editSlot, start: startTime, end: endTime });
            } else {
              onAdd({ id: newId(), start: startTime, end: endTime }, applyAll);
            }
          }}
          className="flex-1 rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 py-2 text-sm font-bold text-[#071018] hover:brightness-110 transition"
        >
          {isEdit ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );
}

export default function CustomEventCalendarModal({
  maxDates = 2,
  initialDates = [],
  defaultStartTime = "20:00",
  onClose,
  onDone,
}: Props) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [selected, setSelected] = useState<SelectedDate[]>(initialDates);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<{ dateKey: string; slot: TimeSlot } | null>(null);

  const months = useMemo(() => {
    const result = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      result.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return result;
  }, [today]);

  const maxDateKey = useMemo(() => {
    const d = new Date(today.getFullYear(), today.getMonth() + 3, 0);
    return formatDateKey(d.getFullYear(), d.getMonth(), d.getDate());
  }, [today]);

  const todayKey = formatDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedKeys = selected.map((s) => s.dateKey);
  const totalSlots = selected.reduce((acc, s) => acc + s.slots.length, 0);

  // Count selected dates in a given month (yyyy-MM prefix)
  function countInMonth(yearMonth: string) {
    return selected.filter((s) => s.dateKey.startsWith(yearMonth)).length;
  }

  function monthPrefix(key: string) { return key.slice(0, 7); }

  function toggleDate(key: string) {
    const idx = selected.findIndex((s) => s.dateKey === key);
    if (idx >= 0) {
      setSelected((prev) => prev.filter((s) => s.dateKey !== key));
      if (addingFor === key) setAddingFor(null);
    } else {
      if (countInMonth(monthPrefix(key)) >= maxDates) return;
      const endT = defaultEnd(defaultStartTime);
      setSelected((prev) =>
        [...prev, { dateKey: key, slots: [{ id: newId(), start: defaultStartTime, end: endT }] }]
          .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      );
    }
  }

  function removeSlot(dateKey: string, slotId: string) {
    setSelected((prev) =>
      prev.map((s) => s.dateKey === dateKey ? { ...s, slots: s.slots.filter((sl) => sl.id !== slotId) } : s)
    );
  }

  function handleSaveSlot(dateKey: string, updated: TimeSlot) {
    setSelected((prev) =>
      prev.map((s) =>
        s.dateKey === dateKey
          ? { ...s, slots: s.slots.map((sl) => sl.id === updated.id ? updated : sl) }
          : s
      )
    );
    setEditingSlot(null);
  }

  function handleAddSlot(dateKey: string, slot: TimeSlot, applyAll: boolean) {
    setSelected((prev) =>
      prev.map((s) => {
        if (s.dateKey === dateKey || applyAll) {
          return { ...s, slots: [...s.slots, { ...slot, id: newId() }] };
        }
        return s;
      })
    );
    setAddingFor(null);
  }

  function duplicateDate(dateKey: string) {
    const src = selected.find((s) => s.dateKey === dateKey);
    if (!src) return;
    const next = new Date(parseDateKey(dateKey).getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextKey = formatDateKey(next.getFullYear(), next.getMonth(), next.getDate());
    if (selected.find((s) => s.dateKey === nextKey) || nextKey > maxDateKey) return;
    if (countInMonth(monthPrefix(nextKey)) >= maxDates) return;
    setSelected((prev) =>
      [...prev, { dateKey: nextKey, slots: src.slots.map((sl) => ({ ...sl, id: newId() })) }]
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="flex h-[90dvh] max-h-[720px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#141618] shadow-[0_32px_80px_rgba(0,0,0,0.7)]">

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/60 hover:bg-white/[0.1] hover:text-white transition"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
          <h2 className="flex-1 text-center text-base font-bold text-white">Custom Event Calendar</h2>
          <div className="w-9" />
        </div>

        {/* Subheader */}
        <div className="flex items-center justify-between border-b border-white/6 bg-white/[0.02] px-5 py-2.5">
          <p className="text-sm font-semibold">
            <span className="text-[#00f5ff]">{selected.length} {selected.length === 1 ? "Date" : "Dates"}</span>
            {selected.length > 0 && (
              <span className="ml-2 text-white/40">{formatRangeLabel(selectedKeys)}</span>
            )}
          </p>
          <p className="text-sm font-semibold text-white/60">
            {totalSlots} {totalSlots === 1 ? "Time" : "Times"}
          </p>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left — Calendar */}
          <div className="w-[46%] shrink-0 overflow-y-auto border-r border-white/8 p-4">
            <p className="mb-3 text-[11px] text-slate-500">Up to {maxDates} per month · 3 months ahead</p>
            {months.map(({ year, month }) => {
              const cells = getMonthGrid(year, month);
              const monthLabel = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
              return (
                <div key={`${year}-${month}`} className="mb-6">
                  <p className="mb-3 text-center text-sm font-bold text-white">{monthLabel}</p>
                  <div className="grid grid-cols-7 text-center">
                    {DAYS.map((d) => (
                      <div key={d} className="pb-1.5 text-[10px] font-semibold text-slate-500">{d}</div>
                    ))}
                    {cells.map((day, i) => {
                      if (day === null) return <div key={i} />;
                      const key = formatDateKey(year, month, day);
                      const isToday = key === todayKey;
                      const isPast = key < todayKey;
                      const isBeyond = key > maxDateKey;
                      const isSelected = selectedKeys.includes(key);
                      const ym = `${String(year)}-${String(month + 1).padStart(2, "0")}`;
                      const monthFull = countInMonth(ym) >= maxDates;
                      const disabled = isPast || isBeyond || (!isSelected && monthFull);
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleDate(key)}
                          className={`mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium transition
                            ${isSelected ? "bg-[#00f5ff] text-[#071018] font-bold shadow-[0_0_10px_rgba(0,245,255,0.35)]" : ""}
                            ${!isSelected && isToday ? "border border-[#00f5ff]/50 text-[#00f5ff]" : ""}
                            ${!isSelected && !isToday && !disabled ? "text-white/80 hover:bg-white/10" : ""}
                            ${disabled ? "text-white/20 cursor-not-allowed" : "cursor-pointer"}
                          `}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 h-px bg-white/6" />
                </div>
              );
            })}
          </div>

          {/* Right — Selected dates + time slots */}
          <div className="flex-1 overflow-y-auto p-4">
            {selected.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <p className="text-sm text-slate-500">Tap dates on the calendar<br />to schedule your events</p>
              </div>
            ) : (
              <div className="space-y-5">
                {selected.map((item) => (
                  <div key={item.dateKey} className="border-b border-white/8 pb-4 last:border-0">
                    {/* Date header */}
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">{formatDisplay(item.dateKey)}</p>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Duplicate to next week"
                          onClick={() => duplicateDate(item.dateKey)}
                          disabled={false}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/35 hover:bg-white/8 hover:text-white/70 disabled:opacity-25 transition"
                        >
                          <span className="material-symbols-outlined text-[15px]">content_copy</span>
                        </button>
                        <button
                          type="button"
                          title="Remove date"
                          onClick={() => setSelected((prev) => prev.filter((s) => s.dateKey !== item.dateKey))}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/35 hover:bg-white/8 hover:text-rose-400 transition"
                        >
                          <span className="material-symbols-outlined text-[15px]">delete</span>
                        </button>
                      </div>
                    </div>

                    {/* Existing time slots */}
                    <div className="mt-1.5 space-y-1">
                      {item.slots.map((slot) => {
                        const isEditing = editingSlot?.dateKey === item.dateKey && editingSlot.slot.id === slot.id;
                        return (
                          <div key={slot.id}>
                            {isEditing ? (
                              <AddTimePicker
                                dateKey={item.dateKey}
                                todayKey={todayKey}
                                allDateKeys={selectedKeys}
                                editSlot={slot}
                                onAdd={() => {}}
                                onSave={(updated) => handleSaveSlot(item.dateKey, updated)}
                                onCancel={() => setEditingSlot(null)}
                              />
                            ) : (
                              <div className="group flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-1.5 hover:bg-white/[0.06] transition">
                                <button
                                  type="button"
                                  onClick={() => { setEditingSlot({ dateKey: item.dateKey, slot }); setAddingFor(null); }}
                                  className="flex-1 text-left text-[13px] text-white/75"
                                >
                                  {fmt12(slot.start)} – {fmt12(slot.end)}
                                  {isOvernight(slot.start, slot.end) ? <span className="ml-1 text-white/35">(overnight)</span> : null}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeSlot(item.dateKey, slot.id)}
                                  className="ml-2 flex h-5 w-5 items-center justify-center rounded text-white/25 hover:text-rose-400 transition"
                                >
                                  <span className="material-symbols-outlined text-[13px]">close</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Add Time picker or button */}
                    {addingFor === item.dateKey ? (
                      <AddTimePicker
                        dateKey={item.dateKey}
                        todayKey={todayKey}
                        allDateKeys={selectedKeys}
                        onAdd={(slot, applyAll) => handleAddSlot(item.dateKey, slot, applyAll)}
                        onCancel={() => setAddingFor(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingFor(item.dateKey)}
                        className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#00f5ff]/80 hover:text-[#00f5ff] transition"
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span>
                        Add Time
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/12 bg-black/25 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-black/40 transition">
            Cancel
          </button>
          <button type="button" onClick={() => onDone(selected)} className="rounded-xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-6 py-2.5 text-sm font-bold text-[#071018] hover:brightness-110 transition">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
