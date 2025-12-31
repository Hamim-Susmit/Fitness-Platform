import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required Supabase environment variables");
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse(401, { error: "invalid_user" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: member, error: memberError } = await serviceClient
    .from("members")
    .select("id, gym_id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) {
    return jsonResponse(500, { error: "member_lookup_failed" });
  }

  if (!member) {
    return jsonResponse(403, { error: "member_not_found" });
  }

  if (member.status !== "active") {
    return jsonResponse(403, { error: "membership_inactive" });
  }

  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const { error: insertError } = await serviceClient
    .from("checkin_tokens")
    .insert({
      token,
      member_id: member.id,
      gym_id: member.gym_id,
      expires_at: expiresAt,
      used: false,
      created_by: user.id,
    });

  if (insertError) {
    return jsonResponse(500, { error: "token_insert_failed" });
  }

  return jsonResponse(200, {
    token,
    expires_at: expiresAt,
    member_id: member.id,
    gym_id: member.gym_id,
  });
});
