"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { loadSessionAndRole, useAuthStore } from "../../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../../lib/roles";
import { useActiveGym } from "../../../../../lib/useActiveGym";
import { useGymAnalytics, type GymAnalyticsRange } from "../../../../../lib/hooks/useGymAnalytics";

// TODO: add multi-gym comparison dashboard (Phase 4+).
// TODO: roll up chain/region analytics for corporate users.
// TODO: integrate BigQuery export + broader KPIs in Phase 5.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

type RangeOption = "7" | "30" | "90";

const rangeOptions: { label: string; value: RangeOption }[] = [
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
];

function resolveRange(option: RangeOption): GymAnalyticsRange {
  const today = new Date();
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const from = new Date(to);
  from.setDate(from.getDate() - (Number(option) - 1));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function GymAnalyticsDashboard() {
  const router = useRouter();
  const params = useParams();
  const { session, role, loading } = useAuthStore();
  const { activeGymId, activeGym, loading: gymsLoading } = useActiveGym();
  const [rangeOption, setRangeOption] = useState<RangeOption>("30");

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || !isStaffRole(role))) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  const routeGymId = params?.gymId as string | undefined;

  useEffect(() => {
    if (!activeGymId || !routeGymId) return;
    if (activeGymId !== routeGymId) {
      router.replace(`/staff/analytics/gyms/${activeGymId}`);
    }
  }, [activeGymId, routeGymId, router]);

  const range = useMemo(() => resolveRange(rangeOption), [rangeOption]);
  const analytics = useGymAnalytics(activeGymId ?? null, range);

  if (loading || gymsLoading || !session) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  if (!activeGymId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <main className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-sm text-slate-400">No active gym access — contact support.</p>
        </main>
      </div>
    );
  }

  const summary = analytics.data?.summary;
  const timeSeries = analytics.data?.time_series ?? [];
  const topClassTypes = analytics.data?.top_class_types ?? [];
  const topInstructors = analytics.data?.top_instructors ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-6xl px-6 py-8 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{activeGym?.name ?? "Gym"} Analytics</h1>
            <p className="text-sm text-slate-400">Performance for the active location.</p>
          </div>
          <div className="flex gap-2 rounded-full bg-slate-900 p-1">
            {rangeOptions.map((option) => (
              <button
                key={option.value}
                className={`rounded-full px-3 py-1 text-xs ${
                  rangeOption === option.value ? "bg-cyan-500 text-slate-950" : "text-slate-300"
                }`}
                onClick={() => setRangeOption(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {analytics.isLoading ? (
          <div className="grid gap-4 md:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-900" />
            ))}
          </div>
        ) : null}

        {summary ? (
          <div className="grid gap-4 md:grid-cols-5">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase text-slate-500">Total check-ins</p>
              <p className="mt-2 text-2xl font-semibold">{summary.total_checkins}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase text-slate-500">Unique members</p>
              <p className="mt-2 text-2xl font-semibold">{summary.unique_members}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase text-slate-500">Avg check-ins/member</p>
              <p className="mt-2 text-2xl font-semibold">{summary.avg_checkins_per_member.toFixed(1)}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase text-slate-500">Avg fill rate</p>
              <p className="mt-2 text-2xl font-semibold">{Math.round(summary.avg_fill_rate * 100)}%</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase text-slate-500">No-show rate</p>
              <p className="mt-2 text-2xl font-semibold">{Math.round(summary.no_show_rate * 100)}%</p>
            </div>
          </div>
        ) : null}

        {analytics.isError ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {analytics.error?.message ?? "Unable to load analytics."}
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-semibold">Daily activity</h2>
          <p className="text-sm text-slate-400">Check-ins, classes, and fill rate by day.</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeSeries} margin={{ left: 8, right: 8 }}>
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937" }} />
                <Legend />
                <Line type="monotone" dataKey="checkins" stroke="#22d3ee" strokeWidth={2} />
                <Line type="monotone" dataKey="classes" stroke="#a78bfa" strokeWidth={2} />
                <Line type="monotone" dataKey="avg_fill_rate" stroke="#34d399" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold">Top class types</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 text-left">Class</th>
                    <th className="py-2 text-left">Sessions</th>
                    <th className="py-2 text-left">Avg fill</th>
                    <th className="py-2 text-left">Attendance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {topClassTypes.map((entry) => (
                    <tr key={entry.class_type_id}>
                      <td className="py-3 text-white">{entry.name}</td>
                      <td className="py-3 text-slate-300">{entry.sessions}</td>
                      <td className="py-3 text-slate-300">{Math.round(entry.avg_fill_rate * 100)}%</td>
                      <td className="py-3 text-slate-300">{Math.round(entry.avg_attendance_rate * 100)}%</td>
                    </tr>
                  ))}
                  {topClassTypes.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-slate-400">
                        No class data in this range.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold">Top instructors</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 text-left">Instructor</th>
                    <th className="py-2 text-left">Sessions</th>
                    <th className="py-2 text-left">Fill rate</th>
                    <th className="py-2 text-left">Attendance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {topInstructors.map((entry) => (
                    <tr key={entry.instructor_id}>
                      <td className="py-3 text-white">{entry.name}</td>
                      <td className="py-3 text-slate-300">{entry.sessions}</td>
                      <td className="py-3 text-slate-300">{Math.round(entry.fill_rate * 100)}%</td>
                      <td className="py-3 text-slate-300">{Math.round(entry.attendance_rate * 100)}%</td>
                    </tr>
                  ))}
                  {topInstructors.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-slate-400">
                        No instructor data in this range.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function GymAnalyticsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <GymAnalyticsDashboard />
    </QueryClientProvider>
  );
}
