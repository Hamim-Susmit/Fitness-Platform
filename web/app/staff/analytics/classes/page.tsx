"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../lib/roles";
import { supabaseBrowser } from "../../../../lib/supabase-browser";
import {
  DateRangeOption,
  useClassTrends,
  type TopClass,
  type InstructorPerformance,
} from "../../../../lib/hooks/useClassAnalytics";

// TODO: BigQuery export pipeline (future).
// TODO: cohort retention analytics (future).
// TODO: revenue-per-class metrics (future).

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

const rangeOptions: { label: string; value: DateRangeOption }[] = [
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
];

function AnalyticsDashboard() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [gymId, setGymId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRangeOption>("30d");
  const [topLimit, setTopLimit] = useState(100);
  const [instructorLimit, setInstructorLimit] = useState(100);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role === "member")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  const { data: staffProfile } = useQuery<{ gym_id: string } | null>({
    queryKey: ["staff-profile", session?.user.id],
    enabled: !!session?.user.id && isStaffRole(role),
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("staff")
        .select("gym_id")
        .eq("user_id", session?.user.id ?? "")
        .maybeSingle();
      return (data ?? null) as { gym_id: string } | null;
    },
  });

  const { data: instructorProfile } = useQuery<{ id: string; gym_id: string } | null>({
    queryKey: ["instructor-profile", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("instructors")
        .select("id, gym_id")
        .eq("user_id", session?.user.id ?? "")
        .eq("active", true)
        .maybeSingle();
      return (data ?? null) as { id: string; gym_id: string } | null;
    },
  });

  useEffect(() => {
    if (staffProfile?.gym_id) {
      setGymId(staffProfile.gym_id);
      return;
    }
    if (instructorProfile?.gym_id) {
      setGymId(instructorProfile.gym_id);
    }
  }, [staffProfile, instructorProfile]);

  const { data, isLoading, isError } = useClassTrends(gymId ?? undefined, range);

  const { data: classTypes = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["class-types", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data } = await supabaseBrowser.from("class_types").select("id, name").eq("gym_id", gymId ?? "");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: instructors = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["instructors", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data } = await supabaseBrowser
        .from("instructors")
        .select("id, users(full_name)")
        .eq("gym_id", gymId ?? "")
        .eq("active", true);
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.users?.full_name ?? "Instructor",
      }));
    },
  });

  const classTypeMap = useMemo(() => new Map(classTypes.map((entry) => [entry.id, entry.name])), [classTypes]);
  const instructorMap = useMemo(() => new Map(instructors.map((entry) => [entry.id, entry.name])), [instructors]);

  const metrics = data?.metrics;
  const trends = data?.trends ?? [];
  const topClasses = data?.top_classes ?? [];
  const instructorPerf = data?.instructor_performance ?? [];

  const noData = !isLoading && !isError && trends.length === 0;

  const visibleTopClasses = topClasses.slice(0, topLimit);
  const visibleInstructors = instructorPerf.slice(0, instructorLimit);

  if (loading || !session) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-6xl px-6 py-8 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Class Analytics</h1>
            <p className="text-sm text-slate-400">Track bookings, attendance, and waitlist trends.</p>
          </div>
          <div className="flex gap-2 rounded-full bg-slate-900 p-1">
            {rangeOptions.map((option) => (
              <button
                key={option.value}
                className={`rounded-full px-3 py-1 text-xs ${
                  range === option.value ? "bg-cyan-500 text-slate-950" : "text-slate-300"
                }`}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-900" />
            ))}
          </div>
        ) : null}

        {metrics && !isLoading ? (
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase text-slate-500">Avg fill rate</p>
              <p className="mt-2 text-2xl font-semibold">{Math.round(metrics.avg_fill_rate * 100)}%</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase text-slate-500">Attendance rate</p>
              <p className="mt-2 text-2xl font-semibold">{Math.round(metrics.avg_attendance_rate * 100)}%</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase text-slate-500">No-show rate</p>
              <p className="mt-2 text-2xl font-semibold">{Math.round(metrics.avg_no_show_rate * 100)}%</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase text-slate-500">Avg waitlist</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.avg_waitlist_count.toFixed(1)}</p>
            </div>
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Bookings & Attendance Trends</h2>
          </div>
          <div className="mt-4 h-64">
            {isLoading ? (
              <div className="h-full animate-pulse rounded-xl bg-slate-800" />
            ) : noData ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Not enough activity to show trends yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trends} margin={{ left: 8, right: 8 }}>
                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1f2937" }} />
                  <Legend />
                  <Line type="monotone" dataKey="bookings" stroke="#22d3ee" strokeWidth={2} />
                  <Line type="monotone" dataKey="attendance" stroke="#34d399" strokeWidth={2} />
                  <Line type="monotone" dataKey="waitlist" stroke="#fbbf24" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold">Top Performing Classes</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 text-left">Class</th>
                    <th className="py-2 text-left">Avg fill</th>
                    <th className="py-2 text-left">Avg attendance</th>
                    <th className="py-2 text-left">Sessions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {visibleTopClasses.map((entry) => (
                    <tr key={entry.class_type_id}>
                      <td className="py-3 text-white">{classTypeMap.get(entry.class_type_id) ?? "Class"}</td>
                      <td className="py-3 text-slate-300">{Math.round(entry.avg_fill_rate * 100)}%</td>
                      <td className="py-3 text-slate-300">{Math.round(entry.avg_attendance_rate * 100)}%</td>
                      <td className="py-3 text-slate-300">{entry.total_sessions}</td>
                    </tr>
                  ))}
                  {visibleTopClasses.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-slate-400">
                        No class performance data yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {topClasses.length > topLimit ? (
              <button
                className="mt-4 text-xs text-slate-400"
                onClick={() => setTopLimit((prev) => prev + 100)}
              >
                Load more
              </button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold">Instructor Insights</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 text-left">Instructor</th>
                    <th className="py-2 text-left">Sessions</th>
                    <th className="py-2 text-left">Attendance</th>
                    <th className="py-2 text-left">Fill rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {visibleInstructors.map((entry) => (
                    <tr key={entry.instructor_id}>
                      <td className="py-3 text-white">{instructorMap.get(entry.instructor_id) ?? "Instructor"}</td>
                      <td className="py-3 text-slate-300">{entry.total_sessions}</td>
                      <td className="py-3 text-slate-300">{Math.round(entry.avg_attendance_rate * 100)}%</td>
                      <td className="py-3 text-slate-300">{Math.round(entry.avg_fill_rate * 100)}%</td>
                    </tr>
                  ))}
                  {visibleInstructors.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-slate-400">
                        No instructor performance data yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {instructorPerf.length > instructorLimit ? (
              <button
                className="mt-4 text-xs text-slate-400"
                onClick={() => setInstructorLimit((prev) => prev + 100)}
              >
                Load more
              </button>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function ClassAnalyticsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <AnalyticsDashboard />
    </QueryClientProvider>
  );
}
