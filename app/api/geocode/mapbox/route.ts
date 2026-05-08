import { NextResponse } from "next/server";
import { normalizeMapboxFeature, type MapboxFeature } from "@/lib/maps/mapbox";

export const runtime = "nodejs";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// GET /api/geocode/mapbox?q=...&session_token=...
// Returns suggest list (name + place_formatted only, no coordinates)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const sessionToken = url.searchParams.get("session_token")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json({ ok: false, error: "Query too short." }, { status: 400 });
  }
  if (!sessionToken) {
    return NextResponse.json({ ok: false, error: "session_token is required." }, { status: 400 });
  }
  if (!MAPBOX_TOKEN) {
    return NextResponse.json({ ok: false, error: "Mapbox token not configured." }, { status: 500 });
  }

  try {
    const params = new URLSearchParams({
      q,
      access_token: MAPBOX_TOKEN,
      limit: "8",
      language: "en",
    });
    if (sessionToken) params.set("session_token", sessionToken);

    const response = await fetch(
      `https://api.mapbox.com/search/searchbox/v1/suggest?${params.toString()}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: "Mapbox suggest failed." }, { status: 502 });
    }

    const data = (await response.json()) as {
      suggestions?: { mapbox_id: string; name: string; place_formatted?: string; full_address?: string; feature_type?: string }[];
    };

    const suggestions = (data.suggestions ?? []).map((s) => ({
      mapboxId: s.mapbox_id,
      name: s.name,
      placeFormatted: s.place_formatted ?? s.full_address ?? "",
      featureType: s.feature_type ?? "place",
    }));

    return NextResponse.json({ ok: true, suggestions });
  } catch (err) {
    console.error("[mapbox suggest]", err);
    return NextResponse.json({ ok: false, error: "Location search failed." }, { status: 500 });
  }
}

// POST /api/geocode/mapbox  { mapbox_id, session_token }
// Retrieves full details (coordinates, city, country) for a selected suggestion
export async function POST(req: Request) {
  if (!MAPBOX_TOKEN) {
    return NextResponse.json({ ok: false, error: "Mapbox token not configured." }, { status: 500 });
  }

  try {
    const body = (await req.json().catch(() => null)) as { mapbox_id?: string; session_token?: string } | null;
    const mapboxId = body?.mapbox_id?.trim() ?? "";
    const sessionToken = body?.session_token?.trim() ?? "";

    if (!mapboxId) {
      return NextResponse.json({ ok: false, error: "mapbox_id is required." }, { status: 400 });
    }

    const params = new URLSearchParams({ access_token: MAPBOX_TOKEN, language: "en" });
    if (sessionToken) params.set("session_token", sessionToken);

    const response = await fetch(
      `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(mapboxId)}?${params.toString()}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: "Mapbox retrieve failed." }, { status: 502 });
    }

    const data = (await response.json()) as { features?: MapboxFeature[] };
    const feature = data.features?.[0];
    if (!feature) {
      return NextResponse.json({ ok: false, error: "No result found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, result: normalizeMapboxFeature(feature) });
  } catch (err) {
    console.error("[mapbox retrieve]", err);
    return NextResponse.json({ ok: false, error: "Location retrieve failed." }, { status: 500 });
  }
}
