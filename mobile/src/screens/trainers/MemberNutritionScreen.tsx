import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";

type NutritionPlan = {
  id: string;
  title: string;
  description: string | null;
  daily_calorie_target: number | null;
  protein_target_g: number | null;
  carbs_target_g: number | null;
  fat_target_g: number | null;
  status: "ACTIVE" | "ARCHIVED";
  visibility: "PRIVATE" | "SHARED_WITH_TRAINER";
};

type DailyTotals = {
  total_date: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type TrainerRow = { id: string };

type Props = { memberId: string };

export function MemberNutritionScreen({ memberId }: Props) {
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [plans, setPlans] = useState<NutritionPlan[]>([]);
  const [totals, setTotals] = useState<DailyTotals[]>([]);
  const [planForm, setPlanForm] = useState({
    title: "",
    description: "",
    daily_calorie_target: "",
    protein_target_g: "",
    carbs_target_g: "",
    fat_target_g: "",
  });

  useEffect(() => {
    const loadTrainer = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) return;
      const { data: trainerRow } = await supabase
        .from("personal_trainers")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      setTrainer(trainerRow as TrainerRow | null);
    };

    loadTrainer();
  }, []);

  useEffect(() => {
    const loadData = async () => {
      if (!memberId || !trainer) return;
      const { data: planRows } = await supabase
        .from("nutrition_plans")
        .select("id, title, description, daily_calorie_target, protein_target_g, carbs_target_g, fat_target_g, status, visibility")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false });

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 6);
      const { data: totalsRows } = await supabase
        .from("nutrition_daily_totals")
        .select("total_date, calories, protein_g, carbs_g, fat_g")
        .eq("member_id", memberId)
        .gte("total_date", startDate.toISOString().slice(0, 10))
        .lte("total_date", endDate.toISOString().slice(0, 10))
        .order("total_date", { ascending: true });

      setPlans((planRows ?? []) as NutritionPlan[]);
      setTotals((totalsRows ?? []) as DailyTotals[]);
    };

    loadData();
  }, [memberId, trainer]);

  const handlePlanCreate = async () => {
    if (!trainer || !planForm.title.trim()) return;
    const { data } = await supabase
      .from("nutrition_plans")
      .insert({
        member_id: memberId,
        created_by: (await supabase.auth.getUser()).data.user?.id,
        title: planForm.title.trim(),
        description: planForm.description || null,
        daily_calorie_target: planForm.daily_calorie_target ? Number(planForm.daily_calorie_target) : null,
        protein_target_g: planForm.protein_target_g ? Number(planForm.protein_target_g) : null,
        carbs_target_g: planForm.carbs_target_g ? Number(planForm.carbs_target_g) : null,
        fat_target_g: planForm.fat_target_g ? Number(planForm.fat_target_g) : null,
        status: "ACTIVE",
        visibility: "SHARED_WITH_TRAINER",
      })
      .select("id, title, description, daily_calorie_target, protein_target_g, carbs_target_g, fat_target_g, status, visibility")
      .maybeSingle();

    if (data) {
      setPlans((prev) => [data as NutritionPlan, ...prev]);
      setPlanForm({
        title: "",
        description: "",
        daily_calorie_target: "",
        protein_target_g: "",
        carbs_target_g: "",
        fat_target_g: "",
      });
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Client Nutrition</Text>
      <Text style={styles.subtitle}>Create shared plans and review daily totals.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create plan</Text>
        <TextInput
          style={styles.input}
          placeholder="Plan title"
          placeholderTextColor="#64748B"
          value={planForm.title}
          onChangeText={(text) => setPlanForm({ ...planForm, title: text })}
        />
        <TextInput
          style={styles.input}
          placeholder="Daily calories"
          placeholderTextColor="#64748B"
          keyboardType="numeric"
          value={planForm.daily_calorie_target}
          onChangeText={(text) => setPlanForm({ ...planForm, daily_calorie_target: text })}
        />
        <TextInput
          style={styles.input}
          placeholder="Protein (g)"
          placeholderTextColor="#64748B"
          keyboardType="numeric"
          value={planForm.protein_target_g}
          onChangeText={(text) => setPlanForm({ ...planForm, protein_target_g: text })}
        />
        <TextInput
          style={styles.input}
          placeholder="Carbs (g)"
          placeholderTextColor="#64748B"
          keyboardType="numeric"
          value={planForm.carbs_target_g}
          onChangeText={(text) => setPlanForm({ ...planForm, carbs_target_g: text })}
        />
        <TextInput
          style={styles.input}
          placeholder="Fat (g)"
          placeholderTextColor="#64748B"
          keyboardType="numeric"
          value={planForm.fat_target_g}
          onChangeText={(text) => setPlanForm({ ...planForm, fat_target_g: text })}
        />
        <TextInput
          style={styles.input}
          placeholder="Short description"
          placeholderTextColor="#64748B"
          value={planForm.description}
          onChangeText={(text) => setPlanForm({ ...planForm, description: text })}
        />
        <TouchableOpacity style={styles.primaryButton} onPress={handlePlanCreate}>
          <Text style={styles.primaryText}>Save plan</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent totals</Text>
        {totals.length === 0 ? (
          <Text style={styles.emptyText}>No totals recorded yet.</Text>
        ) : (
          totals.map((row) => (
            <View key={row.total_date} style={styles.totalsRow}>
              <Text style={styles.totalsDate}>{row.total_date}</Text>
              <Text style={styles.totalsValue}>{row.calories} kcal · P {row.protein_g}g · C {row.carbs_g}g · F {row.fat_g}g</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Plans</Text>
        {plans.length === 0 ? (
          <Text style={styles.emptyText}>No shared plans yet.</Text>
        ) : (
          plans.map((plan) => (
            <View key={plan.id} style={styles.planRow}>
              <Text style={styles.planTitle}>{plan.title}</Text>
              <Text style={styles.planMeta}>{plan.status} · {plan.visibility.replace("_", " ")}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Coaching notes</Text>
        <Text style={styles.emptyText}>Coming soon.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020617" },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: "700", color: "#F8FAFC" },
  subtitle: { fontSize: 14, color: "#94A3B8" },
  card: { backgroundColor: "#0F172A", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#1E293B", gap: 8 },
  cardTitle: { color: "#E2E8F0", fontSize: 16, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#334155", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, color: "#E2E8F0" },
  primaryButton: { backgroundColor: "#10B981", paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  primaryText: { color: "#0F172A", fontWeight: "700" },
  emptyText: { color: "#64748B", fontSize: 12 },
  totalsRow: { marginTop: 4 },
  totalsDate: { color: "#94A3B8", fontSize: 12 },
  totalsValue: { color: "#E2E8F0", fontSize: 12 },
  planRow: { marginTop: 6 },
  planTitle: { color: "#E2E8F0", fontWeight: "600" },
  planMeta: { color: "#94A3B8", fontSize: 12 },
});
