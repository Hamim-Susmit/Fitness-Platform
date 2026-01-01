import { useEffect, useState } from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";

type GoalRow = {
  id: string;
  title: string;
  goal_type: string;
  metric_key: string;
  unit: string;
  target_value: number;
  status: string;
  visibility: string;
};

type Props = {
  memberId: string;
};

export default function MemberGoalsScreen({ memberId }: Props) {
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [title, setTitle] = useState("");
  const [goalType, setGoalType] = useState("STRENGTH");
  const [metricKey, setMetricKey] = useState("bench_press_1rm");
  const [unit, setUnit] = useState("kg");
  const [targetValue, setTargetValue] = useState("0");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const { data: goalRows } = await supabase
        .from("goals")
        .select("id, title, goal_type, metric_key, unit, target_value, status, visibility")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false });

      setGoals((goalRows ?? []) as GoalRow[]);
      setLoading(false);
    };

    loadData();
  }, [memberId]);

  const proposeGoal = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !title.trim()) return;

    const { data } = await supabase
      .from("goals")
      .insert({
        member_id: memberId,
        created_by: user.id,
        goal_type: goalType,
        title,
        description: null,
        metric_key: metricKey,
        unit,
        target_value: Number(targetValue),
        status: "ACTIVE",
        visibility: "SHARED_WITH_TRAINER",
      })
      .select("id, title, goal_type, metric_key, unit, target_value, status, visibility")
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
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Client Goals</Text>
      <TextInput placeholder="Goal title" value={title} onChangeText={setTitle} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <TextInput placeholder="Goal type" value={goalType} onChangeText={setGoalType} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <TextInput placeholder="Metric key" value={metricKey} onChangeText={setMetricKey} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <TextInput placeholder="Unit" value={unit} onChangeText={setUnit} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <TextInput placeholder="Target value" value={targetValue} onChangeText={setTargetValue} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <Button title="Propose goal" onPress={proposeGoal} />

      <FlatList
        data={goals}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text>{item.title}</Text>
            <Text>{item.goal_type} • {item.metric_key}</Text>
            <Text>{item.target_value} {item.unit}</Text>
            <Text>{item.visibility}</Text>
          </View>
        )}
      />
    </View>
  );
}
