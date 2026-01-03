import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { recomputeDailyTotals, updateTotalsAfterMealChange } from "../../lib/nutrition/totals";

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

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function MealLogScreen() {
  const [memberId, setMemberId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));
  const [meals, setMeals] = useState<Meal[]>([]);
  const [dailyTotals, setDailyTotals] = useState<DailyTotals | null>(null);
  const [newMealType, setNewMealType] = useState<Meal["meal_type"]>("BREAKFAST");
  const [newItemMealId, setNewItemMealId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState({
    name: "",
    calories: "",
    protein_g: "",
    carbs_g: "",
    fat_g: "",
  });

  useEffect(() => {
    const loadMember = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) return;
      const { data: member } = await supabase
        .from("members")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      setMemberId(member?.id ?? null);
    };

    loadMember();
  }, []);

  const loadMeals = useCallback(async () => {
    if (!memberId) return;
    const { data } = await supabase
      .from("meals")
      .select("id, meal_type, meal_date, logged_at, meal_items(id, name, calories, protein_g, carbs_g, fat_g, serving_size_label)")
      .eq("member_id", memberId)
      .eq("meal_date", selectedDate)
      .order("logged_at", { ascending: true });

    const { data: totals } = await supabase
      .from("nutrition_daily_totals")
      .select("calories, protein_g, carbs_g, fat_g")
      .eq("member_id", memberId)
      .eq("total_date", selectedDate)
      .maybeSingle();

    setMeals((data ?? []) as Meal[]);
    setDailyTotals((totals ?? null) as DailyTotals | null);
  }, [memberId, selectedDate]);

  useEffect(() => {
    loadMeals();
  }, [loadMeals]);

  const totalsLabel = useMemo(() => {
    if (!dailyTotals) return "No totals yet";
    return `${dailyTotals.calories} kcal · P ${dailyTotals.protein_g}g · C ${dailyTotals.carbs_g}g · F ${dailyTotals.fat_g}g`;
  }, [dailyTotals]);

  const resetItemForm = () => {
    setItemForm({ name: "", calories: "", protein_g: "", carbs_g: "", fat_g: "" });
  };

  const handleAddMeal = async () => {
    if (!memberId) return;
    const { data: meal } = await supabase
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
      await loadMeals();
    }
  };

  const handleAddItem = async (mealId: string) => {
    if (!itemForm.name.trim() || !itemForm.calories) return;
    await supabase.from("meal_items").insert({
      meal_id: mealId,
      name: itemForm.name.trim(),
      calories: Number(itemForm.calories),
      protein_g: itemForm.protein_g ? Number(itemForm.protein_g) : null,
      carbs_g: itemForm.carbs_g ? Number(itemForm.carbs_g) : null,
      fat_g: itemForm.fat_g ? Number(itemForm.fat_g) : null,
      serving_size_label: null,
      source: "MANUAL",
    });
    await updateTotalsAfterMealChange(mealId);
    resetItemForm();
    setNewItemMealId(null);
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
    });
  };

  const handleItemUpdate = async (mealId: string) => {
    if (!editingItemId) return;
    await supabase
      .from("meal_items")
      .update({
        name: itemForm.name.trim(),
        calories: Number(itemForm.calories),
        protein_g: itemForm.protein_g ? Number(itemForm.protein_g) : null,
        carbs_g: itemForm.carbs_g ? Number(itemForm.carbs_g) : null,
        fat_g: itemForm.fat_g ? Number(itemForm.fat_g) : null,
      })
      .eq("id", editingItemId);

    await updateTotalsAfterMealChange(mealId);
    resetItemForm();
    setEditingItemId(null);
    setNewItemMealId(null);
    await loadMeals();
  };

  const handleItemDelete = async (itemId: string, mealId: string) => {
    await supabase.from("meal_items").delete().eq("id", itemId);
    await updateTotalsAfterMealChange(mealId);
    await loadMeals();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Meal Log</Text>
      <Text style={styles.subtitle}>Track meals and keep macros aligned.</Text>

      <View style={styles.dateRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            const date = new Date(selectedDate);
            date.setDate(date.getDate() - 1);
            setSelectedDate(formatDate(date));
          }}
        >
          <Text style={styles.secondaryText}>Prev</Text>
        </TouchableOpacity>
        <Text style={styles.dateLabel}>{selectedDate}</Text>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            const date = new Date(selectedDate);
            date.setDate(date.getDate() + 1);
            setSelectedDate(formatDate(date));
          }}
        >
          <Text style={styles.secondaryText}>Next</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.totalsCard}>
        <Text style={styles.totalsLabel}>Daily totals</Text>
        <Text style={styles.totalsValue}>{totalsLabel}</Text>
      </View>

      <View style={styles.mealRow}>
        {MEAL_TYPES.map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.typeChip, newMealType === type && styles.typeChipActive]}
            onPress={() => setNewMealType(type)}
          >
            <Text style={styles.typeChipText}>{type}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.primaryButton} onPress={handleAddMeal}>
          <Text style={styles.primaryText}>Add meal</Text>
        </TouchableOpacity>
      </View>

      {meals.length === 0 ? (
        <Text style={styles.emptyText}>No meals logged yet.</Text>
      ) : (
        meals.map((meal) => (
          <View key={meal.id} style={styles.mealCard}>
            <View style={styles.mealHeader}>
              <Text style={styles.mealTitle}>{meal.meal_type}</Text>
              <TouchableOpacity
                onPress={() => {
                  setNewItemMealId(meal.id);
                  setEditingItemId(null);
                  resetItemForm();
                }}
              >
                <Text style={styles.linkText}>Add item</Text>
              </TouchableOpacity>
            </View>

            {(meal.meal_items ?? []).map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemMeta}>
                    {item.calories} kcal · P {item.protein_g ?? 0}g · C {item.carbs_g ?? 0}g · F {item.fat_g ?? 0}g
                  </Text>
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity onPress={() => handleItemEdit(item, meal.id)}>
                    <Text style={styles.linkText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleItemDelete(item.id, meal.id)}>
                    <Text style={styles.dangerText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {newItemMealId === meal.id ? (
              <View style={styles.formCard}>
                <TextInput
                  style={styles.input}
                  placeholder="Name"
                  placeholderTextColor="#64748B"
                  value={itemForm.name}
                  onChangeText={(text) => setItemForm({ ...itemForm, name: text })}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Calories"
                  placeholderTextColor="#64748B"
                  keyboardType="numeric"
                  value={itemForm.calories}
                  onChangeText={(text) => setItemForm({ ...itemForm, calories: text })}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Protein (g)"
                  placeholderTextColor="#64748B"
                  keyboardType="numeric"
                  value={itemForm.protein_g}
                  onChangeText={(text) => setItemForm({ ...itemForm, protein_g: text })}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Carbs (g)"
                  placeholderTextColor="#64748B"
                  keyboardType="numeric"
                  value={itemForm.carbs_g}
                  onChangeText={(text) => setItemForm({ ...itemForm, carbs_g: text })}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Fat (g)"
                  placeholderTextColor="#64748B"
                  keyboardType="numeric"
                  value={itemForm.fat_g}
                  onChangeText={(text) => setItemForm({ ...itemForm, fat_g: text })}
                />
                <View style={styles.formActions}>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => (editingItemId ? handleItemUpdate(meal.id) : handleAddItem(meal.id))}
                  >
                    <Text style={styles.primaryText}>{editingItemId ? "Save" : "Add"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => {
                      resetItemForm();
                      setEditingItemId(null);
                      setNewItemMealId(null);
                    }}
                  >
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020617" },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: "700", color: "#F8FAFC" },
  subtitle: { fontSize: 14, color: "#94A3B8" },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dateLabel: { color: "#E2E8F0", fontSize: 14 },
  totalsCard: { backgroundColor: "#0F172A", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#1E293B" },
  totalsLabel: { fontSize: 12, color: "#94A3B8" },
  totalsValue: { fontSize: 14, color: "#E2E8F0", marginTop: 4 },
  mealRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  typeChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: "#334155" },
  typeChipActive: { backgroundColor: "#1E293B" },
  typeChipText: { color: "#E2E8F0", fontSize: 12 },
  primaryButton: { backgroundColor: "#10B981", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  primaryText: { color: "#0F172A", fontWeight: "700" },
  secondaryButton: { borderWidth: 1, borderColor: "#334155", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10 },
  secondaryText: { color: "#E2E8F0", fontWeight: "600" },
  emptyText: { color: "#64748B", fontSize: 14 },
  mealCard: { backgroundColor: "#0F172A", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#1E293B" },
  mealHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mealTitle: { color: "#E2E8F0", fontSize: 16, fontWeight: "600" },
  linkText: { color: "#38BDF8", fontSize: 12 },
  itemRow: { marginTop: 8, flexDirection: "row", justifyContent: "space-between", gap: 8 },
  itemName: { color: "#E2E8F0", fontWeight: "600" },
  itemMeta: { color: "#94A3B8", fontSize: 12 },
  itemActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  dangerText: { color: "#F87171", fontSize: 12 },
  formCard: { marginTop: 12, gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    color: "#E2E8F0",
  },
  formActions: { flexDirection: "row", gap: 8 },
});
