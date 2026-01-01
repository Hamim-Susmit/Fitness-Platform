"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../lib/roles";
import { useActiveGym } from "../../../../lib/useActiveGym";
import { supabaseBrowser } from "../../../../lib/supabase-browser";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

type AttendanceRow = {
  class_instance_id: string;
  class_id: string;
  instructor_id: string | null;
  gym_id: string;
  start_time: string;
  capacity: number;
  booked_count: number;
  attended_count: number;
  waitlist_count: number;
  no_show_count: number;
};

type FillRateRow = {
  class_id: string;
  gym_id: string;
  avg_fill_percent: number;
  avg_waitlist_size: number;
  avg_no_show_rate: number;
  sample_size: number;
};

type InstructorPerformanceRow = {
  instructor_id: string;
  gym_id: string;
  classes_taught: number;
  avg_fill_percent: number;
  avg_attendance: number;
  avg_rating: number | null;
  revenue_generated: number | null;
};

type ClassTypeRow = {
  id: string;
  name: string;
};

type InstructorRow = {
  id: string;
  users?: { full_name: string | null } | null;
};

const ranges = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

function AnalyticsDashboard() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { activeGymId } = useActiveGym();
  const [rangeDays, setRangeDays] = useState(30);
  const [classTypes, setClassTypes] = useState<ClassTypeRow[]>([]);
  const [instructors, setInstructors] = useState<InstructorRow[]>([]);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [instructorFilter, setInstructorFilter] = useState<string>("all");
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [fillRates, setFillRates] = useState<FillRateRow[]>([]);
  const [instructorPerformance, setInstructorPerformance] = useState<InstructorPerformanceRow[]>([]);
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
    const loadFilters = async () => {
      if (!activeGymId) return;
      const [{ data: classRows }, { data: instructorRows }] = await Promise.all([
        supabaseBrowser.from("class_types").select("id, name").eq("gym_id", activeGymId).order("name"),
        supabaseBrowser
          .from("instructors")
          .select("id, users(full_name)")
          .eq("gym_id", activeGymId)
          .eq("active", true)
          .order("created_at", { ascending: false }),
      ]);
      setClassTypes((classRows ?? []) as ClassTypeRow[]);
      setInstructors((instructorRows ?? []) as InstructorRow[]);
    };
    loadFilters();
  }, [activeGymId]);

  useEffect(() => {
    const loadData = async () => {
      if (!activeGymId) return;
      setLoadingData(true);
      const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

      let attendanceQuery = supabaseBrowser
        .from("class_instance_attendance_mv")
        .select("*")
        .eq("gym_id", activeGymId)
        .gte("start_time", since);

      if (classFilter !== "all") {
        attendanceQuery = attendanceQuery.eq("class_id", classFilter);
      }
      if (instructorFilter !== "all") {
        attendanceQuery = attendanceQuery.eq("instructor_id", instructorFilter);
      }

      const [{ data: attendanceData }, { data: fillRateData }, { data: instructorData }] = await Promise.all([
        attendanceQuery,
        supabaseBrowser.from("class_fill_rates_mv").select("*").eq("gym_id", activeGymId),
        supabaseBrowser.from("instructor_performance_mv").select("*").eq("gym_id", activeGymId),
      ]);

      setAttendanceRows((attendanceData ?? []) as AttendanceRow[]);
      setFillRates((fillRateData ?? []) as FillRateRow[]);
      setInstructorPerformance((instructorData ?? []) as InstructorPerformanceRow[]);
      setLoadingData(false);
    };
    loadData();
  }, [activeGymId, classFilter, instructorFilter, rangeDays]);

  const avgFillRate = useMemo(() => {
    if (!attendanceRows.length) return 0;
    const sum = attendanceRows.reduce((acc, row) => acc + (row.capacity > 0 ? row.booked_count / row.capacity : 0), 0);
    return (sum / attendanceRows.length) * 100;
  }, [attendanceRows]);

  const avgAttendance = useMemo(() => {
    if (!attendanceRows.length) return 0;
    const sum = attendanceRows.reduce((acc, row) => acc + (row.booked_count > 0 ? row.attended_count / row.booked_count : 0), 0);
    return (sum / attendanceRows.length) * 100;
  }, [attendanceRows]);

  const avgWaitlistConversion = useMemo(() => {
    if (!attendanceRows.length) return 0;
    const sum = attendanceRows.reduce((acc, row) => acc + (row.waitlist_count > 0 ? row.waitlist_count : 0), 0);
    return sum / attendanceRows.length;
  }, [attendanceRows]);

  const avgNoShowRate = useMemo(() => {
    if (!attendanceRows.length) return 0;
    const sum = attendanceRows.reduce((acc, row) => acc + (row.booked_count > 0 ? row.no_show_count / row.booked_count : 0), 0);
    return (sum / attendanceRows.length) * 100;
  }, [attendanceRows]);

  const classNameMap = useMemo(() => new Map(classTypes.map((row) => [row.id, row.name])), [classTypes]);
  const instructorNameMap = useMemo(
    () => new Map(instructors.map((row) => [row.id, row.users?.full_name ?? "Instructor"])),
    [instructors]
  );

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Class Analytics</h1>
            <p className="text-sm text-slate-400">Performance insights for classes and instructors.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
            >
              <option value="all">All classes</option>
              {classTypes.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
              value={instructorFilter}
              onChange={(event) => setInstructorFilter(event.target.value)}
            >
              <option value="all">All instructors</option>
              {instructors.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.users?.full_name ?? "Instructor"}
                </option>
              ))}
            </select>
            <select
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
              value={rangeDays}
              onChange={(event) => setRangeDays(Number(event.target.value))}
            >
              {ranges.map((range) => (
                <option key={range.value} value={range.value}>
                  {range.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Avg Fill Rate", value: `${avgFillRate.toFixed(1)}%` },
            { label: "Avg Attendance", value: `${avgAttendance.toFixed(1)}%` },
            { label: "Waitlist Conversion", value: avgWaitlistConversion.toFixed(1) },
            { label: "No-Show Rate", value: `${avgNoShowRate.toFixed(1)}%` },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-sm text-slate-400">{metric.label}</div>
              <div className="text-2xl font-semibold">{metric.value}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Class popularity by type</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-400">
              {fillRates.map((row) => (
                <div key={row.class_id} className="flex items-center justify-between">
                  <span>{classNameMap.get(row.class_id) ?? row.class_id}</span>
                  <span>{row.avg_fill_percent.toFixed(1)}%</span>
                </div>
              ))}
              {fillRates.length === 0 ? <div>No class data available.</div> : null}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Instructor comparison</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-400">
              {instructorPerformance.map((row) => (
                <div key={row.instructor_id} className="flex items-center justify-between">
                  <span>{instructorNameMap.get(row.instructor_id) ?? row.instructor_id}</span>
                  <span>{row.avg_fill_percent.toFixed(1)}%</span>
                </div>
              ))}
              {instructorPerformance.length === 0 ? <div>No instructor data available.</div> : null}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Class performance</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Class</th>
                  <th className="px-3 py-2 text-left">Instructor</th>
                  <th className="px-3 py-2 text-left">Avg Fill</th>
                  <th className="px-3 py-2 text-left">Avg Attendance</th>
                  <th className="px-3 py-2 text-left">No-Show</th>
                  <th className="px-3 py-2 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {fillRates.map((row) => (
                  <tr key={row.class_id}>
                    <td className="px-3 py-2">{classNameMap.get(row.class_id) ?? row.class_id}</td>
                    <td className="px-3 py-2 text-slate-400">—</td>
                    <td className="px-3 py-2 text-slate-400">{row.avg_fill_percent.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-400">—</td>
                    <td className="px-3 py-2 text-slate-400">{row.avg_no_show_rate.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        className="text-emerald-300 hover:text-emerald-200"
                        onClick={() => router.push(`/staff/classes/${row.class_id}/analytics`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {fillRates.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                      No class performance data.
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

export default function AnalyticsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <AnalyticsDashboard />
    </QueryClientProvider>
  );
}
