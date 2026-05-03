import { NextResponse } from "next/server";
import { City } from "country-state-city";

const cachedByIso = new Map<string, string>();

export const dynamic = "force-static";

export async function GET(_req: Request, { params }: { params: Promise<{ iso: string }> }) {
  const { iso: rawIso } = await params;
  const iso = (rawIso ?? "").trim().toUpperCase();
  if (!iso) {
    return NextResponse.json({ cities: [] });
  }

  if (!cachedByIso.has(iso)) {
    const cities = Array.from(
      new Set(
        (City.getCitiesOfCountry(iso) ?? [])
          .map((entry) => entry.name?.trim() ?? "")
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
    cachedByIso.set(iso, JSON.stringify({ cities }));
  }

  return new NextResponse(cachedByIso.get(iso)!, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
