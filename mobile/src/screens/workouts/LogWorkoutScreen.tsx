import { useEffect, useMemo, useState } from "react";
import { Button, ScrollView, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { deriveSetDisplayLabel } from "../../lib/workouts/helpers";
import { queueWorkoutLogs, syncPendingWorkoutLogs } from "../../lib/offline/workoutSync";

type WorkoutExerciseRow = {
  id: string;
  order_index: number;
  exercise: { id: string; name: string } | null;
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
  completed_at: string | null;
};

type Props = {
  workoutId: string;
};

export default function LogWorkoutScreen({ workoutId }: Props) {
  const [workout, setWorkout] = useState<WorkoutRow | null>(null);
  const [workoutExercises, setWorkoutExercises] = useState<WorkoutExerciseRow[]>([]);
  const [logs, setLogs] = useState<WorkoutLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const { data: workoutRow } = await supabase
        .from("workouts")
        .select("id, title, completed_at")
        .eq("id", workoutId)
        .maybeSingle();

      const { data: exerciseRows } = await supabase
        .from("workout_exercises")
        .select("id, order_index, exercise:exercises(id, name)")
        .eq("workout_id", workoutId)
        .order("order_index", { ascending: true });

      const { data: logRows } = await supabase
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
      setLoading(false);
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

    const { data, error } = await supabase.from("workout_logs").insert(payload).select("*").maybeSingle();

    if (error) {
      await queueWorkoutLogs([payload]);
      return;
    }

    if (data) {
      setLogs((prev) => [...prev, data as WorkoutLogRow]);
    }
  };

  const updateLog = async (logId: string, updates: Partial<WorkoutLogRow>) => {
    const { data, error } = await supabase.from("workout_logs").update(updates).eq("id", logId).select("*").maybeSingle();

    if (error) {
      return;
    }

    if (data) {
      setLogs((prev) => prev.map((log) => (log.id === logId ? (data as WorkoutLogRow) : log)));
    }
  };

  const completeWorkout = async () => {
    await supabase.from("workouts").update({ completed_at: new Date().toISOString() }).eq("id", workoutId);
    setWorkout((prev) => (prev ? { ...prev, completed_at: new Date().toISOString() } : prev));
  };

  const syncOfflineLogs = async () => {
    setSyncing(true);
    await syncPendingWorkoutLogs();
    setSyncing(false);
  };

  if (loading || !workout) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading workout...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>{workout.title}</Text>
      <Button title={workout.completed_at ? "Completed" : "Mark complete"} onPress={completeWorkout} />
      <Button title={syncing ? "Syncing..." : "Sync offline logs"} onPress={syncOfflineLogs} />

      {workoutExercises.map((workoutExercise) => {
        const exerciseLogs = logsByExercise.get(workoutExercise.id) ?? [];
        return (
          <View key={workoutExercise.id} style={{ marginTop: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: "600" }}>{workoutExercise.exercise?.name ?? "Exercise"}</Text>
            <Button title="Add set" onPress={() => addSet(workoutExercise.id)} />
            {exerciseLogs.map((log) => (
              <View key={log.id} style={{ marginTop: 8 }}>
                <Text>{deriveSetDisplayLabel(log.set_number)}</Text>
                <TextInput
                  placeholder="Reps"
                  value={log.reps?.toString() ?? ""}
                  onChangeText={(value) => updateLog(log.id, { reps: value ? Number(value) : null })}
                />
                <TextInput
                  placeholder="Weight"
                  value={log.weight?.toString() ?? ""}
                  onChangeText={(value) => updateLog(log.id, { weight: value ? Number(value) : null })}
                />
                <TextInput
                  placeholder="RPE"
                  value={log.rpe?.toString() ?? ""}
                  onChangeText={(value) => updateLog(log.id, { rpe: value ? Number(value) : null })}
                />
                <TextInput
                  placeholder="Notes"
                  value={log.notes ?? ""}
                  onChangeText={(value) => updateLog(log.id, { notes: value || null })}
                />
              </View>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}
