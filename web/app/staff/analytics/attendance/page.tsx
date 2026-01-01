"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../lib/roles";
import { useActiveGym } from "../../../../lib/useActiveGym";
import { supabaseBrowser } from "../../../../lib/supabase-browser";

type DailyAttendance = {
  gym_id: string;
  day: string;
  total_checkins: number;
  unique_members: number;
  first_checkin_at: string | null;
  last_checkin_at: string | null;
};

type HourlyAttendance = {
  gym_id: string;
  day: string;
  hour: number;
  checkins_this_hour: number;
  unique_members_this_hour: number;
};

type PeakHour = {
  gym_id: string;
  hour: number;
  avg_checkins: number;
  load_band: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const ranges = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];

function AttendanceAnalyticsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { activeGymId } = useActiveGym();
  const [rangeDays, setRangeDays] = useState(30);
  const [daily, setDaily] = useState<DailyAttendance[]>([]);
  const [hourly, setHourly] = useState<HourlyAttendance[]>([]);
  const [peaks, setPeaks] = useState<PeakHour[]>([]);
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
      const sinceDate = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const [{ data: dailyRows }, { data: hourlyRows }, { data: peakRows }] = await Promise.all([
        supabaseBrowser
          .from("gym_daily_attendance_mv")
          .select("*")
          .eq("gym_id", activeGymId)
          .gte("day", sinceDate)
          .order("day", { ascending: true }),
        supabaseBrowser
          .from("gym_hourly_attendance_mv")
          .select("*")
          .eq("gym_id", activeGymId)
          .gte("day", sinceDate),
        supabaseBrowser
          .from("gym_peak_hours_v")
          .select("gym_id, hour, avg_checkins, load_band")
          .eq("gym_id", activeGymId),
      ]);

      setDaily((dailyRows ?? []) as DailyAttendance[]);
      setHourly((hourlyRows ?? []) as HourlyAttendance[]);
      setPeaks((peakRows ?? []) as PeakHour[]);
      setLoadingData(false);
    };

    loadData();
  }, [activeGymId, rangeDays]);

  const totalVisits = daily.reduce((sum, row) => sum + row.total_checkins, 0);
  const uniqueMembers = daily.reduce((sum, row) => sum + row.unique_members, 0);
  const busiestDay = daily.reduce<DailyAttendance | null>(
    (acc, row) => (!acc || row.total_checkins > acc.total_checkins ? row : acc),
    null
  );

  const busiestHour = useMemo(() => {
    const counts = new Map<number, number>();
    hourly.forEach((row) => {
      counts.set(row.hour, (counts.get(row.hour) ?? 0) + row.checkins_this_hour);
    });
    let topHour: number | null = null;
    let topCount = 0;
    counts.forEach((value, hour) => {
      if (value > topCount) {
        topCount = value;
        topHour = hour;
      }
    });
    return topHour;
  }, [hourly]);

  const hourlyDistribution = useMemo(() => {
    const base = Array.from({ length: 24 }).map((_, hour) => ({ hour, count: 0 }));
    hourly.forEach((row) => {
      base[row.hour].count += row.checkins_this_hour;
    });
    return base;
  }, [hourly]);

  const heatmap = useMemo(() => {
    return Array.from({ length: 24 }).map((_, hour) => {
      const peak = peaks.find((row) => row.hour === hour);
      return { hour, load_band: peak?.load_band ?? "LOW", avg_checkins: peak?.avg_checkins ?? 0 };
    });
  }, [peaks]);

  const peakHourByDay = useMemo(() => {
    const map = new Map<string, number>();
    const grouped = new Map<string, Map<number, number>>();
    hourly.forEach((row) => {
      const dayMap = grouped.get(row.day) ?? new Map<number, number>();
      dayMap.set(row.hour, (dayMap.get(row.hour) ?? 0) + row.checkins_this_hour);
      grouped.set(row.day, dayMap);
    });
    grouped.forEach((hours, day) => {
      const busiest = Array.from(hours.entries()).reduce(
        (acc, [hour, total]) => (total > acc.total ? { hour, total } : acc),
        { hour: 0, total: 0 }
      );
      map.set(day, busiest.hour);
    });
    return map;
  }, [hourly]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Attendance Analytics</h1>
            <p className="text-sm text-slate-400">Attendance trends from check-ins (directional, not live occupancy).</p>
          </div>
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

        <section className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Total visits", value: totalVisits },
            { label: "Unique members", value: uniqueMembers },
            { label: "Busiest day", value: busiestDay ? busiestDay.day : "—" },
            { label: "Busiest hour", value: busiestHour !== null ? `${busiestHour}:00` : "—" },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-sm text-slate-400">{card.label}</div>
              <div className="text-2xl font-semibold">{card.value}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Attendance over time</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-400">
              {daily.length ? (
                daily.map((row) => (
                  <div key={row.day} className="flex items-center justify-between">
                    <span>{row.day}</span>
                    <span>{row.total_checkins}</span>
                  </div>
                ))
              ) : (
                <div>No check-ins in the selected range.</div>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-semibold">Peak-hours heatmap</h2>
            <div className="mt-4 grid grid-cols-6 gap-2 text-xs">
              {heatmap.map((row) => (
                <div
                  key={row.hour}
                  className={`rounded-md px-2 py-2 text-center ${
                    row.load_band === "CRITICAL"
                      ? "bg-rose-500/30 text-rose-200"
                      : row.load_band === "HIGH"
                      ? "bg-amber-500/30 text-amber-200"
                      : row.load_band === "MEDIUM"
                      ? "bg-emerald-500/30 text-emerald-200"
                      : "bg-slate-800 text-slate-300"
                  }`}
                >
                  {row.hour}:00
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Hourly distribution</h2>
          <div className="mt-4 grid grid-cols-6 gap-2 text-xs text-slate-300">
            {hourlyDistribution.map((row) => (
              <div key={row.hour} className="rounded-md bg-slate-800 px-2 py-2 text-center">
                {row.hour}:00 • {row.count}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Daily breakdown</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Day</th>
                  <th className="px-3 py-2 text-left">Total check-ins</th>
                  <th className="px-3 py-2 text-left">Unique members</th>
                  <th className="px-3 py-2 text-left">Peak hour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {daily.map((row) => (
                  <tr key={row.day}>
                    <td className="px-3 py-2">{row.day}</td>
                    <td className="px-3 py-2 text-slate-400">{row.total_checkins}</td>
                    <td className="px-3 py-2 text-slate-400">{row.unique_members}</td>
                    <td className="px-3 py-2 text-slate-400">
                      {peakHourByDay.has(row.day) ? `${peakHourByDay.get(row.day)}:00` : "—"}
                    </td>
                  </tr>
                ))}
                {daily.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                      No attendance data for this range.
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

export default function AttendanceAnalyticsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <AttendanceAnalyticsView />
    </QueryClientProvider>
  );
}
