import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";
import type { FitnessProvider } from "../../lib/fitness/adapters/baseAdapter";

const PROVIDER_PRIORITY: FitnessProvider[] = ["APPLE_HEALTH", "GOOGLE_FIT", "FITBIT", "STRAVA", "GARMIN"];

type MetricRow = {
  metric_date: string;
  steps: number | null;
  active_minutes: number | null;
  calories_active: number | null;
  provider?: FitnessProvider;
};

function formatDateLabel(date: string) {
  const parsed = new Date(date + "T00:00:00");
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function FitnessOverviewScreen() {
  const [memberId, setMemberId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);

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
    const loadMetrics = async () => {
      if (!memberId) return;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 6);
      const start = startDate.toISOString().slice(0, 10);
      const end = endDate.toISOString().slice(0, 10);

      const { data } = await supabase
        .from("fitness_daily_metrics")
        .select("metric_date, steps, active_minutes, calories_active, provider")
        .eq("member_id", memberId)
        .gte("metric_date", start)
        .lte("metric_date", end)
        .order("metric_date", { ascending: true });

      const rowsByDate = new Map<string, MetricRow>();
      (data ?? []).forEach((row) => {
        const existing = rowsByDate.get(row.metric_date);
        const existingProvider = existing?.provider;
        const currentProvider = row.provider as FitnessProvider;
        const shouldReplace =
          !existing ||
          PROVIDER_PRIORITY.indexOf(currentProvider) <
            PROVIDER_PRIORITY.indexOf(existingProvider ?? "GARMIN");

        if (shouldReplace) {
          rowsByDate.set(row.metric_date, {
            metric_date: row.metric_date,
            steps: row.steps,
            active_minutes: row.active_minutes,
            calories_active: row.calories_active,
            provider: row.provider as FitnessProvider,
          });
        }
      });

      const days: MetricRow[] = [];
      for (let i = 0; i < 7; i += 1) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const key = date.toISOString().slice(0, 10);
        days.push(
          rowsByDate.get(key) ?? {
            metric_date: key,
            steps: null,
            active_minutes: null,
            calories_active: null,
          }
        );
      }

      setMetrics(days);
    };

    loadMetrics();
  }, [memberId]);

  const totals = useMemo(() => {
    return metrics.reduce(
      (acc, row) => {
        acc.steps += row.steps ?? 0;
        acc.activeMinutes += row.active_minutes ?? 0;
        acc.calories += row.calories_active ?? 0;
        return acc;
      },
      { steps: 0, activeMinutes: 0, calories: 0 }
    );
  }, [metrics]);

  const maxSteps = Math.max(1, ...metrics.map((row) => row.steps ?? 0));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fitness Overview</Text>
      <Text style={styles.subtitle}>7-day activity summary (daily aggregates only).</Text>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Steps (7d)</Text>
          <Text style={styles.summaryValue}>{totals.steps.toLocaleString()}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Active minutes</Text>
          <Text style={styles.summaryValue}>{totals.activeMinutes.toLocaleString()}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Calories</Text>
          <Text style={styles.summaryValue}>{Math.round(totals.calories).toLocaleString()}</Text>
        </View>
      </View>

      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Steps Trend</Text>
        <View style={styles.chartRow}>
          {metrics.map((row) => {
            const heightPercent = ((row.steps ?? 0) / maxSteps) * 100;
            return (
              <View key={row.metric_date} style={styles.chartItem}>
                <View style={styles.chartBarWrapper}>
                  <View style={[styles.chartBar, { height: `${Math.max(heightPercent, 5)}%` }]} />
                </View>
                <Text style={styles.chartLabel}>{formatDateLabel(row.metric_date)}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  subtitle: {
    fontSize: 14,
    color: "#94A3B8",
    marginBottom: 16,
  },
  summaryRow: {
    gap: 12,
  },
  summaryCard: {
    backgroundColor: "#0F172A",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#94A3B8",
  },
  summaryValue: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: "600",
    color: "#E2E8F0",
  },
  chartCard: {
    marginTop: 16,
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#E2E8F0",
    marginBottom: 12,
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  chartItem: {
    alignItems: "center",
    flex: 1,
  },
  chartBarWrapper: {
    height: 120,
    width: 18,
    backgroundColor: "#0B1220",
    borderRadius: 8,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  chartBar: {
    width: "100%",
    backgroundColor: "#10B981",
  },
  chartLabel: {
    marginTop: 6,
    fontSize: 10,
    color: "#64748B",
  },
});
