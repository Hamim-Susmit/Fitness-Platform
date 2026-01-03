import { useEffect, useMemo, useState } from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { getOrCreateReferralCode, formatReferralLink } from "../../lib/referrals/generator";
import { createReferralInvite } from "../../lib/referrals/workflow";

type ReferralRow = {
  id: string;
  referred_email: string;
  status: string;
  created_at: string;
};

type RewardRow = {
  id: string;
  reward_type: string;
  reward_value: number | null;
  status: string;
  issued_at: string;
};

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export default function ReferralsScreen() {
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [email, setEmail] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [loading, setLoading] = useState(true);

  const referralLink = useMemo(() => (referralCode ? formatReferralLink(referralCode) : ""), [referralCode]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const code = getOrCreateReferralCode(user.id);
      setReferralCode(code);

      const [{ data: referralRows }, { data: rewardRows }] = await Promise.all([
        supabase
          .from("referrals")
          .select("id, referred_email, status, created_at")
          .eq("referrer_member_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("referral_rewards")
          .select("id, reward_type, reward_value, status, issued_at")
          .eq("referrer_member_id", user.id)
          .order("issued_at", { ascending: false }),
      ]);

      setReferrals((referralRows ?? []) as ReferralRow[]);
      setRewards((rewardRows ?? []) as RewardRow[]);
      setLoading(false);
    };

    loadData();
  }, []);

  const sendInvite = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !email || !referralCode) return;
    const result = await createReferralInvite(user.id, email, referralCode);
    if (result.ok && result.data) {
      setReferrals((prev) => [result.data as ReferralRow, ...prev]);
      setEmail("");
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading referrals...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Referrals</Text>
      <Text>Referral code: {referralCode}</Text>
      <Text>Share link: {referralLink}</Text>
      <TextInput placeholder="Friend email" value={email} onChangeText={setEmail} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <Button title="Send invite" onPress={sendInvite} />

      <Text style={{ fontSize: 16, fontWeight: "600", marginTop: 12 }}>Referral history</Text>
      <FlatList
        data={referrals}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text>{maskEmail(item.referred_email)}</Text>
            <Text>Status: {item.status}</Text>
          </View>
        )}
        ListEmptyComponent={<Text>No referrals yet.</Text>}
      />

      <Text style={{ fontSize: 16, fontWeight: "600", marginTop: 12 }}>Rewards</Text>
      <FlatList
        data={rewards}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text>{item.reward_type}</Text>
            <Text>Status: {item.status}</Text>
          </View>
        )}
        ListEmptyComponent={<Text>No rewards yet.</Text>}
      />
    </View>
  );
}
