import { useEffect, useMemo, useState } from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { computeGoalProgress } from "../../lib/goals/progress";

type GoalRow = {
  id: string;
  title: string;
  metric_key: string;
  unit: string;
  target_value: number;
  start_value: number | null;
  current_value: number | null;
  status: string;
};

type ProgressEntryRow = {
  id: string;
  goal_id: string;
  value: number;
  note: string | null;
  source: string;
  recorded_at: string;
};

type Props = {
  goalId: string;
};

export default function GoalDetailScreen({ goalId }: Props) {
  const [goal, setGoal] = useState<GoalRow | null>(null);
  const [entries, setEntries] = useState<ProgressEntryRow[]>([]);
  const [value, setValue] = useState("0");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const { data: goalRow } = await supabase
        .from("goals")
        .select("id, title, metric_key, unit, target_value, start_value, current_value, status")
        .eq("id", goalId)
        .maybeSingle();

      const { data: entryRows } = await supabase
        .from("goal_progress_entries")
        .select("id, goal_id, value, note, source, recorded_at")
        .eq("goal_id", goalId)
        .order("recorded_at", { ascending: true });

      setGoal((goalRow ?? null) as GoalRow | null);
      setEntries((entryRows ?? []) as ProgressEntryRow[]);
      setLoading(false);
    };

    loadData();
  }, [goalId]);

  const progress = useMemo(() => {
    return goal ? computeGoalProgress(goal, entries) : { percent: 0, current: 0 };
  }, [entries, goal]);

  const addEntry = async () => {
    if (!goal || goal.status !== "ACTIVE") return;
    const { data } = await supabase
      .from("goal_progress_entries")
      .insert({
        goal_id: goal.id,
        value: Number(value),
        note: note || null,
        source: "MANUAL",
        recorded_at: new Date().toISOString(),
      })
      .select("id, goal_id, value, note, source, recorded_at")
      .maybeSingle();

    if (data) {
      setEntries((prev) => [...prev, data as ProgressEntryRow]);
      setNote("");
      setValue("0");
    }
  };

  const markComplete = async () => {
    if (!goal) return;
    const { data } = await supabase
      .from("goals")
      .update({ status: "COMPLETED" })
      .eq("id", goal.id)
      .select("id, title, metric_key, unit, target_value, start_value, current_value, status")
      .maybeSingle();

    if (data) {
      setGoal(data as GoalRow);
    }
  };

  if (loading || !goal) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading goal...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>{goal.title}</Text>
      <Text>{progress.current}/{goal.target_value} {goal.unit}</Text>
      <Text>{Math.round(progress.percent)}% complete</Text>

      <TextInput
        placeholder="Value"
        value={value}
        onChangeText={setValue}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <TextInput
        placeholder="Note"
        value={note}
        onChangeText={setNote}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <Button title="Add entry" onPress={addEntry} />
      <Button title="Mark complete" onPress={markComplete} />

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text>{item.value} {goal.unit}</Text>
            <Text>{item.source}</Text>
            <Text>{item.note ?? ""}</Text>
          </View>
        )}
      />
    </View>
  );
}
