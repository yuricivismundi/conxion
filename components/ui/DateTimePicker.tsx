"use client";

import { useEffect, useRef, useState } from "react";

// ── helpers ────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }

function fmt12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = (h ?? 0) >= 12 ? "PM" : "AM";
  const h12 = (h ?? 0) % 12 || 12;
  return `${h12}:${pad(m ?? 0)} ${ampm}`;
}

function toDateDisplay(yyyy_mm_dd: string) {
  if (!yyyy_mm_dd) return "";
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ALL_TIMES: string[] = [];
for (let h = 0; h < 24; h++)
  for (let m = 0; m < 60; m += 15)
    ALL_TIMES.push(`${pad(h)}:${pad(m)}`);

function nextSlot(): string {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const next = Math.ceil((mins + 1) / 15) * 15;
  return `${pad(Math.floor(next / 60) % 24)}:${pad(next % 60)}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Dropdown wrapper (fixed position) ─────────────────────────────────────

function Dropdown({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dropH = 320;
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow >= dropH ? r.bottom + 4 : r.top - dropH - 4;
    setPos({ top, left: r.left, width: r.width });
  }, [anchorRef]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return (
    <>
      <div className="fixed inset-0 z-[59]" onClick={onClose} />
      <div
        ref={ref}
        className="fixed z-[60] overflow-hidden rounded-2xl border border-white/12 bg-[#181c20] shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
        style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}

// ── CalendarPicker ─────────────────────────────────────────────────────────

export function CalendarPicker({
  value,
  onChange,
  minDate,
  maxDate,
  label,
  icon,
}: {
  value: string;
  onChange: (yyyy_mm_dd: string) => void;
  minDate?: string;
  maxDate?: string;
  label?: string;
  icon?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const today = todayStr();
  const min = minDate ?? today;
  const max = maxDate ?? "";

  const initialYear = value ? Number(value.split("-")[0]) : new Date().getFullYear();
  const initialMonth = value ? Number(value.split("-")[1]!) - 1 : new Date().getMonth();
  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);

  function nav(dir: -1 | 1) {
    const d = new Date(viewYear, viewMonth + dir, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDay).fill(null)];
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-left transition ${
          open ? "border-[#00f5ff]/50 bg-[#00f5ff]/5" : "border-white/10 bg-black/20 hover:border-white/20"
        }`}
      >
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <span className="material-symbols-outlined text-[13px]">{icon ?? "calendar_month"}</span>
          {label ?? "Date"}
        </span>
        <span className="text-sm font-semibold text-white">{value ? toDateDisplay(value) : "—"}</span>
      </button>

      {open && (
        <Dropdown anchorRef={btnRef} onClose={() => setOpen(false)}>
          <div className="w-72 p-4">
            {/* Month nav */}
            <div className="mb-3 flex items-center justify-between">
              <button type="button" onClick={() => nav(-1)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10 text-white/60 hover:text-white transition">
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              <p className="text-sm font-bold text-white">{monthLabel}</p>
              <button
                type="button"
                onClick={() => nav(1)}
                disabled={max ? `${viewYear}-${pad(viewMonth + 1)}` >= max.slice(0, 7) : false}
                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10 text-white/60 hover:text-white transition disabled:opacity-25 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS_SHORT.map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-slate-500 pb-1">{d}</div>
              ))}
            </div>
            {/* Cells */}
            <div className="grid grid-cols-7">
              {cells.map((day, i) => {
                if (!day) return <div key={i} />;
                const key = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
                const isSelected = key === value;
                const isToday = key === today;
                const disabled = key < min || (max ? key > max : false);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    onClick={() => { onChange(key); setOpen(false); }}
                    className={`mx-auto mb-0.5 flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium transition
                      ${isSelected ? "bg-[#00f5ff] text-[#071018] font-bold" : ""}
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
          </div>
        </Dropdown>
      )}
    </div>
  );
}

// ── TimePicker ─────────────────────────────────────────────────────────────

export function TimePickerDropdown({
  value,
  onChange,
  dateValue,
  label,
  icon,
}: {
  value: string;
  onChange: (hhmm: string) => void;
  dateValue?: string;
  label?: string;
  icon?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const today = todayStr();
  const isToday = dateValue === today;
  const minTime = isToday ? nextSlot() : "00:00";
  const options = ALL_TIMES.filter((t) => t >= minTime);

  useEffect(() => {
    if (open) {
      setTimeout(() => selectedRef.current?.scrollIntoView({ block: "center" }), 30);
    }
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-left transition ${
          open ? "border-[#00f5ff]/50 bg-[#00f5ff]/5" : "border-white/10 bg-black/20 hover:border-white/20"
        }`}
      >
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <span className="material-symbols-outlined text-[13px]">{icon ?? "schedule"}</span>
          {label ?? "Time"}
        </span>
        <span className="text-sm font-semibold text-white">{value ? fmt12(value) : "—"}</span>
      </button>

      {open && (
        <Dropdown anchorRef={btnRef} onClose={() => setOpen(false)}>
          <div className="w-44 max-h-72 overflow-y-auto overscroll-contain py-1">
            {options.map((t) => {
              const isSelected = t === value;
              return (
                <button
                  key={t}
                  ref={isSelected ? selectedRef : undefined}
                  type="button"
                  onClick={() => { onChange(t); setOpen(false); }}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left transition ${
                    isSelected ? "bg-white/[0.06] text-white" : "text-white/70 hover:bg-white/[0.05]"
                  }`}
                >
                  <span className="text-[13px] font-medium">{fmt12(t)}</span>
                  {isSelected && <span className="material-symbols-outlined text-[16px] text-[#00f5ff]">check</span>}
                </button>
              );
            })}
          </div>
        </Dropdown>
      )}
    </div>
  );
}
