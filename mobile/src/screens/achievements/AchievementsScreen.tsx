import { useEffect, useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";

type AchievementRow = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  points_awarded: number;
};

type MemberAchievementRow = {
  id: string;
  achievement_id: string;
  awarded_at: string;
  achievements?: AchievementRow | null;
};

export default function AchievementsScreen() {
  const [earned, setEarned] = useState<MemberAchievementRow[]>([]);
  const [catalog, setCatalog] = useState<AchievementRow[]>([]);
  const [workoutCount, setWorkoutCount] = useState(0);
  const [checkinCount, setCheckinCount] = useState(0);
  const [currentStreaks, setCurrentStreaks] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const [
        { data: earnedRows },
        { data: achievementsRows },
        { count: workoutsCount },
        { count: checkinsCount },
        { data: streakRows },
      ] = await Promise.all([
        supabase
          .from("member_achievements")
          .select("id, achievement_id, awarded_at, achievements(*)")
          .eq("member_id", user?.id ?? "")
          .order("awarded_at", { ascending: false }),
        supabase
          .from("achievements")
          .select("id, code, title, description, category, points_awarded")
          .eq("is_active", true),
        supabase
          .from("workouts")
          .select("id", { count: "exact", head: true })
          .eq("member_id", user?.id ?? "")
          .not("completed_at", "is", null),
        supabase
          .from("checkins")
          .select("id", { count: "exact", head: true })
          .eq("member_id", user?.id ?? ""),
        supabase
          .from("streaks")
          .select("streak_type, current_count")
          .eq("member_id", user?.id ?? ""),
      ]);

      setEarned((earnedRows ?? []) as MemberAchievementRow[]);
      setCatalog((achievementsRows ?? []) as AchievementRow[]);
      setWorkoutCount(workoutsCount ?? 0);
      setCheckinCount(checkinsCount ?? 0);
      const streakMap = (streakRows ?? []).reduce<Record<string, number>>((acc, row) => {
        acc[row.streak_type] = row.current_count;
        return acc;
      }, {});
      setCurrentStreaks(streakMap);
      setLoading(false);
    };

    loadData();
  }, []);

  const earnedMap = useMemo(() => {
    return new Map(earned.map((row) => [row.achievement_id, row]));
  }, [earned]);

  const grouped = useMemo(() => {
    return catalog.reduce<Record<string, AchievementRow[]>>((acc, achievement) => {
      acc[achievement.category] = acc[achievement.category] ?? [];
      acc[achievement.category].push(achievement);
      return acc;
    }, {});
  }, [catalog]);

  const nextWorkoutMilestone = [1, 10, 50].find((value) => value > workoutCount);
  const nextCheckinMilestone = [10, 100].find((value) => value > checkinCount);
  const nextWorkoutStreak = [7, 30].find((value) => value > (currentStreaks.WORKOUTS ?? 0));
  const nextCheckinStreak = [7, 30].find((value) => value > (currentStreaks.CHECKINS ?? 0));

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading achievements...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: "600", marginBottom: 12 }}>Achievements</Text>
      <View style={{ marginBottom: 12 }}>
        <Text>Workout progress: {workoutCount} {nextWorkoutMilestone ? `• Next ${nextWorkoutMilestone}` : "• All milestones earned"}</Text>
        <Text>Check-ins: {checkinCount} {nextCheckinMilestone ? `• Next ${nextCheckinMilestone}` : "• All milestones earned"}</Text>
        <Text>Workout streak: {currentStreaks.WORKOUTS ?? 0} {nextWorkoutStreak ? `• Next ${nextWorkoutStreak}` : "• All streaks earned"}</Text>
        <Text>Check-in streak: {currentStreaks.CHECKINS ?? 0} {nextCheckinStreak ? `• Next ${nextCheckinStreak}` : "• All streaks earned"}</Text>
      </View>
      {Object.entries(grouped).map(([category, achievements]) => (
        <View key={category} style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: "600" }}>{category}</Text>
          <FlatList
            data={achievements}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const earnedRow = earnedMap.get(item.id);
              return (
                <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
                  <Text>{item.title}</Text>
                  <Text>{item.description}</Text>
                  <Text>{earnedRow ? `Earned ${new Date(earnedRow.awarded_at).toLocaleDateString()}` : "Not earned"}</Text>
                </View>
              );
            }}
          />
        </View>
      ))}
    </View>
  );
}
