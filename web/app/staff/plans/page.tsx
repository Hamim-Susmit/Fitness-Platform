"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";
import { useActiveGym } from "../../../lib/useActiveGym";

type MembershipPlan = {
  id: string;
  name: string;
  billing_period: "MONTHLY" | "YEARLY";
  access_scope: "SINGLE_GYM" | "REGION" | "ALL_LOCATIONS";
  base_price_cents: number;
  currency: string;
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

function StaffPlansView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { activeGymId } = useActiveGym();
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || !isStaffRole(role))) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const loadPlans = async () => {
      if (!activeGymId) return;
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
        .select("id, name, billing_period, access_scope, base_price_cents, currency")
        .eq("chain_id", gym.chain_id)
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
  }, [activeGymId]);

  if (loading || loadingPlans) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Membership Plans</h1>
          <p className="text-slate-400 text-sm">Manage pricing and access scope for your chain.</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-300">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Billing</th>
                <th className="px-4 py-2 text-left">Access</th>
                <th className="px-4 py-2 text-left">Base price</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {plans.length ? (
                plans.map((plan) => (
                  <tr key={plan.id}>
                    <td className="px-4 py-2">{plan.name}</td>
                    <td className="px-4 py-2 text-slate-400">{plan.billing_period}</td>
                    <td className="px-4 py-2 text-slate-400">{plan.access_scope}</td>
                    <td className="px-4 py-2 text-slate-400">
                      {formatPrice(plan.base_price_cents, plan.currency)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        className="text-sm text-emerald-300 hover:text-emerald-200"
                        onClick={() => router.push(`/staff/plans/${plan.id}/pricing`)}
                      >
                        View location pricing
                      </button>
                      <button
                        className="ml-3 text-sm text-sky-300 hover:text-sky-200"
                        onClick={() => router.push(`/staff/plans/${plan.id}/capacity`)}
                      >
                        View capacity limits
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-center text-slate-500">
                    No plans available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function StaffPlansPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <StaffPlansView />
    </QueryClientProvider>
  );
}
