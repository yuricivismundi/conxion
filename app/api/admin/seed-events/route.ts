import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

function isLocalDev() {
  return process.env.NODE_ENV !== "production";
}

async function requireAdmin(req: Request) {
  if (isLocalDev()) return { ok: true as const };
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, status: 401, error: "Missing auth token." };
  const supabaseUser = getSupabaseUserClient(token);
  const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
  if (authErr || !authData.user) return { ok: false as const, status: 401, error: "Invalid auth token." };
  const adminCheck = await supabaseUser
    .from("admins")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (adminCheck.error || !adminCheck.data) return { ok: false as const, status: 403, error: "Admin access required." };
  return { ok: true as const };
}

type SampleEvent = {
  title: string;
  description: string;
  event_type: string;
  city: string;
  country: string;
  venue_name: string;
  venue_address: string;
  daysFromNow: number;
  startHour: number;
  durationHours: number;
  capacity: number;
  styles: string[];
  links: Array<{ label: string; url: string }>;
};

const SAMPLES: SampleEvent[] = [
  {
    title: "Barcelona Bachata Sensual Sunset Social",
    description:
      "Join us on the rooftop terrace for the warmest sensual bachata social in Barcelona. Live DJ spinning the latest sensual remixes, a short pre-party warm-up with Lunita & Andres, and an open-air dance floor with city views. Beginners welcome — first hour includes a sensual basics intro.",
    event_type: "Social",
    city: "Barcelona",
    country: "Spain",
    venue_name: "Sky Terrace Eixample",
    venue_address: "Carrer de Mallorca 401, 08013 Barcelona",
    daysFromNow: 4,
    startHour: 19,
    durationHours: 5,
    capacity: 180,
    styles: ["bachata", "sensual"],
    links: [
      { label: "Instagram", url: "https://instagram.com/bcnsensualsocials" },
      { label: "Tickets", url: "https://www.eventbrite.com" },
    ],
  },
  {
    title: "Bachata Sensual Weekend — Berlin",
    description:
      "A full weekend dedicated to sensual bachata in the heart of Berlin. Friday welcome social, Saturday workshops (Body Movement, Connection, Musicality) with three international instructors, and Saturday night gala with two rooms. Includes pre-party Friday, two full workshop days and Sunday farewell brunch.",
    event_type: "Festival",
    city: "Berlin",
    country: "Germany",
    venue_name: "Sage Beach Studios",
    venue_address: "Köpenicker Str. 76, 10179 Berlin",
    daysFromNow: 12,
    startHour: 18,
    durationHours: 60,
    capacity: 350,
    styles: ["bachata", "sensual", "kizomba"],
    links: [
      { label: "Festival page", url: "https://example.com/berlin-bachata-weekend" },
      { label: "Pass options", url: "https://example.com/passes" },
    ],
  },
  {
    title: "Salsa on Air — Paris",
    description:
      "Paris' beloved Wednesday-night salsa social returns. Cuban-style room downstairs, LA-style room upstairs. Free intro class from 8:30pm with Carlos & Sophie. Drink specials all night, dance floor open until 2am.",
    event_type: "Social",
    city: "Paris",
    country: "France",
    venue_name: "Le Studio des Halles",
    venue_address: "10 Rue du Cygne, 75001 Paris",
    daysFromNow: 6,
    startHour: 20,
    durationHours: 6,
    capacity: 140,
    styles: ["salsa", "cuban", "la"],
    links: [
      { label: "Map", url: "https://maps.google.com" },
    ],
  },
  {
    title: "Kizomba Connection Night — Lisbon",
    description:
      "Authentic kizomba and semba night with live DJ Bruno from Angola. Beginner taster class 9pm. The bar serves traditional Portuguese petiscos until midnight. No phones on the dance floor.",
    event_type: "Social",
    city: "Lisbon",
    country: "Portugal",
    venue_name: "B.Leza Club",
    venue_address: "Cais da Ribeira Nova, 1200-109 Lisboa",
    daysFromNow: 8,
    startHour: 22,
    durationHours: 5,
    capacity: 220,
    styles: ["kizomba", "semba", "urbankiz"],
    links: [
      { label: "Facebook event", url: "https://facebook.com/events" },
    ],
  },
  {
    title: "Zouk in the Park — Amsterdam Summer Edition",
    description:
      "Outdoor zouk picnic and social by the Vondelpark lake. Bring a blanket, dance shoes optional. Beginner-friendly demo at 5pm, open floor until sunset. Free entry, donations welcome to keep the speakers running.",
    event_type: "Social",
    city: "Amsterdam",
    country: "Netherlands",
    venue_name: "Vondelpark — Open Air Theater Lawn",
    venue_address: "Vondelpark, 1071 AA Amsterdam",
    daysFromNow: 10,
    startHour: 16,
    durationHours: 5,
    capacity: 200,
    styles: ["zouk", "brazilian zouk"],
    links: [
      { label: "Weather check", url: "https://www.knmi.nl" },
    ],
  },
  {
    title: "Medellín Bachata Sensual Bootcamp",
    description:
      "5-day intensive bootcamp covering body isolations, lead/follow connection, musicality, footwork and styling. Daily 4-hour group practice plus one private lesson. Includes city dance tour and a Friday graduation social.",
    event_type: "Workshop",
    city: "Medellín",
    country: "Colombia",
    venue_name: "Son Latino Dance Studio",
    venue_address: "Cra. 43A #11-50, El Poblado, Medellín",
    daysFromNow: 18,
    startHour: 10,
    durationHours: 120,
    capacity: 40,
    styles: ["bachata", "sensual"],
    links: [
      { label: "Booking", url: "https://example.com/bootcamp" },
      { label: "Visa info", url: "https://example.com/visa" },
    ],
  },
  {
    title: "Buenos Aires Tango Milonga at Salón Canning",
    description:
      "Traditional Argentine milonga in one of the oldest tango halls. Live orchestra from 11pm, dance floor open from 10pm. Cabeceo etiquette respected — beginner-friendly tables marked.",
    event_type: "Social",
    city: "Buenos Aires",
    country: "Argentina",
    venue_name: "Salón Canning",
    venue_address: "Av. Raúl Scalabrini Ortiz 1331, Buenos Aires",
    daysFromNow: 14,
    startHour: 22,
    durationHours: 5,
    capacity: 250,
    styles: ["tango"],
    links: [
      { label: "Orchestra info", url: "https://example.com/orchestra" },
    ],
  },
  {
    title: "Salsa Dura Workshop — Madrid",
    description:
      "Authentic Cuban salsa workshop with master instructor from Havana. Focused on timing, partner work and classic styling. Two 2-hour sessions plus practica. Refreshments included.",
    event_type: "Workshop",
    city: "Madrid",
    country: "Spain",
    venue_name: "La Habana Dance Studio",
    venue_address: "Calle de Bravo Murillo 234, 28020 Madrid",
    daysFromNow: 9,
    startHour: 14,
    durationHours: 5,
    capacity: 60,
    styles: ["salsa", "cuban"],
    links: [
      { label: "Sign up", url: "https://example.com/madrid-salsa" },
    ],
  },
  {
    title: "Tallinn Bachata Beginners Bootcamp",
    description:
      "4-week beginners course for adults who have never danced before. Small group of max 16, partner rotation guaranteed. Includes one free social entry per week and a closing graduation party.",
    event_type: "Workshop",
    city: "Tallinn",
    country: "Estonia",
    venue_name: "Telliskivi Dance Hall",
    venue_address: "Telliskivi 60a, 10412 Tallinn",
    daysFromNow: 7,
    startHour: 19,
    durationHours: 1.5,
    capacity: 16,
    styles: ["bachata"],
    links: [
      { label: "Course details", url: "https://example.com/tallinn-course" },
    ],
  },
  {
    title: "Mexico City Salsa Festival 2026",
    description:
      "Three-day salsa festival featuring 25+ instructors from Cuba, Colombia, Puerto Rico and USA. Six rooms running in parallel: salsa, bachata, cha-cha, son, mambo and afro-cuban. Nightly socials until 5am.",
    event_type: "Festival",
    city: "Mexico City",
    country: "Mexico",
    venue_name: "Centro Cultural Roma Norte",
    venue_address: "Av. Álvaro Obregón 99, Roma Nte., 06700 CDMX",
    daysFromNow: 21,
    startHour: 17,
    durationHours: 72,
    capacity: 800,
    styles: ["salsa", "bachata", "son", "mambo"],
    links: [
      { label: "Festival site", url: "https://example.com/cdmx-salsa" },
      { label: "Hotel deals", url: "https://example.com/hotels" },
    ],
  },
  {
    title: "Friday Night Kizomba — Buenos Aires",
    description:
      "Weekly Friday kizomba social at the heart of Palermo. Free entry before 11pm, drink included. Live DJ playing kizomba, semba and a touch of urban kiz. Cabeceo recommended.",
    event_type: "Social",
    city: "Buenos Aires",
    country: "Argentina",
    venue_name: "Salón Palermo",
    venue_address: "Av. Córdoba 5064, Buenos Aires",
    daysFromNow: 3,
    startHour: 22,
    durationHours: 5,
    capacity: 150,
    styles: ["kizomba", "semba", "urbankiz"],
    links: [
      { label: "Instagram", url: "https://instagram.com/kizombaba" },
    ],
  },
  {
    title: "Berlin Zouk Marathon Weekend",
    description:
      "48-hour zouk marathon: continuous music from Friday 9pm to Sunday 9pm with hourly DJ rotations. Brazilian zouk, soul zouk, lambazouk and zouk fusion. Camping option available on-site.",
    event_type: "Festival",
    city: "Berlin",
    country: "Germany",
    venue_name: "Funkhaus Berlin",
    venue_address: "Nalepastraße 18, 12459 Berlin",
    daysFromNow: 16,
    startHour: 21,
    durationHours: 48,
    capacity: 400,
    styles: ["zouk", "brazilian zouk"],
    links: [
      { label: "Marathon details", url: "https://example.com/zouk-marathon" },
    ],
  },
];

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") === "1";

    const service = getSupabaseServiceClient();

    // Pick a host user — first verified profile, or any profile as fallback.
    const hostRes = await service
      .from("profiles")
      .select("user_id,display_name")
      .limit(50);

    if (hostRes.error || !hostRes.data?.length) {
      return NextResponse.json(
        { ok: false, error: "No profiles available to host events." },
        { status: 400 }
      );
    }

    type ProfileRow = { user_id: string; display_name: string | null };
    const profiles = hostRes.data as ProfileRow[];
    const hostUserId = profiles[0].user_id;

    const now = new Date();
    const rows = SAMPLES.map((sample) => {
      const startsAt = new Date(now);
      startsAt.setDate(startsAt.getDate() + sample.daysFromNow);
      startsAt.setHours(sample.startHour, 0, 0, 0);
      const endsAt = new Date(startsAt.getTime() + sample.durationHours * 60 * 60 * 1000);

      return {
        host_user_id: hostUserId,
        title: sample.title,
        description: sample.description,
        event_type: sample.event_type,
        visibility: "public",
        city: sample.city,
        country: sample.country,
        venue_name: sample.venue_name,
        venue_address: sample.venue_address,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        capacity: sample.capacity,
        cover_url: null,
        links: sample.links,
        status: "published",
        cover_status: "approved",
        styles: sample.styles,
      };
    });

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, wouldInsert: rows.length, sample: rows[0] });
    }

    const insertRes = await service.from("events").insert(rows as never[]).select("id,title,city,starts_at");

    if (insertRes.error) {
      return NextResponse.json({ ok: false, error: insertRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      inserted: insertRes.data?.length ?? 0,
      hostUserId,
      hostName: profiles[0].display_name,
      events: insertRes.data,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
