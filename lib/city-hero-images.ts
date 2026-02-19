export const FALLBACK_GRADIENT =
  "linear-gradient(135deg, rgba(13, 204, 242, 0.25), rgba(217, 70, 239, 0.2)), radial-gradient(120% 120% at 10% 10%, rgba(13, 204, 242, 0.25), transparent 60%)";

function encodeQuery(value: string) {
  return encodeURIComponent(value.trim().toLowerCase().replace(/\s+/g, ","));
}

export const TRIP_HERO_OVERLAY =
  "linear-gradient(180deg, rgba(10,10,10,0.15), rgba(10,10,10,0.85))," +
  "linear-gradient(135deg, rgba(13,204,242,0.25), rgba(217,70,239,0.25))";

const TRIP_HERO_BUCKET = "trip-heroes";

const COUNTRY_FILE_OVERRIDES: Record<string, string> = {
  "dominican republic": "dominican.webp",
  "dominican": "dominican.webp",
  "espana": "spain.webp",
  "españa": "spain.webp",
  "france": "france.webp",
  "germany": "germany.webp",
  "italy": "italy.webp",
  "mexico": "mexico.webp",
  "poland": "poland.webp",
  "romania": "romania.webp",
  "spain": "spain.webp",
  "switzerland": "suiza.webp",
  "suiza": "suiza.webp",
  "united kingdom": "uk.webp",
  "uk": "uk.webp",
  "united states": "US.webp",
  "usa": "us.webp",
  "us": "US.webp",
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getTripHeroStorageUrl(country?: string | null): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return "";
  if (!country) {
    return `${base}/storage/v1/object/public/${TRIP_HERO_BUCKET}/generic.webp`;
  }
  const key = country.trim().toLowerCase();
  const filename = COUNTRY_FILE_OVERRIDES[key] ?? `${slugify(country)}.jpg`;
  if (!filename || filename === ".jpg") return "";
  return `${base}/storage/v1/object/public/${TRIP_HERO_BUCKET}/${filename}`;
}

export function getTripHeroStorageFolderUrl(country?: string | null): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !country) return "";
  const key = country.trim().toLowerCase();
  const filename = COUNTRY_FILE_OVERRIDES[key] ?? `${slugify(country)}.jpg`;
  if (!filename || filename === ".jpg") return "";
  return `${base}/storage/v1/object/public/${TRIP_HERO_BUCKET}/countries/${filename}`;
}

export function getTripHeroFallbackUrl(city?: string | null, country?: string | null): string {
  const cityQ = city ? encodeQuery(city) : "";
  const countryQ = country ? encodeQuery(country) : "";
  const query = [cityQ, countryQ, "cityscape"].filter(Boolean).join(",");

  if (!query) return "";
  return `https://source.unsplash.com/featured/1600x900?${query}`;
}

// Back-compat for older imports that expect a CSS background string.
export function getTripHeroBackground(city?: string | null, country?: string | null): string {
  const url = getTripHeroStorageUrl(country) || getTripHeroFallbackUrl(city, country);
  if (!url) return `${TRIP_HERO_OVERLAY},${FALLBACK_GRADIENT}`;
  return `${TRIP_HERO_OVERLAY},url('${url}')`;
}
