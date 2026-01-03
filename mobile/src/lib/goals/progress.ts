export type GoalRecord = {
  id: string;
  target_value: number;
  start_value: number | null;
  current_value: number | null;
  status: string;
};

export type GoalProgressEntry = {
  value: number;
  recorded_at: string;
  source: string;
};

export function computeGoalProgress(goal: GoalRecord, entries: GoalProgressEntry[]) {
  if (goal.status !== "ACTIVE") {
    return { percent: 100, current: goal.current_value ?? goal.target_value };
  }

  const sorted = [...entries].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
  const startValue = goal.start_value ?? sorted[0]?.value ?? 0;
  const latestValue = sorted[sorted.length - 1]?.value ?? goal.current_value ?? startValue;
  const delta = goal.target_value - startValue;
  const progress = delta === 0 ? 100 : ((latestValue - startValue) / delta) * 100;

  return {
    percent: Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0)),
    current: latestValue,
  };
}
