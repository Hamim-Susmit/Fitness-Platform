import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
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
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export function NutritionPlansScreen() {
  const [memberId, setMemberId] = useState<string | null>(null);
  const [plans, setPlans] = useState<NutritionPlan[]>([]);
  const [dailyTotals, setDailyTotals] = useState<DailyTotals | null>(null);

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

  useEffect(() => {
    const loadPlans = async () => {
      if (!memberId) return;
      const { data } = await supabase
        .from("nutrition_plans")
        .select("id, title, description, daily_calorie_target, protein_target_g, carbs_target_g, fat_target_g, status, visibility")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false });

      const today = new Date().toISOString().slice(0, 10);
      const { data: totals } = await supabase
        .from("nutrition_daily_totals")
        .select("calories, protein_g, carbs_g, fat_g")
        .eq("member_id", memberId)
        .eq("total_date", today)
        .maybeSingle();

      setPlans((data ?? []) as NutritionPlan[]);
      setDailyTotals((totals ?? null) as DailyTotals | null);
    };

    loadPlans();
  }, [memberId]);

  const activePlan = useMemo(() => plans.find((plan) => plan.status === "ACTIVE") ?? null, [plans]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Nutrition Plans</Text>
      <Text style={styles.subtitle}>Review guidance and compare daily totals.</Text>

      {activePlan ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{activePlan.title}</Text>
          <Text style={styles.cardSubtitle}>{activePlan.description ?? "No description."}</Text>
          <View style={styles.macroRow}>
            <View style={styles.macroCard}>
              <Text style={styles.macroLabel}>Calories</Text>
              <Text style={styles.macroValue}>{activePlan.daily_calorie_target ?? "—"}</Text>
            </View>
            <View style={styles.macroCard}>
              <Text style={styles.macroLabel}>Protein</Text>
              <Text style={styles.macroValue}>{activePlan.protein_target_g ?? "—"} g</Text>
            </View>
            <View style={styles.macroCard}>
              <Text style={styles.macroLabel}>Carbs</Text>
              <Text style={styles.macroValue}>{activePlan.carbs_target_g ?? "—"} g</Text>
            </View>
            <View style={styles.macroCard}>
              <Text style={styles.macroLabel}>Fat</Text>
              <Text style={styles.macroValue}>{activePlan.fat_target_g ?? "—"} g</Text>
            </View>
          </View>
          <Text style={styles.totalsText}>
            Today: {dailyTotals ? `${dailyTotals.calories} kcal · P ${dailyTotals.protein_g}g · C ${dailyTotals.carbs_g}g · F ${dailyTotals.fat_g}g` : "No totals yet"}
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.emptyText}>No active plan yet.</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Plan history</Text>
        {plans.length === 0 ? (
          <Text style={styles.emptyText}>No plans created yet.</Text>
        ) : (
          plans.map((plan) => (
            <View key={plan.id} style={styles.planRow}>
              <View>
                <Text style={styles.planTitle}>{plan.title}</Text>
                <Text style={styles.planMeta}>{plan.status} · {plan.visibility.replace("_", " ")}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020617" },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: "700", color: "#F8FAFC" },
  subtitle: { fontSize: 14, color: "#94A3B8" },
  card: { backgroundColor: "#0F172A", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#1E293B" },
  cardTitle: { color: "#E2E8F0", fontSize: 18, fontWeight: "600" },
  cardSubtitle: { color: "#94A3B8", fontSize: 13, marginTop: 4 },
  macroRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  macroCard: { backgroundColor: "#111827", padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#1F2937" },
  macroLabel: { color: "#94A3B8", fontSize: 11 },
  macroValue: { color: "#E2E8F0", fontSize: 14, fontWeight: "600" },
  totalsText: { marginTop: 8, color: "#CBD5F5", fontSize: 12 },
  section: { gap: 8 },
  sectionTitle: { color: "#E2E8F0", fontSize: 16, fontWeight: "600" },
  emptyText: { color: "#64748B", fontSize: 13 },
  planRow: { backgroundColor: "#0F172A", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#1E293B" },
  planTitle: { color: "#E2E8F0", fontSize: 14, fontWeight: "600" },
  planMeta: { color: "#94A3B8", fontSize: 12 },
});
