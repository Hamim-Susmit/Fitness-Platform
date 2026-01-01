"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../../lib/roles";
import { useActiveGym } from "../../../../../lib/useActiveGym";
import { supabaseBrowser } from "../../../../../lib/supabase-browser";

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

type InstructorRow = {
  id: string;
  users?: { full_name: string | null } | null;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function ClassAnalyticsView() {
  const router = useRouter();
  const params = useParams();
  const classId = params?.classId as string | undefined;
  const { session, role, loading } = useAuthStore();
  const { activeGymId } = useActiveGym();
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [instructors, setInstructors] = useState<InstructorRow[]>([]);
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
      if (!activeGymId || !classId) return;
      setLoadingData(true);
      const [{ data: attendanceData }, { data: instructorRows }] = await Promise.all([
        supabaseBrowser
          .from("class_instance_attendance_mv")
          .select("*")
          .eq("gym_id", activeGymId)
          .eq("class_id", classId)
          .order("start_time", { ascending: true }),
        supabaseBrowser
          .from("instructors")
          .select("id, users(full_name)")
          .eq("gym_id", activeGymId)
          .eq("active", true),
      ]);
      setAttendanceRows((attendanceData ?? []) as AttendanceRow[]);
      setInstructors((instructorRows ?? []) as InstructorRow[]);
      setLoadingData(false);
    };
    loadData();
  }, [activeGymId, classId]);

  const instructorNameMap = useMemo(
    () => new Map(instructors.map((row) => [row.id, row.users?.full_name ?? "Instructor"])),
    [instructors]
  );

  const fillRateSeries = attendanceRows.map((row) => ({
    date: row.start_time.slice(0, 10),
    fillPercent: row.capacity > 0 ? (row.booked_count / row.capacity) * 100 : 0,
    attendancePercent: row.booked_count > 0 ? (row.attended_count / row.booked_count) * 100 : 0,
  }));

  const hourlyPerformance = useMemo(() => {
    const bucket = new Map<number, { count: number; total: number }>();
    attendanceRows.forEach((row) => {
      const hour = new Date(row.start_time).getHours();
      const value = bucket.get(hour) ?? { count: 0, total: 0 };
      value.count += 1;
      value.total += row.booked_count;
      bucket.set(hour, value);
    });
    return Array.from(bucket.entries())
      .map(([hour, data]) => ({ hour, avgBookings: data.total / data.count }))
      .sort((a, b) => a.hour - b.hour);
  }, [attendanceRows]);

  const instructorComparison = useMemo(() => {
    const bucket = new Map<string, { count: number; fill: number; attendance: number }>();
    attendanceRows.forEach((row) => {
      const key = row.instructor_id ?? "unknown";
      const value = bucket.get(key) ?? { count: 0, fill: 0, attendance: 0 };
      value.count += 1;
      value.fill += row.capacity > 0 ? row.booked_count / row.capacity : 0;
      value.attendance += row.booked_count > 0 ? row.attended_count / row.booked_count : 0;
      bucket.set(key, value);
    });
    return Array.from(bucket.entries()).map(([id, value]) => ({
      instructor_id: id,
      avgFill: (value.fill / value.count) * 100,
      avgAttendance: (value.attendance / value.count) * 100,
    }));
  }, [attendanceRows]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Class Analytics</h1>
            <p className="text-sm text-slate-400">Performance details for selected class type.</p>
          </div>
          <button
            className="rounded-md bg-slate-800 px-4 py-2 text-sm text-slate-200"
            onClick={() => router.push("/staff/analytics/classes")}
          >
            Back to classes
          </button>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Fill rate over time</h2>
          <div className="mt-4 space-y-2 text-sm text-slate-400">
            {fillRateSeries.length ? (
              fillRateSeries.map((row, index) => (
                <div key={`${row.date}-${index}`} className="flex items-center justify-between">
                  <span>{row.date}</span>
                  <span>{row.fillPercent.toFixed(1)}% fill · {row.attendancePercent.toFixed(1)}% attendance</span>
                </div>
              ))
            ) : (
              <div>No class instances in range.</div>
            )}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Attendance vs capacity</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-400">
              {attendanceRows.map((row) => (
                <div key={row.class_instance_id} className="flex items-center justify-between">
                  <span>{row.start_time.slice(0, 10)}</span>
                  <span>
                    {row.attended_count} attended / {row.capacity} capacity
                  </span>
                </div>
              ))}
              {attendanceRows.length === 0 ? <div>No attendance records.</div> : null}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">No-show & waitlist patterns</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-400">
              {attendanceRows.map((row) => (
                <div key={row.class_instance_id} className="flex items-center justify-between">
                  <span>{row.start_time.slice(0, 10)}</span>
                  <span>
                    {row.no_show_count} no-shows · {row.waitlist_count} waitlist
                  </span>
                </div>
              ))}
              {attendanceRows.length === 0 ? <div>No attendance records.</div> : null}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Top performing schedules</h2>
          <div className="mt-4 grid grid-cols-6 gap-2 text-xs text-slate-300">
            {hourlyPerformance.map((row) => (
              <div key={row.hour} className="rounded-md bg-slate-800 px-2 py-2 text-center">
                {row.hour}:00 · {row.avgBookings.toFixed(1)}
              </div>
            ))}
            {hourlyPerformance.length === 0 ? <div>No schedule data.</div> : null}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Instructor comparison</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Instructor</th>
                  <th className="px-3 py-2 text-left">Avg fill %</th>
                  <th className="px-3 py-2 text-left">Avg attendance %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {instructorComparison.map((row) => (
                  <tr key={row.instructor_id}>
                    <td className="px-3 py-2">{instructorNameMap.get(row.instructor_id) ?? "Unassigned"}</td>
                    <td className="px-3 py-2 text-slate-400">{row.avgFill.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-slate-400">{row.avgAttendance.toFixed(1)}%</td>
                  </tr>
                ))}
                {instructorComparison.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
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

export default function ClassAnalyticsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ClassAnalyticsView />
    </QueryClientProvider>
  );
}
