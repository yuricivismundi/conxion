import { NextResponse } from "next/server";
import { Country } from "country-state-city";

// Evaluated once on the server, then cached by Next.js route cache
let cachedPayload: string | null = null;

export const dynamic = "force-dynamic";

export function GET() {
  if (!cachedPayload) {
    const countries = Country.getAllCountries()
      .map((entry) => ({ name: entry.name, isoCode: entry.isoCode }))
      .sort((a, b) => a.name.localeCompare(b.name));
    cachedPayload = JSON.stringify({ countries });
  }

  return new NextResponse(cachedPayload, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
