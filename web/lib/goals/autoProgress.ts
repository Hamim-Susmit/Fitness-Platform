import { supabaseBrowser } from "../supabase-browser";

type AutoProgressMapping = {
  exercise_id: string;
  metric_key: string;
};

type ProgressEntryInput = {
  goal_id: string;
  value: number;
  source: "PR_EVENT" | "WORKOUT";
  recorded_at: string;
  note?: string | null;
};

// Append goal progress from PRs or workout logs without overwriting manual entries.
export async function appendAutoProgressEntries(entries: ProgressEntryInput[]) {
  if (!entries.length) return [];
  const { data, error } = await supabaseBrowser
    .from("goal_progress_entries")
    .insert(
      entries.map((entry) => ({
        goal_id: entry.goal_id,
        value: entry.value,
        source: entry.source,
        recorded_at: entry.recorded_at,
        note: entry.note ?? null,
      }))
    )
    .select("id, goal_id");

  if (error) {
    throw new Error(`Failed to append auto progress: ${error.message}`);
  }

  return data ?? [];
}

// Update strength goals from PR events by matching metric_key.
export async function updateGoalsFromPrs(memberId: string, prs: { exercise_id: string; pr_type: string; value: number; achieved_at: string }[], mapping: AutoProgressMapping[]) {
  if (!prs.length) return [];

  const { data: goals } = await supabaseBrowser
    .from("goals")
    .select("id, metric_key")
    .eq("member_id", memberId)
    .eq("goal_type", "STRENGTH")
    .eq("status", "ACTIVE");

  const goalMap = new Map((goals ?? []).map((goal) => [goal.metric_key, goal.id]));
  const mappedEntries: ProgressEntryInput[] = [];

  prs.forEach((pr) => {
    const mappingEntry = mapping.find((entry) => entry.exercise_id === pr.exercise_id);
    if (!mappingEntry) return;
    const goalId = goalMap.get(mappingEntry.metric_key);
    if (!goalId) return;
    mappedEntries.push({
      goal_id: goalId,
      value: pr.value,
      source: "PR_EVENT",
      recorded_at: pr.achieved_at,
      note: `${pr.pr_type} PR`,
    });
  });

  return appendAutoProgressEntries(mappedEntries);
}

// Update endurance goals from workout logs (distance/time metrics) using provided mapping.
export async function updateGoalsFromWorkoutLogs(
  memberId: string,
  logs: { metric_key: string; value: number; logged_at: string }[]
) {
  if (!logs.length) return [];

  const { data: goals } = await supabaseBrowser
    .from("goals")
    .select("id, metric_key")
    .eq("member_id", memberId)
    .eq("goal_type", "ENDURANCE")
    .eq("status", "ACTIVE");

  const goalMap = new Map((goals ?? []).map((goal) => [goal.metric_key, goal.id]));
  const entries: ProgressEntryInput[] = logs
    .map((log) => ({
      goal_id: goalMap.get(log.metric_key),
      value: log.value,
      source: "WORKOUT" as const,
      recorded_at: log.logged_at,
    }))
    .filter((entry) => !!entry.goal_id) as ProgressEntryInput[];

  return appendAutoProgressEntries(entries);
}
