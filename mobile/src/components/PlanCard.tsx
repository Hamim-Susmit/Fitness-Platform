import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, spacing, fontSize } from "../styles/theme";

type PlanCardProps = {
  name: string;
  description?: string | null;
  priceCents: number;
  interval: "monthly" | "yearly";
  isCurrent: boolean;
  status?: string | null;
  onSelect: () => void;
  loading: boolean;
};

const formatPrice = (priceCents: number) => `$${(priceCents / 100).toFixed(0)}`;

export default function PlanCard({
  name,
  description,
  priceCents,
  interval,
  isCurrent,
  status,
  onSelect,
  loading,
}: PlanCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{name}</Text>
          {description ? <Text style={styles.subtitle}>{description}</Text> : null}
        </View>
        {isCurrent ? <Text style={styles.badge}>Current</Text> : null}
      </View>
      <Text style={styles.price}>
        {formatPrice(priceCents)} <Text style={styles.interval}>/ {interval}</Text>
      </Text>
      {status && isCurrent ? <Text style={styles.status}>Status: {status}</Text> : null}
      <Pressable
        style={[styles.button, (loading || isCurrent) && styles.buttonDisabled]}
        onPress={onSelect}
        disabled={loading || isCurrent}
      >
        <Text style={styles.buttonText}>
          {isCurrent ? "Current Plan" : loading ? "Starting..." : "Subscribe / Change Plan"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
  badge: {
    color: colors.success,
    fontSize: fontSize.sm,
    textTransform: "uppercase",
  },
  price: {
    marginTop: spacing.md,
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: "600",
  },
  interval: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  status: {
    marginTop: spacing.xs,
    color: colors.textSecondary,
  },
  button: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.background,
    fontWeight: "600",
  },
});
