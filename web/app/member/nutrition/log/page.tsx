"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore, useToastStore } from "../../../../lib/auth";
import { roleRedirectPath } from "../../../../lib/roles";
import { supabaseBrowser } from "../../../../lib/supabase-browser";
import { recomputeDailyTotals, updateTotalsAfterMealChange } from "../../../../lib/nutrition/totals";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type MealItem = {
  id: string;
  name: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  serving_size_label: string | null;
};

type Meal = {
  id: string;
  meal_type: "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
  meal_date: string;
  logged_at: string;
  meal_items?: MealItem[];
};

type DailyTotals = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

const MEAL_TYPES: Meal["meal_type"][] = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"];

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function MemberMealLogView() {
  const { session, role, loading } = useAuthStore();
  const { message, status, setToast } = useToastStore();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(formatDateInput(new Date()));
  const [meals, setMeals] = useState<Meal[]>([]);
  const [dailyTotals, setDailyTotals] = useState<DailyTotals | null>(null);
  const [newMealType, setNewMealType] = useState<Meal["meal_type"]>("BREAKFAST");
  const [loadingData, setLoadingData] = useState(true);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState({
    name: "",
    calories: "",
    protein_g: "",
    carbs_g: "",
    fat_g: "",
    serving_size_label: "",
  });
  const [newItemMealId, setNewItemMealId] = useState<string | null>(null);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      window.location.href = roleRedirectPath(role);
    }
  }, [loading, role, session]);

  useEffect(() => {
    const loadMember = async () => {
      if (!session?.user?.id) return;
      const { data: member } = await supabaseBrowser
        .from("members")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      setMemberId(member?.id ?? null);
    };

    loadMember();
  }, [session?.user?.id]);

  const loadMeals = useCallback(async () => {
    if (!memberId) return;
    setLoadingData(true);
    const { data: mealRows } = await supabaseBrowser
      .from("meals")
      .select("id, meal_type, meal_date, logged_at, meal_items(id, name, calories, protein_g, carbs_g, fat_g, serving_size_label)")
      .eq("member_id", memberId)
      .eq("meal_date", selectedDate)
      .order("logged_at", { ascending: true });

    setMeals((mealRows ?? []) as Meal[]);

    const { data: totals } = await supabaseBrowser
      .from("nutrition_daily_totals")
      .select("calories, protein_g, carbs_g, fat_g")
      .eq("member_id", memberId)
      .eq("total_date", selectedDate)
      .maybeSingle();

    setDailyTotals((totals ?? null) as DailyTotals | null);
    setLoadingData(false);
  }, [memberId, selectedDate]);

  useEffect(() => {
    loadMeals();
  }, [loadMeals]);

  const totalsLabel = useMemo(() => {
    if (!dailyTotals) return "No totals yet";
    return `${dailyTotals.calories} kcal · P ${dailyTotals.protein_g}g · C ${dailyTotals.carbs_g}g · F ${dailyTotals.fat_g}g`;
  }, [dailyTotals]);

  const resetItemForm = () => {
    setItemForm({
      name: "",
      calories: "",
      protein_g: "",
      carbs_g: "",
      fat_g: "",
      serving_size_label: "",
    });
  };

  const handleAddMeal = async () => {
    if (!memberId) return;
    const { data: meal } = await supabaseBrowser
      .from("meals")
      .insert({
        member_id: memberId,
        meal_type: newMealType,
        meal_date: selectedDate,
      })
      .select("id, meal_type, meal_date, logged_at")
      .maybeSingle();

    if (meal) {
      await recomputeDailyTotals(memberId, selectedDate);
      setToast("Meal added", "success");
      await loadMeals();
    }
  };

  const handleAddItem = async (mealId: string) => {
    if (!itemForm.name.trim() || !itemForm.calories) return;
    const payload = {
      meal_id: mealId,
      name: itemForm.name.trim(),
      calories: Number(itemForm.calories),
      protein_g: itemForm.protein_g ? Number(itemForm.protein_g) : null,
      carbs_g: itemForm.carbs_g ? Number(itemForm.carbs_g) : null,
      fat_g: itemForm.fat_g ? Number(itemForm.fat_g) : null,
      serving_size_label: itemForm.serving_size_label || null,
      source: "MANUAL",
    };

    await supabaseBrowser.from("meal_items").insert(payload);
    await updateTotalsAfterMealChange(mealId);
    resetItemForm();
    setNewItemMealId(null);
    setToast("Item added", "success");
    await loadMeals();
  };

  const handleItemEdit = (item: MealItem, mealId: string) => {
    setEditingItemId(item.id);
    setNewItemMealId(mealId);
    setItemForm({
      name: item.name,
      calories: item.calories.toString(),
      protein_g: item.protein_g?.toString() ?? "",
      carbs_g: item.carbs_g?.toString() ?? "",
      fat_g: item.fat_g?.toString() ?? "",
      serving_size_label: item.serving_size_label ?? "",
    });
  };

  const handleItemUpdate = async (mealId: string) => {
    if (!editingItemId) return;
    await supabaseBrowser
      .from("meal_items")
      .update({
        name: itemForm.name.trim(),
        calories: Number(itemForm.calories),
        protein_g: itemForm.protein_g ? Number(itemForm.protein_g) : null,
        carbs_g: itemForm.carbs_g ? Number(itemForm.carbs_g) : null,
        fat_g: itemForm.fat_g ? Number(itemForm.fat_g) : null,
        serving_size_label: itemForm.serving_size_label || null,
      })
      .eq("id", editingItemId);

    await updateTotalsAfterMealChange(mealId);
    resetItemForm();
    setEditingItemId(null);
    setNewItemMealId(null);
    setToast("Item updated", "success");
    await loadMeals();
  };

  const handleItemDelete = async (itemId: string, mealId: string) => {
    await supabaseBrowser.from("meal_items").delete().eq("id", itemId);
    await updateTotalsAfterMealChange(mealId);
    setToast("Item removed", "success");
    await loadMeals();
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        {message ? (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              status === "success" ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"
            }`}
          >
            {message}
          </div>
        ) : null}
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Meal Log</h1>
          <p className="text-sm text-slate-400">Track meals and keep macros aligned with your nutrition plan.</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div>
            <label className="block text-xs text-slate-400">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400">Daily totals</label>
            <div className="mt-1 text-sm text-slate-200">{totalsLabel}</div>
          </div>
        </div>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={newMealType}
              onChange={(event) => setNewMealType(event.target.value as Meal["meal_type"])}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {MEAL_TYPES.map((mealType) => (
                <option key={mealType} value={mealType}>
                  {mealType}
                </option>
              ))}
            </select>
            <button className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold" onClick={handleAddMeal}>
              Add meal
            </button>
          </div>

          {meals.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
              No meals logged yet for this date.
            </div>
          ) : (
            meals.map((meal) => (
              <div key={meal.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{meal.meal_type}</h2>
                    <p className="text-xs text-slate-500">Logged at {new Date(meal.logged_at).toLocaleTimeString()}</p>
                  </div>
                  <button
                    className="text-sm text-sky-300"
                    onClick={() => {
                      setNewItemMealId(meal.id);
                      setEditingItemId(null);
                      resetItemForm();
                    }}
                  >
                    Add item
                  </button>
                </div>

                <div className="space-y-3">
                  {(meal.meal_items ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500">No items logged yet.</p>
                  ) : (
                    meal.meal_items?.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-800 p-3">
                        <div>
                          <div className="font-semibold">{item.name}</div>
                          <div className="text-xs text-slate-400">
                            {item.calories} kcal · P {item.protein_g ?? 0}g · C {item.carbs_g ?? 0}g · F {item.fat_g ?? 0}g
                          </div>
                        </div>
                        <div className="flex gap-3 text-sm">
                          <button className="text-emerald-300" onClick={() => handleItemEdit(item, meal.id)}>
                            Edit
                          </button>
                          <button className="text-rose-300" onClick={() => handleItemDelete(item.id, meal.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {newItemMealId === meal.id ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 space-y-3">
                    <div className="text-sm text-slate-300">
                      {editingItemId ? "Edit item" : "Add item"}
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        placeholder="Name"
                        value={itemForm.name}
                        onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })}
                      />
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        placeholder="Calories"
                        type="number"
                        value={itemForm.calories}
                        onChange={(event) => setItemForm({ ...itemForm, calories: event.target.value })}
                      />
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        placeholder="Serving size"
                        value={itemForm.serving_size_label}
                        onChange={(event) => setItemForm({ ...itemForm, serving_size_label: event.target.value })}
                      />
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        placeholder="Protein (g)"
                        type="number"
                        value={itemForm.protein_g}
                        onChange={(event) => setItemForm({ ...itemForm, protein_g: event.target.value })}
                      />
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        placeholder="Carbs (g)"
                        type="number"
                        value={itemForm.carbs_g}
                        onChange={(event) => setItemForm({ ...itemForm, carbs_g: event.target.value })}
                      />
                      <input
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        placeholder="Fat (g)"
                        type="number"
                        value={itemForm.fat_g}
                        onChange={(event) => setItemForm({ ...itemForm, fat_g: event.target.value })}
                      />
                    </div>
                    <div className="flex gap-3">
                      <button
                        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold"
                        onClick={() => (editingItemId ? handleItemUpdate(meal.id) : handleAddItem(meal.id))}
                      >
                        {editingItemId ? "Save" : "Add"}
                      </button>
                      <button
                        className="rounded-md border border-slate-700 px-4 py-2 text-sm"
                        onClick={() => {
                          resetItemForm();
                          setEditingItemId(null);
                          setNewItemMealId(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}

export default function MemberMealLogPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemberMealLogView />
    </QueryClientProvider>
  );
}
