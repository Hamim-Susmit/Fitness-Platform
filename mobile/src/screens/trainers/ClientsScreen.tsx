import { useEffect, useState } from "react";
import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";

type ClientRow = {
  id: string;
  member_id: string;
  members?: { users?: { full_name: string | null } | null } | null;
};

type TrainerRow = {
  id: string;
};

export default function ClientsScreen() {
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
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

      const { data: clientRows } = await supabase
        .from("trainer_clients")
        .select("id, member_id, members(users(full_name))")
        .eq("trainer_id", trainerRow.id)
        .order("created_at", { ascending: false });

      setTrainer(trainerRow as TrainerRow);
      setClients((clientRows ?? []) as ClientRow[]);
      setLoading(false);
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading clients...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Clients</Text>
      <FlatList
        data={clients}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text>{item.members?.users?.full_name ?? "Member"}</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity onPress={() => alert("Open workouts")}> 
                <Text style={{ color: "#0ea5e9" }}>Workouts</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => alert("Open progress history")}> 
                <Text style={{ color: "#0ea5e9" }}>Progress</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => alert("Open notes")}> 
                <Text style={{ color: "#0ea5e9" }}>Notes</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text>No clients assigned.</Text>}
      />
    </View>
  );
}
