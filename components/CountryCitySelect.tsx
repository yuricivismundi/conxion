"use client";

import { useMemo } from "react";

export type CountryCitySelectValue = {
  country: string;
  city: string;
};

type Props = {
  value: CountryCitySelectValue;
  onChange: (next: CountryCitySelectValue) => void;
  className?: string;
  labelCountry?: string;
  labelCity?: string;
};

// Minimal starter dataset (extend anytime)
const DATA: Record<string, string[]> = {
  Spain: ["Barcelona", "Madrid", "Valencia", "Seville", "Málaga"],
  Italy: ["Rome", "Milan", "Naples", "Florence", "Turin"],
  Estonia: ["Tallinn", "Tartu"],
  Mexico: ["CDMX", "Guadalajara", "Monterrey"],
};

function sortUniq(arr: string[]) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
}

export default function CountryCitySelect({
  value,
  onChange,
  className,
  labelCountry = "Country",
  labelCity = "City",
}: Props) {
  const countries = useMemo(() => sortUniq(Object.keys(DATA)), []);
  const cities = useMemo(() => {
    const list = DATA[value.country] ?? [];
    return sortUniq(list);
  }, [value.country]);

  return (
    <div className={className ?? ""}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-zinc-700">
          {labelCountry}
          <select
            className="mt-1 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500"
            value={value.country}
            onChange={(e) => {
              const nextCountry = e.target.value;
              const firstCity = (DATA[nextCountry] ?? [])[0] ?? "";
              onChange({ country: nextCountry, city: firstCity });
            }}
          >
            <option value="">Select</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-zinc-700">
          {labelCity}
          <select
            className="mt-1 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500"
            value={value.city}
            onChange={(e) => onChange({ country: value.country, city: e.target.value })}
            disabled={!value.country}
          >
            <option value="">{value.country ? "Select" : "Pick country first"}</option>
            {cities.map((ct) => (
              <option key={ct} value={ct}>
                {ct}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}