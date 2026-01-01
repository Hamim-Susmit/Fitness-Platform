"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../lib/roles";
import { useActiveGym } from "../../../../lib/useActiveGym";
import { supabaseBrowser } from "../../../../lib/supabase-browser";

type InstructorRow = {
  id: string;
  users?: { full_name: string | null } | null;
};

type PerformanceRow = {
  instructor_id: string;
  gym_id: string;
  classes_taught: number;
  avg_fill_percent: number;
  avg_attendance: number;
  avg_rating: number | null;
  revenue_generated: number | null;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function InstructorAnalyticsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { activeGymId } = useActiveGym();
  const [instructors, setInstructors] = useState<InstructorRow[]>([]);
  const [performance, setPerformance] = useState<PerformanceRow[]>([]);
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
      if (!activeGymId) return;
      setLoadingData(true);
      const [{ data: instructorRows }, { data: performanceRows }] = await Promise.all([
        supabaseBrowser
          .from("instructors")
          .select("id, users(full_name)")
          .eq("gym_id", activeGymId)
          .eq("active", true)
          .order("created_at", { ascending: false }),
        supabaseBrowser.from("instructor_performance_mv").select("*").eq("gym_id", activeGymId),
      ]);
      setInstructors((instructorRows ?? []) as InstructorRow[]);
      setPerformance((performanceRows ?? []) as PerformanceRow[]);
      setLoadingData(false);
    };
    loadData();
  }, [activeGymId]);

  const instructorNameMap = useMemo(
    () => new Map(instructors.map((row) => [row.id, row.users?.full_name ?? "Instructor"])),
    [instructors]
  );

  const totalClasses = performance.reduce((sum, row) => sum + row.classes_taught, 0);
  const avgAttendance =
    performance.length > 0
      ? performance.reduce((sum, row) => sum + row.avg_attendance, 0) / performance.length
      : 0;
  const avgRating =
    performance.length > 0
      ? performance.reduce((sum, row) => sum + (row.avg_rating ?? 0), 0) / performance.length
      : 0;
  const revenueContribution =
    performance.length > 0
      ? performance.reduce((sum, row) => sum + (row.revenue_generated ?? 0), 0)
      : 0;

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Instructor Performance</h1>
          <p className="text-sm text-slate-400">Aggregated performance trends by instructor.</p>
        </div>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Classes taught", value: totalClasses },
            { label: "Avg rating", value: avgRating ? avgRating.toFixed(1) : "—" },
            { label: "Avg attendance", value: avgAttendance ? avgAttendance.toFixed(1) : "—" },
            { label: "Revenue contribution", value: revenueContribution ? revenueContribution.toFixed(0) : "—" },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-sm text-slate-400">{card.label}</div>
              <div className="text-2xl font-semibold">{card.value}</div>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Instructor performance</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Instructor</th>
                  <th className="px-3 py-2 text-left">Classes taught</th>
                  <th className="px-3 py-2 text-left">Avg fill %</th>
                  <th className="px-3 py-2 text-left">Avg attendance</th>
                  <th className="px-3 py-2 text-left">Rating</th>
                  <th className="px-3 py-2 text-left">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {performance.map((row) => (
                  <tr key={row.instructor_id}>
                    <td className="px-3 py-2">{instructorNameMap.get(row.instructor_id) ?? row.instructor_id}</td>
                    <td className="px-3 py-2 text-slate-400">{row.classes_taught}</td>
                    <td className="px-3 py-2 text-slate-400">{row.avg_fill_percent.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-400">{row.avg_attendance.toFixed(1)}</td>
                    <td className="px-3 py-2 text-slate-400">{row.avg_rating ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-400">—</td>
                  </tr>
                ))}
                {performance.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                      No instructor performance data.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function InstructorAnalyticsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <InstructorAnalyticsView />
    </QueryClientProvider>
  );
}
