"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../../lib/auth";
import { roleRedirectPath } from "../../../../../lib/roles";
import { supabaseBrowser } from "../../../../../lib/supabase-browser";
import { deriveSetDisplayLabel } from "../../../../../lib/workouts/helpers";

type ExerciseRow = {
  id: string;
  name: string;
};

type WorkoutExerciseRow = {
  id: string;
  order_index: number;
  exercise: ExerciseRow | null;
};

type WorkoutLogRow = {
  id: string;
  workout_exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  weight_unit: "kg" | "lb" | null;
  rpe: number | null;
  notes: string | null;
  logged_at: string;
};

type WorkoutRow = {
  id: string;
  title: string;
  started_at: string;
  completed_at: string | null;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function WorkoutLogView() {
  const router = useRouter();
  const params = useParams();
  const workoutId = params?.workoutId as string | undefined;
  const { session, role, loading } = useAuthStore();
  const [workout, setWorkout] = useState<WorkoutRow | null>(null);
  const [workoutExercises, setWorkoutExercises] = useState<WorkoutExerciseRow[]>([]);
  const [logs, setLogs] = useState<WorkoutLogRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);

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
      if (!workoutId) return;
      setLoadingData(true);
      const { data: workoutRow } = await supabaseBrowser
        .from("workouts")
        .select("id, title, started_at, completed_at")
        .eq("id", workoutId)
        .maybeSingle();

      const { data: exerciseRows } = await supabaseBrowser
        .from("workout_exercises")
        .select("id, order_index, exercise:exercises(id, name)")
        .eq("workout_id", workoutId)
        .order("order_index", { ascending: true });

      const { data: logRows } = await supabaseBrowser
        .from("workout_logs")
        .select("id, workout_exercise_id, set_number, reps, weight, weight_unit, rpe, notes, logged_at")
        .in(
          "workout_exercise_id",
          (exerciseRows ?? []).map((row) => row.id)
        )
        .order("logged_at", { ascending: true });

      setWorkout((workoutRow ?? null) as WorkoutRow | null);
      setWorkoutExercises((exerciseRows ?? []) as WorkoutExerciseRow[]);
      setLogs((logRows ?? []) as WorkoutLogRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [workoutId]);

  const logsByExercise = useMemo(() => {
    const map = new Map<string, WorkoutLogRow[]>();
    logs.forEach((log) => {
      const list = map.get(log.workout_exercise_id) ?? [];
      list.push(log);
      map.set(log.workout_exercise_id, list);
    });
    return map;
  }, [logs]);

  const addSet = async (workoutExerciseId: string) => {
    const existing = logsByExercise.get(workoutExerciseId) ?? [];
    const nextSetNumber = existing.length + 1;
    const payload = {
      workout_exercise_id: workoutExerciseId,
      set_number: nextSetNumber,
      reps: existing[existing.length - 1]?.reps ?? null,
      weight: existing[existing.length - 1]?.weight ?? null,
      weight_unit: existing[existing.length - 1]?.weight_unit ?? null,
      rpe: existing[existing.length - 1]?.rpe ?? null,
      notes: existing[existing.length - 1]?.notes ?? null,
      logged_at: new Date().toISOString(),
    };

    const { data } = await supabaseBrowser.from("workout_logs").insert(payload).select("*").maybeSingle();
    if (data) {
      setLogs((prev) => [...prev, data as WorkoutLogRow]);
    }
  };

  const updateLog = async (logId: string, updates: Partial<WorkoutLogRow>) => {
    setSaving(true);
    const { data } = await supabaseBrowser
      .from("workout_logs")
      .update(updates)
      .eq("id", logId)
      .select("*")
      .maybeSingle();
    if (data) {
      setLogs((prev) => prev.map((log) => (log.id === logId ? (data as WorkoutLogRow) : log)));
    }
    setSaving(false);
  };

  const completeWorkout = async () => {
    if (!workoutId) return;
    const completedAt = new Date().toISOString();
    await supabaseBrowser.from("workouts").update({ completed_at: completedAt }).eq("id", workoutId);
    setWorkout((prev) => (prev ? { ...prev, completed_at: completedAt } : prev));
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  if (!workout) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <main className="mx-auto max-w-5xl px-6 py-10">
          <p className="text-sm text-slate-400">Workout not found.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">{workout.title}</h1>
            <p className="text-sm text-slate-400">Log sets and mark completion when finished.</p>
          </div>
          <button
            className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950"
            onClick={completeWorkout}
            disabled={!!workout.completed_at}
          >
            {workout.completed_at ? "Completed" : "Mark complete"}
          </button>
        </div>

        <section className="space-y-4">
          {workoutExercises.map((workoutExercise) => {
            const exerciseLogs = logsByExercise.get(workoutExercise.id) ?? [];
            return (
              <div key={workoutExercise.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{workoutExercise.exercise?.name ?? "Exercise"}</h2>
                    <p className="text-xs text-slate-500">{exerciseLogs.length} sets logged</p>
                  </div>
                  <button
                    className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200"
                    onClick={() => addSet(workoutExercise.id)}
                  >
                    Add set
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {exerciseLogs.map((log) => (
                    <div key={log.id} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-3 md:grid-cols-6">
                      <div className="text-xs text-slate-400">{deriveSetDisplayLabel(log.set_number)}</div>
                      <input
                        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                        placeholder="Reps"
                        value={log.reps ?? ""}
                        onChange={(event) =>
                          updateLog(log.id, { reps: event.target.value ? Number(event.target.value) : null })
                        }
                      />
                      <input
                        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                        placeholder="Weight"
                        value={log.weight ?? ""}
                        onChange={(event) =>
                          updateLog(log.id, { weight: event.target.value ? Number(event.target.value) : null })
                        }
                      />
                      <select
                        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                        value={log.weight_unit ?? ""}
                        onChange={(event) => updateLog(log.id, { weight_unit: (event.target.value || null) as "kg" | "lb" | null })}
                      >
                        <option value="">Unit</option>
                        <option value="kg">kg</option>
                        <option value="lb">lb</option>
                      </select>
                      <input
                        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                        placeholder="RPE"
                        value={log.rpe ?? ""}
                        onChange={(event) =>
                          updateLog(log.id, { rpe: event.target.value ? Number(event.target.value) : null })
                        }
                      />
                      <input
                        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                        placeholder="Notes"
                        value={log.notes ?? ""}
                        onChange={(event) => updateLog(log.id, { notes: event.target.value || null })}
                      />
                    </div>
                  ))}
                  {exerciseLogs.length === 0 ? <p className="text-xs text-slate-500">No sets logged yet.</p> : null}
                </div>
              </div>
            );
          })}
        </section>

        {saving ? <p className="text-xs text-slate-500">Saving changes...</p> : null}
      </main>
    </div>
  );
}

export default function WorkoutLogPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <WorkoutLogView />
    </QueryClientProvider>
  );
}
