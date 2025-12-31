import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, spacing, fontSize } from "../styles/theme";
import type { BillingHistoryItem } from "../lib/useBillingHistory";

const formatPrice = (amountCents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    amountCents / 100
  );

const statusStyles: Record<string, string> = {
  paid: colors.success,
  failed: colors.error,
  refunded: "#f59e0b",
  pending: colors.textSecondary,
};

type BillingHistoryItemProps = {
  item: BillingHistoryItem;
  onOpen: (url: string) => void;
  onDownload: (url: string) => void;
};

export default function BillingHistoryItem({ item, onOpen, onDownload }: BillingHistoryItemProps) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>Subscription</Text>
        <Text style={[styles.status, { color: statusStyles[item.status] ?? colors.textSecondary }]}
        >
          {item.status}
        </Text>
      </View>
      <Text style={styles.period}>
        {item.period_start ? new Date(item.period_start).toLocaleDateString() : ""}
        {item.period_end ? ` → ${new Date(item.period_end).toLocaleDateString()}` : ""}
      </Text>
      <Text style={styles.amount}>{formatPrice(item.amount_cents, item.currency)}</Text>
      {item.status === "failed" ? (
        <Text style={styles.helper}>Payment failed. Retry in billing portal.</Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          style={[styles.actionButton, !item.hosted_invoice_url && styles.actionDisabled]}
          onPress={() => item.hosted_invoice_url && onOpen(item.hosted_invoice_url)}
          disabled={!item.hosted_invoice_url}
        >
          <Text style={styles.actionText}>View Invoice</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, !item.pdf_url && styles.actionDisabled]}
          onPress={() => item.pdf_url && onDownload(item.pdf_url)}
          disabled={!item.pdf_url}
        >
          <Text style={styles.actionText}>Download PDF</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  status: {
    textTransform: "uppercase",
    fontSize: fontSize.sm,
  },
  period: {
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  amount: {
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  helper: {
    color: colors.error,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    alignItems: "center",
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionText: {
    color: colors.textPrimary,
  },
});
