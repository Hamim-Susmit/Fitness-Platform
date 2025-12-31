import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useTokenStore, useSessionStore } from "../../store/useSessionStore";
import QRDisplay from "../../components/QRDisplay";
import CheckinsList from "../../components/CheckinsList";
import { colors, spacing, fontSize } from "../../styles/theme";
import type { Checkin, MemberProfile } from "../../lib/types";
import { callEdgeFunction } from "../../lib/api";
import { secondsUntil } from "../../lib/time";
import type { MemberStackParamList } from "../../navigation/member";

export default function MemberDashboardScreen() {
  const { session } = useSessionStore();
  const { token, expiresAt, setToken } = useTokenStore();
  const [now, setNow] = useState(Date.now());
  const queryCache = useQueryClient();
  const navigation = useNavigation<NativeStackNavigationProp<MemberStackParamList>>();

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { data: member } = useQuery<MemberProfile | null>({
    queryKey: ["member-profile", session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("members")
        .select("id, user_id, gym_id, status")
        .eq("user_id", session?.user.id ?? "")
        .maybeSingle();
      return (data ?? null) as MemberProfile | null;
    },
  });

  const {
    data: checkins = [],
    isLoading: checkinsLoading,
    isError: checkinsError,
  } = useQuery<Checkin[]>({
    queryKey: ["member-checkins", member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("checkins")
        .select("id, member_id, gym_id, checked_in_at, source, staff_id")
        .eq("member_id", member?.id ?? "")
        .order("checked_in_at", { ascending: false })
        .limit(10);
      return (data ?? []) as Checkin[];
    },
  });

  const { data: memberSubscription } = useQuery<{ access_state: string } | null>({
    queryKey: ["member-access-state", member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_subscriptions")
        .select("access_state")
        .eq("member_id", member?.id ?? "")
        .maybeSingle();
      return (data ?? null) as { access_state: string } | null;
    },
  });

  const { data: delinquency } = useQuery<{ delinquency_state: string; grace_period_until: string | null } | null>({
    queryKey: ["member-delinquency", member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("delinquency_state, grace_period_until")
        .eq("member_id", member?.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as { delinquency_state: string; grace_period_until: string | null } | null;
    },
  });

  const generateToken = useMutation({
    mutationFn: async () => {
      const response = await callEdgeFunction<{ token: string; expires_at: string }>("generate_qr_token");
      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to generate token");
      }
      return response.data;
    },
    onSuccess: (data) => {
      setToken(data.token, data.expires_at);
      queryCache.invalidateQueries({ queryKey: ["member-checkins"] });
    },
  });

  const expiresInSeconds = useMemo(() => secondsUntil(expiresAt, now), [expiresAt, now]);

  useEffect(() => {
    if (expiresInSeconds !== null && expiresInSeconds <= 0) {
      setToken(null, null);
    }
  }, [expiresInSeconds, setToken]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Your Check-in QR</Text>
        <Text style={styles.subtitle}>Generate a new QR token each time you enter the gym.</Text>
        <View style={styles.qrSection}>
          <QRDisplay token={token} expiresInSeconds={expiresInSeconds} />
        </View>
        {generateToken.isError ? <Text style={styles.errorText}>{generateToken.error?.message ?? "Token error"}</Text> : null}
        {memberSubscription?.access_state === "grace" ? (
          <Text style={styles.warning}>
            Payment issue detected — your access is in grace period
            {delinquency?.grace_period_until
              ? ` until ${new Date(delinquency.grace_period_until).toLocaleDateString()}.`
              : "."}{" "}
            Please update billing.
          </Text>
        ) : null}
        {memberSubscription?.access_state === "restricted" ? (
          <Text style={styles.errorText}>Membership access restricted due to unpaid balance.</Text>
        ) : null}
        {delinquency?.delinquency_state === "recovered" ? (
          <Text style={styles.success}>Thanks — your membership is active again.</Text>
        ) : null}
        <Pressable
          style={[styles.button, memberSubscription?.access_state === "restricted" && styles.buttonDisabled]}
          onPress={() => generateToken.mutate()}
          disabled={generateToken.isPending || memberSubscription?.access_state === "restricted"}
        >
          <Text style={styles.buttonText}>{generateToken.isPending ? "Generating..." : "Refresh Token"}</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Membership Status</Text>
        <Text style={styles.statusText}>Status: {member?.status ?? "unknown"}</Text>
        <Text style={styles.helper}>Need help? Contact staff at the front desk.</Text>
        <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("ClassSchedule")}>
          <Text style={styles.secondaryButtonText}>View Classes</Text>
        </Pressable>
      </View>
      <CheckinsList checkins={checkins} title="Visit History" />
      {checkinsLoading ? <Text style={styles.helper}>Loading visits...</Text> : null}
      {checkinsError ? <Text style={styles.errorText}>Unable to load visits.</Text> : null}
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
  qrSection: {
    marginTop: spacing.md,
  },
  button: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: "center",
  },
  buttonText: {
    color: colors.background,
    fontWeight: "600",
  },
  secondaryButton: {
    marginTop: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  statusText: {
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  helper: {
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  errorText: {
    color: colors.error,
    marginTop: spacing.sm,
  },
  warning: {
    color: "#fbbf24",
    marginTop: spacing.sm,
  },
  success: {
    color: colors.success,
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
