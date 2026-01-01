import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase";

const STORAGE_KEY = "pending_workout_logs";

type PendingLog = {
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

function generateTempId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function loadQueue() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [] as PendingLog[];
  try {
    return JSON.parse(raw) as PendingLog[];
  } catch {
    return [] as PendingLog[];
  }
}

async function saveQueue(queue: PendingLog[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

// Queue workout logs while offline (or when saving locally).
export async function queueWorkoutLogs(entries: Omit<PendingLog, "id">[]) {
  const queue = await loadQueue();
  const next = entries.map((entry) => ({ ...entry, id: generateTempId() }));
  await saveQueue([...queue, ...next]);
  return next;
}

function isDuplicateLog(existing: PendingLog, incoming: PendingLog) {
  return (
    existing.workout_exercise_id === incoming.workout_exercise_id &&
    existing.set_number === incoming.set_number &&
    existing.logged_at === incoming.logged_at
  );
}

// Sync pending logs when online. Prefers latest logged_at for conflicts.
export async function syncPendingWorkoutLogs() {
  const queue = await loadQueue();
  if (!queue.length) return { synced: 0, remaining: 0 };

  const grouped = queue.reduce<Record<string, PendingLog[]>>((acc, log) => {
    acc[log.workout_exercise_id] = acc[log.workout_exercise_id] ?? [];
    acc[log.workout_exercise_id].push(log);
    return acc;
  }, {});

  let synced = 0;
  const remaining: PendingLog[] = [];

  for (const [workoutExerciseId, logs] of Object.entries(grouped)) {
    const { data: existingLogs } = await supabase
      .from("workout_logs")
      .select("workout_exercise_id, set_number, logged_at")
      .eq("workout_exercise_id", workoutExerciseId);

    const existing = (existingLogs ?? []) as Array<Pick<PendingLog, "workout_exercise_id" | "set_number" | "logged_at">>;

    const deduped = logs.filter((log) => !existing.some((row) => isDuplicateLog(row as PendingLog, log)));

    const latestBySet = new Map<number, PendingLog>();
    deduped.forEach((log) => {
      const current = latestBySet.get(log.set_number);
      if (!current || new Date(log.logged_at) > new Date(current.logged_at)) {
        latestBySet.set(log.set_number, log);
      }
    });

    const payload = Array.from(latestBySet.values()).map((log) => ({
      workout_exercise_id: log.workout_exercise_id,
      set_number: log.set_number,
      reps: log.reps,
      weight: log.weight,
      weight_unit: log.weight_unit,
      rpe: log.rpe,
      notes: log.notes,
      logged_at: log.logged_at,
    }));

    if (!payload.length) continue;

    const { error } = await supabase.from("workout_logs").insert(payload);
    if (error) {
      remaining.push(...logs);
    } else {
      synced += payload.length;
    }
  }

  await saveQueue(remaining);
  return { synced, remaining: remaining.length };
}
