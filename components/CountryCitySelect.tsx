"use client";

import { useEffect, useMemo, useState } from "react";
import { getCachedCountriesAll, getCountriesAll, getCachedCitiesOfCountry, getCitiesOfCountry } from "@/lib/country-city-client";

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
  disabled?: boolean;
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
  disabled = false,
}: Props) {
  const [countriesAll, setCountriesAll] = useState(() => getCachedCountriesAll());
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);

  // Load countries if not already loaded
  useEffect(() => {
    if (countriesAll.length > 0) return;
    
    let cancelled = false;
    (async () => {
      const fetchedCountries = await getCountriesAll();
      if (!cancelled && fetchedCountries.length > 0) {
        setCountriesAll(fetchedCountries);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [countriesAll.length]);

  // Load cities when country changes
  useEffect(() => {
    if (!value.country) {
      setCityOptions([]);
      return;
    }

    // Find country ISO code
    const countryEntry = countriesAll.find(c => c.name === value.country);
    if (!countryEntry) {
      setCityOptions([]);
      return;
    }

    const countryIso = countryEntry.isoCode;
    
    // Get cached cities first
    const cached = getCachedCitiesOfCountry(countryIso);
    if (cached.length) setCityOptions(cached);

    // Then fetch fresh
    let cancelled = false;
    setLoadingCities(true);
    
    (async () => {
      const fetched = await getCitiesOfCountry(countryIso);
      if (!cancelled) {
        setCityOptions(fetched);
        setLoadingCities(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [value.country, countriesAll]);

  const countries = useMemo(() => 
    sortUniq(countriesAll.map(c => c.name)), 
    [countriesAll]
  );

  const cities = useMemo(() => sortUniq(cityOptions), [cityOptions]);

  const handleCountryChange = (nextCountry: string) => {
    // Clear city when country changes
    onChange({ country: nextCountry, city: "" });
  };

  return (
    <div className={className ?? ""}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-zinc-700">
          {labelCountry}
          <select
            className="mt-1 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
            value={value.country}
            onChange={(e) => handleCountryChange(e.target.value)}
            disabled={disabled}
          >
            <option value="">Select country</option>
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
            className="mt-1 w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
            value={value.city}
            onChange={(e) => onChange({ country: value.country, city: e.target.value })}
            disabled={!value.country || disabled || loadingCities}
          >
            <option value="">
              {!value.country ? "Select country first" : 
               loadingCities ? "Loading cities..." : 
               "Select city"}
            </option>
            {cities.map((ct) => (
              <option key={ct} value={ct}>
                {ct}
              </option>
            ))}
          </select>
          {value.country && cities.length === 0 && !loadingCities && (
            <p className="mt-1 text-xs text-amber-600">
              No city list available. Type the city manually.
            </p>
          )}
        </label>
      </div>
    </div>
  );
}
