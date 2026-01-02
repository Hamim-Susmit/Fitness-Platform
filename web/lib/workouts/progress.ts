import { supabaseBrowser } from "../supabase-browser";
import { WorkoutLogSchema, WorkoutPrSchema } from "../types/workouts";
import { z } from "zod";

type HistoryRange = {
  from: string;
  to: string;
};

type ExerciseHistoryEntry = {
  logged_at: string;
  reps: number | null;
  weight: number | null;
  weight_unit: string | null;
  rpe: number | null;
};

const historySchema = z.array(
  z.object({
    logged_at: z.string(),
    reps: z.number().nullable(),
    weight: z.number().nullable(),
    weight_unit: z.string().nullable(),
    rpe: z.number().nullable(),
  })
);

function estimateOneRepMax(weight: number, reps: number) {
  return weight * (1 + reps / 30);
}

// Fetch exercise history within a date range for charts and progress snapshots.
export async function getExerciseHistory(memberId: string, exerciseId: string, range: HistoryRange) {
  const { data, error } = await supabaseBrowser
    .from("workout_logs")
    .select("logged_at, reps, weight, weight_unit, rpe, workout_exercises!inner(exercise_id, workouts!inner(member_id))")
    .eq("workout_exercises.exercise_id", exerciseId)
    .eq("workout_exercises.workouts.member_id", memberId)
    .gte("logged_at", range.from)
    .lte("logged_at", range.to)
    .order("logged_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load history: ${error.message}`);
  }

  const trimmed = (data ?? []).map((row) => ({
    logged_at: row.logged_at,
    reps: row.reps,
    weight: row.weight,
    weight_unit: row.weight_unit,
    rpe: row.rpe,
  }));

  const parsed = historySchema.safeParse(trimmed);
  if (!parsed.success) {
    throw new Error("Invalid history payload returned.");
  }

  return parsed.data as ExerciseHistoryEntry[];
}

// Detect PRs for a workout by comparing log entries to existing PR table.
export async function detectPRsForWorkout(workoutId: string) {
  const { data: logs, error } = await supabaseBrowser
    .from("workout_logs")
    .select("id, reps, weight, logged_at, workout_exercises!inner(exercise_id, workouts!inner(member_id))")
    .eq("workout_exercises.workout_id", workoutId);

  if (error) {
    throw new Error(`Failed to load workout logs: ${error.message}`);
  }

  if (!logs || logs.length === 0) return [];

  const memberId = logs[0].workout_exercises.workouts.member_id as string;

  const { data: existingPrs } = await supabaseBrowser
    .from("workout_prs")
    .select("id, member_id, exercise_id, pr_type, value, achieved_at")
    .eq("member_id", memberId);

  const parsedPrs = z.array(WorkoutPrSchema).safeParse(existingPrs ?? []);
  const prsByKey = new Map<string, number>();
  if (parsedPrs.success) {
    parsedPrs.data.forEach((pr) => {
      prsByKey.set(`${pr.exercise_id}:${pr.pr_type}`, pr.value);
    });
  }

  const newRecords: { member_id: string; exercise_id: string; pr_type: string; value: number; achieved_at: string }[] = [];

  logs.forEach((row) => {
    const exerciseId = row.workout_exercises.exercise_id as string;
    const reps = row.reps ?? 0;
    const weight = row.weight ?? 0;
    const achievedAt = row.logged_at;

    if (weight > 0) {
      const maxWeightKey = `${exerciseId}:MAX_WEIGHT`;
      if (weight > (prsByKey.get(maxWeightKey) ?? 0)) {
        prsByKey.set(maxWeightKey, weight);
        newRecords.push({ member_id: memberId, exercise_id: exerciseId, pr_type: "MAX_WEIGHT", value: weight, achieved_at: achievedAt });
      }
    }

    if (reps > 0) {
      const maxRepsKey = `${exerciseId}:MAX_REPS`;
      if (reps > (prsByKey.get(maxRepsKey) ?? 0)) {
        prsByKey.set(maxRepsKey, reps);
        newRecords.push({ member_id: memberId, exercise_id: exerciseId, pr_type: "MAX_REPS", value: reps, achieved_at: achievedAt });
      }
    }

    if (weight > 0 && reps > 0) {
      const estimated = estimateOneRepMax(weight, reps);
      const oneRmKey = `${exerciseId}:1RM`;
      if (estimated > (prsByKey.get(oneRmKey) ?? 0)) {
        prsByKey.set(oneRmKey, estimated);
        newRecords.push({ member_id: memberId, exercise_id: exerciseId, pr_type: "1RM", value: estimated, achieved_at: achievedAt });
      }
    }
  });

  return newRecords;
}

// Update the PR table with new records (requires privileged execution).
export async function updatePRTable(records: Array<Omit<z.infer<typeof WorkoutPrSchema>, "id">>) {
  if (!records.length) return [];

  const { data, error } = await supabaseBrowser.from("workout_prs").insert(records).select("*");

  if (error) {
    throw new Error(`Failed to update PR table: ${error.message}`);
  }

  const parsed = z.array(WorkoutPrSchema).safeParse(data ?? []);
  if (!parsed.success) {
    throw new Error("Invalid PR payload returned.");
  }

  return parsed.data;
}
