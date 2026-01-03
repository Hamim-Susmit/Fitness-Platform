"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../../lib/auth";
import { roleRedirectPath } from "../../../../../lib/roles";
import { supabaseBrowser } from "../../../../../lib/supabase-browser";

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
  status: "ACTIVE" | "ARCHIVED";
  visibility: "PRIVATE" | "SHARED_WITH_TRAINER";
  created_at: string;
};

type DailyTotals = {
  total_date: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type TrainerRow = {
  id: string;
};

function TrainerNutritionView() {
  const router = useRouter();
  const params = useParams();
  const memberId = params?.memberId as string | undefined;
  const { session, loading } = useAuthStore();
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [plans, setPlans] = useState<NutritionPlan[]>([]);
  const [totals, setTotals] = useState<DailyTotals[]>([]);
  const [planForm, setPlanForm] = useState({
    title: "",
    description: "",
    daily_calorie_target: "",
    protein_target_g: "",
    carbs_target_g: "",
    fat_target_g: "",
  });
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && !session) {
      router.replace(roleRedirectPath(null));
    }
  }, [loading, router, session]);

  useEffect(() => {
    const loadData = async () => {
      if (!session?.user.id || !memberId) return;
      setLoadingData(true);
      const { data: trainerRow } = await supabaseBrowser
        .from("personal_trainers")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!trainerRow) {
        router.replace("/member");
        return;
      }

      const { data: planRows } = await supabaseBrowser
        .from("nutrition_plans")
        .select("id, title, description, daily_calorie_target, protein_target_g, carbs_target_g, fat_target_g, status, visibility, created_at")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false });

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 6);
      const { data: totalsRows } = await supabaseBrowser
        .from("nutrition_daily_totals")
        .select("total_date, calories, protein_g, carbs_g, fat_g")
        .eq("member_id", memberId)
        .gte("total_date", startDate.toISOString().slice(0, 10))
        .lte("total_date", endDate.toISOString().slice(0, 10))
        .order("total_date", { ascending: true });

      setTrainer(trainerRow as TrainerRow);
      setPlans((planRows ?? []) as NutritionPlan[]);
      setTotals((totalsRows ?? []) as DailyTotals[]);
      setLoadingData(false);
    };

    loadData();
  }, [memberId, router, session?.user.id]);

  const handlePlanCreate = async () => {
    if (!trainer || !memberId || !planForm.title.trim()) return;
    const { data } = await supabaseBrowser
      .from("nutrition_plans")
      .insert({
        member_id: memberId,
        created_by: session?.user.id,
        title: planForm.title.trim(),
        description: planForm.description || null,
        daily_calorie_target: planForm.daily_calorie_target ? Number(planForm.daily_calorie_target) : null,
        protein_target_g: planForm.protein_target_g ? Number(planForm.protein_target_g) : null,
        carbs_target_g: planForm.carbs_target_g ? Number(planForm.carbs_target_g) : null,
        fat_target_g: planForm.fat_target_g ? Number(planForm.fat_target_g) : null,
        status: "ACTIVE",
        visibility: "SHARED_WITH_TRAINER",
      })
      .select("id, title, description, daily_calorie_target, protein_target_g, carbs_target_g, fat_target_g, status, visibility, created_at")
      .maybeSingle();

    if (data) {
      setPlans((prev) => [data as NutritionPlan, ...prev]);
      setPlanForm({
        title: "",
        description: "",
        daily_calorie_target: "",
        protein_target_g: "",
        carbs_target_g: "",
        fat_target_g: "",
      });
    }
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Client Nutrition</h1>
          <p className="text-sm text-slate-400">Review daily totals and create shared nutrition guidance.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <h2 className="text-lg font-semibold">Create plan</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Plan title"
              value={planForm.title}
              onChange={(event) => setPlanForm({ ...planForm, title: event.target.value })}
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Daily calories"
              type="number"
              value={planForm.daily_calorie_target}
              onChange={(event) => setPlanForm({ ...planForm, daily_calorie_target: event.target.value })}
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Protein (g)"
              type="number"
              value={planForm.protein_target_g}
              onChange={(event) => setPlanForm({ ...planForm, protein_target_g: event.target.value })}
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Carbs (g)"
              type="number"
              value={planForm.carbs_target_g}
              onChange={(event) => setPlanForm({ ...planForm, carbs_target_g: event.target.value })}
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Fat (g)"
              type="number"
              value={planForm.fat_target_g}
              onChange={(event) => setPlanForm({ ...planForm, fat_target_g: event.target.value })}
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Short description"
              value={planForm.description}
              onChange={(event) => setPlanForm({ ...planForm, description: event.target.value })}
            />
          </div>
          <button className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold" onClick={handlePlanCreate}>
            Save plan
          </button>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
          <h2 className="text-lg font-semibold">Recent totals</h2>
          {totals.length === 0 ? (
            <p className="text-sm text-slate-500">No totals recorded yet.</p>
          ) : (
            totals.map((row) => (
              <div key={row.total_date} className="flex items-center justify-between text-sm text-slate-300">
                <span>{row.total_date}</span>
                <span>{row.calories} kcal · P {row.protein_g}g · C {row.carbs_g}g · F {row.fat_g}g</span>
              </div>
            ))
          )}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
          <h2 className="text-lg font-semibold">Plans</h2>
          {plans.length === 0 ? (
            <p className="text-sm text-slate-500">No shared plans yet.</p>
          ) : (
            plans.map((plan) => (
              <div key={plan.id} className="rounded-lg border border-slate-800 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{plan.title}</div>
                    <div className="text-xs text-slate-400">{plan.status}</div>
                  </div>
                  <div className="text-xs text-slate-500">{plan.visibility.replace("_", " ")}</div>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-2">
          <h2 className="text-lg font-semibold">Coaching notes</h2>
          <textarea
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            rows={3}
            placeholder="Short coaching notes (coming soon)"
            disabled
          />
          <p className="text-xs text-slate-500">Notes will be available in a future step.</p>
        </section>
      </main>
    </div>
  );
}

export default function TrainerNutritionPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <TrainerNutritionView />
    </QueryClientProvider>
  );
}
