"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SearchableMobileSelectProps = {
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  disabled?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  buttonClassName?: string;
  allowCustomValue?: boolean;
  customValueLabel?: (value: string) => string;
  onSelect: (value: string) => void;
};

const MAX_VISIBLE_OPTIONS = 120;

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

export default function SearchableMobileSelect({
  label,
  value,
  options,
  placeholder,
  disabled = false,
  searchPlaceholder,
  emptyMessage = "No matches found.",
  buttonClassName,
  allowCustomValue = false,
  customValueLabel,
  onSelect,
}: SearchableMobileSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredOptions = useMemo(() => {
    const needle = normalizeSearchValue(query);
    const matches = needle
      ? options.filter((option) => normalizeSearchValue(option).includes(needle))
      : options;
    return matches.slice(0, MAX_VISIBLE_OPTIONS);
  }, [options, query]);

  const totalMatchCount = useMemo(() => {
    const needle = normalizeSearchValue(query);
    if (!needle) return options.length;
    return options.filter((option) => normalizeSearchValue(option).includes(needle)).length;
  }, [options, query]);

  const trimmedQuery = query.trim();
  const hasExactMatch = useMemo(
    () => options.some((option) => normalizeSearchValue(option) === normalizeSearchValue(trimmedQuery)),
    [options, trimmedQuery]
  );
  const canUseCustomValue = allowCustomValue && trimmedQuery.length > 0 && !hasExactMatch;

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 30);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const triggerClassName =
    buttonClassName ??
    "inline-flex min-h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-left text-sm text-[#E0E0E0]";

  const selectOption = (nextValue: string) => {
    onSelect(nextValue);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        aria-label={value ? `${label}: ${value}` : `Select ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={triggerClassName}
      >
        <span className={value ? "" : "text-white/35"}>{value || placeholder}</span>
        <span className="material-symbols-outlined text-[18px] text-white/45">search</span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[160] sm:hidden">
              <button
                type="button"
                aria-label={`Close ${label} picker`}
                className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
                onClick={() => setOpen(false)}
              />

              <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-hidden rounded-t-[28px] border border-white/10 bg-[#081018] shadow-[0_-18px_60px_rgba(0,0,0,0.55)]">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">{label}</p>
                    <h3 className="mt-1 text-lg font-semibold text-white">Search {label.toLowerCase()}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70"
                    aria-label="Close"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>

                <div className="border-b border-white/10 px-4 py-4">
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                    <span className="material-symbols-outlined text-[18px] text-white/45">search</span>
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      aria-label={`Search ${label.toLowerCase()}`}
                      placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}...`}
                      className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-white/35">
                    {totalMatchCount > MAX_VISIBLE_OPTIONS
                      ? `Showing first ${MAX_VISIBLE_OPTIONS} matches. Keep typing to narrow the list.`
                      : `${totalMatchCount} result${totalMatchCount === 1 ? "" : "s"}`}
                  </p>
                </div>

                <div className="max-h-[52vh] overflow-y-auto px-3 py-3">
                  <div className="space-y-1.5">
                    {canUseCustomValue ? (
                      <button
                        type="button"
                        onClick={() => selectOption(trimmedQuery)}
                        className="flex w-full items-center justify-between rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-left"
                      >
                        <span className="text-sm font-semibold text-cyan-50">
                          {customValueLabel ? customValueLabel(trimmedQuery) : `Use "${trimmedQuery}"`}
                        </span>
                        <span className="material-symbols-outlined text-[18px] text-cyan-100">arrow_forward</span>
                      </button>
                    ) : null}

                    {filteredOptions.length > 0 ? (
                      filteredOptions.map((option) => {
                        const isSelected = option === value;
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => selectOption(option)}
                            className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                              isSelected
                                ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-50"
                                : "border-white/10 bg-white/[0.03] text-white/85"
                            }`}
                          >
                            <span className="text-sm font-medium">{option}</span>
                            {isSelected ? (
                              <span className="material-symbols-outlined text-[18px] text-cyan-100">check</span>
                            ) : null}
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-white/45">
                        {emptyMessage}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
