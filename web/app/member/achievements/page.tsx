"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";

type AchievementRow = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  icon_key: string;
  points_awarded: number;
};

type MemberAchievementRow = {
  id: string;
  achievement_id: string;
  awarded_at: string;
  achievements?: AchievementRow | null;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function AchievementsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [earned, setEarned] = useState<MemberAchievementRow[]>([]);
  const [catalog, setCatalog] = useState<AchievementRow[]>([]);
  const [workoutCount, setWorkoutCount] = useState(0);
  const [checkinCount, setCheckinCount] = useState(0);
  const [currentStreaks, setCurrentStreaks] = useState<Record<string, number>>({});
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const loadData = async () => {
      if (!session?.user.id) return;
      setLoadingData(true);
      const [{ data: earnedRows }, { data: achievementsRows }, { count: workoutsCount }, { count: checkinsCount }, { data: streakRows }] =
        await Promise.all([
        supabaseBrowser
          .from("member_achievements")
          .select("id, achievement_id, awarded_at, achievements(*)")
          .eq("member_id", session.user.id)
          .order("awarded_at", { ascending: false }),
        supabaseBrowser
          .from("achievements")
          .select("id, code, title, description, category, icon_key, points_awarded")
          .eq("is_active", true),
        supabaseBrowser
          .from("workouts")
          .select("id", { count: "exact", head: true })
          .eq("member_id", session.user.id)
          .not("completed_at", "is", null),
        supabaseBrowser
          .from("checkins")
          .select("id", { count: "exact", head: true })
          .eq("member_id", session.user.id),
        supabaseBrowser
          .from("streaks")
          .select("streak_type, current_count")
          .eq("member_id", session.user.id),
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
      setLoadingData(false);
    };

    loadData();
  }, [session?.user.id]);

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

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Achievements</h1>
          <p className="text-sm text-slate-400">Consistency-focused milestones for your training.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 grid gap-3 md:grid-cols-2 text-sm">
          <div className="text-slate-300">
            Workout progress: {workoutCount} completed
            {nextWorkoutMilestone ? ` • Next: ${nextWorkoutMilestone}` : " • All milestones earned"}
          </div>
          <div className="text-slate-300">
            Check-in progress: {checkinCount} visits
            {nextCheckinMilestone ? ` • Next: ${nextCheckinMilestone}` : " • All milestones earned"}
          </div>
          <div className="text-slate-300">
            Workout streak: {currentStreaks.WORKOUTS ?? 0} days
            {nextWorkoutStreak ? ` • Next: ${nextWorkoutStreak}` : " • All streaks earned"}
          </div>
          <div className="text-slate-300">
            Check-in streak: {currentStreaks.CHECKINS ?? 0} days
            {nextCheckinStreak ? ` • Next: ${nextCheckinStreak}` : " • All streaks earned"}
          </div>
        </section>

        {Object.entries(grouped).map(([category, achievements]) => (
          <section key={category} className="space-y-3">
            <h2 className="text-lg font-semibold">{category}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {achievements.map((achievement) => {
                const earnedRow = earnedMap.get(achievement.id);
                return (
                  <div key={achievement.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
                    <div className="text-sm font-medium">{achievement.title}</div>
                    <div className="text-xs text-slate-400">{achievement.description}</div>
                    <div className="text-xs text-slate-500">Points: {achievement.points_awarded}</div>
                    <div className="text-xs text-slate-400">
                      {earnedRow ? `Earned ${new Date(earnedRow.awarded_at).toLocaleDateString()}` : "Not yet earned"}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

export default function AchievementsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <AchievementsView />
    </QueryClientProvider>
  );
}
