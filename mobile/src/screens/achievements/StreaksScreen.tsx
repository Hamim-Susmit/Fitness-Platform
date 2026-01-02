import { useEffect, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { computeStreakStatus } from "../../lib/gamification/streaks";

type StreakRow = {
  id: string;
  streak_type: string;
  current_count: number;
  longest_count: number;
  last_event_at: string | null;
};

export default function StreaksScreen() {
  const [streaks, setStreaks] = useState<StreakRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const rows = await computeStreakStatus(user.id);
      setStreaks(rows as StreakRow[]);
      setLoading(false);
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading streaks...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: "600", marginBottom: 12 }}>Streaks</Text>
      <FlatList
        data={streaks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text>{item.streak_type}</Text>
            <Text>Current: {item.current_count}</Text>
            <Text>Longest: {item.longest_count}</Text>
            <Text>Last: {item.last_event_at ? new Date(item.last_event_at).toLocaleDateString() : "—"}</Text>
          </View>
        )}
        ListEmptyComponent={<Text>No streaks yet.</Text>}
      />
    </View>
  );
}
