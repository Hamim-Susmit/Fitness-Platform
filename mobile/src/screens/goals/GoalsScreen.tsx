import { useEffect, useMemo, useState } from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { computeGoalProgress } from "../../lib/goals/progress";

type GoalRow = {
  id: string;
  title: string;
  goal_type: string;
  metric_key: string;
  unit: string;
  target_value: number;
  start_value: number | null;
  current_value: number | null;
  status: string;
};

type ProgressEntryRow = {
  goal_id: string;
  value: number;
  recorded_at: string;
  source: string;
};

export default function GoalsScreen() {
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [entries, setEntries] = useState<ProgressEntryRow[]>([]);
  const [title, setTitle] = useState("");
  const [goalType, setGoalType] = useState("WEIGHT");
  const [metricKey, setMetricKey] = useState("body_weight");
  const [unit, setUnit] = useState("kg");
  const [targetValue, setTargetValue] = useState("0");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: goalRows } = await supabase
        .from("goals")
        .select("id, title, goal_type, metric_key, unit, target_value, start_value, current_value, status")
        .eq("member_id", user?.id ?? "")
        .order("created_at", { ascending: false });

      const { data: entryRows } = await supabase
        .from("goal_progress_entries")
        .select("goal_id, value, recorded_at, source")
        .in(
          "goal_id",
          (goalRows ?? []).map((goal) => goal.id)
        );

      setGoals((goalRows ?? []) as GoalRow[]);
      setEntries((entryRows ?? []) as ProgressEntryRow[]);
      setLoading(false);
    };

    loadData();
  }, []);

  const entriesByGoal = useMemo(() => {
    const map = new Map<string, ProgressEntryRow[]>();
    entries.forEach((entry) => {
      const list = map.get(entry.goal_id) ?? [];
      list.push(entry);
      map.set(entry.goal_id, list);
    });
    return map;
  }, [entries]);

  const createGoal = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !title.trim()) return;

    const { data } = await supabase
      .from("goals")
      .insert({
        member_id: user.id,
        created_by: user.id,
        goal_type: goalType,
        title,
        description: null,
        metric_key: metricKey,
        unit,
        target_value: Number(targetValue),
        status: "ACTIVE",
        visibility: "PRIVATE",
      })
      .select("id, title, goal_type, metric_key, unit, target_value, start_value, current_value, status")
      .maybeSingle();

    if (data) {
      setGoals((prev) => [data as GoalRow, ...prev]);
      setTitle("");
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading goals...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Goals</Text>
      <TextInput placeholder="Goal title" value={title} onChangeText={setTitle} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <TextInput placeholder="Goal type" value={goalType} onChangeText={setGoalType} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <TextInput placeholder="Metric key" value={metricKey} onChangeText={setMetricKey} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <TextInput placeholder="Unit" value={unit} onChangeText={setUnit} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <TextInput placeholder="Target value" value={targetValue} onChangeText={setTargetValue} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <Button title="Create goal" onPress={createGoal} />

      <FlatList
        data={goals}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const progress = computeGoalProgress(item, entriesByGoal.get(item.id) ?? []);
          return (
            <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
              <Text>{item.title}</Text>
              <Text>{item.goal_type} • {item.metric_key}</Text>
              <Text>{progress.current}/{item.target_value} {item.unit}</Text>
              <Text>{Math.round(progress.percent)}% complete</Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text>No goals yet.</Text>}
      />
    </View>
  );
}
