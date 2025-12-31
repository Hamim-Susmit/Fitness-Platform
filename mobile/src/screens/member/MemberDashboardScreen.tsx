import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useTokenStore, useSessionStore } from "../../store/useSessionStore";
import QRDisplay from "../../components/QRDisplay";
import CheckinsList from "../../components/CheckinsList";
import { colors, spacing, fontSize } from "../../styles/theme";
import type { Checkin, MemberProfile } from "../../lib/types";
import { callEdgeFunction } from "../../lib/api";
import { secondsUntil } from "../../lib/time";

export default function MemberDashboardScreen() {
  const { session } = useSessionStore();
  const { token, expiresAt, setToken } = useTokenStore();
  const [now, setNow] = useState(Date.now());
  const queryCache = useQueryClient();

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
        <Pressable style={styles.button} onPress={() => generateToken.mutate()} disabled={generateToken.isPending}>
          <Text style={styles.buttonText}>{generateToken.isPending ? "Generating..." : "Refresh Token"}</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Membership Status</Text>
        <Text style={styles.statusText}>Status: {member?.status ?? "unknown"}</Text>
        <Text style={styles.helper}>Need help? Contact staff at the front desk.</Text>
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
});
