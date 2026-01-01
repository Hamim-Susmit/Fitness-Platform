import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type PricingRequest = {
  plan_id?: string;
  gym_id?: string;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function resolvePricing(
  serviceClient: ReturnType<typeof createClient>,
  planId: string,
  gymId: string
) {
  const { data: plan } = await serviceClient
    .from("membership_plans")
    .select("id, chain_id, base_price_cents, currency, stripe_price_id, is_active")
    .eq("id", planId)
    .maybeSingle();

  if (!plan || !plan.is_active) {
    return null;
  }

  const { data: gym } = await serviceClient
    .from("gyms")
    .select("id, chain_id, region_id")
    .eq("id", gymId)
    .maybeSingle();

  if (!gym || gym.chain_id !== plan.chain_id) {
    return null;
  }

  const { data: gymOverride } = await serviceClient
    .from("plan_gym_overrides")
    .select("price_cents, currency, stripe_price_id")
    .eq("plan_id", planId)
    .eq("gym_id", gymId)
    .maybeSingle();

  if (gymOverride) {
    return {
      plan_id: planId,
      gym_id: gymId,
      price_cents: gymOverride.price_cents,
      currency: gymOverride.currency ?? plan.currency,
      stripe_price_id: gymOverride.stripe_price_id ?? plan.stripe_price_id,
    };
  }

  if (gym.region_id) {
    const { data: regionOverride } = await serviceClient
      .from("plan_region_overrides")
      .select("price_cents, currency, stripe_price_id")
      .eq("plan_id", planId)
      .eq("region_id", gym.region_id)
      .maybeSingle();

    if (regionOverride) {
      return {
        plan_id: planId,
        gym_id: gymId,
        price_cents: regionOverride.price_cents,
        currency: regionOverride.currency ?? plan.currency,
        stripe_price_id: regionOverride.stripe_price_id ?? plan.stripe_price_id,
      };
    }
  }

  return {
    plan_id: planId,
    gym_id: gymId,
    price_cents: plan.base_price_cents,
    currency: plan.currency ?? "usd",
    stripe_price_id: plan.stripe_price_id,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: PricingRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.plan_id || !payload.gym_id) {
    return jsonResponse(400, { error: "missing_plan_or_gym" });
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

  // Never trust client-side role checks: validate the caller has membership or staff access to the chain.
  const { data: gym } = await serviceClient
    .from("gyms")
    .select("id, chain_id")
    .eq("id", payload.gym_id)
    .maybeSingle();

  if (!gym) {
    return jsonResponse(404, { error: "gym_not_found" });
  }
  const { data: member } = await serviceClient
    .from("members")
    .select("id, gym_id, gyms(chain_id)")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: staffRole } = await serviceClient
    .from("staff_roles")
    .select("gym_id")
    .eq("user_id", user.id)
    .eq("gym_id", payload.gym_id)
    .maybeSingle();

  const { data: orgRole } = await serviceClient
    .from("organization_roles")
    .select("chain_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const memberChainId = (member?.gyms as { chain_id: string } | null)?.chain_id ?? null;
  const isMemberAuthorized = memberChainId !== null && memberChainId === gym.chain_id;
  const isOrgAuthorized = Boolean(orgRole?.chain_id) && orgRole?.chain_id === gym.chain_id;
  const isAuthorized = Boolean(staffRole?.gym_id) || isOrgAuthorized || isMemberAuthorized;

  if (!isAuthorized) {
    return jsonResponse(403, { error: "not_authorized" });
  }

  const pricing = await resolvePricing(serviceClient, payload.plan_id, payload.gym_id);
  if (!pricing) {
    return jsonResponse(404, { error: "pricing_not_found" });
  }

  return jsonResponse(200, pricing);
});
