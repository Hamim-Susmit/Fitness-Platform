"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { loadSessionAndRole, useAuthStore } from "../../../../../lib/auth";
import { roleRedirectPath } from "../../../../../lib/roles";
import { getUserRoleContext, isCorporateAdmin, isRegionalManager } from "../../../../../lib/permissions/gymPermissions";
import { useActiveGym } from "../../../../../lib/useActiveGym";
import { supabaseBrowser } from "../../../../../lib/supabase-browser";

type GymRow = {
  id: string;
  name: string;
  chain_id: string | null;
};

type DailyAttendance = {
  gym_id: string;
  day: string;
  total_checkins: number;
};

type HourlyAttendance = {
  gym_id: string;
  hour: number;
  checkins_this_hour: number;
};

type TrendRow = {
  gym_id: string;
  trend_label: "UP" | "DOWN" | "FLAT";
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function AttendanceLocationsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const { activeGymId } = useActiveGym();
  const [gyms, setGyms] = useState<GymRow[]>([]);
  const [dailyAttendance, setDailyAttendance] = useState<DailyAttendance[]>([]);
  const [hourlyAttendance, setHourlyAttendance] = useState<HourlyAttendance[]>([]);
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    const resolveAccess = async () => {
      if (!session?.user.id) return;
      await getUserRoleContext(session.user.id);
      if (!isCorporateAdmin() && !isRegionalManager()) {
        router.replace(roleRedirectPath(role));
      }
    };
    resolveAccess();
  }, [role, router, session?.user.id]);

  useEffect(() => {
    const loadData = async () => {
      if (!activeGymId) return;
      setLoadingData(true);

      const { data: activeGym } = await supabaseBrowser
        .from("gyms")
        .select("id, chain_id")
        .eq("id", activeGymId)
        .maybeSingle();

      if (!activeGym?.chain_id) {
        setGyms([]);
        setLoadingData(false);
        return;
      }

      const [{ data: gymsRows }, { data: dailyRows }, { data: hourlyRows }, { data: trendRows }] =
        await Promise.all([
          supabaseBrowser
            .from("gyms")
            .select("id, name, chain_id")
            .eq("chain_id", activeGym.chain_id)
            .order("name"),
          supabaseBrowser
            .from("gym_daily_attendance_mv")
            .select("gym_id, day, total_checkins")
            .gte("day", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
          supabaseBrowser.from("gym_hourly_attendance_mv").select("gym_id, hour, checkins_this_hour"),
          supabaseBrowser.from("gym_occupancy_trends_v").select("gym_id, trend_label"),
        ]);

      setGyms((gymsRows ?? []) as GymRow[]);
      setDailyAttendance((dailyRows ?? []) as DailyAttendance[]);
      setHourlyAttendance((hourlyRows ?? []) as HourlyAttendance[]);
      setTrends((trendRows ?? []) as TrendRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [activeGymId]);

  const dailyByGym = useMemo(() => {
    const map = new Map<string, DailyAttendance[]>();
    dailyAttendance.forEach((row) => {
      const rows = map.get(row.gym_id) ?? [];
      rows.push(row);
      map.set(row.gym_id, rows);
    });
    return map;
  }, [dailyAttendance]);

  const hourlyByGym = useMemo(() => {
    const map = new Map<string, HourlyAttendance[]>();
    hourlyAttendance.forEach((row) => {
      const rows = map.get(row.gym_id) ?? [];
      rows.push(row);
      map.set(row.gym_id, rows);
    });
    return map;
  }, [hourlyAttendance]);

  const trendMap = useMemo(() => new Map(trends.map((row) => [row.gym_id, row.trend_label])), [trends]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Attendance by Location</h1>
          <p className="text-sm text-slate-400">Cross-gym attendance comparisons (last 30 days).</p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <table className="min-w-full text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Gym</th>
                <th className="px-3 py-2 text-left">Total visits</th>
                <th className="px-3 py-2 text-left">Avg visits/day</th>
                <th className="px-3 py-2 text-left">Busiest hour</th>
                <th className="px-3 py-2 text-left">Trend</th>
                <th className="px-3 py-2 text-left">Sparkline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {gyms.map((gym) => {
                const dailyRows = dailyByGym.get(gym.id) ?? [];
                const hourlyRows = hourlyByGym.get(gym.id) ?? [];
                const totalVisits = dailyRows.reduce((sum, row) => sum + row.total_checkins, 0);
                const avgVisits = dailyRows.length ? Math.round(totalVisits / dailyRows.length) : 0;
                const hourlyTotals = new Map<number, number>();
                hourlyRows.forEach((row) => {
                  hourlyTotals.set(row.hour, (hourlyTotals.get(row.hour) ?? 0) + row.checkins_this_hour);
                });
                const busiestHour = Array.from(hourlyTotals.entries()).reduce(
                  (acc, [hour, total]) => (total > acc.total ? { hour, total } : acc),
                  { hour: 0, total: 0 }
                ).hour;
                const trendLabel = trendMap.get(gym.id) ?? "FLAT";
                const sparklinePoints = dailyRows.map((row) => row.total_checkins);
                const maxPoint = Math.max(1, ...sparklinePoints);
                return (
                  <tr key={gym.id}>
                    <td className="px-3 py-2">{gym.name}</td>
                    <td className="px-3 py-2 text-slate-400">{totalVisits}</td>
                    <td className="px-3 py-2 text-slate-400">{avgVisits}</td>
                    <td className="px-3 py-2 text-slate-400">{busiestHour}:00</td>
                    <td className="px-3 py-2 text-slate-400">{trendLabel}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-end gap-1 h-6">
                        {sparklinePoints.slice(-14).map((value, idx) => (
                          <span
                            key={`${gym.id}-spark-${idx}`}
                            className="block w-1 bg-emerald-400/60"
                            style={{ height: `${Math.max(10, (value / maxPoint) * 100)}%` }}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {gyms.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                    No gyms available for this chain.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AttendanceLocationsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <AttendanceLocationsView />
    </QueryClientProvider>
  );
}
