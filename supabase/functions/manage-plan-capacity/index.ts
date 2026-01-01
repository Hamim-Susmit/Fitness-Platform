import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type CapacityAction = "UPSERT_PLAN_CAPACITY_LIMIT" | "REMOVE_PLAN_CAPACITY_LIMIT";

type CapacityRequest = {
  action?: CapacityAction;
  plan_id?: string;
  gym_id?: string;
  max_active_members?: number | null;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function assertCorporateAdmin(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  planId: string
) {
  const { data: plan } = await serviceClient
    .from("membership_plans")
    .select("id, chain_id")
    .eq("id", planId)
    .maybeSingle();

  if (!plan) {
    return { ok: false, error: "plan_not_found" } as const;
  }

  const { data: orgRole } = await serviceClient
    .from("organization_roles")
    .select("role, chain_id")
    .eq("user_id", userId)
    .eq("chain_id", plan.chain_id)
    .maybeSingle();

  if (!orgRole || orgRole.role !== "CORPORATE_ADMIN") {
    return { ok: false, error: "not_authorized" } as const;
  }

  return { ok: true } as const;
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

  if (!payload.action || !payload.plan_id || !payload.gym_id) {
    return jsonResponse(400, { error: "missing_action_or_plan" });
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

  const permission = await assertCorporateAdmin(serviceClient, user.id, payload.plan_id);
  if (!permission.ok) {
    return jsonResponse(403, { error: permission.error });
  }

  if (payload.action === "UPSERT_PLAN_CAPACITY_LIMIT") {
    const { error } = await serviceClient
      .from("plan_location_capacity_limits")
      .upsert(
        {
          plan_id: payload.plan_id,
          gym_id: payload.gym_id,
          max_active_members: payload.max_active_members ?? null,
        },
        { onConflict: "plan_id,gym_id" }
      );

    if (error) {
      console.log("plan_capacity_upsert_failed", error.message);
      return jsonResponse(500, { error: "plan_capacity_upsert_failed" });
    }

    return jsonResponse(200, { status: "ok" });
  }

  if (payload.action === "REMOVE_PLAN_CAPACITY_LIMIT") {
    const { error } = await serviceClient
      .from("plan_location_capacity_limits")
      .delete()
      .eq("plan_id", payload.plan_id)
      .eq("gym_id", payload.gym_id);

    if (error) {
      console.log("plan_capacity_delete_failed", error.message);
      return jsonResponse(500, { error: "plan_capacity_delete_failed" });
    }

    return jsonResponse(200, { status: "ok" });
  }

  return jsonResponse(400, { error: "unsupported_action" });
});
