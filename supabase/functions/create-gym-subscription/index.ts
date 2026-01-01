import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripe, getOrCreateStripeCustomer, mapStripeStatusToInternalStatus } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type SubscriptionRequest = {
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
    .select("id, chain_id, base_price_cents, currency, stripe_price_id, is_active, access_scope")
    .eq("id", planId)
    .maybeSingle();

  if (!plan) {
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
      plan,
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
        plan,
        price_cents: regionOverride.price_cents,
        currency: regionOverride.currency ?? plan.currency,
        stripe_price_id: regionOverride.stripe_price_id ?? plan.stripe_price_id,
      };
    }
  }

  return {
    plan,
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

  let payload: SubscriptionRequest;
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

  const { data: member } = await serviceClient
    .from("members")
    .select("id, stripe_customer_id, user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return jsonResponse(403, { error: "member_not_found" });
  }

  const pricing = await resolvePricing(serviceClient, payload.plan_id, payload.gym_id);
  if (!pricing || !pricing.plan?.is_active) {
    return jsonResponse(404, { error: "plan_not_available" });
  }

  if (!pricing.stripe_price_id) {
    return jsonResponse(400, { error: "missing_stripe_price" });
  }

  // Capacity enforcement must never rely on UI logic. Backend + SQL rules determine allowance.
  const { data: capacityStatus, error: capacityError } = await serviceClient.rpc("get_gym_capacity_status", {
    p_gym_id: payload.gym_id,
  });

  if (capacityError) {
    console.log("capacity_status_failed", capacityError.message);
    return jsonResponse(500, { error: "capacity_status_failed" });
  }

  const capacityStatusValue = (capacityStatus as { status?: string; hard_limit_enforced?: boolean } | null)?.status ?? "OK";
  const hardLimitEnforced =
    (capacityStatus as { hard_limit_enforced?: boolean } | null)?.hard_limit_enforced ?? false;

  if (capacityStatusValue === "BLOCK_NEW") {
    return jsonResponse(409, { error: "capacity_blocked", message: "This location is currently full." });
  }

  if (capacityStatusValue === "AT_CAPACITY" && hardLimitEnforced) {
    return jsonResponse(409, { error: "capacity_blocked", message: "This location is currently full." });
  }

  const { data: planCapacity, error: planCapacityError } = await serviceClient.rpc("check_plan_capacity_for_gym", {
    p_plan_id: payload.plan_id,
    p_gym_id: payload.gym_id,
  });

  if (planCapacityError) {
    console.log("plan_capacity_failed", planCapacityError.message);
    return jsonResponse(500, { error: "plan_capacity_failed" });
  }

  const planCapacityStatus = (planCapacity as { status?: string } | null)?.status ?? "NO_LIMIT";
  if (planCapacityStatus === "BLOCK_NEW" || planCapacityStatus === "AT_CAPACITY") {
    return jsonResponse(409, { error: "plan_capacity_blocked", message: "This plan is full for the selected gym." });
  }

  const customer =
    member.stripe_customer_id ??
    (await getOrCreateStripeCustomer(user.id, user.email ?? "member@fitness.local")).id;

  if (!member.stripe_customer_id) {
    await serviceClient
      .from("members")
      .update({ stripe_customer_id: customer })
      .eq("id", member.id);
  }

  // TODO: handle graceful plan upgrades/downgrades (proration rules).
  const stripeSubscription = await stripe.subscriptions.create({
    customer,
    items: [{ price: pricing.stripe_price_id }],
    expand: ["latest_invoice.payment_intent"],
  });

  const internalStatus = mapStripeStatusToInternalStatus(stripeSubscription.status);
  const normalizedStatus =
    internalStatus === "active" || internalStatus === "trialing"
      ? "ACTIVE"
      : internalStatus === "past_due"
      ? "PAST_DUE"
      : internalStatus === "canceled"
      ? "CANCELED"
      : "INACTIVE";

  const { data: subscriptionRow, error: subscriptionError } = await serviceClient
    .from("member_subscriptions")
    .insert({
      member_id: member.id,
      plan_id: payload.plan_id,
      home_gym_id: payload.gym_id,
      access_scope: pricing.plan.access_scope ?? "SINGLE_GYM",
      status: normalizedStatus,
      started_at: new Date().toISOString(),
      current_period_end: stripeSubscription.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
        : null,
      stripe_subscription_id: stripeSubscription.id,
      stripe_customer_id: customer,
    })
    .select("id")
    .maybeSingle();

  if (subscriptionError) {
    console.log("subscription_insert_failed", subscriptionError.message);
    return jsonResponse(500, { error: "subscription_insert_failed" });
  }

  // TODO: update Stripe webhooks to re-run derive_member_gym_access_from_subscription on status changes.
  await serviceClient.rpc("derive_member_gym_access_from_subscription", {
    p_member_id: member.id,
    p_subscription_id: subscriptionRow?.id,
  });

  // Analytics event: subscription.created
  try {
    await serviceClient.rpc("log_analytics_event", {
      p_event_type: "subscription.created",
      p_user_id: user.id,
      p_member_id: member.id,
      p_gym_id: payload.gym_id,
      p_source: "web",
      p_context: {
        subscription_id: subscriptionRow?.id,
        plan_id: payload.plan_id,
        gym_id: payload.gym_id,
      },
    });
  } catch (error) {
    console.log("analytics_event_failed", error);
  }

  const paymentIntent = stripeSubscription.latest_invoice?.payment_intent;
  const clientSecret =
    typeof paymentIntent === "object" && paymentIntent !== null ? paymentIntent.client_secret : null;

  return jsonResponse(200, {
    status: "created",
    subscription_id: subscriptionRow?.id,
    client_secret: clientSecret,
    capacity_warning: capacityStatusValue === "NEAR_LIMIT",
  });
});
