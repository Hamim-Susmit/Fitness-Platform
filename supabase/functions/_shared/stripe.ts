import Stripe from "npm:stripe@14.21.0";

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
