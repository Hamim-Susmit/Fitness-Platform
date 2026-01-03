import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";

type DailyTotals = {
  total_date: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

function formatDateLabel(date: string) {
  const parsed = new Date(date + "T00:00:00");
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function NutritionOverviewScreen() {
  const [memberId, setMemberId] = useState<string | null>(null);
  const [totals, setTotals] = useState<DailyTotals[]>([]);

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
    const loadTotals = async () => {
      if (!memberId) return;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 6);
      const { data } = await supabase
        .from("nutrition_daily_totals")
        .select("total_date, calories, protein_g, carbs_g, fat_g")
        .eq("member_id", memberId)
        .gte("total_date", startDate.toISOString().slice(0, 10))
        .lte("total_date", endDate.toISOString().slice(0, 10))
        .order("total_date", { ascending: true });

      const totalsByDate = new Map((data ?? []).map((row) => [row.total_date, row]));
      const rows: DailyTotals[] = [];
      for (let i = 0; i < 7; i += 1) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const key = date.toISOString().slice(0, 10);
        rows.push(
          totalsByDate.get(key) ?? {
            total_date: key,
            calories: 0,
            protein_g: 0,
            carbs_g: 0,
            fat_g: 0,
          }
        );
      }
      setTotals(rows);
    };

    loadTotals();
  }, [memberId]);

  const latestTotals = totals[totals.length - 1];
  const calorieMax = Math.max(1, ...totals.map((row) => row.calories));
  const macroTotal = (latestTotals?.protein_g ?? 0) + (latestTotals?.carbs_g ?? 0) + (latestTotals?.fat_g ?? 0);
  const macroBreakdown = useMemo(() => {
    if (!latestTotals || macroTotal === 0) {
      return { protein: 0, carbs: 0, fat: 0 };
    }
    return {
      protein: Math.round((latestTotals.protein_g / macroTotal) * 100),
      carbs: Math.round((latestTotals.carbs_g / macroTotal) * 100),
      fat: Math.round((latestTotals.fat_g / macroTotal) * 100),
    };
  }, [latestTotals, macroTotal]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Nutrition Overview</Text>
      <Text style={styles.subtitle}>7-day calorie trend and macro distribution.</Text>

      <View style={styles.chartCard}>
        <Text style={styles.sectionTitle}>Calories Trend</Text>
        <View style={styles.chartRow}>
          {totals.map((row) => {
            const heightPercent = (row.calories / calorieMax) * 100;
            return (
              <View key={row.total_date} style={styles.chartItem}>
                <View style={styles.chartBarWrapper}>
                  <View style={[styles.chartBar, { height: `${Math.max(heightPercent, 5)}%` }]} />
                </View>
                <Text style={styles.chartLabel}>{formatDateLabel(row.total_date)}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.macroRow}>
        <View style={styles.macroCard}>
          <Text style={styles.macroLabel}>Protein</Text>
          <Text style={styles.macroValue}>{macroBreakdown.protein}%</Text>
        </View>
        <View style={styles.macroCard}>
          <Text style={styles.macroLabel}>Carbs</Text>
          <Text style={styles.macroValue}>{macroBreakdown.carbs}%</Text>
        </View>
        <View style={styles.macroCard}>
          <Text style={styles.macroLabel}>Fat</Text>
          <Text style={styles.macroValue}>{macroBreakdown.fat}%</Text>
        </View>
      </View>

      <Text style={styles.helperText}>Plan comparison is coming soon.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020617" },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: "700", color: "#F8FAFC" },
  subtitle: { fontSize: 14, color: "#94A3B8" },
  chartCard: { backgroundColor: "#0F172A", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#1E293B" },
  sectionTitle: { color: "#E2E8F0", fontSize: 16, fontWeight: "600" },
  chartRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 12 },
  chartItem: { alignItems: "center", flex: 1 },
  chartBarWrapper: { height: 120, width: 18, backgroundColor: "#0B1220", borderRadius: 8, overflow: "hidden", justifyContent: "flex-end" },
  chartBar: { width: "100%", backgroundColor: "#F59E0B" },
  chartLabel: { marginTop: 6, fontSize: 10, color: "#64748B" },
  macroRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  macroCard: { backgroundColor: "#0F172A", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#1E293B" },
  macroLabel: { color: "#94A3B8", fontSize: 12 },
  macroValue: { color: "#E2E8F0", fontSize: 18, fontWeight: "600" },
  helperText: { color: "#64748B", fontSize: 12 },
});
