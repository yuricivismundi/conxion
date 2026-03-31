import { NextResponse } from "next/server";
import { normalizeOsmGeocodeResult, type OsmGeocodeResult } from "@/lib/maps/osm";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

function cleanParam(value: string | null) {
  return value?.trim() ?? "";
}

function pushCandidate(queries: string[], raw: string) {
  const candidate = raw.trim().replace(/\s+/g, " ");
  if (candidate.length < 5) return;
  if (!queries.includes(candidate)) queries.push(candidate);
}

async function searchNominatim(query: string, countryCode: string) {
  const searchUrl = new URL(NOMINATIM_ENDPOINT);
  searchUrl.searchParams.set("format", "jsonv2");
  searchUrl.searchParams.set("addressdetails", "1");
  searchUrl.searchParams.set("limit", "5");
  searchUrl.searchParams.set("q", query);
  if (countryCode.length === 2) {
    searchUrl.searchParams.set("countrycodes", countryCode.toLowerCase());
  }

  const response = await fetch(searchUrl, {
    headers: {
      "accept-language": "en",
      "user-agent": "Conxion Events/1.0 (location lookup)",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return { ok: false as const, results: [] as OsmGeocodeResult[] };
  }

  const raw = (await response.json().catch(() => [])) as unknown[];
  const results = Array.isArray(raw)
    ? raw.map(normalizeOsmGeocodeResult).filter((result): result is OsmGeocodeResult => Boolean(result))
    : [];
  return { ok: true as const, results };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = cleanParam(url.searchParams.get("q"));
  const venue = cleanParam(url.searchParams.get("venue"));
  const address = cleanParam(url.searchParams.get("address"));
  const city = cleanParam(url.searchParams.get("city"));
  const country = cleanParam(url.searchParams.get("country"));
  const countryCode = cleanParam(url.searchParams.get("countryCode"));
  if (query.length < 5) {
    return NextResponse.json({ ok: false, error: "Query must be at least 5 characters." }, { status: 400 });
  }

  const queryCandidates: string[] = [];
  pushCandidate(queryCandidates, [venue, address, city, country].filter(Boolean).join(", "));
  pushCandidate(queryCandidates, [address, city, country].filter(Boolean).join(", "));
  pushCandidate(queryCandidates, [venue, city, country].filter(Boolean).join(", "));
  pushCandidate(queryCandidates, [address, country].filter(Boolean).join(", "));
  pushCandidate(queryCandidates, [venue, address, country].filter(Boolean).join(", "));
  pushCandidate(queryCandidates, query);

  const seen = new Set<string>();
  const results: OsmGeocodeResult[] = [];
  let providerReached = false;

  for (const candidate of queryCandidates) {
    const search = await searchNominatim(candidate, countryCode);
    providerReached = providerReached || search.ok;
    for (const result of search.results) {
      const key = `${result.lat}:${result.lon}:${result.displayName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(result);
      if (results.length >= 6) break;
    }
    if (results.length >= 6) break;
  }

  if (results.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: providerReached
          ? "No exact match yet. Try street + number without the venue name, or confirm the city and country first."
          : "Could not resolve the address right now.",
      },
      { status: providerReached ? 404 : 502 }
    );
  }

  return NextResponse.json({ ok: true, results });
}
