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

type GoalRow = {
  id: string;
  title: string;
  goal_type: string;
  metric_key: string;
  unit: string;
  target_value: number;
  status: string;
  visibility: string;
};

type TrainerRow = {
  id: string;
};

function TrainerGoalsView() {
  const router = useRouter();
  const params = useParams();
  const memberId = params?.memberId as string | undefined;
  const { session, loading } = useAuthStore();
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [title, setTitle] = useState("");
  const [goalType, setGoalType] = useState("STRENGTH");
  const [metricKey, setMetricKey] = useState("bench_press_1rm");
  const [unit, setUnit] = useState("kg");
  const [targetValue, setTargetValue] = useState(0);
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

      const { data: goalRows } = await supabaseBrowser
        .from("goals")
        .select("id, title, goal_type, metric_key, unit, target_value, status, visibility")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false });

      setTrainer(trainerRow as TrainerRow);
      setGoals((goalRows ?? []) as GoalRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [memberId, router, session?.user.id]);

  const proposeGoal = async () => {
    if (!trainer || !memberId || !title.trim()) return;
    const { data } = await supabaseBrowser
      .from("goals")
      .insert({
        member_id: memberId,
        created_by: session?.user.id,
        goal_type: goalType,
        title,
        description: null,
        metric_key: metricKey,
        unit,
        target_value: targetValue,
        start_value: null,
        current_value: null,
        target_date: null,
        status: "ACTIVE",
        visibility: "SHARED_WITH_TRAINER",
      })
      .select("id, title, goal_type, metric_key, unit, target_value, status, visibility")
      .maybeSingle();

    if (data) {
      setGoals((prev) => [data as GoalRow, ...prev]);
      setTitle("");
    }
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Client Goals</h1>
          <p className="text-sm text-slate-400">Propose goals and track shared progress.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="Goal title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <select
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={goalType}
              onChange={(event) => setGoalType(event.target.value)}
            >
              <option value="STRENGTH">Strength</option>
              <option value="ENDURANCE">Endurance</option>
              <option value="WEIGHT">Weight</option>
              <option value="CUSTOM">Custom</option>
            </select>
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              placeholder="Metric key"
              value={metricKey}
              onChange={(event) => setMetricKey(event.target.value)}
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              placeholder="Unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            />
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              type="number"
              placeholder="Target value"
              value={targetValue}
              onChange={(event) => setTargetValue(Number(event.target.value))}
            />
          </div>
          <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950" onClick={proposeGoal}>
            Propose goal
          </button>
        </section>

        <section className="space-y-3">
          {goals.map((goal) => (
            <div key={goal.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-sm font-medium">{goal.title}</div>
              <div className="text-xs text-slate-500">{goal.goal_type} • {goal.metric_key} • {goal.visibility}</div>
              <div className="text-xs text-slate-500">Target {goal.target_value} {goal.unit}</div>
              <div className="text-xs text-slate-500">Status: {goal.status}</div>
            </div>
          ))}
          {goals.length === 0 ? <p className="text-sm text-slate-400">No shared goals yet.</p> : null}
        </section>
      </main>
    </div>
  );
}

export default function TrainerGoalsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <TrainerGoalsView />
    </QueryClientProvider>
  );
}
