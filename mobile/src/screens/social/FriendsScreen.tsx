import { useEffect, useMemo, useState } from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";

type FriendRow = {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: string;
  created_at: string;
};

export default function FriendsScreen() {
  const [friendRows, setFriendRows] = useState<FriendRow[]>([]);
  const [receiverId, setReceiverId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data } = await supabase
        .from("friends")
        .select("id, requester_id, receiver_id, status, created_at")
        .or(`requester_id.eq.${user?.id ?? ""},receiver_id.eq.${user?.id ?? ""}`)
        .order("created_at", { ascending: false });

      setFriendRows((data ?? []) as FriendRow[]);
      setLoading(false);
    };

    loadData();
  }, []);

  const sendRequest = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !receiverId) return;
    const { data } = await supabase
      .from("friends")
      .insert({ requester_id: user.id, receiver_id: receiverId, status: "PENDING" })
      .select("id, requester_id, receiver_id, status, created_at")
      .maybeSingle();

    if (data) {
      setFriendRows((prev) => [data as FriendRow, ...prev]);
      setReceiverId("");
    }
  };

  const updateStatus = async (friendId: string, status: string) => {
    const { data } = await supabase
      .from("friends")
      .update({ status })
      .eq("id", friendId)
      .select("id, requester_id, receiver_id, status, created_at")
      .maybeSingle();

    if (data) {
      setFriendRows((prev) => prev.map((row) => (row.id === friendId ? (data as FriendRow) : row)));
    }
  };

  const pending = useMemo(() => friendRows.filter((row) => row.status === "PENDING"), [friendRows]);
  const accepted = useMemo(() => friendRows.filter((row) => row.status === "ACCEPTED"), [friendRows]);
  const blocked = useMemo(() => friendRows.filter((row) => row.status === "BLOCKED"), [friendRows]);

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading friends...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Friends</Text>
      <TextInput placeholder="Receiver user id" value={receiverId} onChangeText={setReceiverId} style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }} />
      <Button title="Send request" onPress={sendRequest} />

      <Text style={{ fontSize: 16, fontWeight: "600" }}>Pending</Text>
      <FlatList
        data={pending}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 6 }}>
            <Text>{item.requester_id} → {item.receiver_id}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title="Accept" onPress={() => updateStatus(item.id, "ACCEPTED")} />
              <Button title="Reject" onPress={() => updateStatus(item.id, "REJECTED")} />
              <Button title="Block" onPress={() => updateStatus(item.id, "BLOCKED")} />
            </View>
          </View>
        )}
        ListEmptyComponent={<Text>No pending requests.</Text>}
      />

      <Text style={{ fontSize: 16, fontWeight: "600" }}>Friends</Text>
      <FlatList
        data={accepted}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 6 }}>
            <Text>{item.requester_id} ↔ {item.receiver_id}</Text>
            <Button title="Block" onPress={() => updateStatus(item.id, "BLOCKED")} />
          </View>
        )}
        ListEmptyComponent={<Text>No friends yet.</Text>}
      />

      <Text style={{ fontSize: 16, fontWeight: "600" }}>Blocked</Text>
      <FlatList
        data={blocked}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 6 }}>
            <Text>{item.requester_id} ↔ {item.receiver_id}</Text>
            <Button title="Unblock" onPress={() => updateStatus(item.id, "REJECTED")} />
          </View>
        )}
        ListEmptyComponent={<Text>No blocked users.</Text>}
      />
    </View>
  );
}
