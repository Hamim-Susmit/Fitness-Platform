import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripe, mapStripeStatusToInternalStatus } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type ChangePlanRequest = {
  pricing_plan_id?: string;
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

  let payload: ChangePlanRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.pricing_plan_id) {
    return jsonResponse(400, { error: "pricing_plan_id_required" });
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

  const { data: userProfile } = await userClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!userProfile || userProfile.role !== "member") {
    return jsonResponse(403, { error: "member_only" });
  }

  const { data: member } = await userClient
    .from("members")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return jsonResponse(403, { error: "member_not_found" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: subscription } = await serviceClient
    .from("subscriptions")
    .select("id, pricing_plan_id, stripe_subscription_id, status")
    .eq("member_id", member.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!subscription || !subscription.stripe_subscription_id) {
    return jsonResponse(404, { error: "subscription_not_found" });
  }

  if (subscription.pricing_plan_id === payload.pricing_plan_id) {
    return jsonResponse(400, { error: "plan_already_active" });
  }

  const { data: targetPlan } = await serviceClient
    .from("pricing_plans")
    .select("id, stripe_price_id, active")
    .eq("id", payload.pricing_plan_id)
    .maybeSingle();

  if (!targetPlan || !targetPlan.active || !targetPlan.stripe_price_id) {
    return jsonResponse(400, { error: "plan_unavailable" });
  }

  const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
  const subscriptionItemId = stripeSubscription.items.data[0]?.id;

  if (!subscriptionItemId) {
    return jsonResponse(500, { error: "subscription_item_missing" });
  }

  const updatedStripeSubscription = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
    cancel_at_period_end: false,
    proration_behavior: "create_prorations",
    items: [
      {
        id: subscriptionItemId,
        price: targetPlan.stripe_price_id,
      },
    ],
  });

  const internalStatus = mapStripeStatusToInternalStatus(updatedStripeSubscription.status);

  const { error: updateError } = await serviceClient
    .from("subscriptions")
    .update({
      previous_pricing_plan_id: subscription.pricing_plan_id,
      pricing_plan_id: targetPlan.id,
      plan_change_requested_at: new Date().toISOString(),
      status: internalStatus,
      current_period_start: updatedStripeSubscription.current_period_start
        ? new Date(updatedStripeSubscription.current_period_start * 1000).toISOString()
        : null,
      current_period_end: updatedStripeSubscription.current_period_end
        ? new Date(updatedStripeSubscription.current_period_end * 1000).toISOString()
        : null,
    })
    .eq("id", subscription.id);

  if (updateError) {
    return jsonResponse(500, { error: "subscription_update_failed" });
  }

  return jsonResponse(200, {
    pricing_plan_id: targetPlan.id,
    status: internalStatus,
    note: "Prorations will appear on the next invoice.",
  });
});
