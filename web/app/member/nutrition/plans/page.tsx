"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { roleRedirectPath } from "../../../../lib/roles";
import { supabaseBrowser } from "../../../../lib/supabase-browser";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type NutritionPlan = {
  id: string;
  title: string;
  description: string | null;
  daily_calorie_target: number | null;
  protein_target_g: number | null;
  carbs_target_g: number | null;
  fat_target_g: number | null;
  start_date: string | null;
  end_date: string | null;
  status: "ACTIVE" | "ARCHIVED";
  visibility: "PRIVATE" | "SHARED_WITH_TRAINER";
  created_at: string;
};

type DailyTotals = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

function MemberNutritionPlansView() {
  const { session, role, loading } = useAuthStore();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [plans, setPlans] = useState<NutritionPlan[]>([]);
  const [dailyTotals, setDailyTotals] = useState<DailyTotals | null>(null);
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
    const loadPlans = async () => {
      if (!memberId) return;
      setLoadingData(true);
      const { data } = await supabaseBrowser
        .from("nutrition_plans")
        .select("id, title, description, daily_calorie_target, protein_target_g, carbs_target_g, fat_target_g, start_date, end_date, status, visibility, created_at")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false });

      const today = new Date().toISOString().slice(0, 10);
      const { data: totals } = await supabaseBrowser
        .from("nutrition_daily_totals")
        .select("calories, protein_g, carbs_g, fat_g")
        .eq("member_id", memberId)
        .eq("total_date", today)
        .maybeSingle();

      setPlans((data ?? []) as NutritionPlan[]);
      setDailyTotals((totals ?? null) as DailyTotals | null);
      setLoadingData(false);
    };

    loadPlans();
  }, [memberId]);

  const activePlan = useMemo(() => plans.find((plan) => plan.status === "ACTIVE") ?? null, [plans]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Nutrition Plans</h1>
          <p className="text-sm text-slate-400">Review active guidance and align your daily totals.</p>
        </div>

        {activePlan ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{activePlan.title}</h2>
                <p className="text-sm text-slate-400">{activePlan.description ?? "No description."}</p>
              </div>
              <span className="text-xs text-emerald-300">Active</span>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-slate-400">Calories</div>
                <div className="text-lg font-semibold">
                  {activePlan.daily_calorie_target ?? "—"}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-slate-400">Protein</div>
                <div className="text-lg font-semibold">
                  {activePlan.protein_target_g ?? "—"} g
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-slate-400">Carbs</div>
                <div className="text-lg font-semibold">
                  {activePlan.carbs_target_g ?? "—"} g
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 p-3">
                <div className="text-xs text-slate-400">Fat</div>
                <div className="text-lg font-semibold">
                  {activePlan.fat_target_g ?? "—"} g
                </div>
              </div>
            </div>
            <div className="text-sm text-slate-400">
              Today: {dailyTotals ? `${dailyTotals.calories} kcal · P ${dailyTotals.protein_g}g · C ${dailyTotals.carbs_g}g · F ${dailyTotals.fat_g}g` : "No totals yet"}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
            No active nutrition plan yet.
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Plan history</h2>
          {plans.length === 0 ? (
            <div className="text-sm text-slate-500">No plans created yet.</div>
          ) : (
            plans.map((plan) => (
              <div key={plan.id} className="rounded-lg border border-slate-800 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{plan.title}</div>
                    <div className="text-xs text-slate-400">
                      {plan.status} · {plan.visibility.replace("_", " ")}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {plan.start_date ?? "—"} → {plan.end_date ?? "—"}
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}

export default function MemberNutritionPlansPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemberNutritionPlansView />
    </QueryClientProvider>
  );
}
