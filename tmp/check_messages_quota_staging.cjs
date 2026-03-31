const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const raw = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const password = env.PLAYWRIGHT_E2E_PASSWORD || 'ConXionE2E!12345';
  const ns = `diag${Date.now()}`;
  const emailA = `conxion.e2e.messages.primary+${ns}@local.test`;
  const emailB = `conxion.e2e.messages.peer+${ns}@local.test`;

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const clientA = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const clientB = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

  const createA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  const createB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (createA.error) throw createA.error;
  if (createB.error) throw createB.error;
  const idA = createA.data.user.id;
  const idB = createB.data.user.id;

  const baseProfile = {
    roles: ['Social dancer / Student'],
    languages: ['English'],
    interests: ['Practice / Dance Partner'],
    availability: ['Evenings'],
    has_other_style: false,
  };
  const profileA = await admin.from('profiles').upsert({
    user_id: idA,
    username: `diag.a.${Date.now()}`,
    display_name: 'Diag A',
    city: 'Tallinn',
    country: 'Estonia',
    avatar_url: 'https://i.pravatar.cc/300?u=diagA',
    verified: false,
    dance_skills: { bachata: { level: 'Improver (3–9 months)' } },
    ...baseProfile,
  }, { onConflict: 'user_id' });
  const profileB = await admin.from('profiles').upsert({
    user_id: idB,
    username: `diag.b.${Date.now()}`,
    display_name: 'Diag B',
    city: 'Lisbon',
    country: 'Portugal',
    avatar_url: 'https://i.pravatar.cc/300?u=diagB',
    verified: false,
    dance_skills: { salsa: { level: 'Improver (3–9 months)' } },
    ...baseProfile,
  }, { onConflict: 'user_id' });
  if (profileA.error) throw profileA.error;
  if (profileB.error) throw profileB.error;

  const signInA = await clientA.auth.signInWithPassword({ email: emailA, password });
  const signInB = await clientB.auth.signInWithPassword({ email: emailB, password });
  if (signInA.error) throw signInA.error;
  if (signInB.error) throw signInB.error;

  const createReq = await clientA.rpc('create_connection_request', {
    p_target_id: idB,
    p_context: 'member',
    p_connect_reason: 'diag',
    p_connect_reason_role: null,
    p_trip_id: null,
    p_note: 'diag',
  });
  if (createReq.error) throw createReq.error;

  const conn = await admin.from('connections').select('id').eq('requester_id', idA).eq('target_id', idB).order('created_at', { ascending: false }).limit(1).single();
  if (conn.error) throw conn.error;
  const accept = await clientB.rpc('accept_connection_request', { p_connection_id: conn.data.id });
  if (accept.error) throw accept.error;

  const sync = await clientA.rpc('cx_sync_user_messaging_state');
  console.log(JSON.stringify({ emailA, idA, syncData: sync.data, syncError: sync.error }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
