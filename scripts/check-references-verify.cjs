const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function parseEnv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return out;
}

async function main() {
  const env = parseEnv(path.join(process.cwd(), ".env.local"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const seedTag = "[seed-reference-examples-v1]";

  function formatErr(error, label) {
    if (!error) return null;
    return {
      label,
      message: error.message ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
      code: error.code ?? null,
      raw: error,
    };
  }

  async function count(query, label) {
    const { count, error } = await query;
    if (error) throw formatErr(error, label);
    return count ?? 0;
  }

  const total = await count(supabase.from("references").select("*", { count: "exact", head: true }), "count_total");

  const { data: rows, error: rowsErr } = await supabase
    .from("references")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (rowsErr) throw formatErr(rowsErr, "select_rows_for_scan");

  const allRows = Array.isArray(rows) ? rows : [];

  const seededRows = allRows.filter((r) => {
    const candidates = [
      r.text,
      r.body,
      r.content,
      r.feedback,
      r.comment,
      r.reference_text,
    ];
    return candidates.some((v) => typeof v === "string" && v.includes(seedTag));
  });
  const seeded = seededRows.length;

  const tags = ["practice", "event", "host", "guest", "travel", "festival", "collaboration"];
  const breakdown = {};
  for (const t of tags) {
    breakdown[t] = allRows.filter((r) => (r.context_tag ?? null) === t).length;
  }

  const legacyConn = allRows.filter((r) => (r.context ?? null) === "connection").length;
  const legacyTrip = allRows.filter((r) => (r.context ?? null) === "trip").length;
  const sample = seededRows.slice(0, 8).map((r) => ({
    id: r.id,
    from_user_id: r.from_user_id ?? r.author_id ?? null,
    to_user_id: r.to_user_id ?? r.recipient_id ?? null,
    context_tag: r.context_tag ?? null,
    context: r.context ?? null,
    rating: r.rating ?? null,
    text: typeof r.text === "string" ? r.text : typeof r.body === "string" ? r.body : null,
    created_at: r.created_at ?? null,
  }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        total_references: total,
        scanned_rows: allRows.length,
        seeded_references: seeded,
        context_tag_breakdown: breakdown,
        legacy_context_counts: { connection: legacyConn, trip: legacyTrip },
        seeded_sample: sample,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("VERIFY_ERROR");
  console.dir(err, { depth: 6 });
  try {
    console.error(JSON.stringify(err, null, 2));
  } catch (_) {
    // no-op
  }
  process.exit(1);
});
