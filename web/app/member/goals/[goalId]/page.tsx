"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { roleRedirectPath } from "../../../../lib/roles";
import { supabaseBrowser } from "../../../../lib/supabase-browser";
import { computeGoalProgress } from "../../../../lib/goals/progress";

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
};

type ProgressEntryRow = {
  id: string;
  goal_id: string;
  value: number;
  note: string | null;
  source: string;
  recorded_at: string;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function GoalDetailView() {
  const router = useRouter();
  const params = useParams();
  const goalId = params?.goalId as string | undefined;
  const { session, role, loading } = useAuthStore();
  const [goal, setGoal] = useState<GoalRow | null>(null);
  const [entries, setEntries] = useState<ProgressEntryRow[]>([]);
  const [value, setValue] = useState(0);
  const [note, setNote] = useState("");
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
      if (!goalId) return;
      setLoadingData(true);
      const { data: goalRow } = await supabaseBrowser
        .from("goals")
        .select("id, title, goal_type, metric_key, unit, target_value, start_value, current_value, target_date, status")
        .eq("id", goalId)
        .maybeSingle();

      const { data: entryRows } = await supabaseBrowser
        .from("goal_progress_entries")
        .select("id, goal_id, value, note, source, recorded_at")
        .eq("goal_id", goalId)
        .order("recorded_at", { ascending: true });

      setGoal((goalRow ?? null) as GoalRow | null);
      setEntries((entryRows ?? []) as ProgressEntryRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [goalId]);

  const progress = useMemo(() => {
    return goal ? computeGoalProgress(goal, entries) : { percent: 0, current: 0 };
  }, [entries, goal]);

  const addEntry = async () => {
    if (!goal || goal.status !== "ACTIVE") return;
    const { data } = await supabaseBrowser
      .from("goal_progress_entries")
      .insert({
        goal_id: goal.id,
        value,
        note: note || null,
        source: "MANUAL",
        recorded_at: new Date().toISOString(),
      })
      .select("id, goal_id, value, note, source, recorded_at")
      .maybeSingle();

    if (data) {
      setEntries((prev) => [...prev, data as ProgressEntryRow]);
      setNote("");
      setValue(0);
    }
  };

  const markComplete = async () => {
    if (!goal) return;
    const { data } = await supabaseBrowser
      .from("goals")
      .update({ status: "COMPLETED" })
      .eq("id", goal.id)
      .select("id, title, goal_type, metric_key, unit, target_value, start_value, current_value, target_date, status")
      .maybeSingle();

    if (data) {
      setGoal(data as GoalRow);
    }
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  if (!goal) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <main className="mx-auto max-w-4xl px-6 py-10">
          <p className="text-sm text-slate-400">Goal not found.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">{goal.title}</h1>
          <p className="text-sm text-slate-400">{goal.metric_key} • Target {goal.target_value} {goal.unit}</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-sm text-slate-300">Progress: {progress.current}/{goal.target_value} {goal.unit}</p>
          <p className="text-xs text-slate-500">{Math.round(progress.percent)}% complete</p>
          <div className="mt-3 h-2 rounded-full bg-slate-800">
            <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${Math.round(progress.percent)}%` }} />
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <h2 className="text-lg font-semibold">Log progress</h2>
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            type="number"
            value={value}
            onChange={(event) => setValue(Number(event.target.value))}
            placeholder="Value"
          />
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note"
          />
          <button
            className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950"
            onClick={addEntry}
            disabled={goal.status !== "ACTIVE"}
          >
            Add entry
          </button>
          <button
            className="rounded-md border border-emerald-500/60 px-3 py-2 text-sm text-emerald-200"
            onClick={markComplete}
            disabled={goal.status !== "ACTIVE"}
          >
            Mark complete
          </button>
        </section>

        <section className="space-y-3">
          {entries.map((entry, index) => (
            <div key={entry.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-xs text-slate-500">{new Date(entry.recorded_at).toLocaleString()}</div>
              <div className="text-sm text-slate-200 mt-2">{entry.value} {goal.unit}</div>
              <div className="text-xs text-slate-400">Source: {entry.source}</div>
              {index > 0 && entry.value > entries[index - 1].value ? (
                <div className="text-xs text-emerald-300">Milestone reached</div>
              ) : null}
            </div>
          ))}
          {entries.length === 0 ? <p className="text-sm text-slate-400">No progress entries yet.</p> : null}
        </section>
      </main>
    </div>
  );
}

export default function GoalDetailPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <GoalDetailView />
    </QueryClientProvider>
  );
}
