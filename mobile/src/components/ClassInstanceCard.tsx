import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { colors, spacing, fontSize } from "../styles/theme";

export type ClassInstanceCardProps = {
  title: string;
  instructor: string;
  timeRange: string;
  capacityLabel: string;
  statusLabel: string;
  attendanceLabel?: string;
  onPressDetails?: () => void;
  onBook?: () => void;
  onCancel?: () => void;
  onJoinWaitlist?: () => void;
  disabled?: boolean;
  pending?: boolean;
};

export default function ClassInstanceCard({
  title,
  instructor,
  timeRange,
  capacityLabel,
  statusLabel,
  attendanceLabel,
  onPressDetails,
  onBook,
  onCancel,
  onJoinWaitlist,
  disabled,
  pending,
}: ClassInstanceCardProps) {
  const showBook = !!onBook;
  const showCancel = !!onCancel;
  const showWaitlist = !!onJoinWaitlist;

  return (
    <Pressable onPress={onPressDetails} disabled={!onPressDetails} style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{instructor}</Text>
        </View>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{statusLabel}</Text>
        </View>
      </View>
      <Text style={styles.time}>{timeRange}</Text>
      <Text style={styles.capacity}>{capacityLabel}</Text>
      {attendanceLabel ? <Text style={styles.attendance}>{attendanceLabel}</Text> : null}
      <View style={styles.actions}>
        {showCancel ? (
          <Pressable style={[styles.secondaryButton, disabled && styles.buttonDisabled]} onPress={onCancel} disabled={disabled || pending}>
            {pending ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.secondaryText}>Cancel</Text>}
          </Pressable>
        ) : null}
        {showWaitlist ? (
          <Pressable style={[styles.secondaryButton, disabled && styles.buttonDisabled]} onPress={onJoinWaitlist} disabled={disabled || pending}>
            {pending ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.secondaryText}>Join Waitlist</Text>}
          </Pressable>
        ) : null}
        {showBook ? (
          <Pressable style={[styles.primaryButton, disabled && styles.buttonDisabled]} onPress={onBook} disabled={disabled || pending}>
            {pending ? <ActivityIndicator color={colors.background} /> : <Text style={styles.primaryText}>Book</Text>}
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: 2,
  },
  time: {
    color: colors.textPrimary,
    fontSize: fontSize.md,
  },
  capacity: {
    color: colors.textSecondary,
  },
  attendance: {
    color: colors.success,
    fontSize: fontSize.sm,
  },
  chip: {
    backgroundColor: "rgba(34, 211, 238, 0.15)",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chipText: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
  },
  primaryText: {
    color: colors.background,
    fontWeight: "600",
  },
  secondaryButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
  },
  secondaryText: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
