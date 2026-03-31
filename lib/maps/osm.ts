export type OsmGeocodeResult = {
  displayName: string;
  lat: number;
  lon: number;
  address: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    country?: string;
    road?: string;
    houseNumber?: string;
    postcode?: string;
  };
};

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeOsmGeocodeResult(raw: unknown): OsmGeocodeResult | null {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!row) return null;

  const displayName = asString(row.display_name).trim();
  const lat = asNumber(row.lat);
  const lon = asNumber(row.lon);
  if (!displayName || lat === null || lon === null) return null;

  const addressRow = row.address && typeof row.address === "object" ? (row.address as Record<string, unknown>) : {};

  return {
    displayName,
    lat,
    lon,
    address: {
      city: asString(addressRow.city).trim() || undefined,
      town: asString(addressRow.town).trim() || undefined,
      village: asString(addressRow.village).trim() || undefined,
      municipality: asString(addressRow.municipality).trim() || undefined,
      county: asString(addressRow.county).trim() || undefined,
      country: asString(addressRow.country).trim() || undefined,
      road: asString(addressRow.road).trim() || undefined,
      houseNumber: asString(addressRow.house_number).trim() || undefined,
      postcode: asString(addressRow.postcode).trim() || undefined,
    },
  };
}

export function buildOsmEmbedUrl(lat: number, lon: number, delta = 0.008) {
  const left = lon - delta;
  const right = lon + delta;
  const top = lat + delta;
  const bottom = lat - delta;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lon}`;
}
