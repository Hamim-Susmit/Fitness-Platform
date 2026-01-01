"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { roleRedirectPath } from "../../../../lib/roles";
import { supabaseBrowser } from "../../../../lib/supabase-browser";

type ExerciseRow = {
  id: string;
  name: string;
};

type TemplateRow = {
  id: string;
  title: string;
  owner_type: string;
};

type TemplateExerciseRow = {
  exercise_id: string;
  order_index: number;
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

function WorkoutBuilderView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [workoutTitle, setWorkoutTitle] = useState("Custom Workout");
  const [selectedExercises, setSelectedExercises] = useState<ExerciseRow[]>([]);
  const [draftWorkout, setDraftWorkout] = useState<WorkoutRow | null>(null);
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
      if (!session?.user.id) return;
      setLoadingData(true);
      const [{ data: exerciseRows }, { data: templateRows }, { data: workoutRows }] = await Promise.all([
        supabaseBrowser.from("exercises").select("id, name").order("name"),
        supabaseBrowser
          .from("workout_templates")
          .select("id, title, owner_type")
          .order("created_at", { ascending: false }),
        supabaseBrowser
          .from("workouts")
          .select("id, title, started_at, completed_at")
          .eq("member_id", session.user.id)
          .is("completed_at", null)
          .order("started_at", { ascending: false })
          .limit(1),
      ]);

      setExercises((exerciseRows ?? []) as ExerciseRow[]);
      setTemplates((templateRows ?? []) as TemplateRow[]);
      setDraftWorkout((workoutRows ?? [])[0] ?? null);
      setLoadingData(false);
    };

    loadData();
  }, [session?.user.id]);

  const availableExercises = useMemo(() => exercises, [exercises]);

  const applyTemplate = async (template: TemplateRow) => {
    setTemplateId(template.id);
    setWorkoutTitle(template.title);
    const { data } = await supabaseBrowser
      .from("workout_template_exercises")
      .select("exercise_id, order_index")
      .eq("template_id", template.id)
      .order("order_index", { ascending: true });

    const templateExercises = (data ?? []) as TemplateExerciseRow[];
    const mapped = templateExercises
      .map((row) => availableExercises.find((exercise) => exercise.id === row.exercise_id))
      .filter((exercise): exercise is ExerciseRow => !!exercise);

    setSelectedExercises(mapped);
  };

  const addExercise = (exerciseId: string) => {
    const exercise = availableExercises.find((item) => item.id === exerciseId);
    if (!exercise) return;
    setSelectedExercises((prev) => [...prev, exercise]);
  };

  const removeExercise = (index: number) => {
    setSelectedExercises((prev) => prev.filter((_, idx) => idx !== index));
  };

  const moveExercise = (index: number, direction: -1 | 1) => {
    setSelectedExercises((prev) => {
      const next = [...prev];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  };

  const saveWorkout = async () => {
    if (!session?.user.id) return;
    setSaving(true);
    const { data: workoutRow, error } = await supabaseBrowser
      .from("workouts")
      .insert({
        member_id: session.user.id,
        template_id: templateId,
        title: workoutTitle,
        source: templateId ? "TEMPLATE" : "CUSTOM",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (!error && workoutRow?.id) {
      const payload = selectedExercises.map((exercise, index) => ({
        workout_id: workoutRow.id,
        exercise_id: exercise.id,
        order_index: index,
      }));
      if (payload.length) {
        await supabaseBrowser.from("workout_exercises").insert(payload);
      }
      router.push(`/member/workouts/${workoutRow.id}/log`);
    }
    setSaving(false);
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Workout Builder</h1>
          <p className="text-sm text-slate-400">Create or resume a workout. Drafts are saved until completed.</p>
        </div>

        {draftWorkout ? (
          <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-sm text-amber-200">Resume your draft workout: {draftWorkout.title}</p>
            <button
              className="mt-3 rounded-md bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950"
              onClick={() => router.push(`/member/workouts/${draftWorkout.id}/log`)}
            >
              Resume workout
            </button>
          </section>
        ) : null}

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          <div>
            <label className="text-xs text-slate-400">Start from template</label>
            <select
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={templateId ?? ""}
              onChange={(event) => {
                const next = templates.find((template) => template.id === event.target.value);
                if (next) {
                  applyTemplate(next);
                } else {
                  setTemplateId(null);
                  setWorkoutTitle("Custom Workout");
                  setSelectedExercises([]);
                }
              }}
            >
              <option value="">Custom blank workout</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.title} ({template.owner_type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400">Workout title</label>
            <input
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={workoutTitle}
              onChange={(event) => setWorkoutTitle(event.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-slate-400">Add exercise</label>
            <div className="mt-2 flex gap-2">
              <select
                className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                onChange={(event) => {
                  if (event.target.value) {
                    addExercise(event.target.value);
                    event.target.value = "";
                  }
                }}
              >
                <option value="">Select exercise</option>
                {availableExercises.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400">Exercises</label>
            <div className="mt-2 space-y-2">
              {selectedExercises.map((exercise, index) => (
                <div key={`${exercise.id}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{exercise.name}</div>
                    <div className="text-xs text-slate-500">Order {index + 1}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200"
                      onClick={() => moveExercise(index, -1)}
                    >
                      Up
                    </button>
                    <button
                      className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200"
                      onClick={() => moveExercise(index, 1)}
                    >
                      Down
                    </button>
                    <button
                      className="rounded-md border border-rose-500/60 px-2 py-1 text-xs text-rose-200"
                      onClick={() => removeExercise(index)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {selectedExercises.length === 0 ? (
                <p className="text-xs text-slate-500">No exercises added yet.</p>
              ) : null}
            </div>
          </div>

          <button
            className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
            onClick={saveWorkout}
            disabled={saving || selectedExercises.length === 0}
          >
            {saving ? "Saving..." : "Save workout"}
          </button>
        </section>
      </main>
    </div>
  );
}

export default function WorkoutBuilderPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <WorkoutBuilderView />
    </QueryClientProvider>
  );
}
