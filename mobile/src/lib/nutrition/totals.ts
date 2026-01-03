import { supabase } from "../supabase";

export async function recomputeDailyTotals(memberId: string, date: string) {
  const { error } = await supabase.rpc("recompute_nutrition_daily_totals", {
    p_member_id: memberId,
    p_date: date,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateTotalsAfterMealChange(mealId: string) {
  const { error } = await supabase.rpc("update_nutrition_totals_for_meal", {
    p_meal_id: mealId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

// Notes:
// - Totals are derived from meal_items and safe to recompute any time.
// - RPCs run under security definer; clients cannot write nutrition_daily_totals directly.
