import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Pick a few real user IDs from the DB to act as hosts
const { data: profiles, error: profilesErr } = await supabase
  .from("profiles")
  .select("user_id")
  .limit(10);

if (profilesErr || !profiles?.length) {
  console.error("Could not fetch profiles:", profilesErr?.message);
  process.exit(1);
}

const userIds = profiles.map((p) => p.user_id);
function pickHost(i) { return userIds[i % userIds.length]; }

function future(daysFromNow, durationHours = 5) {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(20, 0, 0, 0);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

const EVENTS = [
  {
    title: "Bachata Sensual Saturday Night",
    description: "Join us for an unforgettable night of Bachata Sensual. All levels welcome. DJ sets from 21:00, open floor until 2:00 AM. Drinks and snacks included.",
    event_type: "Social",
    styles: ["bachata"],
    visibility: "public",
    city: "Madrid",
    country: "Spain",
    venue_name: "Sala El Sol",
    venue_address: "Calle de los Jardines 3, Madrid",
    capacity: 120,
    status: "published",
    ...future(5),
  },
  {
    title: "Salsa on the Rooftop — Summer Edition",
    description: "Dance under the stars at our iconic rooftop summer social. Cuban salsa and timba music all night. Beginners class at 19:30, open dance from 20:30.",
    event_type: "Social",
    styles: ["salsa"],
    visibility: "public",
    city: "Barcelona",
    country: "Spain",
    venue_name: "Rooftop Terrace, Hotel Arts",
    venue_address: "Carrer de la Marina 19, Barcelona",
    capacity: 80,
    status: "published",
    ...future(8),
  },
  {
    title: "Kizomba & Urban Kiz — Exclusive Night",
    description: "An intimate private evening dedicated to Kizomba and Urban Kiz. Curated playlist by guest DJ Kwame. Max 60 dancers to keep the floor comfortable.",
    event_type: "Social",
    styles: ["kizomba"],
    visibility: "private",
    city: "Lisbon",
    country: "Portugal",
    venue_name: "Studio Movimento",
    venue_address: "Rua do Século 17, Lisboa",
    capacity: 60,
    status: "published",
    ...future(10),
  },
  {
    title: "EuroZouk Weekend Festival",
    description: "Three days of Zouk workshops, shows, and socials. 15+ international instructors. Parties every night. Full pass includes all workshops and 3 night socials.",
    event_type: "Festival",
    styles: ["zouk"],
    visibility: "public",
    city: "Amsterdam",
    country: "Netherlands",
    venue_name: "Paradiso",
    venue_address: "Weteringschans 6-8, Amsterdam",
    capacity: 400,
    status: "published",
    ...future(14, 72),
  },
  {
    title: "Tango Milonga — Buenos Aires Night",
    description: "Traditional milonga with live orchestra. Dress code: elegant. Beginners welcome with a complimentary 30-min intro lesson at 20:00.",
    event_type: "Social",
    styles: ["tango"],
    visibility: "public",
    city: "Berlin",
    country: "Germany",
    venue_name: "Clärchens Ballhaus",
    venue_address: "Auguststraße 24, Berlin",
    capacity: 150,
    status: "published",
    ...future(7),
  },
  {
    title: "Bachata Fusion Masterclass",
    description: "An intensive 3-hour masterclass with artist duo Marcos & Laura. Focus on musicality, body movement, and fusion styling. Limited to 30 couples.",
    event_type: "Workshop",
    styles: ["bachata"],
    visibility: "private",
    city: "London",
    country: "United Kingdom",
    venue_name: "Pineapple Dance Studios",
    venue_address: "7 Langley St, London",
    capacity: 60,
    status: "published",
    ...future(12, 3),
  },
  {
    title: "Latin Fiesta — Salsa & Bachata Open Social",
    description: "The biggest Latin social in the city. Salsa and Bachata floors running simultaneously. Free beginner class at 19:00. No partner needed.",
    event_type: "Social",
    styles: ["salsa", "bachata"],
    visibility: "public",
    city: "Paris",
    country: "France",
    venue_name: "La Java",
    venue_address: "105 Rue du Faubourg du Temple, Paris",
    capacity: 200,
    status: "published",
    ...future(3),
  },
  {
    title: "Sensual Dance Congress — Rome",
    description: "International congress featuring top artists in Bachata Sensual, Kizomba, and Zouk. 3-day event with workshops by day and parties by night.",
    event_type: "Congress",
    styles: ["bachata", "kizomba", "zouk"],
    visibility: "public",
    city: "Rome",
    country: "Italy",
    venue_name: "Palazzo dei Congressi",
    venue_address: "Piazza John Fitzgerald Kennedy, Roma",
    capacity: 600,
    status: "published",
    ...future(21, 72),
  },
  {
    title: "Thursday Night Zouk Practice",
    description: "Chill weekly practice session for Zouk dancers. Bring your own partner or rotate. DJ playlist, light snacks, good vibes. Intermediate+ level.",
    event_type: "Social",
    styles: ["zouk"],
    visibility: "private",
    city: "Porto",
    country: "Portugal",
    venue_name: "Studio Ritmo",
    venue_address: "Rua Formosa 40, Porto",
    capacity: 30,
    status: "published",
    ...future(2, 3),
  },
  {
    title: "Salsa on2 Intensive Weekend",
    description: "Two full days dedicated to New York style Salsa on2. Footwork, shines, partnerwork, and musicality. All materials included. Couples and singles welcome.",
    event_type: "Workshop",
    styles: ["salsa"],
    visibility: "public",
    city: "Warsaw",
    country: "Poland",
    venue_name: "Dance Factory Warsaw",
    venue_address: "ul. Złota 59, Warszawa",
    capacity: 50,
    status: "published",
    ...future(18, 16),
  },
];

console.log(`Seeding ${EVENTS.length} events with ${userIds.length} available hosts…\n`);

let seeded = 0;
for (let i = 0; i < EVENTS.length; i++) {
  const hostUserId = pickHost(i);
  const eventData = {
    host_user_id: hostUserId,
    cover_status: "approved",
    ...EVENTS[i],
    styles: EVENTS[i].styles,
  };

  const { data: inserted, error } = await supabase
    .from("events")
    .insert(eventData)
    .select("id")
    .single();

  if (error) {
    console.error(`  ✗ "${EVENTS[i].title}": ${error.message}`);
    continue;
  }

  // Add host as a member
  await supabase.from("event_members").insert({
    event_id: inserted.id,
    user_id: hostUserId,
    status: "host",
  });

  console.log(`  ✓ [${EVENTS[i].visibility}] ${EVENTS[i].title} (${EVENTS[i].city}) — host: ${hostUserId.slice(0, 8)}…`);
  seeded++;
}

console.log(`\nDone — ${seeded}/${EVENTS.length} events seeded.`);
