import React from "react";
import { ActivityIndicator, FlatList, Text, View, StyleSheet } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useSessionStore } from "../../store/useSessionStore";
import { colors, spacing, fontSize } from "../../styles/theme";
import BillingHistoryItem from "../../components/BillingHistoryItem";
import { useMemberProfile } from "../../lib/useBilling";
import { useBillingHistory } from "../../lib/useBillingHistory";

export default function BillingHistoryScreen() {
  const { session } = useSessionStore();
  const memberProfile = useMemberProfile(session?.user.id);
  const history = useBillingHistory(memberProfile.data?.id ?? undefined);

  const items = history.data?.pages.flatMap((page) => page) ?? [];

  const openUrl = async (url: string) => {
    await WebBrowser.openBrowserAsync(url);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Billing History</Text>
      {history.isLoading ? (
        <ActivityIndicator color={colors.accent} />
      ) : history.isError ? (
        <Text style={styles.error}>Unable to load billing history.</Text>
      ) : items.length === 0 ? (
        <Text style={styles.helper}>No billing history yet.</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.invoice_id}
          renderItem={({ item }) => (
            <BillingHistoryItem item={item} onOpen={openUrl} onDownload={openUrl} />
          )}
          onEndReached={() => {
            if (history.hasNextPage) {
              history.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            history.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: "600",
    marginBottom: spacing.md,
  },
  helper: {
    color: colors.textSecondary,
  },
  error: {
    color: colors.error,
  },
});
