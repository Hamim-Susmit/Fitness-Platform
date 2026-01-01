import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type CapacityAction = "UPSERT_GYM_CAPACITY_LIMIT";

type CapacityRequest = {
  action?: CapacityAction;
  gym_id?: string;
  max_active_members?: number | null;
  soft_limit_threshold?: number | null;
  hard_limit_enforced?: boolean;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function canManageGymCapacity(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  gymId: string
) {
  const { data: staffRole } = await serviceClient
    .from("staff_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("gym_id", gymId)
    .maybeSingle();

  if (staffRole?.role && ["MANAGER", "ADMIN"].includes(staffRole.role)) {
    return true;
  }

  const { data: gym } = await serviceClient
    .from("gyms")
    .select("chain_id")
    .eq("id", gymId)
    .maybeSingle();

  if (!gym?.chain_id) return false;

  const { data: orgRole } = await serviceClient
    .from("organization_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("chain_id", gym.chain_id)
    .maybeSingle();

  return orgRole?.role === "CORPORATE_ADMIN";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: CapacityRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.action || !payload.gym_id) {
    return jsonResponse(400, { error: "missing_action_or_gym" });
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

  const isAuthorized = await canManageGymCapacity(serviceClient, user.id, payload.gym_id);
  if (!isAuthorized) {
    return jsonResponse(403, { error: "not_authorized" });
  }

  if (payload.action === "UPSERT_GYM_CAPACITY_LIMIT") {
    const { error } = await serviceClient
      .from("gym_capacity_limits")
      .upsert(
        {
          gym_id: payload.gym_id,
          max_active_members: payload.max_active_members ?? null,
          soft_limit_threshold: payload.soft_limit_threshold ?? null,
          hard_limit_enforced: payload.hard_limit_enforced ?? false,
        },
        { onConflict: "gym_id" }
      );

    if (error) {
      console.log("gym_capacity_upsert_failed", error.message);
      return jsonResponse(500, { error: "gym_capacity_upsert_failed" });
    }

    return jsonResponse(200, { status: "ok" });
  }

  return jsonResponse(400, { error: "unsupported_action" });
});
