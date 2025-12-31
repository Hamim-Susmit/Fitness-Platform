import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateStripeCustomer, attachCustomerMetadata, stripe } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase environment variables");
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

  if (member.stripe_customer_id) {
    return jsonResponse(200, { stripe_customer_id: member.stripe_customer_id });
  }

  if (!user.email) {
    return jsonResponse(400, { error: "email_required" });
  }

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

  return jsonResponse(200, { stripe_customer_id: customer.id });
});
