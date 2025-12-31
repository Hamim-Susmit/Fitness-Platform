import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateStripeCustomer, attachCustomerMetadata, stripe } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const STRIPE_SUCCESS_URL = Deno.env.get("STRIPE_CHECKOUT_SUCCESS_URL") ?? "";
const STRIPE_CANCEL_URL = Deno.env.get("STRIPE_CHECKOUT_CANCEL_URL") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase environment variables");
}

if (!STRIPE_SUCCESS_URL || !STRIPE_CANCEL_URL) {
  throw new Error("Missing Stripe checkout redirect URLs");
}

type CheckoutRequest = {
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

  let payload: CheckoutRequest;
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

  const { data: userProfile, error: userProfileError } = await userClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (userProfileError || !userProfile || userProfile.role !== "member") {
    return jsonResponse(403, { error: "member_only" });
  }

  const { data: member, error: memberError } = await userClient
    .from("members")
    .select("id, gym_id, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) {
    return jsonResponse(500, { error: "member_lookup_failed" });
  }

  if (!member) {
    return jsonResponse(403, { error: "member_not_found" });
  }

  const { data: plan, error: planError } = await userClient
    .from("pricing_plans")
    .select("id, stripe_price_id, active")
    .eq("id", payload.pricing_plan_id)
    .maybeSingle();

  if (planError || !plan) {
    return jsonResponse(404, { error: "plan_not_found" });
  }

  if (!plan.active || !plan.stripe_price_id) {
    return jsonResponse(400, { error: "plan_unavailable" });
  }

  if (!user.email) {
    return jsonResponse(400, { error: "email_required" });
  }

  let customerId = member.stripe_customer_id as string | null;

  if (!customerId) {
    const customer = await getOrCreateStripeCustomer(user.id, user.email);
    await stripe.customers.update(customer.id, {
      metadata: attachCustomerMetadata(member.id, member.gym_id),
    });

    const { error: updateError } = await userClient
      .from("members")
      .update({ stripe_customer_id: customer.id })
      .eq("id", member.id);

    if (updateError) {
      return jsonResponse(500, { error: "member_update_failed" });
    }

    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: STRIPE_SUCCESS_URL,
    cancel_url: STRIPE_CANCEL_URL,
    automatic_tax: { enabled: true },
    subscription_data: {
      metadata: {
        member_id: member.id,
        gym_id: member.gym_id,
      },
    },
  });

  if (!session.url) {
    return jsonResponse(500, { error: "checkout_url_missing" });
  }

  return jsonResponse(200, { checkout_url: session.url });
});
