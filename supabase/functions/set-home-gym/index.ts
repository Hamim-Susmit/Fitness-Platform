import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type SetHomeGymRequest = {
  member_id?: string;
  gym_id?: string;
};

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

  let payload: SetHomeGymRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.member_id || !payload.gym_id) {
    return jsonResponse(400, { error: "member_id_and_gym_id_required" });
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

  const { data: member } = await serviceClient
    .from("members")
    .select("id, user_id, home_gym_id")
    .eq("id", payload.member_id)
    .maybeSingle();

  if (!member) {
    return jsonResponse(404, { error: "member_not_found" });
  }

  const { data: staffRole } = await serviceClient
    .from("staff_roles")
    .select("role, gym_id")
    .eq("user_id", user.id)
    .eq("gym_id", payload.gym_id)
    .in("role", ["MANAGER", "ADMIN"])
    .maybeSingle();

  const { data: legacyStaff } = await serviceClient
    .from("staff")
    .select("staff_role, gym_id")
    .eq("user_id", user.id)
    .eq("gym_id", payload.gym_id)
    .maybeSingle();

  const canManage = !!staffRole || legacyStaff?.staff_role === "manager";
  const isMemberSelf = member.user_id === user.id;

  if (!canManage) {
    if (!isMemberSelf) {
      return jsonResponse(403, { error: "not_authorized" });
    }
    if (member.home_gym_id) {
      return jsonResponse(403, { error: "home_gym_already_set" });
    }
  }

  const { data: assigned, error: assignError } = await serviceClient.rpc("assign_home_gym", {
    p_member_id: payload.member_id,
    p_gym_id: payload.gym_id,
  });

  if (assignError) {
    return jsonResponse(500, { error: "assign_home_gym_failed" });
  }

  await serviceClient.from("member_gym_access_events").insert({
    member_id: payload.member_id,
    gym_id: payload.gym_id,
    actor_user_id: user.id,
    event_type: "HOME_GYM_ASSIGNED",
    payload: { previous_home_gym_id: member.home_gym_id },
  });

  return jsonResponse(200, { home_gym_id: assigned });
});
