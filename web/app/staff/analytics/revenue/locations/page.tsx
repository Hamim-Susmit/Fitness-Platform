"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { loadSessionAndRole, useAuthStore } from "../../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../../lib/roles";
import { useActiveGym } from "../../../../../lib/useActiveGym";
import { supabaseBrowser } from "../../../../../lib/supabase-browser";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type RevenueByPlanRow = {
  gym_id: string | null;
  month: string;
  mrr_total: number;
  arr_contribution: number;
};

type GymRow = { id: string; name: string };

type LocationRow = {
  gym_id: string;
  gym_name: string;
  mrr: number;
  arr: number;
  growth: number | null;
  sparkline: { month: string; value: number }[];
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCurrencyFromCents(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return currencyFormatter.format(value / 100);
}

function buildMonthSeries(months: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const series: string[] = [];
  for (let i = 0; i < months; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth() + i, 1);
    series.push(date.toISOString().slice(0, 10));
  }
  return series;
}

function LocationsRevenueView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { gyms, loading: gymsLoading } = useActiveGym();
  const [revenueRows, setRevenueRows] = useState<RevenueByPlanRow[]>([]);
  const [gymRows, setGymRows] = useState<GymRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

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
      setLoadingData(true);
      const months = buildMonthSeries(6);
      const startIso = months[0];

      const [{ data: revenueData }, { data: gymData }] = await Promise.all([
        supabaseBrowser
          .from("revenue_by_plan_mv")
          .select("gym_id, month, mrr_total, arr_contribution")
          .gte("month", startIso)
          .order("month", { ascending: true }),
        supabaseBrowser.from("gyms").select("id, name"),
      ]);

      setRevenueRows((revenueData ?? []) as RevenueByPlanRow[]);
      setGymRows((gymData ?? []) as GymRow[]);
      setLoadingData(false);
    };

    loadData();
  }, []);

  const gymMap = useMemo(() => new Map(gymRows.map((gym) => [gym.id, gym.name])), [gymRows]);

  const monthSeries = useMemo(() => buildMonthSeries(6), []);

  const locationRows = useMemo(() => {
    const byGym = new Map<string, { month: string; mrr: number; arr: number }[]>();
    revenueRows.forEach((row) => {
      if (!row.gym_id) return;
      const list = byGym.get(row.gym_id) ?? [];
      list.push({ month: row.month, mrr: row.mrr_total, arr: row.arr_contribution });
      byGym.set(row.gym_id, list);
    });

    return Array.from(byGym.entries()).map(([gymId, rows]) => {
      const mrrByMonth = new Map(rows.map((row) => [row.month, row.mrr]));
      const arrByMonth = new Map(rows.map((row) => [row.month, row.arr]));
      const sparkline = monthSeries.map((month) => ({ month, value: mrrByMonth.get(month) ?? 0 }));
      const latestMonth = monthSeries[monthSeries.length - 1];
      const previousMonth = monthSeries[monthSeries.length - 2];
      const latestMrr = mrrByMonth.get(latestMonth) ?? 0;
      const prevMrr = previousMonth ? mrrByMonth.get(previousMonth) ?? 0 : 0;
      const growth = prevMrr ? ((latestMrr - prevMrr) / prevMrr) * 100 : null;
      return {
        gym_id: gymId,
        gym_name: gymMap.get(gymId) ?? "Gym",
        mrr: latestMrr,
        arr: arrByMonth.get(latestMonth) ?? latestMrr * 12,
        growth,
        sparkline,
      };
    });
  }, [gymMap, monthSeries, revenueRows]);

  if (loading || loadingData || gymsLoading) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  if (role !== "owner") {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <main className="mx-auto max-w-6xl px-6 py-10">
          <p className="text-sm text-slate-400">Corporate roll-up access is limited to owners.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Location Revenue Roll-up</h1>
          <p className="text-sm text-slate-400">Compare MRR and ARR contribution across gyms.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Gym</th>
                  <th className="py-2 text-left">MRR</th>
                  <th className="py-2 text-left">ARR contribution</th>
                  <th className="py-2 text-left">Growth trend</th>
                  <th className="py-2 text-left">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {locationRows.map((row) => (
                  <tr key={row.gym_id}>
                    <td className="py-3 text-white">{row.gym_name}</td>
                    <td className="py-3 text-slate-300">{formatCurrencyFromCents(row.mrr)}</td>
                    <td className="py-3 text-slate-300">{formatCurrencyFromCents(row.arr)}</td>
                    <td className="py-3 text-slate-300">
                      {row.growth === null ? "—" : `${row.growth >= 0 ? "+" : ""}${row.growth.toFixed(1)}%`}
                    </td>
                    <td className="py-3 text-slate-300">
                      <div className="h-10 w-32">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={row.sparkline}>
                            <Line type="monotone" dataKey="value" stroke="#38bdf8" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </td>
                  </tr>
                ))}
                {locationRows.length === 0 ? (
                  <tr>
                    <td className="py-4 text-slate-400" colSpan={5}>
                      No revenue data available yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {gyms.length > 1 ? (
          <p className="text-xs text-slate-500">
            Corporate view is directional; confirm accounting totals in Stripe exports.
          </p>
        ) : null}
      </main>
    </div>
  );
}

export default function LocationsRevenuePage() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocationsRevenueView />
    </QueryClientProvider>
  );
}
