export type CountryEntry = {
  name: string;
  isoCode: string;
};

type CountryStateCityModule = typeof import("country-state-city");

let countryStateCityModulePromise: Promise<CountryStateCityModule> | null = null;
let cachedCountriesAll: CountryEntry[] | null = null;
const cachedCitiesByCountryIso = new Map<string, string[]>();

function normalizeCountryIso(value: string) {
  return value.trim().toUpperCase();
}

function uniqueOrdered(items: string[]) {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}

async function loadCountryStateCityModule() {
  if (!countryStateCityModulePromise) {
    countryStateCityModulePromise = import("country-state-city");
  }
  return countryStateCityModulePromise;
}

export function getCachedCountriesAll() {
  return cachedCountriesAll ?? [];
}

export function getCachedCitiesOfCountry(countryIso: string) {
  return cachedCitiesByCountryIso.get(normalizeCountryIso(countryIso)) ?? [];
}

export async function getCountriesAll() {
  if (cachedCountriesAll) return cachedCountriesAll;

  const countryStateCity = await loadCountryStateCityModule();
  cachedCountriesAll = uniqueOrdered(
    countryStateCity.Country.getAllCountries()
      .map((entry) => `${entry.name}\t${entry.isoCode}`)
      .filter((entry) => entry.trim().length > 0)
  ).map((entry) => {
    const [name, isoCode] = entry.split("\t");
    return { name, isoCode };
  });

  return cachedCountriesAll;
}

export async function getCitiesOfCountry(countryIso: string) {
  const normalizedIso = normalizeCountryIso(countryIso);
  if (!normalizedIso) return [];

  const cached = cachedCitiesByCountryIso.get(normalizedIso);
  if (cached) return cached;

  const countryStateCity = await loadCountryStateCityModule();
  const cities = uniqueOrdered(
    (countryStateCity.City.getCitiesOfCountry(normalizedIso) ?? [])
      .map((entry) => entry.name?.trim() ?? "")
      .filter(Boolean)
  );

  cachedCitiesByCountryIso.set(normalizedIso, cities);
  return cities;
}
