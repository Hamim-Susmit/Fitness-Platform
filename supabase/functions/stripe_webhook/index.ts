import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@14.21.0";
import { mapStripeStatusToInternalStatus, updateSubscriptionAndMemberStatus, stripe } from "../_shared/stripe.ts";

// Stripe webhook endpoint:
// https://<supabase-project-ref>.functions.supabase.co/stripe_webhook
// Configure events: checkout.session.completed, customer.subscription.created,
// customer.subscription.updated, customer.subscription.deleted, invoice.paid,
// invoice.payment_failed, charge.refunded

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_FUNCTIONS_URL = Deno.env.get("SUPABASE_FUNCTIONS_URL") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

if (!STRIPE_WEBHOOK_SECRET) {
  throw new Error("Missing STRIPE_WEBHOOK_SECRET");
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function notifyBilling(event: string, memberId: string, gracePeriodUntil?: string | null) {
  if (!SUPABASE_FUNCTIONS_URL) return;
  await fetch(`${SUPABASE_FUNCTIONS_URL}/send_billing_notifications`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ event, member_id: memberId, grace_period_until: gracePeriodUntil }),
  });
}

async function upsertInvoice(
  supabase: ReturnType<typeof createClient>,
  subscriptionId: string,
  invoice: Stripe.Invoice
) {
  await supabase.from("invoices").upsert(
    {
      subscription_id: subscriptionId,
      stripe_invoice_id: invoice.id,
      amount_due_cents: invoice.amount_due ?? 0,
      amount_paid_cents: invoice.amount_paid ?? 0,
      hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      pdf_url: invoice.invoice_pdf ?? null,
      status: invoice.status ?? "open",
    },
    { onConflict: "stripe_invoice_id" }
  );
}

async function insertTransaction(
  supabase: ReturnType<typeof createClient>,
  subscriptionId: string,
  amountCents: number,
  currency: string,
  paymentIntentId: string | null,
  status: "succeeded" | "failed" | "pending" | "refunded"
) {
  if (paymentIntentId) {
    const { data } = await supabase
      .from("transactions")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();

    if (data?.id) {
      await supabase
        .from("transactions")
        .update({ status })
        .eq("id", data.id);
      return;
    }
  }

  await supabase.from("transactions").insert({
    subscription_id: subscriptionId,
    amount_cents: amountCents,
    currency,
    stripe_payment_intent_id: paymentIntentId,
    status,
    refund_amount_cents: 0,
  });
}

async function resolveSubscriptionId(
  supabase: ReturnType<typeof createClient>,
  stripeSubscriptionId: string
) {
  const { data } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle();
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  // TODO: re-run derive_member_gym_access_from_subscription when subscription status changes.
  // TODO: handle graceful downgrade/upgrade flows and prorations for location-based pricing.
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse(400, { error: "missing_signature" });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed", err);
    return jsonResponse(400, { error: "invalid_signature" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingEvent } = await serviceClient
    .from("stripe_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();

  if (existingEvent?.id) {
    return jsonResponse(200, { received: true });
  }

  const { error: insertEventError } = await serviceClient
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });

  if (insertEventError && insertEventError.code !== "23505") {
    console.error("stripe_events insert failed", insertEventError);
    return jsonResponse(500, { error: "event_persist_failed" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const stripeSubscriptionId = session.subscription as string | null;
        const stripeCustomerId = session.customer as string | null;
        const memberId = session.metadata?.member_id ?? null;

        if (stripeSubscriptionId && memberId) {
          const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
          await updateSubscriptionAndMemberStatus(serviceClient, stripeSubscription, memberId);

          await serviceClient
            .from("subscriptions")
            .update({ stripe_customer_id: stripeCustomerId })
            .eq("stripe_subscription_id", stripeSubscriptionId);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const memberId = subscription.metadata?.member_id;

        const stripePriceId = subscription.items.data[0]?.price?.id ?? null;
        let newPlanId: string | null = null;
        if (stripePriceId) {
          const { data: plan } = await serviceClient
            .from("pricing_plans")
            .select("id")
            .eq("stripe_price_id", stripePriceId)
            .maybeSingle();
          newPlanId = plan?.id ?? null;
        }

        const { data: existingSub } = await serviceClient
          .from("subscriptions")
          .select("id, pricing_plan_id, previous_pricing_plan_id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        const internalStatus = mapStripeStatusToInternalStatus(subscription.status);

        if (memberId) {
          await updateSubscriptionAndMemberStatus(serviceClient, subscription, memberId);
        }

        if (existingSub?.id && newPlanId && existingSub.pricing_plan_id !== newPlanId) {
          await serviceClient
            .from("subscriptions")
            .update({
              previous_pricing_plan_id: existingSub.pricing_plan_id ?? existingSub.previous_pricing_plan_id,
              pricing_plan_id: newPlanId,
              status: internalStatus,
              current_period_start: subscription.current_period_start
                ? new Date(subscription.current_period_start * 1000).toISOString()
                : null,
              current_period_end: subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : null,
              cancel_at_period_end: subscription.cancel_at_period_end ?? false,
            })
            .eq("id", existingSub.id);
        } else if (existingSub?.id) {
          await serviceClient
            .from("subscriptions")
            .update({
              status: internalStatus,
              current_period_start: subscription.current_period_start
                ? new Date(subscription.current_period_start * 1000).toISOString()
                : null,
              current_period_end: subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : null,
              cancel_at_period_end: subscription.cancel_at_period_end ?? false,
            })
            .eq("id", existingSub.id);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const memberId = subscription.metadata?.member_id;

        await serviceClient
          .from("subscriptions")
          .update({ status: "canceled", cancel_at_period_end: false, delinquency_state: "canceled" })
          .eq("stripe_subscription_id", subscription.id);

        if (memberId) {
          await serviceClient
            .from("members")
            .update({ status: "inactive" })
            .eq("id", memberId);

          await serviceClient
            .from("member_subscriptions")
            .update({ status: "inactive", access_state: "inactive" })
            .eq("member_id", memberId);
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeSubscriptionId = invoice.subscription as string | null;

        if (stripeSubscriptionId) {
          const subscriptionId = await resolveSubscriptionId(serviceClient, stripeSubscriptionId);
          if (subscriptionId) {
            await upsertInvoice(serviceClient, subscriptionId, invoice);
            await insertTransaction(
              serviceClient,
              subscriptionId,
              invoice.amount_paid ?? 0,
              invoice.currency ?? "usd",
              invoice.payment_intent as string | null,
              "succeeded"
            );

            await serviceClient
              .from("subscriptions")
              .update({ delinquency_state: "recovered", grace_period_until: null })
              .eq("id", subscriptionId);

            const { data: sub } = await serviceClient
              .from("subscriptions")
              .select("member_id")
              .eq("id", subscriptionId)
              .maybeSingle();

            if (sub?.member_id) {
              await serviceClient
                .from("member_subscriptions")
                .update({ access_state: "active" })
                .eq("member_id", sub.member_id);

              await notifyBilling("billing.payment_recovered", sub.member_id, null);
            }
          }
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeSubscriptionId = invoice.subscription as string | null;

        if (stripeSubscriptionId) {
          const subscriptionId = await resolveSubscriptionId(serviceClient, stripeSubscriptionId);
          if (subscriptionId) {
            await upsertInvoice(serviceClient, subscriptionId, invoice);
            await insertTransaction(
              serviceClient,
              subscriptionId,
              invoice.amount_due ?? 0,
              invoice.currency ?? "usd",
              invoice.payment_intent as string | null,
              "failed"
            );

            await serviceClient
              .from("subscriptions")
              .update({
                status: "past_due",
                delinquency_state: "pending_retry",
                grace_period_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              })
              .eq("id", subscriptionId);

            const { data: sub } = await serviceClient
              .from("subscriptions")
              .select("member_id, grace_period_until")
              .eq("id", subscriptionId)
              .maybeSingle();

            if (sub?.member_id) {
              await serviceClient
                .from("member_subscriptions")
                .update({ access_state: "grace" })
                .eq("member_id", sub.member_id);

              await notifyBilling("billing.payment_failed", sub.member_id, sub.grace_period_until);
            }
          }
        }
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = charge.payment_intent as string | null;

        if (paymentIntentId) {
          const refundAmount = charge.amount_refunded ?? charge.amount ?? 0;
          const isFullRefund = refundAmount >= (charge.amount ?? 0);

          await serviceClient
            .from("transactions")
            .update({
              refund_amount_cents: refundAmount,
              status: isFullRefund ? "refunded" : "succeeded",
            })
            .eq("stripe_payment_intent_id", paymentIntentId);
        }
        break;
      }
      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (error) {
    console.error("Stripe webhook handler error", error);
    return jsonResponse(500, { error: "webhook_handler_failed" });
  }

  return jsonResponse(200, { received: true });
});
