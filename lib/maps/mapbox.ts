// Mapbox SearchBox retrieve response: GeoJSON Feature with all data in properties
export type MapboxFeature = {
  type: "Feature";
  geometry: { coordinates: [number, number]; type: "Point" };
  properties: {
    mapbox_id: string;
    name: string;
    place_formatted: string;
    full_address?: string;
    coordinates: { longitude: number; latitude: number };
    context: {
      place?: { name: string };
      locality?: { name: string };
      district?: { name: string };
      region?: { name: string };
      country?: { name: string; country_code: string };
      address?: { name: string; address_number?: string; street_name?: string };
      street?: { name: string };
      neighborhood?: { name: string };
      postcode?: { name: string };
    };
  };
};

export type MapboxPlaceResult = {
  mapboxId: string;
  name: string;
  address: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  fullAddress: string;
};

export function normalizeMapboxFeature(feature: MapboxFeature): MapboxPlaceResult {
  const p = feature.properties;
  const ctx = p.context;
  const country = ctx.country?.name ?? "";
  const countryCode = ctx.country?.country_code?.toUpperCase() ?? "";

  // city: prefer explicit context fields, fall back to parsing place_formatted
  let city =
    ctx.place?.name ??
    ctx.locality?.name ??
    ctx.district?.name ??
    ctx.region?.name ??
    "";

  if (!city && p.place_formatted) {
    // place_formatted e.g. "Viru väljak 4, 10111 Tallinn, Estonia"
    const segments = p.place_formatted.split(",").map((s) => s.trim()).filter(Boolean);
    const withoutCountry = country ? segments.filter((s) => s !== country) : segments;
    const cityCandidate = withoutCountry[withoutCountry.length - 1] ?? "";
    city = cityCandidate.replace(/^\d+\s+/, "");
  }

  // Build street address: "Sauna tn 1" from context, or strip city/country from place_formatted
  const streetParts = [
    p.context.address?.street_name ?? p.context.street?.name,
    p.context.address?.address_number,
  ].filter(Boolean);
  let address = streetParts.join(" ").trim();
  if (!address && p.place_formatted) {
    // Remove city and country from place_formatted to get just the street portion
    const segments = p.place_formatted.split(",").map((s) => s.trim()).filter(Boolean);
    const streetSegments = segments.filter((s) => s !== country && s !== city && !/^\d{4,5}\s/.test(s) === false || /\d/.test(s));
    // simpler: take everything except last segment (country) and second-to-last (city if we know it)
    const withoutCountry = country ? segments.filter((s) => s !== country) : segments;
    const withoutCity = city ? withoutCountry.filter((s) => !s.endsWith(city) && s !== city) : withoutCountry;
    address = withoutCity.join(", ");
  }
  if (!address) address = p.full_address ?? p.place_formatted ?? "";

  return {
    mapboxId: p.mapbox_id,
    name: p.name,
    address,
    city,
    country,
    countryCode,
    lat: p.coordinates.latitude,
    lon: p.coordinates.longitude,
    fullAddress: p.full_address ?? p.place_formatted ?? "",
  };
}
