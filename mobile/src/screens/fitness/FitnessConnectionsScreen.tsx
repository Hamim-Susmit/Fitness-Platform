import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";
import type { FitnessProvider } from "../../lib/fitness/adapters/baseAdapter";
import { syncProviderForMember } from "../../lib/fitness/sync";

const PROVIDERS: Array<{
  key: FitnessProvider;
  label: string;
  description: string;
  canConnectOnMobile: boolean;
}> = [
  { key: "APPLE_HEALTH", label: "Apple Health", description: "Sync daily summaries from your iPhone.", canConnectOnMobile: true },
  { key: "GOOGLE_FIT", label: "Google Fit", description: "Sync daily summaries from your Android device.", canConnectOnMobile: true },
  { key: "FITBIT", label: "Fitbit", description: "Connect via the web dashboard.", canConnectOnMobile: false },
  { key: "GARMIN", label: "Garmin", description: "Garmin integration available soon.", canConnectOnMobile: false },
  { key: "STRAVA", label: "Strava", description: "Connect via the web dashboard.", canConnectOnMobile: false },
];

type FitnessAccountRow = {
  id: string;
  provider: FitnessProvider;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  updated_at: string;
};

export function FitnessConnectionsScreen() {
  const [memberId, setMemberId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<FitnessAccountRow[]>([]);
  const [syncingProvider, setSyncingProvider] = useState<FitnessProvider | null>(null);

  useEffect(() => {
    const loadMember = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) return;
      const { data: member } = await supabase
        .from("members")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      setMemberId(member?.id ?? null);
    };

    loadMember();
  }, []);

  const refreshAccounts = useCallback(async () => {
    if (!memberId) return;
    const { data } = await supabase
      .from("fitness_accounts")
      .select("id, provider, status, updated_at")
      .eq("member_id", memberId)
      .order("updated_at", { ascending: false });
    setAccounts((data ?? []) as FitnessAccountRow[]);
  }, [memberId]);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  const accountsByProvider = useMemo(() => new Map(accounts.map((account) => [account.provider, account])), [accounts]);

  const handleConnect = async (provider: FitnessProvider) => {
    if (!memberId) return;
    const { data: existing } = await supabase
      .from("fitness_accounts")
      .select("id")
      .eq("member_id", memberId)
      .eq("provider", provider)
      .maybeSingle();

    if (!existing) {
      await supabase.from("fitness_accounts").insert({
        member_id: memberId,
        provider,
        external_user_id: `${provider.toLowerCase()}-${memberId}`,
        access_token: "encrypted_token_placeholder",
        refresh_token: null,
        status: "CONNECTED",
      });
    } else {
      await supabase
        .from("fitness_accounts")
        .update({ status: "CONNECTED" })
        .eq("id", existing.id);
    }
    await refreshAccounts();
  };

  const handleDisconnect = async (provider: FitnessProvider) => {
    const account = accountsByProvider.get(provider);
    if (!account) return;
    await supabase
      .from("fitness_accounts")
      .update({ status: "DISCONNECTED" })
      .eq("id", account.id);
    await refreshAccounts();
  };

  const handleSync = async (provider: FitnessProvider) => {
    if (!memberId) return;
    setSyncingProvider(provider);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 6);
    await syncProviderForMember(memberId, provider, {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
    });
    await refreshAccounts();
    setSyncingProvider(null);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fitness Connections</Text>
      <Text style={styles.subtitle}>Connect wearable providers to sync daily summaries.</Text>

      {PROVIDERS.map((provider) => {
        const account = accountsByProvider.get(provider.key);
        return (
          <View key={provider.key} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{provider.label}</Text>
              <Text style={styles.cardStatus}>Status: {account?.status ?? "DISCONNECTED"}</Text>
            </View>
            <Text style={styles.cardDescription}>{provider.description}</Text>
            <View style={styles.actions}>
              {provider.canConnectOnMobile ? (
                account?.status === "CONNECTED" ? (
                  <>
                    <TouchableOpacity
                      style={styles.primaryButton}
                      onPress={() => handleSync(provider.key)}
                      disabled={syncingProvider === provider.key}
                    >
                      <Text style={styles.buttonText}>
                        {syncingProvider === provider.key ? "Syncing..." : "Sync Now"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.secondaryButton} onPress={() => handleDisconnect(provider.key)}>
                      <Text style={styles.secondaryText}>Disconnect</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity style={styles.primaryButton} onPress={() => handleConnect(provider.key)}>
                    <Text style={styles.buttonText}>Connect</Text>
                  </TouchableOpacity>
                )
              ) : (
                <TouchableOpacity style={styles.disabledButton} disabled>
                  <Text style={styles.disabledText}>Connect on web</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  subtitle: {
    fontSize: 14,
    color: "#94A3B8",
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#E2E8F0",
  },
  cardStatus: {
    fontSize: 12,
    color: "#94A3B8",
  },
  cardDescription: {
    fontSize: 13,
    color: "#94A3B8",
    marginTop: 6,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  primaryButton: {
    backgroundColor: "#10B981",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  secondaryButton: {
    borderColor: "#334155",
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  buttonText: {
    color: "#0F172A",
    fontWeight: "600",
  },
  secondaryText: {
    color: "#E2E8F0",
    fontWeight: "600",
  },
  disabledButton: {
    borderColor: "#334155",
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  disabledText: {
    color: "#64748B",
    fontWeight: "600",
  },
});
