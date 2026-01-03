import { supabaseBrowser } from "../supabase-browser";

type StreakRow = {
  id: string;
  streak_type: string;
  current_count: number;
  longest_count: number;
  last_event_at: string | null;
};

export async function computeStreakStatus(memberId: string) {
  const { data, error } = await supabaseBrowser
    .from("streaks")
    .select("id, streak_type, current_count, longest_count, last_event_at")
    .eq("member_id", memberId);

  if (error) {
    throw new Error(`Failed to load streaks: ${error.message}`);
  }

  return (data ?? []) as StreakRow[];
}
