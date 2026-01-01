"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore, useToastStore } from "../../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../../lib/roles";
import { supabaseBrowser } from "../../../../../lib/supabase-browser";
import { callEdgeFunction } from "../../../../../lib/api";

type GymRow = {
  id: string;
  name: string;
};

type PlanCapacityLimit = {
  gym_id: string;
  max_active_members: number | null;
};

type CapacityStatusResponse = {
  status: "OK" | "AT_CAPACITY" | "BLOCK_NEW" | "NO_LIMIT";
  active_count: number;
  max_allowed: number | null;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

function PlanCapacityView() {
  const router = useRouter();
  const params = useParams();
  const planId = params?.planId as string | undefined;
  const { session, role, loading } = useAuthStore();
  const { message, status, setToast } = useToastStore();
  const [gyms, setGyms] = useState<GymRow[]>([]);
  const [limits, setLimits] = useState<PlanCapacityLimit[]>([]);
  const [capacityByGym, setCapacityByGym] = useState<Record<string, CapacityStatusResponse>>({});
  const [editingGymId, setEditingGymId] = useState<string | null>(null);
  const [limitValue, setLimitValue] = useState("");

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
      const { data: plan } = await supabaseBrowser
        .from("membership_plans")
        .select("id, chain_id")
        .eq("id", planId)
        .maybeSingle();

      if (!plan?.chain_id) return;

      const { data: gymRows } = await supabaseBrowser
        .from("gyms")
        .select("id, name")
        .eq("chain_id", plan.chain_id)
        .order("name");
      setGyms((gymRows ?? []) as GymRow[]);

      const { data: limitRows } = await supabaseBrowser
        .from("plan_location_capacity_limits")
        .select("gym_id, max_active_members")
        .eq("plan_id", planId);
      setLimits((limitRows ?? []) as PlanCapacityLimit[]);
    };

    loadData();
  }, [planId]);

  useEffect(() => {
    const loadCapacityStatuses = async () => {
      if (!planId || gyms.length === 0) return;
      const results: Record<string, CapacityStatusResponse> = {};
      await Promise.all(
        gyms.map(async (gym) => {
          const { data, error } = await supabaseBrowser.rpc("check_plan_capacity_for_gym", {
            p_plan_id: planId,
            p_gym_id: gym.id,
          });
          if (!error && data) {
            results[gym.id] = data as CapacityStatusResponse;
          }
        })
      );
      setCapacityByGym(results);
    };

    loadCapacityStatuses();
  }, [gyms, planId]);

  const handleSave = async (gymId: string) => {
    if (!planId) return;
    const response = await callEdgeFunction("manage-plan-capacity", {
      body: {
        action: "UPSERT_PLAN_CAPACITY_LIMIT",
        plan_id: planId,
        gym_id: gymId,
        max_active_members: limitValue ? Number(limitValue) : null,
      },
    });

    if (response.error) {
      setToast(response.error, "error");
      setTimeout(() => setToast(null, null), 3000);
      return;
    }

    setToast("Plan capacity saved", "success");
    setTimeout(() => setToast(null, null), 3000);
    setEditingGymId(null);
    setLimitValue("");
    const { data: limitRows } = await supabaseBrowser
      .from("plan_location_capacity_limits")
      .select("gym_id, max_active_members")
      .eq("plan_id", planId);
    setLimits((limitRows ?? []) as PlanCapacityLimit[]);
  };

  const handleRemove = async (gymId: string) => {
    if (!planId) return;
    const response = await callEdgeFunction("manage-plan-capacity", {
      body: {
        action: "REMOVE_PLAN_CAPACITY_LIMIT",
        plan_id: planId,
        gym_id: gymId,
      },
    });

    if (response.error) {
      setToast(response.error, "error");
      setTimeout(() => setToast(null, null), 3000);
      return;
    }

    setToast("Plan capacity removed", "success");
    setTimeout(() => setToast(null, null), 3000);
    const { data: limitRows } = await supabaseBrowser
      .from("plan_location_capacity_limits")
      .select("gym_id, max_active_members")
      .eq("plan_id", planId);
    setLimits((limitRows ?? []) as PlanCapacityLimit[]);
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  const limitMap = new Map(limits.map((limit) => [limit.gym_id, limit]));

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
          <h1 className="text-3xl font-semibold">Plan Capacity Limits</h1>
          <p className="text-sm text-slate-400">
            Configure per-gym caps for this plan. Capacity enforcement is handled server-side.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-300">
              <tr>
                <th className="px-4 py-2 text-left">Gym</th>
                <th className="px-4 py-2 text-left">Active count</th>
                <th className="px-4 py-2 text-left">Limit</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {gyms.length ? (
                gyms.map((gym) => {
                  const limit = limitMap.get(gym.id);
                  const status = capacityByGym[gym.id];
                  return (
                    <tr key={gym.id}>
                      <td className="px-4 py-2">{gym.name}</td>
                      <td className="px-4 py-2 text-slate-400">{status?.active_count ?? 0}</td>
                      <td className="px-4 py-2 text-slate-400">{limit?.max_active_members ?? "Unset"}</td>
                      <td className="px-4 py-2 text-slate-400">{status?.status ?? "NO_LIMIT"}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          className="text-sm text-emerald-300 hover:text-emerald-200"
                          onClick={() => {
                            setEditingGymId(gym.id);
                            setLimitValue(limit?.max_active_members?.toString() ?? "");
                          }}
                        >
                          Edit
                        </button>
                        {limit ? (
                          <button
                            className="ml-3 text-sm text-rose-300 hover:text-rose-200"
                            onClick={() => handleRemove(gym.id)}
                          >
                            Clear
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-center text-slate-500">
                    No gyms available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editingGymId ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
            <div className="text-sm text-slate-300">Edit plan capacity limit</div>
            <div className="flex flex-wrap gap-3">
              <input
                type="number"
                placeholder="Max active members"
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
                value={limitValue}
                onChange={(event) => setLimitValue(event.target.value)}
              />
              <button
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold"
                onClick={() => handleSave(editingGymId)}
              >
                Save limit
              </button>
              <button
                className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold"
                onClick={() => {
                  setEditingGymId(null);
                  setLimitValue("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function PlanCapacityPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <PlanCapacityView />
    </QueryClientProvider>
  );
}
