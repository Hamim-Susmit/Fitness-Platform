"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Header from "../../../components/Header";
import BillingPlanCard from "../../../components/BillingPlanCard";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { useCheckoutSession, useMemberProfile, useMemberSubscription, usePortalSession, usePricingPlans } from "../../../lib/useBilling";

export default function BillingPage() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const memberProfile = useMemberProfile(session?.user.id);
  const plans = usePricingPlans();
  const subscription = useMemberSubscription(memberProfile.data?.id ?? undefined);
  const checkout = useCheckoutSession();
  const portal = usePortalSession();

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  if (loading || !session) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  const currentPlanId = subscription.data?.pricing_plan_id ?? null;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Header />
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-2xl font-semibold">Billing</h2>
          <p className="text-sm text-slate-400 mt-2">
            Manage your subscription and update payment details securely through Stripe.
          </p>
          {subscription.isLoading ? (
            <p className="mt-4 text-sm text-slate-400">Loading subscription...</p>
          ) : subscription.isError ? (
            <p className="mt-4 text-sm text-rose-400">Unable to load subscription.</p>
          ) : subscription.data ? (
            <div className="mt-4 text-sm text-slate-300">
              Current plan: <span className="font-semibold">{subscription.data.pricing_plans?.name ?? "Plan"}</span>
              <span className="ml-3 text-slate-400">Status: {subscription.data.status}</span>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">No active subscription yet.</p>
          )}
          <button
            onClick={() => portal.mutateAsync().then((url) => window.location.assign(url))}
            disabled={portal.isPending}
            className="mt-4 rounded-lg border border-slate-700 px-4 py-2 text-slate-200 hover:bg-slate-800"
          >
            {portal.isPending ? "Opening portal..." : "Manage Billing"}
          </button>
          {portal.isError ? (
            <p className="mt-2 text-sm text-rose-400">{portal.error?.message ?? "Unable to open portal."}</p>
          ) : null}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {plans.isLoading ? (
            <p className="text-sm text-slate-400">Loading plans...</p>
          ) : plans.isError ? (
            <p className="text-sm text-rose-400">Unable to load pricing plans.</p>
          ) : (
            plans.data?.map((plan) => (
              <BillingPlanCard
                key={plan.id}
                name={plan.name}
                description={plan.description}
                priceCents={plan.price_cents}
                interval={plan.interval}
                status={subscription.data?.status ?? null}
                isCurrent={plan.id === currentPlanId}
                loading={checkout.isPending && checkout.variables === plan.id}
                onSelect={() =>
                  checkout
                    .mutateAsync(plan.id)
                    .then((url) => window.location.assign(url))
                    .catch(() => undefined)
                }
              />
            ))
          )}
          {checkout.isError ? (
            <p className="text-sm text-rose-400">{checkout.error?.message ?? "Unable to start checkout."}</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
