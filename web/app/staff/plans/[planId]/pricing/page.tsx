"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore, useToastStore } from "../../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../../lib/roles";
import { supabaseBrowser } from "../../../../../lib/supabase-browser";
import { callEdgeFunction } from "../../../../../lib/api";

type GymRow = {
  id: string;
  name: string;
  region_id: string | null;
};

type MembershipPlan = {
  id: string;
  name: string;
  base_price_cents: number;
  currency: string;
};

type GymOverride = {
  gym_id: string;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
};

type RegionOverride = {
  region_id: string;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
};

type PricingResponse = {
  plan_id: string;
  gym_id: string;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
};

type Region = {
  id: string;
  name: string;
};

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

function PlanPricingView() {
  const router = useRouter();
  const params = useParams();
  const planId = params?.planId as string | undefined;
  const { session, role, loading } = useAuthStore();
  const { message, status, setToast } = useToastStore();
  const [plan, setPlan] = useState<MembershipPlan | null>(null);
  const [gyms, setGyms] = useState<GymRow[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [gymOverrides, setGymOverrides] = useState<GymOverride[]>([]);
  const [regionOverrides, setRegionOverrides] = useState<RegionOverride[]>([]);
  const [editingGymId, setEditingGymId] = useState<string | null>(null);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [overridePrice, setOverridePrice] = useState("");
  const [overrideCurrency, setOverrideCurrency] = useState("usd");
  const [overrideStripePrice, setOverrideStripePrice] = useState("");

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || !isStaffRole(role))) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const loadData = async () => {
      if (!planId) return;
      const { data: planRow } = await supabaseBrowser
        .from("membership_plans")
        .select("id, name, base_price_cents, currency, chain_id")
        .eq("id", planId)
        .maybeSingle();

      if (!planRow) {
        setPlan(null);
        return;
      }

      setPlan(planRow as MembershipPlan);

      const { data: gymsData } = await supabaseBrowser
        .from("gyms")
        .select("id, name, region_id")
        .eq("chain_id", planRow.chain_id)
        .order("name");

      setGyms((gymsData ?? []) as GymRow[]);

      const { data: regionsData } = await supabaseBrowser
        .from("regions")
        .select("id, name")
        .eq("chain_id", planRow.chain_id)
        .order("name");

      setRegions((regionsData ?? []) as Region[]);

      const { data: gymOverrideRows } = await supabaseBrowser
        .from("plan_gym_overrides")
        .select("gym_id, price_cents, currency, stripe_price_id")
        .eq("plan_id", planId);

      setGymOverrides((gymOverrideRows ?? []) as GymOverride[]);

      const { data: regionOverrideRows } = await supabaseBrowser
        .from("plan_region_overrides")
        .select("region_id, price_cents, currency, stripe_price_id")
        .eq("plan_id", planId);

      setRegionOverrides((regionOverrideRows ?? []) as RegionOverride[]);
    };

    loadData();
  }, [planId]);

  const gymOverrideMap = useMemo(() => {
    return new Map(gymOverrides.map((override) => [override.gym_id, override]));
  }, [gymOverrides]);

  const regionOverrideMap = useMemo(() => {
    return new Map(regionOverrides.map((override) => [override.region_id, override]));
  }, [regionOverrides]);

  const resetOverrideForm = () => {
    setOverridePrice("");
    setOverrideCurrency("usd");
    setOverrideStripePrice("");
  };

  const handleGymOverrideSave = async (gymId: string) => {
    if (!overridePrice) return;
    const response = await callEdgeFunction("manage-plan-pricing", {
      body: {
        action: "UPSERT_GYM_OVERRIDE",
        plan_id: planId,
        gym_id: gymId,
        price_cents: Number(overridePrice),
        currency: overrideCurrency,
        stripe_price_id: overrideStripePrice || null,
      },
    });

    if (response.error) {
      setToast(response.error, "error");
      setTimeout(() => setToast(null, null), 3000);
      return;
    }

    setToast("Override saved", "success");
    setTimeout(() => setToast(null, null), 3000);
    setEditingGymId(null);
    resetOverrideForm();
    const { data } = await supabaseBrowser
      .from("plan_gym_overrides")
      .select("gym_id, price_cents, currency, stripe_price_id")
      .eq("plan_id", planId);
    setGymOverrides((data ?? []) as GymOverride[]);
  };

  const handleRegionOverrideSave = async (regionId: string) => {
    if (!overridePrice) return;
    const response = await callEdgeFunction("manage-plan-pricing", {
      body: {
        action: "UPSERT_REGION_OVERRIDE",
        plan_id: planId,
        region_id: regionId,
        price_cents: Number(overridePrice),
        currency: overrideCurrency,
        stripe_price_id: overrideStripePrice || null,
      },
    });

    if (response.error) {
      setToast(response.error, "error");
      setTimeout(() => setToast(null, null), 3000);
      return;
    }

    setToast("Region override saved", "success");
    setTimeout(() => setToast(null, null), 3000);
    setEditingRegionId(null);
    resetOverrideForm();
    const { data } = await supabaseBrowser
      .from("plan_region_overrides")
      .select("region_id, price_cents, currency, stripe_price_id")
      .eq("plan_id", planId);
    setRegionOverrides((data ?? []) as RegionOverride[]);
  };

  const handleOverrideRemove = async (gymId: string) => {
    const response = await callEdgeFunction("manage-plan-pricing", {
      body: { action: "REMOVE_GYM_OVERRIDE", plan_id: planId, gym_id: gymId },
    });

    if (response.error) {
      setToast(response.error, "error");
      setTimeout(() => setToast(null, null), 3000);
      return;
    }

    setToast("Override removed", "success");
    setTimeout(() => setToast(null, null), 3000);
    const { data } = await supabaseBrowser
      .from("plan_gym_overrides")
      .select("gym_id, price_cents, currency, stripe_price_id")
      .eq("plan_id", planId);
    setGymOverrides((data ?? []) as GymOverride[]);
  };

  const handleRegionOverrideRemove = async (regionId: string) => {
    const response = await callEdgeFunction("manage-plan-pricing", {
      body: { action: "REMOVE_REGION_OVERRIDE", plan_id: planId, region_id: regionId },
    });

    if (response.error) {
      setToast(response.error, "error");
      setTimeout(() => setToast(null, null), 3000);
      return;
    }

    setToast("Region override removed", "success");
    setTimeout(() => setToast(null, null), 3000);
    const { data } = await supabaseBrowser
      .from("plan_region_overrides")
      .select("region_id, price_cents, currency, stripe_price_id")
      .eq("plan_id", planId);
    setRegionOverrides((data ?? []) as RegionOverride[]);
  };

  if (loading || !plan) {
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
          <h1 className="text-3xl font-semibold">{plan.name} Pricing</h1>
          <p className="text-sm text-slate-400">
            Base price: {formatPrice(plan.base_price_cents, plan.currency)} — manage overrides per gym or region.
          </p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <h2 className="text-xl font-semibold">Gym Overrides</h2>
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/80 text-slate-300">
                <tr>
                  <th className="px-4 py-2 text-left">Gym</th>
                  <th className="px-4 py-2 text-left">Effective price</th>
                  <th className="px-4 py-2 text-left">Override</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {gyms.length ? (
                  gyms.map((gym) => {
                    const override = gymOverrideMap.get(gym.id);
                    const regionOverride = gym.region_id ? regionOverrideMap.get(gym.region_id) : null;
                    const effectivePrice = override
                      ? formatPrice(override.price_cents, override.currency)
                      : regionOverride
                        ? formatPrice(regionOverride.price_cents, regionOverride.currency)
                        : formatPrice(plan.base_price_cents, plan.currency);
                    return (
                      <tr key={gym.id}>
                        <td className="px-4 py-2">{gym.name}</td>
                        <td className="px-4 py-2 text-slate-400">{effectivePrice}</td>
                        <td className="px-4 py-2 text-slate-400">{override ? "Yes" : "No"}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            className="text-sm text-emerald-300 hover:text-emerald-200"
                            onClick={() => {
                              setEditingGymId(gym.id);
                              setEditingRegionId(null);
                              setOverridePrice(override?.price_cents.toString() ?? "");
                              setOverrideCurrency(override?.currency ?? plan.currency);
                              setOverrideStripePrice(override?.stripe_price_id ?? "");
                            }}
                          >
                            Edit
                          </button>
                          {override ? (
                            <button
                              className="ml-3 text-sm text-rose-300 hover:text-rose-200"
                              onClick={() => handleOverrideRemove(gym.id)}
                            >
                              Remove
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-slate-500">
                      No gyms available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {editingGymId ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
              <div className="text-sm text-slate-300">Edit gym override</div>
              <div className="flex flex-wrap gap-3">
                <input
                  type="number"
                  placeholder="Price (cents)"
                  className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
                  value={overridePrice}
                  onChange={(event) => setOverridePrice(event.target.value)}
                />
                <input
                  type="text"
                  placeholder="Currency"
                  className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
                  value={overrideCurrency}
                  onChange={(event) => setOverrideCurrency(event.target.value)}
                />
                <input
                  type="text"
                  placeholder="Stripe price ID"
                  className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
                  value={overrideStripePrice}
                  onChange={(event) => setOverrideStripePrice(event.target.value)}
                />
                <button
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold"
                  onClick={() => handleGymOverrideSave(editingGymId)}
                >
                  Save override
                </button>
                <button
                  className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold"
                  onClick={() => {
                    setEditingGymId(null);
                    resetOverrideForm();
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <h2 className="text-xl font-semibold">Region Overrides</h2>
          <div className="space-y-3">
            {regions.length ? (
              regions.map((region) => {
                const override = regionOverrideMap.get(region.id);
                return (
                  <div key={region.id} className="flex items-center justify-between rounded-lg border border-slate-800 p-4">
                    <div>
                      <div className="font-semibold">{region.name}</div>
                      <div className="text-sm text-slate-400">
                        {override
                          ? formatPrice(override.price_cents, override.currency)
                          : formatPrice(plan.base_price_cents, plan.currency)}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        className="text-sm text-emerald-300 hover:text-emerald-200"
                        onClick={() => {
                          setEditingRegionId(region.id);
                          setEditingGymId(null);
                          setOverridePrice(override?.price_cents.toString() ?? "");
                          setOverrideCurrency(override?.currency ?? plan.currency);
                          setOverrideStripePrice(override?.stripe_price_id ?? "");
                        }}
                      >
                        Edit
                      </button>
                      {override ? (
                        <button
                          className="text-sm text-rose-300 hover:text-rose-200"
                          onClick={() => handleRegionOverrideRemove(region.id)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-slate-500">No regions configured.</div>
            )}
          </div>
          {editingRegionId ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
              <div className="text-sm text-slate-300">Edit region override</div>
              <div className="flex flex-wrap gap-3">
                <input
                  type="number"
                  placeholder="Price (cents)"
                  className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
                  value={overridePrice}
                  onChange={(event) => setOverridePrice(event.target.value)}
                />
                <input
                  type="text"
                  placeholder="Currency"
                  className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
                  value={overrideCurrency}
                  onChange={(event) => setOverrideCurrency(event.target.value)}
                />
                <input
                  type="text"
                  placeholder="Stripe price ID"
                  className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
                  value={overrideStripePrice}
                  onChange={(event) => setOverrideStripePrice(event.target.value)}
                />
                <button
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold"
                  onClick={() => handleRegionOverrideSave(editingRegionId)}
                >
                  Save override
                </button>
                <button
                  className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold"
                  onClick={() => {
                    setEditingRegionId(null);
                    resetOverrideForm();
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default function PlanPricingPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <PlanPricingView />
    </QueryClientProvider>
  );
}
