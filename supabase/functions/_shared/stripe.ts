import Stripe from "npm:stripe@14.21.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY environment variable");
}

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2023-10-16",
});

export async function getOrCreateStripeCustomer(userId: string, email: string) {
  const existing = await stripe.customers.search({
    query: `metadata['user_id']:'${userId}'`,
    limit: 1,
  });

  if (existing.data.length > 0) {
    return existing.data[0];
  }

  return await stripe.customers.create({
    email,
    metadata: { user_id: userId },
  });
}

export function attachCustomerMetadata(memberId: string, gymId: string) {
  return {
    member_id: memberId,
    gym_id: gymId,
  } as Record<string, string>;
}

export function mapStripeStatusToInternalStatus(status: Stripe.Subscription.Status) {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "canceled":
    case "incomplete_expired":
    case "incomplete":
      return "canceled";
    default:
      return "canceled";
  }
}

export async function updateSubscriptionAndMemberStatus(
  supabase: SupabaseClient,
  stripeSubscription: Stripe.Subscription,
  memberId: string
) {
  const internalStatus = mapStripeStatusToInternalStatus(stripeSubscription.status);
  const membershipStatus =
    internalStatus === "active" || internalStatus === "trialing" ? "active" : "inactive";
  const accessState = membershipStatus === "active" ? "active" : "inactive";
  const stripePriceId = stripeSubscription.items.data[0]?.price?.id ?? null;

  let pricingPlanId: string | null = null;
  if (stripePriceId) {
    const { data: plan } = await supabase
      .from("pricing_plans")
      .select("id")
      .eq("stripe_price_id", stripePriceId)
      .maybeSingle();
    pricingPlanId = plan?.id ?? null;
  }

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", stripeSubscription.id)
    .maybeSingle();

  let subscriptionId = existing?.id ?? null;

  if (!subscriptionId) {
    const { data: created, error } = await supabase
      .from("subscriptions")
      .insert({
        member_id: memberId,
        pricing_plan_id: pricingPlanId,
        stripe_subscription_id: stripeSubscription.id,
        stripe_customer_id: typeof stripeSubscription.customer === "string"
          ? stripeSubscription.customer
          : stripeSubscription.customer?.id,
        status: internalStatus,
        current_period_start: stripeSubscription.current_period_start
          ? new Date(stripeSubscription.current_period_start * 1000).toISOString()
          : null,
        current_period_end: stripeSubscription.current_period_end
          ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
          : null,
        cancel_at_period_end: stripeSubscription.cancel_at_period_end ?? false,
        pricing_plan_id: null,
      })
      .select("id")
      .maybeSingle();

    if (error) throw error;
    subscriptionId = created?.id ?? null;
  } else {
    const { error } = await supabase
      .from("subscriptions")
      .update({
        status: internalStatus,
        pricing_plan_id: pricingPlanId,
        current_period_start: stripeSubscription.current_period_start
          ? new Date(stripeSubscription.current_period_start * 1000).toISOString()
          : null,
        current_period_end: stripeSubscription.current_period_end
          ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
          : null,
        cancel_at_period_end: stripeSubscription.cancel_at_period_end ?? false,
      })
      .eq("id", subscriptionId);

    if (error) throw error;
  }

  if (subscriptionId) {
    const { data: link } = await supabase
      .from("member_subscriptions")
      .select("id")
      .eq("member_id", memberId)
      .maybeSingle();

    if (link?.id) {
      const { error } = await supabase
        .from("member_subscriptions")
        .update({ status: membershipStatus, access_state: accessState, subscription_id: subscriptionId })
        .eq("id", link.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("member_subscriptions").insert({
        member_id: memberId,
        subscription_id: subscriptionId,
        status: membershipStatus,
        access_state: accessState,
      });
      if (error) throw error;
    }
  }

  await supabase
    .from("members")
    .update({ status: membershipStatus })
    .eq("id", memberId);
}
