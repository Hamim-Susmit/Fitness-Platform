import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import CheckinsList from "../../components/CheckinsList";
import { colors, spacing, fontSize } from "../../styles/theme";
import type { Checkin, StaffProfile } from "../../lib/types";
import { useSessionStore } from "../../store/useSessionStore";
import { useRealtimeCheckins } from "../../lib/useRealtimeCheckins";

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

  const {
    data: checkins = [],
    isLoading: checkinsLoading,
    isError: checkinsError,
  } = useQuery<Checkin[]>({
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

  const handleRealtimeInsert = useCallback(
    (newCheckin: Checkin) => {
      queryCache.setQueryData<Checkin[]>(
        ["staff-checkins", gymId, todayRange.start],
        (existing = []) => {
          if (existing.some((checkin) => checkin.id === newCheckin.id)) {
            return existing;
          }
          return [newCheckin, ...existing];
        }
      );
    },
    [gymId, queryCache, todayRange.start]
  );

  useRealtimeCheckins(gymId, handleRealtimeInsert);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Today's Check-ins</Text>
        <Text style={styles.subtitle}>Realtime updates for all member visits.</Text>
      </View>
      <CheckinsList checkins={checkins} title="Today" />
      {checkinsLoading ? <Text style={styles.empty}>Loading check-ins...</Text> : null}
      {checkinsError ? <Text style={styles.error}>Unable to load check-ins.</Text> : null}
      {!checkinsLoading && !checkinsError && checkins.length === 0 ? (
        <Text style={styles.empty}>No check-ins yet today.</Text>
      ) : null}
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
  empty: {
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  error: {
    color: colors.error,
    marginTop: spacing.sm,
  },
});
