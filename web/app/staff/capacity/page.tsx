"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore, useToastStore } from "../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../lib/roles";
import { useActiveGym } from "../../../lib/useActiveGym";
import { callEdgeFunction } from "../../../lib/api";

type CapacityStatus = "OK" | "NEAR_LIMIT" | "AT_CAPACITY" | "BLOCK_NEW";

type CapacityResponse = {
  gym_id: string;
  active_members_count: number;
  max_active_members: number | null;
  soft_limit_threshold: number | null;
  hard_limit_enforced: boolean;
  capacity_percent: number;
  status: CapacityStatus;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

function formatCapacityPercent(percent: number) {
  if (!Number.isFinite(percent)) return "0%";
  return `${percent.toFixed(1)}%`;
}

function CapacityManagementView() {
  const { session, role, loading } = useAuthStore();
  const { message, status, setToast } = useToastStore();
  const { activeGymId, activeGym } = useActiveGym();
  const [capacity, setCapacity] = useState<CapacityResponse | null>(null);
  const [maxActiveMembers, setMaxActiveMembers] = useState("");
  const [softLimitThreshold, setSoftLimitThreshold] = useState("");
  const [hardLimitEnforced, setHardLimitEnforced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || !isStaffRole(role))) {
      window.location.href = roleRedirectPath(role);
    }
  }, [loading, role, session]);

  useEffect(() => {
    const loadCapacity = async () => {
      if (!activeGymId) return;
      const response = await callEdgeFunction<CapacityResponse>("get-gym-capacity-status", {
        body: { gym_id: activeGymId },
      });
      if (!response.error && response.data) {
        setCapacity(response.data);
        setMaxActiveMembers(response.data.max_active_members?.toString() ?? "");
        setSoftLimitThreshold(response.data.soft_limit_threshold?.toString() ?? "");
        setHardLimitEnforced(Boolean(response.data.hard_limit_enforced));
      }
    };
    loadCapacity();
  }, [activeGymId]);

  const handleSave = async () => {
    if (!activeGymId) return;
    setSaving(true);
    const response = await callEdgeFunction("manage-gym-capacity", {
      body: {
        action: "UPSERT_GYM_CAPACITY_LIMIT",
        gym_id: activeGymId,
        max_active_members: maxActiveMembers ? Number(maxActiveMembers) : null,
        soft_limit_threshold: softLimitThreshold ? Number(softLimitThreshold) : null,
        hard_limit_enforced: hardLimitEnforced,
      },
    });

    if (response.error) {
      setToast(response.error, "error");
      setTimeout(() => setToast(null, null), 3000);
      setSaving(false);
      return;
    }

    setToast("Capacity settings saved", "success");
    setTimeout(() => setToast(null, null), 3000);
    setSaving(false);
  };

  const statusLabel = useMemo(() => {
    if (!capacity) return "OK";
    return capacity.status;
  }, [capacity]);

  if (loading || !session) {
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
          <h1 className="text-3xl font-semibold">Capacity Management</h1>
          <p className="text-slate-400 text-sm">
            Configure member capacity rules for {activeGym?.name ?? "this location"}.
          </p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <h2 className="text-xl font-semibold">Location Capacity</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
              <div className="text-sm text-slate-400">Active members</div>
              <div className="text-2xl font-semibold">{capacity?.active_members_count ?? 0}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
              <div className="text-sm text-slate-400">Max allowed</div>
              <div className="text-2xl font-semibold">
                {capacity?.max_active_members ?? "Unlimited"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
              <div className="text-sm text-slate-400">Capacity usage</div>
              <div className="text-2xl font-semibold">
                {capacity?.max_active_members ? formatCapacityPercent(capacity.capacity_percent) : "—"}
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-800">
                <div
                  className="h-2 rounded-full bg-emerald-500"
                  style={{
                    width: capacity?.max_active_members
                      ? `${Math.min(capacity.capacity_percent, 100)}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
              <div className="text-sm text-slate-400">Status</div>
              <div className="text-2xl font-semibold">{statusLabel}</div>
            </div>
          </div>
          {/* TODO: alert managers/corporate when gyms move into NEAR_LIMIT or AT_CAPACITY. */}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <h2 className="text-xl font-semibold">Capacity Settings</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col text-sm gap-2">
              Max active members
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={maxActiveMembers}
                onChange={(event) => setMaxActiveMembers(event.target.value)}
                placeholder="Unlimited"
              />
            </label>
            <label className="flex flex-col text-sm gap-2">
              Soft limit threshold
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={softLimitThreshold}
                onChange={(event) => setSoftLimitThreshold(event.target.value)}
                placeholder="Warn near limit"
              />
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={hardLimitEnforced}
                onChange={(event) => setHardLimitEnforced(event.target.checked)}
              />
              Enforce hard limit (block new subscriptions when at capacity)
            </label>
          </div>
          <button
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </section>
      </div>
    </div>
  );
}

export default function StaffCapacityPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <CapacityManagementView />
    </QueryClientProvider>
  );
}
