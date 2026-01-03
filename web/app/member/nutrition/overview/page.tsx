"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { roleRedirectPath } from "../../../../lib/roles";
import { supabaseBrowser } from "../../../../lib/supabase-browser";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type DailyTotals = {
  total_date: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

function formatDateLabel(date: string) {
  const parsed = new Date(date + "T00:00:00");
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MemberNutritionOverviewView() {
  const { session, role, loading } = useAuthStore();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [totals, setTotals] = useState<DailyTotals[]>([]);
  const [loadingData, setLoadingData] = useState(true);

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
    const loadTotals = async () => {
      if (!memberId) return;
      setLoadingData(true);
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 6);
      const start = startDate.toISOString().slice(0, 10);
      const end = endDate.toISOString().slice(0, 10);

      const { data } = await supabaseBrowser
        .from("nutrition_daily_totals")
        .select("total_date, calories, protein_g, carbs_g, fat_g")
        .eq("member_id", memberId)
        .gte("total_date", start)
        .lte("total_date", end)
        .order("total_date", { ascending: true });

      const totalsByDate = new Map((data ?? []).map((row) => [row.total_date, row]));
      const rows: DailyTotals[] = [];
      for (let i = 0; i < 7; i += 1) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const key = date.toISOString().slice(0, 10);
        rows.push(
          totalsByDate.get(key) ?? {
            total_date: key,
            calories: 0,
            protein_g: 0,
            carbs_g: 0,
            fat_g: 0,
          }
        );
      }
      setTotals(rows);
      setLoadingData(false);
    };

    loadTotals();
  }, [memberId]);

  const latestTotals = totals[totals.length - 1];
  const calorieMax = Math.max(1, ...totals.map((row) => row.calories));
  const macroTotal = (latestTotals?.protein_g ?? 0) + (latestTotals?.carbs_g ?? 0) + (latestTotals?.fat_g ?? 0);
  const macroBreakdown = useMemo(() => {
    if (!latestTotals || macroTotal === 0) {
      return { protein: 0, carbs: 0, fat: 0 };
    }
    return {
      protein: Math.round((latestTotals.protein_g / macroTotal) * 100),
      carbs: Math.round((latestTotals.carbs_g / macroTotal) * 100),
      fat: Math.round((latestTotals.fat_g / macroTotal) * 100),
    };
  }, [latestTotals, macroTotal]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Nutrition Overview</h1>
          <p className="text-sm text-slate-400">7-day calorie trend and macro distribution.</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="text-lg font-semibold">Calories Trend</h2>
          <div className="mt-4 flex items-end gap-3 h-40">
            {totals.map((row) => {
              const heightPercent = (row.calories / calorieMax) * 100;
              return (
                <div key={row.total_date} className="flex flex-col items-center gap-2 text-xs text-slate-400">
                  <div className="flex-1 flex items-end">
                    <div
                      className="w-8 rounded-md bg-amber-500/70"
                      style={{ height: `${Math.max(heightPercent, 5)}%` }}
                    />
                  </div>
                  <div>{formatDateLabel(row.total_date)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="text-xs text-slate-400">Protein</div>
            <div className="text-2xl font-semibold mt-2">{macroBreakdown.protein}%</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="text-xs text-slate-400">Carbs</div>
            <div className="text-2xl font-semibold mt-2">{macroBreakdown.carbs}%</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="text-xs text-slate-400">Fat</div>
            <div className="text-2xl font-semibold mt-2">{macroBreakdown.fat}%</div>
          </div>
        </div>

        <div className="text-sm text-slate-400">
          Plan comparison coming soon. Use your meal log to stay within targets.
        </div>
      </main>
    </div>
  );
}

export default function MemberNutritionOverviewPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemberNutritionOverviewView />
    </QueryClientProvider>
  );
}
