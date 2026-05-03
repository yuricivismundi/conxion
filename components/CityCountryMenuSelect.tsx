"use client";

import { useEffect, useMemo, useState } from "react";
import SearchableMobileSelect from "./SearchableMobileSelect";

export type CityCountryValue = {
  city: string;
  country: string;
};

type Props = {
  value: CityCountryValue;
  onChange: (next: CityCountryValue) => void;
  className?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
};

// We'll fetch all cities with their countries on demand
type CityWithCountry = {
  city: string;
  country: string;
  countryIso: string;
};

let cachedCitiesWithCountries: CityWithCountry[] | null = null;
let citiesFetchPromise: Promise<CityWithCountry[]> | null = null;

async function getAllCitiesWithCountries(): Promise<CityWithCountry[]> {
  if (cachedCitiesWithCountries) return cachedCitiesWithCountries;

  if (!citiesFetchPromise) {
    citiesFetchPromise = fetch("/api/geodata/all-cities", { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error("Could not load city list.");
        return res.json() as Promise<{ cities: CityWithCountry[] }>;
      })
      .then((payload) => {
        cachedCitiesWithCountries = payload.cities ?? [];
        return cachedCitiesWithCountries;
      })
      .catch(() => {
        citiesFetchPromise = null;
        cachedCitiesWithCountries = [];
        return cachedCitiesWithCountries;
      });
  }

  return citiesFetchPromise;
}

function getCachedCitiesWithCountries(): CityWithCountry[] {
  return cachedCitiesWithCountries ?? [];
}

export default function CityCountryMenuSelect({
  value,
  onChange,
  className,
  label = "City",
  placeholder = "Select city",
  disabled = false,
}: Props) {
  const [allCities, setAllCities] = useState<CityWithCountry[]>(getCachedCitiesWithCountries());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (allCities.length > 0) return;

    let cancelled = false;
    setLoading(true);
    
    (async () => {
      try {
        const cities = await getAllCitiesWithCountries();
        if (!cancelled) {
          setAllCities(cities);
        }
      } catch (error) {
        console.error("Failed to load cities:", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Format options as "City, Country"
  const options = useMemo(() => {
    return allCities.map(city => `${city.city}, ${city.country}`);
  }, [allCities]);

  // Current value display
  const displayValue = useMemo(() => {
    if (value.city && value.country) {
      return `${value.city}, ${value.country}`;
    }
    return "";
  }, [value.city, value.country]);

  const handleSelect = (selectedOption: string) => {
    // Parse "City, Country" format
    const match = selectedOption.match(/^(.*?), (.*)$/);
    if (match) {
      const [, city, country] = match;
      onChange({ city: city.trim(), country: country.trim() });
    }
  };

  // For mobile, use SearchableMobileSelect
  return (
    <div className={className}>
      <div className="sm:hidden">
        <SearchableMobileSelect
          label={label}
          value={displayValue}
          options={options}
          placeholder={loading ? "Loading cities..." : placeholder}
          searchPlaceholder="Search cities..."
          disabled={disabled || loading}
          allowCustomValue={false}
          onSelect={handleSelect}
          buttonClassName="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-white disabled:opacity-55"
        />
      </div>
      
      {/* Desktop version - enhanced select with search */}
      <div className="hidden sm:block">
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">{label}</span>
          <div className="relative">
            <select
              value={displayValue}
              onChange={(e) => handleSelect(e.target.value)}
              disabled={disabled || loading}
              className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 pr-11 text-white focus:border-cyan-300/35 focus:outline-none disabled:opacity-55"
            >
              <option value="">{loading ? "Loading cities..." : placeholder}</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-500">
              expand_more
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            {loading 
              ? "Loading city list..." 
              : allCities.length > 0 
                ? "Select a city from the menu to automatically set both city and country."
                : "City list not available. Please type manually."}
          </p>
        </label>
      </div>
    </div>
  );
}