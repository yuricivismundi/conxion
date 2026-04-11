export type CountryEntry = {
  name: string;
  isoCode: string;
};

let cachedCountriesAll: CountryEntry[] | null = null;
let countriesFetchPromise: Promise<CountryEntry[]> | null = null;

const cachedCitiesByCountryIso = new Map<string, string[]>();
const citiesFetchPromises = new Map<string, Promise<string[]>>();

export function getCachedCountriesAll(): CountryEntry[] {
  return cachedCountriesAll ?? [];
}

export function getCachedCitiesOfCountry(countryIso: string): string[] {
  return cachedCitiesByCountryIso.get(countryIso.trim().toUpperCase()) ?? [];
}

export async function getCountriesAll(): Promise<CountryEntry[]> {
  if (cachedCountriesAll) return cachedCountriesAll;

  if (!countriesFetchPromise) {
    countriesFetchPromise = fetch("/api/geodata/countries", { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error("Could not load country list.");
        return res.json() as Promise<{ countries: CountryEntry[] }>;
      })
      .then((payload) => {
        cachedCountriesAll = payload.countries ?? [];
        return cachedCountriesAll;
      })
      .catch(() => {
        countriesFetchPromise = null;
        cachedCountriesAll = [];
        return cachedCountriesAll;
      });
  }

  return countriesFetchPromise;
}

export async function getCitiesOfCountry(countryIso: string): Promise<string[]> {
  const iso = countryIso.trim().toUpperCase();
  if (!iso) return [];

  const cached = cachedCitiesByCountryIso.get(iso);
  if (cached) return cached;

  if (!citiesFetchPromises.has(iso)) {
    const promise = fetch(`/api/geodata/cities/${encodeURIComponent(iso)}`, { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error("Could not load city list.");
        return res.json() as Promise<{ cities: string[] }>;
      })
      .then((payload) => {
        const cities = payload.cities ?? [];
        cachedCitiesByCountryIso.set(iso, cities);
        citiesFetchPromises.delete(iso);
        return cities;
      })
      .catch(() => {
        citiesFetchPromises.delete(iso);
        cachedCitiesByCountryIso.set(iso, []);
        return [] as string[];
      });
    citiesFetchPromises.set(iso, promise);
  }

  return citiesFetchPromises.get(iso)!;
}
