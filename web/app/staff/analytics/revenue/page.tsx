"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../lib/roles";
import { useActiveGym } from "../../../../lib/useActiveGym";
import { supabaseBrowser } from "../../../../lib/supabase-browser";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type SubscriptionMrrRow = {
  subscription_id: string | null;
  member_id: string;
  plan_id: string | null;
  gym_id: string | null;
  price_amount: number | null;
  price_interval: "month" | "year" | null;
  mrr: number | null;
  is_active: boolean;
  started_at: string | null;
  ended_at: string | null;
};

type RevenueByPlanRow = {
  plan_id: string | null;
  gym_id: string | null;
  month: string;
  mrr_total: number;
  arr_contribution: number;
  active_subscriptions: number;
};

type RevenueMovementRow = {
  month: string;
  new_mrr: number;
  expansion_mrr: number;
  contraction_mrr: number;
  churned_mrr: number;
  net_new_mrr: number;
  mrr_ending: number;
};

type PlanRow = {
  id: string;
  name: string;
};

type MonthOption = {
  label: string;
  value: number;
};

const rangeOptions: MonthOption[] = [
  { label: "6 months", value: 6 },
  { label: "12 months", value: 12 },
  { label: "24 months", value: 24 },
];

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

function monthLabel(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function resolveMonthRange(months: number) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
  return {
    start,
    end,
  };
}

function buildMonthSeries(months: number) {
  const { start } = resolveMonthRange(months);
  const series: string[] = [];
  for (let i = 0; i < months; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth() + i, 1);
    series.push(date.toISOString().slice(0, 10));
  }
  return series;
}

function RevenueAnalyticsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { activeGymId, gyms, loading: gymsLoading } = useActiveGym();
  const [rangeMonths, setRangeMonths] = useState(12);
  const [selectedGymId, setSelectedGymId] = useState<string | null>(null);
  const [subscriptionMrr, setSubscriptionMrr] = useState<SubscriptionMrrRow[]>([]);
  const [revenueByPlan, setRevenueByPlan] = useState<RevenueByPlanRow[]>([]);
  const [movementRows, setMovementRows] = useState<RevenueMovementRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
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
    if (!selectedGymId && activeGymId) {
      setSelectedGymId(activeGymId);
    }
  }, [activeGymId, selectedGymId]);

  useEffect(() => {
    const loadData = async () => {
      if (!selectedGymId) return;
      setLoadingData(true);
      const { start } = resolveMonthRange(rangeMonths);
      const startIso = start.toISOString().slice(0, 10);

      let revenueQuery = supabaseBrowser
        .from("revenue_by_plan_mv")
        .select("plan_id, gym_id, month, mrr_total, arr_contribution, active_subscriptions")
        .gte("month", startIso)
        .order("month", { ascending: true });

      if (selectedGymId !== "all") {
        revenueQuery = revenueQuery.eq("gym_id", selectedGymId);
      }

      let subscriptionQuery = supabaseBrowser
        .from("subscription_mrr_mv")
        .select("subscription_id, member_id, plan_id, gym_id, price_amount, price_interval, mrr, is_active, started_at, ended_at")
        .or(`started_at.gte.${startIso},is_active.eq.true`);

      if (selectedGymId !== "all") {
        subscriptionQuery = subscriptionQuery.eq("gym_id", selectedGymId);
      }

      const [{ data: revenueRows }, { data: subscriptionRows }, { data: planRows }, { data: movementData }] =
        await Promise.all([
          revenueQuery,
          subscriptionQuery,
          supabaseBrowser.from("membership_plans").select("id, name"),
          supabaseBrowser.from("revenue_movement_v").select("*").gte("month", startIso).order("month"),
        ]);

      setRevenueByPlan((revenueRows ?? []) as RevenueByPlanRow[]);
      setSubscriptionMrr((subscriptionRows ?? []) as SubscriptionMrrRow[]);
      setPlans((planRows ?? []) as PlanRow[]);
      setMovementRows((movementData ?? []) as RevenueMovementRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [rangeMonths, selectedGymId]);

  const planNameMap = useMemo(() => {
    return new Map(plans.map((plan) => [plan.id, plan.name]));
  }, [plans]);

  const monthSeries = useMemo(() => buildMonthSeries(rangeMonths), [rangeMonths]);

  const monthlyRevenue = useMemo(() => {
    const byMonth = new Map<string, number>();
    revenueByPlan.forEach((row) => {
      const key = row.month;
      byMonth.set(key, (byMonth.get(key) ?? 0) + row.mrr_total);
    });
    return monthSeries.map((month) => ({ month, mrr_total: byMonth.get(month) ?? 0 }));
  }, [monthSeries, revenueByPlan]);

  const movementByMonth = useMemo(() => {
    if (selectedGymId === "all") {
      return movementRows.map((row) => ({
        month: row.month,
        new_mrr: row.new_mrr,
        expansion_mrr: row.expansion_mrr,
        contraction_mrr: row.contraction_mrr,
        churned_mrr: row.churned_mrr,
        net_new_mrr: row.net_new_mrr,
        mrr_ending: row.mrr_ending,
      }));
    }

    const rows: RevenueMovementRow[] = monthSeries.map((month) => ({
      month,
      new_mrr: 0,
      expansion_mrr: 0,
      contraction_mrr: 0,
      churned_mrr: 0,
      net_new_mrr: 0,
      mrr_ending: 0,
    }));

    rows.forEach((row) => {
      const monthStart = new Date(row.month);
      const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
      const monthEnd = new Date(nextMonth.getTime() - 1);

      const newMrr = subscriptionMrr
        .filter((sub) => sub.started_at && new Date(sub.started_at) >= monthStart && new Date(sub.started_at) < nextMonth)
        .reduce((sum, sub) => sum + (sub.mrr ?? 0), 0);

      const churnedMrr = subscriptionMrr
        .filter((sub) => sub.ended_at && new Date(sub.ended_at) >= monthStart && new Date(sub.ended_at) < nextMonth)
        .reduce((sum, sub) => sum + (sub.mrr ?? 0), 0);

      const endingMrr = subscriptionMrr
        .filter((sub) => {
          if (!sub.started_at) return false;
          const startedAt = new Date(sub.started_at);
          const endedAt = sub.ended_at ? new Date(sub.ended_at) : null;
          return startedAt <= monthEnd && (!endedAt || endedAt >= monthEnd) && (sub.mrr ?? 0) > 0;
        })
        .reduce((sum, sub) => sum + (sub.mrr ?? 0), 0);

      row.new_mrr = newMrr;
      row.churned_mrr = churnedMrr;
      row.net_new_mrr = newMrr - churnedMrr;
      row.mrr_ending = endingMrr;
    });

    return rows;
  }, [monthSeries, movementRows, selectedGymId, subscriptionMrr]);

  const currentMonthStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, []);

  const currentMrr = useMemo(() => {
    return subscriptionMrr
      .filter((row) => row.is_active)
      .reduce((sum, row) => sum + (row.mrr ?? 0), 0);
  }, [subscriptionMrr]);

  const newMrrThisPeriod = useMemo(() => {
    return subscriptionMrr
      .filter((row) => row.started_at && new Date(row.started_at) >= currentMonthStart)
      .reduce((sum, row) => sum + (row.mrr ?? 0), 0);
  }, [currentMonthStart, subscriptionMrr]);

  const churnedMrrThisPeriod = useMemo(() => {
    return subscriptionMrr
      .filter((row) => row.ended_at && new Date(row.ended_at) >= currentMonthStart)
      .reduce((sum, row) => sum + (row.mrr ?? 0), 0);
  }, [currentMonthStart, subscriptionMrr]);

  const latestMonth = monthSeries[monthSeries.length - 1];

  const planSummaryRows = useMemo(() => {
    const byPlan = new Map<string, { mrr: number; active: number }>();
    revenueByPlan
      .filter((row) => row.month === latestMonth)
      .forEach((row) => {
        if (!row.plan_id) return;
        const existing = byPlan.get(row.plan_id) ?? { mrr: 0, active: 0 };
        existing.mrr += row.mrr_total;
        existing.active += row.active_subscriptions;
        byPlan.set(row.plan_id, existing);
      });

    const churnedByPlan = new Map<string, number>();
    subscriptionMrr
      .filter((row) => row.plan_id && row.ended_at && new Date(row.ended_at) >= currentMonthStart)
      .forEach((row) => {
        if (!row.plan_id) return;
        churnedByPlan.set(row.plan_id, (churnedByPlan.get(row.plan_id) ?? 0) + 1);
      });

    return Array.from(byPlan.entries()).map(([planId, values]) => ({
      plan_id: planId,
      plan_name: planNameMap.get(planId) ?? "Plan",
      active_subscriptions: values.active,
      mrr_total: values.mrr,
      churned_subscriptions: churnedByPlan.get(planId) ?? 0,
    }));
  }, [currentMonthStart, latestMonth, planNameMap, revenueByPlan, subscriptionMrr]);

  const revenueByPlanChart = useMemo(() => {
    return planSummaryRows.map((row) => ({
      name: row.plan_name,
      mrr_total: row.mrr_total,
    }));
  }, [planSummaryRows]);

  const canViewAllGyms = role === "owner" && gyms.length > 1;

  if (loading || loadingData || gymsLoading) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  if (!selectedGymId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <main className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-sm text-slate-400">No active gym access — contact support.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Revenue Analytics</h1>
            <p className="text-sm text-slate-400">Directional finance metrics; reconcile to Stripe for accounting.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              value={selectedGymId}
              onChange={(event) => setSelectedGymId(event.target.value)}
            >
              {canViewAllGyms ? <option value="all">All locations</option> : null}
              {gyms.map((gym) => (
                <option key={gym.id} value={gym.id}>
                  {gym.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              value={rangeMonths}
              onChange={(event) => setRangeMonths(Number(event.target.value))}
            >
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Current MRR", value: formatCurrencyFromCents(currentMrr) },
            { label: "ARR Run Rate", value: formatCurrencyFromCents(currentMrr * 12) },
            { label: "New MRR (this period)", value: formatCurrencyFromCents(newMrrThisPeriod) },
            { label: "Churned MRR (this period)", value: formatCurrencyFromCents(churnedMrrThisPeriod) },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-sm text-slate-400">{card.label}</div>
              <div className="text-2xl font-semibold">{card.value}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Revenue over time</h2>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyRevenue} margin={{ left: 8, right: 8 }}>
                  <XAxis dataKey="month" tickFormatter={monthLabel} stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(value) => `${Math.round(value / 100)}k`} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #1f2937" }}
                    formatter={(value: number) => formatCurrencyFromCents(value)}
                    labelFormatter={monthLabel}
                  />
                  <Line type="monotone" dataKey="mrr_total" stroke="#22d3ee" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Net new MRR</h2>
            <p className="text-xs text-slate-500">
              Expansion/contraction signals are directional; confirm plan changes in Stripe.
            </p>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={movementByMonth} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis dataKey="month" tickFormatter={monthLabel} stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(value) => `${Math.round(value / 100)}k`} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #1f2937" }}
                    formatter={(value: number) => formatCurrencyFromCents(value)}
                    labelFormatter={monthLabel}
                  />
                  <Legend />
                  <Bar dataKey="new_mrr" stackId="mrr" fill="#22c55e" name="New" />
                  <Bar dataKey="expansion_mrr" stackId="mrr" fill="#38bdf8" name="Expansion" />
                  <Bar dataKey="contraction_mrr" stackId="mrr" fill="#f97316" name="Contraction" />
                  <Bar dataKey="churned_mrr" stackId="mrr" fill="#ef4444" name="Churned" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Revenue by plan</h2>
              <p className="text-sm text-slate-400">Most recent month view.</p>
            </div>
            <Link
              className="text-xs text-cyan-400 hover:text-cyan-300"
              href="/staff/analytics/revenue/failed-payments"
            >
              View failed payments
            </Link>
          </div>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByPlanChart} margin={{ left: 8, right: 8 }}>
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(value) => `${Math.round(value / 100)}k`} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #1f2937" }}
                  formatter={(value: number) => formatCurrencyFromCents(value)}
                />
                <Bar dataKey="mrr_total" fill="#a78bfa" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Plan performance</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Plan</th>
                  <th className="py-2 text-left">Active subs</th>
                  <th className="py-2 text-left">MRR total</th>
                  <th className="py-2 text-left">Churned subs</th>
                  <th className="py-2 text-left">Failed payments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {planSummaryRows.map((row) => {
                  const params = new URLSearchParams();
                  params.set("planId", row.plan_id);
                  if (selectedGymId !== "all") {
                    params.set("gymId", selectedGymId);
                  }
                  return (
                    <tr key={row.plan_id}>
                      <td className="py-3 text-white">{row.plan_name}</td>
                      <td className="py-3 text-slate-300">{row.active_subscriptions}</td>
                      <td className="py-3 text-slate-300">{formatCurrencyFromCents(row.mrr_total)}</td>
                      <td className="py-3 text-slate-300">{row.churned_subscriptions}</td>
                      <td className="py-3 text-slate-300">
                        <Link
                          className="text-cyan-400 hover:text-cyan-300"
                          href={`/staff/analytics/revenue/failed-payments?${params.toString()}`}
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {planSummaryRows.length === 0 ? (
                  <tr>
                    <td className="py-4 text-slate-400" colSpan={5}>
                      No revenue activity for the selected period.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function RevenueAnalyticsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <RevenueAnalyticsView />
    </QueryClientProvider>
  );
}
