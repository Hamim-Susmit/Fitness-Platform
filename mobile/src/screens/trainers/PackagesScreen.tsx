import { useEffect, useState } from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";

type TrainerRow = {
  id: string;
};

type PackageRow = {
  id: string;
  member_id: string;
  package_name: string;
  total_sessions: number;
  sessions_used: number;
  price: number;
  expires_at: string | null;
};

export default function PackagesScreen() {
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [memberId, setMemberId] = useState("");
  const [packageName, setPackageName] = useState("10 Sessions");
  const [totalSessions, setTotalSessions] = useState("10");
  const [price, setPrice] = useState("0");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: trainerRow } = await supabase
        .from("personal_trainers")
        .select("id")
        .eq("user_id", user?.id ?? "")
        .maybeSingle();

      if (!trainerRow) {
        setLoading(false);
        return;
      }

      const { data: packageRows } = await supabase
        .from("trainer_packages")
        .select("id, member_id, package_name, total_sessions, sessions_used, price, expires_at")
        .eq("trainer_id", trainerRow.id)
        .order("created_at", { ascending: false });

      setTrainer(trainerRow as TrainerRow);
      setPackages((packageRows ?? []) as PackageRow[]);
      setLoading(false);
    };

    loadData();
  }, []);

  const assignPackage = async () => {
    if (!trainer || !memberId) return;
    const { data } = await supabase
      .from("trainer_packages")
      .insert({
        trainer_id: trainer.id,
        member_id: memberId,
        package_name: packageName,
        total_sessions: Number(totalSessions),
        sessions_used: 0,
        price: Number(price),
        currency: "usd",
        expires_at: expiresAt || null,
      })
      .select("id, member_id, package_name, total_sessions, sessions_used, price, expires_at")
      .maybeSingle();

    if (data) {
      setPackages((prev) => [data as PackageRow, ...prev]);
    }
  };

  const markUsed = async (packageId: string) => {
    const target = packages.find((pkg) => pkg.id === packageId);
    if (!target) return;
    const nextUsed = Math.min(target.sessions_used + 1, target.total_sessions);
    const { data } = await supabase
      .from("trainer_packages")
      .update({ sessions_used: nextUsed })
      .eq("id", packageId)
      .select("id, member_id, package_name, total_sessions, sessions_used, price, expires_at")
      .maybeSingle();

    if (data) {
      setPackages((prev) => prev.map((pkg) => (pkg.id === packageId ? (data as PackageRow) : pkg)));
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading packages...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Packages</Text>
      <TextInput
        placeholder="Member ID"
        value={memberId}
        onChangeText={setMemberId}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <TextInput
        placeholder="Package name"
        value={packageName}
        onChangeText={setPackageName}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <TextInput
        placeholder="Total sessions"
        value={totalSessions}
        onChangeText={setTotalSessions}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <TextInput
        placeholder="Price"
        value={price}
        onChangeText={setPrice}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <TextInput
        placeholder="Expires at (YYYY-MM-DD)"
        value={expiresAt}
        onChangeText={setExpiresAt}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <Button title="Assign package" onPress={assignPackage} />

      <FlatList
        data={packages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text>{item.package_name}</Text>
            <Text>
              {item.sessions_used}/{item.total_sessions} used
            </Text>
            <Text>Expires: {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : "None"}</Text>
            <Button title="Mark used" onPress={() => markUsed(item.id)} />
          </View>
        )}
      />
    </View>
  );
}
