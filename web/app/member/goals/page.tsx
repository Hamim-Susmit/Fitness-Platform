"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";
import { computeGoalProgress } from "../../../lib/goals/progress";

type GoalRow = {
  id: string;
  title: string;
  goal_type: string;
  metric_key: string;
  unit: string;
  target_value: number;
  start_value: number | null;
  current_value: number | null;
  target_date: string | null;
  status: string;
  visibility: string;
};

type ProgressEntryRow = {
  id: string;
  goal_id: string;
  value: number;
  recorded_at: string;
  source: string;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function GoalsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [progressEntries, setProgressEntries] = useState<ProgressEntryRow[]>([]);
  const [title, setTitle] = useState("");
  const [goalType, setGoalType] = useState("WEIGHT");
  const [metricKey, setMetricKey] = useState("body_weight");
  const [unit, setUnit] = useState("kg");
  const [targetValue, setTargetValue] = useState(0);
  const [targetDate, setTargetDate] = useState("");
  const [visibility, setVisibility] = useState("PRIVATE");
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const loadData = async () => {
      if (!session?.user.id) return;
      setLoadingData(true);
      const { data: goalRows } = await supabaseBrowser
        .from("goals")
        .select("id, title, goal_type, metric_key, unit, target_value, start_value, current_value, target_date, status, visibility")
        .eq("member_id", session.user.id)
        .order("created_at", { ascending: false });

      const { data: progressRows } = await supabaseBrowser
        .from("goal_progress_entries")
        .select("id, goal_id, value, recorded_at, source")
        .in(
          "goal_id",
          (goalRows ?? []).map((goal) => goal.id)
        );

      setGoals((goalRows ?? []) as GoalRow[]);
      setProgressEntries((progressRows ?? []) as ProgressEntryRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [session?.user.id]);

  const entriesByGoal = useMemo(() => {
    const map = new Map<string, ProgressEntryRow[]>();
    progressEntries.forEach((entry) => {
      const list = map.get(entry.goal_id) ?? [];
      list.push(entry);
      map.set(entry.goal_id, list);
    });
    return map;
  }, [progressEntries]);

  const createGoal = async () => {
    if (!session?.user.id || !title.trim()) return;
    const { data } = await supabaseBrowser
      .from("goals")
      .insert({
        member_id: session.user.id,
        created_by: session.user.id,
        goal_type: goalType,
        title,
        description: null,
        metric_key: metricKey,
        unit,
        target_value: targetValue,
        start_value: null,
        current_value: null,
        target_date: targetDate || null,
        status: "ACTIVE",
        visibility,
      })
      .select("id, title, goal_type, metric_key, unit, target_value, start_value, current_value, target_date, status, visibility")
      .maybeSingle();

    if (data) {
      setGoals((prev) => [data as GoalRow, ...prev]);
      setTitle("");
    }
  };

  const archiveGoal = async (goalId: string) => {
    const { data } = await supabaseBrowser
      .from("goals")
      .update({ status: "ABANDONED" })
      .eq("id", goalId)
      .select("id, title, goal_type, metric_key, unit, target_value, start_value, current_value, target_date, status, visibility")
      .maybeSingle();

    if (data) {
      setGoals((prev) => prev.map((goal) => (goal.id === goalId ? (data as GoalRow) : goal)));
    }
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Goals</h1>
          <p className="text-sm text-slate-400">Track weight, strength, endurance, or custom metrics.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              placeholder="Goal title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <select
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={goalType}
              onChange={(event) => setGoalType(event.target.value)}
            >
              <option value="WEIGHT">Weight</option>
              <option value="STRENGTH">Strength</option>
              <option value="ENDURANCE">Endurance</option>
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
            <input
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              type="date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
            />
            <select
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value)}
            >
              <option value="PRIVATE">Private</option>
              <option value="SHARED_WITH_TRAINER">Shared with trainer</option>
            </select>
          </div>
          <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950" onClick={createGoal}>
            Create goal
          </button>
        </section>

        <section className="space-y-3">
          {goals.map((goal) => {
            const progress = computeGoalProgress(goal, entriesByGoal.get(goal.id) ?? []);
            return (
              <div key={goal.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{goal.title}</h2>
                    <p className="text-xs text-slate-500">{goal.goal_type} • {goal.metric_key}</p>
                  </div>
                  <div className="text-xs text-slate-400">Status: {goal.status}</div>
                </div>
                <p className="text-sm text-slate-300">Progress: {progress.current}/{goal.target_value} {goal.unit}</p>
                <p className="text-xs text-slate-500">{Math.round(progress.percent)}% complete</p>
                <div className="flex gap-2 text-xs">
                  <Link className="rounded-md border border-slate-700 px-2 py-1 text-slate-200" href={`/member/goals/${goal.id}`}>
                    View details
                  </Link>
                  {goal.status === "ACTIVE" ? (
                    <button
                      className="rounded-md border border-rose-500/60 px-2 py-1 text-rose-200"
                      onClick={() => archiveGoal(goal.id)}
                    >
                      Archive
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {goals.length === 0 ? <p className="text-sm text-slate-400">No goals yet.</p> : null}
        </section>
      </main>
    </div>
  );
}

export default function GoalsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <GoalsView />
    </QueryClientProvider>
  );
}
