import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Checkin } from "../lib/types";
import { colors, spacing, fontSize } from "../styles/theme";
import { formatTime } from "../lib/time";

type CheckinsListProps = {
  checkins: Checkin[];
  title?: string;
};

export default function CheckinsList({ checkins, title }: CheckinsListProps) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title ?? "Recent Check-ins"}</Text>
        <Text style={styles.count}>{checkins.length} total</Text>
      </View>
      {checkins.length === 0 ? (
        <Text style={styles.empty}>No check-ins yet.</Text>
      ) : (
        checkins.map((checkin) => (
          <View key={checkin.id} style={styles.item}>
            <View>
              <Text style={styles.itemTitle}>Member #{checkin.member_id.slice(0, 6)}</Text>
              <Text style={styles.itemSubtitle}>{checkin.source.toUpperCase()} check-in</Text>
            </View>
            <Text style={styles.itemTime}>{formatTime(checkin.checked_in_at)}</Text>
          </View>
        ))
      )}
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
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  count: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  empty: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  itemTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.md,
  },
  itemSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: 4,
  },
  itemTime: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
});
