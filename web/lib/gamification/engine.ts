import { supabaseBrowser } from "../supabase-browser";
import { publishAchievementEvent, publishWorkoutEvent, publishGoalCompletedEvent } from "../social/events";

const WORKOUT_THRESHOLDS = [1, 10, 50];
const CHECKIN_THRESHOLDS = [10, 100];
const STREAK_THRESHOLDS = [7, 30];

function startOfDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function daysBetween(a: Date, b: Date) {
  const delta = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(delta / (1000 * 60 * 60 * 24));
}

async function updateStreak(memberId: string, streakType: "CHECKINS" | "WORKOUTS", eventAt: string) {
  const { data: streakRow } = await supabaseBrowser
    .from("streaks")
    .select("id, current_count, longest_count, last_event_at")
    .eq("member_id", memberId)
    .eq("streak_type", streakType)
    .maybeSingle();

  const eventDate = new Date(eventAt);
  let current = streakRow?.current_count ?? 0;
  let longest = streakRow?.longest_count ?? 0;
  const lastEvent = streakRow?.last_event_at ? new Date(streakRow.last_event_at) : null;

  if (lastEvent) {
    const diff = daysBetween(lastEvent, eventDate);
    if (diff === 0) {
      return { current, longest };
    }
    current = diff === 1 ? current + 1 : 1;
  } else {
    current = 1;
  }

  longest = Math.max(longest, current);

  if (streakRow?.id) {
    await supabaseBrowser
      .from("streaks")
      .update({ current_count: current, longest_count: longest, last_event_at: eventAt })
      .eq("id", streakRow.id);
  } else {
    await supabaseBrowser
      .from("streaks")
      .insert({ member_id: memberId, streak_type: streakType, current_count: current, longest_count: longest, last_event_at: eventAt });
  }

  return { current, longest };
}

export async function awardAchievement(memberId: string, achievementCode: string, context?: Record<string, unknown>) {
  const { data: achievement } = await supabaseBrowser
    .from("achievements")
    .select("id")
    .eq("code", achievementCode)
    .eq("is_active", true)
    .maybeSingle();

  if (!achievement) return false;

  const { data: existing } = await supabaseBrowser
    .from("member_achievements")
    .select("id")
    .eq("member_id", memberId)
    .eq("achievement_id", achievement.id)
    .maybeSingle();

  if (existing) return false;

  const { error } = await supabaseBrowser.from("member_achievements").insert({
    member_id: memberId,
    achievement_id: achievement.id,
    source: "SYSTEM",
    context_json: context ?? null,
  });

  if (!error) {
    await publishAchievementEvent(memberId, achievement.id);
  }

  return !error;
}

export async function evaluateWorkoutEvent(memberId: string, workoutId: string) {
  const { count } = await supabaseBrowser
    .from("workouts")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .not("completed_at", "is", null);

  const workoutCount = count ?? 0;
  for (const threshold of WORKOUT_THRESHOLDS) {
    if (workoutCount >= threshold) {
      await awardAchievement(memberId, `WORKOUT_${threshold}`, { workout_id: workoutId });
    }
  }

  await publishWorkoutEvent(memberId, workoutId);

  const streak = await updateStreak(memberId, "WORKOUTS", new Date().toISOString());
  for (const threshold of STREAK_THRESHOLDS) {
    if (streak.current >= threshold) {
      await awardAchievement(memberId, `STREAK_${threshold}`, { streak_type: "WORKOUTS" });
    }
  }
}

export async function evaluateCheckinEvent(memberId: string) {
  const { count } = await supabaseBrowser
    .from("checkins")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId);

  const total = count ?? 0;
  for (const threshold of CHECKIN_THRESHOLDS) {
    if (total >= threshold) {
      await awardAchievement(memberId, `CHECKIN_${threshold}`, { count: total });
    }
  }

  const streak = await updateStreak(memberId, "CHECKINS", new Date().toISOString());
  for (const threshold of STREAK_THRESHOLDS) {
    if (streak.current >= threshold) {
      await awardAchievement(memberId, `STREAK_${threshold}`, { streak_type: "CHECKINS" });
    }
  }
}

export async function evaluateGoalEvent(memberId: string, goalId: string) {
  await awardAchievement(memberId, "GOAL_COMPLETE", { goal_id: goalId });
  await publishGoalCompletedEvent(memberId, goalId);
}
