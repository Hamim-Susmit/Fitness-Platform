import React from "react";
import { ScrollView, Text, StyleSheet, Pressable } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useSessionStore } from "../../store/useSessionStore";
import { colors, spacing, fontSize } from "../../styles/theme";
import PlanCard from "../../components/PlanCard";
import { useCheckoutSession, useMemberProfile, useMemberSubscription, usePortalSession, usePricingPlans } from "../../lib/useBilling";

export default function BillingScreen() {
  const { session } = useSessionStore();
  const memberProfile = useMemberProfile(session?.user.id);
  const subscription = useMemberSubscription(memberProfile.data?.id ?? undefined);
  const plans = usePricingPlans();
  const checkout = useCheckoutSession();
  const portal = usePortalSession();

  const currentPlanId = subscription.data?.pricing_plan_id ?? null;

  const openUrl = async (url: string) => {
    await WebBrowser.openAuthSessionAsync(url);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Billing</Text>
      <Text style={styles.subtitle}>Manage your membership plan and payment details.</Text>

      {subscription.isLoading ? (
        <Text style={styles.helper}>Loading subscription...</Text>
      ) : subscription.isError ? (
        <Text style={styles.error}>Unable to load subscription.</Text>
      ) : subscription.data ? (
        <Text style={styles.helper}>
          Current plan: {subscription.data.pricing_plans?.name ?? "Plan"} · Status: {subscription.data.status}
        </Text>
      ) : (
        <Text style={styles.helper}>No active subscription yet.</Text>
      )}

      <Pressable
        style={styles.portalButton}
        onPress={() => portal.mutateAsync().then(openUrl)}
        disabled={portal.isPending}
      >
        <Text style={styles.portalButtonText}>
          {portal.isPending ? "Opening portal..." : "Manage Billing"}
        </Text>
      </Pressable>
      {portal.isError ? (
        <Text style={styles.error}>{portal.error?.message ?? "Unable to open portal."}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>Plans</Text>
      {plans.isLoading ? (
        <Text style={styles.helper}>Loading plans...</Text>
      ) : plans.isError ? (
        <Text style={styles.error}>Unable to load pricing plans.</Text>
      ) : (
        plans.data?.map((plan) => (
          <PlanCard
            key={plan.id}
            name={plan.name}
            description={plan.description}
            priceCents={plan.price_cents}
            interval={plan.interval}
            status={subscription.data?.status ?? null}
            isCurrent={plan.id === currentPlanId}
            loading={checkout.isPending && checkout.variables === plan.id}
            onSelect={() =>
              checkout
                .mutateAsync(plan.id)
                .then(openUrl)
                .catch(() => undefined)
            }
          />
        ))
      )}
      {checkout.isError ? (
        <Text style={styles.error}>{checkout.error?.message ?? "Unable to start checkout."}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: "600",
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  helper: {
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  error: {
    color: colors.error,
    marginTop: spacing.md,
  },
  portalButton: {
    marginTop: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: "center",
  },
  portalButtonText: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  sectionTitle: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
});
