import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import CheckinsList from "../../components/CheckinsList";
import { colors, spacing, fontSize } from "../../styles/theme";
import type { Checkin, StaffProfile } from "../../lib/types";
import { useSessionStore } from "../../store/useSessionStore";

export default function StaffDashboardScreen() {
  const { session } = useSessionStore();
  const queryCache = useQueryClient();
  const [gymId, setGymId] = useState<string | null>(null);

  const { data: staffProfile } = useQuery<StaffProfile | null>({
    queryKey: ["staff-profile", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("staff")
        .select("id, user_id, gym_id, staff_role")
        .eq("user_id", session?.user.id ?? "")
        .maybeSingle();
      return (data ?? null) as StaffProfile | null;
    },
  });

  useEffect(() => {
    if (staffProfile?.gym_id) {
      setGymId(staffProfile.gym_id);
    }
  }, [staffProfile?.gym_id]);

  const todayRange = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

  const { data: checkins = [] } = useQuery<Checkin[]>({
    queryKey: ["staff-checkins", gymId, todayRange.start],
    enabled: !!gymId,
    queryFn: async () => {
      const { data } = await supabase
        .from("checkins")
        .select("id, member_id, gym_id, checked_in_at, source, staff_id")
        .eq("gym_id", gymId ?? "")
        .gte("checked_in_at", todayRange.start)
        .lte("checked_in_at", todayRange.end)
        .order("checked_in_at", { ascending: false });
      return (data ?? []) as Checkin[];
    },
  });

  useEffect(() => {
    if (!gymId) return;

    const channel = supabase
      .channel("realtime-checkins")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "checkins",
          filter: `gym_id=eq.${gymId}`,
        },
        (payload) => {
          const newCheckin = payload.new as Checkin;
          queryCache.setQueryData<Checkin[]>(
            ["staff-checkins", gymId, todayRange.start],
            (existing = []) => [newCheckin, ...existing]
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gymId, queryCache, todayRange.start]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Today's Check-ins</Text>
        <Text style={styles.subtitle}>Realtime updates for all member visits.</Text>
      </View>
      <CheckinsList checkins={checkins} title="Today" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    backgroundColor: colors.background,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
