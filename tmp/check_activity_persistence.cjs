const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const raw = fs.readFileSync(path.resolve(".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, idx).trim()] = value;
  }
  return env;
}

function namespacedEmail(baseEmail) {
  const ns = `d${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const at = baseEmail.indexOf("@");
  if (at <= 0) return baseEmail;
  const local = baseEmail.slice(0, at).split("+")[0];
  const domain = baseEmail.slice(at + 1);
  return `${local}+${ns}@${domain}`;
}

async function main() {
  const env = loadEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const primary = namespacedEmail(env.PLAYWRIGHT_E2E_EMAIL || "conxion.e2e.messages.primary@local.test");
  const peer = namespacedEmail(env.PLAYWRIGHT_E2E_PEER_EMAIL || "conxion.e2e.messages.peer@local.test");
  const password = env.PLAYWRIGHT_E2E_PASSWORD || "ConXionE2E!12345";

  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listed.error) throw listed.error;
  const byEmail = (email) =>
    listed.data.users.find((item) => (item.email || "").toLowerCase() === email.toLowerCase());

  const primaryUser = byEmail(primary);
  const peerUser = byEmail(peer);
  if (!primaryUser || !peerUser) {
    throw new Error(`users not found ${primary} / ${peer}`);
  }

  const conn = await admin
    .from("connections")
    .select("id,requester_id,target_id,status,created_at")
    .or(
      `and(requester_id.eq.${primaryUser.id},target_id.eq.${peerUser.id}),and(requester_id.eq.${peerUser.id},target_id.eq.${primaryUser.id})`
    )
    .order("created_at", { ascending: false })
    .limit(5);
  if (conn.error) throw conn.error;
  const connectionId = conn.data?.[0]?.id;
  const signIn = await anon.auth.signInWithPassword({ email: primary, password });
  if (signIn.error) throw signIn.error;

  const threads = await admin
    .from("threads")
    .select("id,thread_type,connection_id,last_message_at,created_at")
    .eq("connection_id", connectionId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (threads.error) throw threads.error;
  const threadId = threads.data?.[0]?.id;

  const activities = threadId
    ? await admin
        .from("activities")
        .select("id,thread_id,requester_id,recipient_id,activity_type,status,title,note,created_at,updated_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [], error: null };
  if (activities.error) throw activities.error;

  const threadContexts = threadId
    ? await admin
        .from("thread_contexts")
        .select("id,thread_id,source_table,source_id,context_tag,status_tag,title,metadata,updated_at,created_at")
        .eq("thread_id", threadId)
        .order("updated_at", { ascending: false })
        .limit(20)
    : { data: [], error: null };
  if (threadContexts.error) throw threadContexts.error;

  const threadMessages = threadId
    ? await admin
        .from("thread_messages")
        .select("id,thread_id,sender_id,body,message_type,context_tag,status_tag,metadata,created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [], error: null };
  if (threadMessages.error) throw threadMessages.error;

  const userThreads = await anon
    .from("threads")
    .select("id,thread_type,connection_id,last_message_at,created_at")
    .eq("connection_id", connectionId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (userThreads.error) throw userThreads.error;

  const userThreadContexts = threadId
    ? await anon
        .from("thread_contexts")
        .select("id,thread_id,source_table,source_id,context_tag,status_tag,title,metadata,updated_at,created_at")
        .eq("thread_id", threadId)
        .order("updated_at", { ascending: false })
        .limit(20)
    : { data: [], error: null };
  if (userThreadContexts.error) throw userThreadContexts.error;

  const userThreadMessages = threadId
    ? await anon
        .from("thread_messages")
        .select("id,thread_id,sender_id,body,message_type,context_tag,status_tag,metadata,created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [], error: null };
  if (userThreadMessages.error) throw userThreadMessages.error;

  console.log(
    JSON.stringify(
      {
        primary,
        peer,
        primaryId: primaryUser.id,
        peerId: peerUser.id,
        connectionId,
        threads: threads.data,
        activities: activities.data,
        threadContexts: threadContexts.data,
        threadMessages: threadMessages.data,
        userThreads: userThreads.data,
        userThreadContexts: userThreadContexts.data,
        userThreadMessages: userThreadMessages.data,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
