import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type CapacityRequest = {
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

  let payload: CapacityRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.gym_id) {
    return jsonResponse(400, { error: "missing_gym_id" });
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

  const { data: gym } = await serviceClient
    .from("gyms")
    .select("id, chain_id")
    .eq("id", payload.gym_id)
    .maybeSingle();

  if (!gym) {
    return jsonResponse(404, { error: "gym_not_found" });
  }

  const { data: staffRole } = await serviceClient
    .from("staff_roles")
    .select("id")
    .eq("user_id", user.id)
    .eq("gym_id", payload.gym_id)
    .maybeSingle();

  const { data: orgRole } = await serviceClient
    .from("organization_roles")
    .select("id")
    .eq("user_id", user.id)
    .eq("chain_id", gym.chain_id)
    .maybeSingle();

  const { data: member } = await serviceClient
    .from("members")
    .select("id, gyms(chain_id)")
    .eq("user_id", user.id)
    .maybeSingle();

  const memberChainId = (member?.gyms as { chain_id: string } | null)?.chain_id ?? null;
  const isAuthorized =
    Boolean(staffRole?.id) || Boolean(orgRole?.id) || (memberChainId !== null && memberChainId === gym.chain_id);

  if (!isAuthorized) {
    return jsonResponse(403, { error: "not_authorized" });
  }

  const { data: capacityStatus, error: capacityError } = await serviceClient.rpc("get_gym_capacity_status", {
    p_gym_id: payload.gym_id,
  });

  if (capacityError) {
    console.log("capacity_status_failed", capacityError.message);
    return jsonResponse(500, { error: "capacity_status_failed" });
  }

  const statusPayload = capacityStatus as Record<string, unknown> | null;
  if (!statusPayload) {
    return jsonResponse(404, { error: "capacity_not_found" });
  }

  if (staffRole?.id || orgRole?.id) {
    return jsonResponse(200, statusPayload);
  }

  // Members only receive the status field to avoid leaking capacity details.
  return jsonResponse(200, { status: statusPayload.status });
});
