import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const USERS = [
  { email: "conxion.seed+marco@yourdomain.com", name: "Marco Bianchi", city: "Milan", country: "Italy",
    roles: ["Social dancer / Student"], languages: ["Italian","English"], interests: ["Practice / Dance Partner"], availability: ["Evenings"],
    avatar_url: "https://i.pravatar.cc/300?u=marco", verified: false,
    dance_skills: { salsa: { level: "Intermediate (9–24 months)" }, bachata: { level: "Beginner (0–3 months)" } },
    has_other_style: true
  },
  { email: "conxion.seed+ana@yourdomain.com", name: "Ana Morales", city: "Seville", country: "Spain",
    roles: ["Artist","Organizer"], languages: ["Spanish","English"], interests: ["Social Dance Party","Festival Travel Buddy"], availability: ["Weekends"],
    avatar_url: "https://i.pravatar.cc/300?u=ana", verified: true,
    dance_skills: { bachata: { level: "Advanced", verified: true } },
    has_other_style: false
  },
  { email: "conxion.seed+julien@yourdomain.com", name: "Julien Moreau", city: "Paris", country: "France",
    roles: ["Teacher"], languages: ["French","English"], interests: ["Offer private/group lessons"], availability: ["Weekdays"],
    avatar_url: "https://i.pravatar.cc/300?u=julien", verified: true,
    dance_skills: { zouk: { level: "Advanced", verified: true } },
    has_other_style: false
  },
  { email: "conxion.seed+kasia@yourdomain.com", name: "Kasia Nowak", city: "Warsaw", country: "Poland",
    roles: ["Social dancer / Student"], languages: ["Polish","English"], interests: ["Practice / Dance Partner"], availability: ["Evenings","Weekends"],
    avatar_url: "https://i.pravatar.cc/300?u=kasia", verified: false,
    dance_skills: { bachata: { level: "Improver (3–9 months)" } },
    has_other_style: true
  },
  { email: "conxion.seed+pedro@yourdomain.com", name: "Pedro Santos", city: "Lisbon", country: "Portugal",
    roles: ["Promoter"], languages: ["Portuguese","English","Spanish"], interests: ["Video Collabs","Festival Travel Buddy"], availability: ["Weekends"],
    avatar_url: "https://i.pravatar.cc/300?u=pedro", verified: true,
    dance_skills: { kizomba: { level: "Advanced", verified: true } },
    has_other_style: false
  },
  { email: "conxion.seed+laura@yourdomain.com", name: "Laura Schmidt", city: "Berlin", country: "Germany",
    roles: ["Social dancer / Student"], languages: ["German","English"], interests: ["Practice / Dance Partner"], availability: ["Evenings"],
    avatar_url: "https://i.pravatar.cc/300?u=laura", verified: false,
    dance_skills: { salsa: { level: "Beginner (0–3 months)" } },
    has_other_style: false
  },
  { email: "conxion.seed+tomas@yourdomain.com", name: "Tomas Novak", city: "Prague", country: "Czech Republic",
    roles: ["DJ"], languages: ["Czech","English"], interests: ["Social Dance Party"], availability: ["Weekends"],
    avatar_url: "https://i.pravatar.cc/300?u=tomas", verified: true,
    dance_skills: { bachata: { level: "Intermediate (9–24 months)" } },
    has_other_style: false
  },
  { email: "conxion.seed+elena@yourdomain.com", name: "Elena Petrova", city: "Sofia", country: "Bulgaria",
    roles: ["Artist"], languages: ["Bulgarian","English"], interests: ["Video Collabs"], availability: ["Weekdays"],
    avatar_url: "https://i.pravatar.cc/300?u=elena", verified: false,
    dance_skills: { zouk: { level: "Improver (3–9 months)" } },
    has_other_style: true
  },
  { email: "conxion.seed+david@yourdomain.com", name: "David Klein", city: "Vienna", country: "Austria",
    roles: ["Teacher","Organizer"], languages: ["German","English"], interests: ["Offer private/group lessons","Social Dance Party"], availability: ["Weekdays","Weekends"],
    avatar_url: "https://i.pravatar.cc/300?u=david", verified: true,
    dance_skills: { salsa: { level: "Advanced", verified: true } },
    has_other_style: false
  },
  { email: "conxion.seed+marta@yourdomain.com", name: "Marta Ruiz", city: "Valencia", country: "Spain",
    roles: ["Social dancer / Student"], languages: ["Spanish","English"], interests: ["Practice / Dance Partner"], availability: ["Evenings"],
    avatar_url: "https://i.pravatar.cc/300?u=marta", verified: false,
    dance_skills: { bachata: { level: "Intermediate (9–24 months)" } },
    has_other_style: false
  },
];


for (const u of USERS) {
  // 1) Create Auth user (admin)
  // BEFORE creating user, check if user exists by email
const { data: existing, error: findErr } = await supabase.auth.admin.listUsers({
  // listUsers has pagination; we filter manually
  page: 1,
  perPage: 1000,
});

if (findErr) throw findErr;

const already = existing.users.find((u) => u.email?.toLowerCase() === seed.email.toLowerCase());

let userId;

if (already) {
  userId = already.id;
  console.log("User exists, skipping create:", seed.email);
} else {
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: seed.email,
    email_confirm: true,
    user_metadata: { display_name: seed.display_name },
  });
  if (createErr) throw createErr;
  userId = created.user.id;
  console.log("Created:", seed.email);
}

// then upsert profile using userId
await supabase.from("profiles").upsert({
  user_id: userId,
  display_name: seed.display_name,
  city: seed.city,
  country: seed.country,
  roles: seed.roles,
  languages: seed.languages,
  interests: seed.interests,
  availability: seed.availability,
  verified: seed.verified,
  dance_skills: seed.dance_skills,
  has_other_style: true,
});

  if (profileErr) {
    console.error("Profile upsert failed:", u.email, profileErr.message);
    continue;
  }

  console.log("Seeded:", u.email, "->", id);
}

console.log("Done.");
