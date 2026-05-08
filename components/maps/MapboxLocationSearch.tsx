"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapboxPlaceResult } from "@/lib/maps/mapbox";

type Suggestion = {
  mapboxId: string;
  name: string;
  placeFormatted: string;
  featureType: string;
};

type MapboxLocationSearchProps = {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: MapboxPlaceResult) => void;
  onClear?: () => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  autoFocus?: boolean;
};

function randomSessionToken() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export default function MapboxLocationSearch({
  value,
  onChange,
  onSelect,
  onClear,
  placeholder = "Search venue or city…",
  className = "",
  inputClassName = "",
  disabled = false,
  autoFocus = false,
}: MapboxLocationSearchProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const sessionTokenRef = useRef<string>(randomSessionToken());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // New session token each time user starts a new search interaction
  const resetSession = useCallback(() => {
    sessionTokenRef.current = randomSessionToken();
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim(), session_token: sessionTokenRef.current });
      const res = await fetch(`/api/geocode/mapbox?${params.toString()}`);
      const data = (await res.json().catch(() => null)) as { ok?: boolean; suggestions?: Suggestion[] } | null;
      if (data?.ok && Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions);
        setOpen(data.suggestions.length > 0);
      } else {
        setSuggestions([]);
        setOpen(false);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      onChange(v);
      setActiveIndex(-1);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void fetchSuggestions(v), 260);
    },
    [fetchSuggestions, onChange]
  );

  const handleSelect = useCallback(
    async (suggestion: Suggestion) => {
      setOpen(false);
      setSuggestions([]);
      onChange(suggestion.placeFormatted || suggestion.name);
      try {
        const res = await fetch("/api/geocode/mapbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mapbox_id: suggestion.mapboxId,
            session_token: sessionTokenRef.current,
          }),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: MapboxPlaceResult } | null;
        if (data?.ok && data.result) {
          onSelect(data.result);
          // Start new session after a successful retrieve
          resetSession();
        }
      } catch {
        // ignore retrieve failure — user has typed the name at least
      }
    },
    [onChange, onSelect, resetSession]
  );

  const handleClear = useCallback(() => {
    onChange("");
    setSuggestions([]);
    setOpen(false);
    resetSession();
    onClear?.();
    inputRef.current?.focus();
  }, [onChange, onClear, resetSession]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open || suggestions.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        void handleSelect(suggestions[activeIndex]);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [activeIndex, handleSelect, open, suggestions]
  );

  // Close on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative h-full">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 material-symbols-outlined" style={{ fontSize: 18 }}>
          location_on
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          aria-label={placeholder || "Search location"}
          className={`h-full w-full rounded-xl border border-white/15 bg-black/25 py-2.5 pl-9 pr-8 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/35 focus:outline-none disabled:opacity-50 ${inputClassName}`}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
            tabIndex={-1}
            aria-label="Clear location"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
          </button>
        )}
        {loading && (
          <span className="absolute right-8 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-cyan-300/70" />
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-2xl border border-white/10 bg-[#0e1214] shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
          {suggestions.map((s, i) => (
            <button
              key={s.mapboxId}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); void handleSelect(s); }}
              onMouseEnter={() => setActiveIndex(i)}
              className={[
                "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                i === activeIndex ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                i > 0 ? "border-t border-white/[0.05]" : "",
              ].join(" ")}
            >
              <span className="mt-0.5 shrink-0 material-symbols-outlined text-[#0df2f2]/60" style={{ fontSize: 16 }}>
                {s.featureType === "address" || s.featureType === "street" ? "map" : "location_on"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{s.name}</p>
                {s.placeFormatted && (
                  <p className="mt-0.5 truncate text-xs text-slate-400">{s.placeFormatted}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
