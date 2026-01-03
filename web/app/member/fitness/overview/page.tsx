"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { roleRedirectPath } from "../../../../lib/roles";
import { supabaseBrowser } from "../../../../lib/supabase-browser";
import type { FitnessProvider } from "../../../../lib/fitness/adapters/baseAdapter";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

type MetricRow = {
  metric_date: string;
  steps: number | null;
  active_minutes: number | null;
  calories_active: number | null;
  provider?: FitnessProvider;
};

const PROVIDER_PRIORITY: FitnessProvider[] = ["APPLE_HEALTH", "GOOGLE_FIT", "FITBIT", "STRAVA", "GARMIN"];

function formatDateLabel(date: string) {
  const parsed = new Date(date + "T00:00:00");
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MemberFitnessOverviewView() {
  const { session, role, loading } = useAuthStore();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      window.location.href = roleRedirectPath(role);
    }
  }, [loading, role, session]);

  useEffect(() => {
    const loadMember = async () => {
      if (!session?.user?.id) return;
      const { data: member } = await supabaseBrowser
        .from("members")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      setMemberId(member?.id ?? null);
    };

    loadMember();
  }, [session?.user?.id]);

  useEffect(() => {
    const loadMetrics = async () => {
      if (!memberId) return;
      setLoadingMetrics(true);
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 6);
      const start = startDate.toISOString().slice(0, 10);
      const end = endDate.toISOString().slice(0, 10);

      const { data } = await supabaseBrowser
        .from("fitness_daily_metrics")
        .select("metric_date, steps, active_minutes, calories_active, provider")
        .eq("member_id", memberId)
        .gte("metric_date", start)
        .lte("metric_date", end)
        .order("metric_date", { ascending: true });

      const rowsByDate = new Map<string, MetricRow>();
      (data ?? []).forEach((row) => {
        const existing = rowsByDate.get(row.metric_date);
        const existingProvider = existing?.provider;
        const currentProvider = row.provider as FitnessProvider;
        const shouldReplace =
          !existing ||
          PROVIDER_PRIORITY.indexOf(currentProvider) <
            PROVIDER_PRIORITY.indexOf(existingProvider ?? "GARMIN");

        if (shouldReplace) {
          rowsByDate.set(row.metric_date, {
            metric_date: row.metric_date,
            steps: row.steps,
            active_minutes: row.active_minutes,
            calories_active: row.calories_active,
            provider: row.provider as FitnessProvider,
          });
        }
      });

      const days: MetricRow[] = [];
      for (let i = 0; i < 7; i += 1) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const key = date.toISOString().slice(0, 10);
        days.push(
          rowsByDate.get(key) ?? {
            metric_date: key,
            steps: null,
            active_minutes: null,
            calories_active: null,
          }
        );
      }

      setMetrics(days);
      setLoadingMetrics(false);
    };

    loadMetrics();
  }, [memberId]);

  const totals = useMemo(() => {
    return metrics.reduce(
      (acc, row) => {
        acc.steps += row.steps ?? 0;
        acc.activeMinutes += row.active_minutes ?? 0;
        acc.calories += row.calories_active ?? 0;
        return acc;
      },
      { steps: 0, activeMinutes: 0, calories: 0 }
    );
  }, [metrics]);

  const maxSteps = Math.max(1, ...metrics.map((row) => row.steps ?? 0));

  if (loading || loadingMetrics) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Fitness Overview</h1>
          <p className="text-sm text-slate-400">7-day activity summary (daily aggregates only).</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="text-sm text-slate-400">Steps (7d)</div>
            <div className="text-2xl font-semibold mt-2">{totals.steps.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="text-sm text-slate-400">Active minutes (7d)</div>
            <div className="text-2xl font-semibold mt-2">{totals.activeMinutes.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="text-sm text-slate-400">Calories (7d)</div>
            <div className="text-2xl font-semibold mt-2">{Math.round(totals.calories).toLocaleString()}</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-lg font-semibold">Steps Trend</h2>
          <div className="mt-4 flex items-end gap-3 h-40">
            {metrics.map((row) => {
              const heightPercent = ((row.steps ?? 0) / maxSteps) * 100;
              return (
                <div key={row.metric_date} className="flex flex-col items-center gap-2 text-xs text-slate-400">
                  <div className="flex-1 flex items-end">
                    <div
                      className="w-8 rounded-md bg-emerald-500/70"
                      style={{ height: `${Math.max(heightPercent, 5)}%` }}
                    />
                  </div>
                  <div>{formatDateLabel(row.metric_date)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MemberFitnessOverviewPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemberFitnessOverviewView />
    </QueryClientProvider>
  );
}
