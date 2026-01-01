import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripe } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type RefundRequest = {
  transaction_id?: string;
  amount_cents?: number;
  reason?: string;
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

  let payload: RefundRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.transaction_id) {
    return jsonResponse(400, { error: "transaction_id_required" });
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

  if (!userProfile || (userProfile.role !== "staff" && userProfile.role !== "owner")) {
    return jsonResponse(403, { error: "staff_only" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: transaction } = await serviceClient
    .from("transactions")
    .select("id, subscription_id, amount_cents, refund_amount_cents, stripe_payment_intent_id, status")
    .eq("id", payload.transaction_id)
    .maybeSingle();

  if (!transaction) {
    return jsonResponse(404, { error: "transaction_not_found" });
  }

  if (transaction.status !== "succeeded") {
    return jsonResponse(400, { error: "transaction_not_refundable" });
  }

  if (!transaction.stripe_payment_intent_id) {
    return jsonResponse(400, { error: "missing_payment_intent" });
  }

  const { data: subscription } = await serviceClient
    .from("subscriptions")
    .select("id, member_id")
    .eq("id", transaction.subscription_id)
    .maybeSingle();

  if (!subscription) {
    return jsonResponse(404, { error: "subscription_not_found" });
  }

  if (userProfile.role === "staff") {
    const { data: staff } = await serviceClient
      .from("staff")
      .select("gym_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!staff) {
      return jsonResponse(403, { error: "staff_not_found" });
    }

    const { data: member } = await serviceClient
      .from("members")
      .select("gym_id")
      .eq("id", subscription.member_id)
      .maybeSingle();

    if (!member || member.gym_id !== staff.gym_id) {
      return jsonResponse(403, { error: "gym_mismatch" });
    }
  }

  const remaining = transaction.amount_cents - (transaction.refund_amount_cents ?? 0);
  const refundAmount = payload.amount_cents ?? remaining;

  if (refundAmount <= 0 || refundAmount > remaining) {
    return jsonResponse(400, { error: "invalid_refund_amount" });
  }

  await stripe.refunds.create({
    payment_intent: transaction.stripe_payment_intent_id,
    amount: refundAmount,
    reason: payload.reason as "duplicate" | "fraudulent" | "requested_by_customer" | undefined,
  });

  const newRefundTotal = (transaction.refund_amount_cents ?? 0) + refundAmount;
  const newStatus = newRefundTotal >= transaction.amount_cents ? "refunded" : "succeeded";

  const { error: updateError } = await serviceClient
    .from("transactions")
    .update({
      refund_amount_cents: newRefundTotal,
      refund_reason: payload.reason ?? null,
      status: newStatus,
    })
    .eq("id", transaction.id);

  if (updateError) {
    return jsonResponse(500, { error: "refund_update_failed" });
  }

  return jsonResponse(200, {
    refund_amount_cents: newRefundTotal,
    status: newStatus,
  });
});
