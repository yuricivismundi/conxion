import { NextResponse } from "next/server";
import { City, Country } from "country-state-city";

// Cache the response since this data doesn't change often
let cachedPayload: string | null = null;

export const dynamic = "force-dynamic";

export async function GET() {
  if (!cachedPayload) {
    try {
      // Get all countries first
      const allCountries = Country.getAllCountries();
      const countryMap = new Map<string, string>();
      allCountries.forEach(country => {
        countryMap.set(country.isoCode, country.name);
      });

      // Get cities for all countries
      const citiesWithCountries: Array<{
        city: string;
        country: string;
        countryIso: string;
      }> = [];

      // Limit to major countries to keep response size manageable
      const majorCountryCodes = [
        "US", "GB", "DE", "FR", "ES", "IT", "NL", "BE", "SE", "NO", "DK", "FI",
        "CA", "AU", "NZ", "JP", "KR", "CN", "IN", "BR", "MX", "AR", "CL", "CO",
        "PE", "EC", "UY", "PY", "BO", "VE", "CR", "PA", "DO", "PR", "GT", "SV",
        "HN", "NI", "CU", "JM", "HT", "BS", "TT", "BB", "GD", "LC", "VC", "AG",
        "DM", "KN", "PT", "GR", "TR", "PL", "CZ", "SK", "HU", "AT", "CH", "RO",
        "BG", "RS", "HR", "SI", "BA", "ME", "MK", "AL", "EE", "LV", "LT", "UA",
        "BY", "MD", "GE", "AM", "AZ", "KZ", "UZ", "KG", "TJ", "TM", "IL", "JO",
        "LB", "SY", "IQ", "IR", "SA", "AE", "QA", "OM", "KW", "BH", "YE", "EG",
        "MA", "DZ", "TN", "LY", "SD", "SO", "ET", "KE", "TZ", "UG", "RW", "BI",
        "CD", "CG", "AO", "ZM", "ZW", "BW", "NA", "ZA", "MZ", "MW", "MG", "MU",
        "SC", "KM", "RE", "YT", "MY", "SG", "ID", "TH", "VN", "PH", "MM", "KH",
        "LA", "BN", "TL", "PG", "FJ", "SB", "VU", "NC", "PF", "WF", "TO", "WS",
        "KI", "MH", "FM", "NR", "TV", "CK", "NU", "TK", "PW", "MP", "GU", "AS"
      ];

      // Process each major country
      for (const countryCode of majorCountryCodes) {
        const countryName = countryMap.get(countryCode);
        if (!countryName) continue;

        const cities = City.getCitiesOfCountry(countryCode) || [];
        for (const city of cities) {
          if (city.name?.trim()) {
            citiesWithCountries.push({
              city: city.name.trim(),
              country: countryName,
              countryIso: countryCode,
            });
          }
        }
      }

      // Sort alphabetically by city name
      citiesWithCountries.sort((a, b) => a.city.localeCompare(b.city));

      // Limit to 5000 cities to keep response size reasonable
      const limitedCities = citiesWithCountries.slice(0, 5000);

      cachedPayload = JSON.stringify({ cities: limitedCities });
    } catch (error) {
      console.error("Failed to generate city list:", error);
      cachedPayload = JSON.stringify({ cities: [] });
    }
  }

  return new NextResponse(cachedPayload, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}