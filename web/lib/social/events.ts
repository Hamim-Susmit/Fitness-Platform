import { supabaseBrowser } from "../supabase-browser";

export type FeedVisibility = "PUBLIC" | "FRIENDS_ONLY" | "PRIVATE";

const STORAGE_KEY = "defaultFeedVisibility";

function getStoredVisibility(): FeedVisibility {
  if (typeof window === "undefined") return "FRIENDS_ONLY";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "PUBLIC" || stored === "FRIENDS_ONLY" || stored === "PRIVATE") {
    return stored;
  }
  return "FRIENDS_ONLY";
}

export function setDefaultFeedVisibility(value: FeedVisibility) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, value);
}

async function publishEvent(
  memberId: string,
  eventType: string,
  relatedId: string | null,
  payload: Record<string, unknown>,
  visibility?: FeedVisibility
) {
  const { data: existing } = await supabaseBrowser
    .from("activity_feed_events")
    .select("id")
    .eq("member_id", memberId)
    .eq("event_type", eventType)
    .eq("related_id", relatedId)
    .maybeSingle();

  if (existing) return false;

  const { error } = await supabaseBrowser.from("activity_feed_events").insert({
    member_id: memberId,
    event_type: eventType,
    related_id: relatedId,
    payload_json: payload,
    visibility: visibility ?? getStoredVisibility(),
  });

  return !error;
}

export async function publishWorkoutEvent(memberId: string, workoutId: string, visibility?: FeedVisibility) {
  const { data: workout } = await supabaseBrowser
    .from("workouts")
    .select("title, completed_at")
    .eq("id", workoutId)
    .maybeSingle();

  return publishEvent(
    memberId,
    "WORKOUT_COMPLETED",
    workoutId,
    {
      title: workout?.title ?? "Workout completed",
      completed_at: workout?.completed_at ?? new Date().toISOString(),
    },
    visibility
  );
}

export async function publishAchievementEvent(memberId: string, achievementId: string, visibility?: FeedVisibility) {
  const { data: achievement } = await supabaseBrowser
    .from("achievements")
    .select("title, description")
    .eq("id", achievementId)
    .maybeSingle();

  return publishEvent(
    memberId,
    "ACHIEVEMENT_EARNED",
    achievementId,
    {
      title: achievement?.title ?? "Achievement earned",
      description: achievement?.description ?? "",
    },
    visibility
  );
}

export async function publishGoalCompletedEvent(memberId: string, goalId: string, visibility?: FeedVisibility) {
  const { data: goal } = await supabaseBrowser
    .from("goals")
    .select("title, metric_key")
    .eq("id", goalId)
    .maybeSingle();

  return publishEvent(
    memberId,
    "GOAL_COMPLETED",
    goalId,
    {
      title: goal?.title ?? "Goal completed",
      metric: goal?.metric_key ?? "",
    },
    visibility
  );
}

export async function publishCheckinEvent(memberId: string, checkinId: string, visibility?: FeedVisibility) {
  const { data: checkin } = await supabaseBrowser
    .from("checkins")
    .select("gym_id, checked_in_at")
    .eq("id", checkinId)
    .maybeSingle();

  return publishEvent(
    memberId,
    "CHECKIN",
    checkinId,
    {
      gym_id: checkin?.gym_id ?? null,
      checked_in_at: checkin?.checked_in_at ?? new Date().toISOString(),
    },
    visibility
  );
}
