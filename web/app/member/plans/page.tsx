"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore, useToastStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";
import { useActiveGym } from "../../../lib/useActiveGym";
import { callEdgeFunction } from "../../../lib/api";

type MembershipPlan = {
  id: string;
  name: string;
  description: string | null;
  billing_period: "MONTHLY" | "YEARLY";
  base_price_cents: number;
  access_scope: "SINGLE_GYM" | "REGION" | "ALL_LOCATIONS";
};

type PricingResponse = {
  plan_id: string;
  gym_id: string;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
};

type CapacityStatus = "OK" | "NEAR_LIMIT" | "AT_CAPACITY" | "BLOCK_NEW";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function accessScopeLabel(scope: MembershipPlan["access_scope"]) {
  switch (scope) {
    case "REGION":
      return "Region access";
    case "ALL_LOCATIONS":
      return "All locations";
    default:
      return "This location only";
  }
}

function MemberPlansView() {
  const { session, role, loading } = useAuthStore();
  const { message, status, setToast } = useToastStore();
  const { activeGymId } = useActiveGym();
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [pricingByPlan, setPricingByPlan] = useState<Record<string, PricingResponse>>({});
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [creatingPlanId, setCreatingPlanId] = useState<string | null>(null);
  const [capacityStatus, setCapacityStatus] = useState<CapacityStatus>("OK");

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      window.location.href = roleRedirectPath(role);
    }
  }, [loading, role, session]);

  useEffect(() => {
    const loadPlans = async () => {
      if (!activeGymId || !session) return;
      setLoadingPlans(true);
      const { data: gym } = await supabaseBrowser
        .from("gyms")
        .select("id, chain_id")
        .eq("id", activeGymId)
        .maybeSingle();

      if (!gym?.chain_id) {
        setPlans([]);
        setLoadingPlans(false);
        return;
      }

      const { data, error } = await supabaseBrowser
        .from("membership_plans")
        .select("id, name, description, billing_period, base_price_cents, access_scope")
        .eq("chain_id", gym.chain_id)
        .eq("is_active", true)
        .order("base_price_cents", { ascending: true });

      if (error) {
        setPlans([]);
        setLoadingPlans(false);
        return;
      }

      setPlans((data ?? []) as MembershipPlan[]);
      setLoadingPlans(false);
    };

    loadPlans();
  }, [activeGymId, session]);

  useEffect(() => {
    const resolvePricing = async () => {
      if (!activeGymId || plans.length === 0) {
        setPricingByPlan({});
        return;
      }

      const results: Record<string, PricingResponse> = {};
      for (const plan of plans) {
        const response = await callEdgeFunction<PricingResponse>("get-pricing-for-gym", {
          body: { plan_id: plan.id, gym_id: activeGymId },
        });
        if (!response.error && response.data) {
          results[plan.id] = response.data;
        }
      }
      setPricingByPlan(results);
    };

    resolvePricing();
  }, [activeGymId, plans]);

  useEffect(() => {
    const loadCapacityStatus = async () => {
      if (!activeGymId) return;
      const response = await callEdgeFunction<{ status: CapacityStatus }>("get-gym-capacity-status", {
        body: { gym_id: activeGymId },
      });
      if (!response.error && response.data?.status) {
        setCapacityStatus(response.data.status);
      }
    };
    loadCapacityStatus();
  }, [activeGymId]);

  const visiblePlans = useMemo(() => plans, [plans]);
  const isLocationFull = capacityStatus === "BLOCK_NEW";
  const showNearLimit = capacityStatus === "NEAR_LIMIT";

  const handleSelectPlan = async (planId: string) => {
    if (!activeGymId) return;
    setCreatingPlanId(planId);
    const response = await callEdgeFunction("create-gym-subscription", {
      body: { plan_id: planId, gym_id: activeGymId },
    });

    if (response.error) {
      setToast(response.error, "error");
      setTimeout(() => setToast(null, null), 3000);
      setCreatingPlanId(null);
      return;
    }

    setToast("Subscription created", "success");
    setTimeout(() => setToast(null, null), 3000);
    setCreatingPlanId(null);
  };

  if (loading || loadingPlans) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-5xl mx-auto space-y-6">
        {message ? (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              status === "success" ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"
            }`}
          >
            {message}
          </div>
        ) : null}
        <div>
          <h1 className="text-3xl font-semibold">Membership Plans</h1>
          <p className="text-slate-400 text-sm">
            Choose a plan for your current location. Pricing updates automatically for the selected gym.
          </p>
        </div>
        {isLocationFull ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            This location is currently full.
          </div>
        ) : showNearLimit ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Limited spots remaining.
          </div>
        ) : null}
        <div className="grid gap-6 md:grid-cols-2">
          {visiblePlans.length ? (
            visiblePlans.map((plan) => {
              const pricing = pricingByPlan[plan.id];
              const priceLabel = pricing
                ? formatPrice(pricing.price_cents, pricing.currency)
                : formatPrice(plan.base_price_cents, "usd");
              return (
                <div key={plan.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
                  <div>
                    <h2 className="text-xl font-semibold">{plan.name}</h2>
                    <p className="text-sm text-slate-400">{plan.description ?? "Flexible access plan."}</p>
                  </div>
                  <div className="text-3xl font-semibold">{priceLabel}</div>
                  <div className="text-xs text-slate-400 uppercase tracking-wide">{plan.billing_period}</div>
                  <span className="inline-flex items-center rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">
                    {accessScopeLabel(plan.access_scope)}
                  </span>
                  <button
                    className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    onClick={() => handleSelectPlan(plan.id)}
                    disabled={creatingPlanId === plan.id || isLocationFull}
                  >
                    {isLocationFull ? "Location full" : creatingPlanId === plan.id ? "Creating..." : "Select Plan"}
                  </button>
                </div>
              );
            })
          ) : (
            <div className="text-slate-400">No plans available for this location.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MemberPlansPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemberPlansView />
    </QueryClientProvider>
  );
}
