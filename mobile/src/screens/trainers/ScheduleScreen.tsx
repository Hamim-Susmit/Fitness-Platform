import { useEffect, useState } from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";

type TrainerRow = {
  id: string;
};

type ClientRow = {
  member_id: string;
  members?: { users?: { full_name: string | null } | null } | null;
};

type SessionRow = {
  id: string;
  member_id: string;
  session_start: string;
  session_end: string;
  status: string;
};

export default function ScheduleScreen() {
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
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

      const [{ data: clientRows }, { data: sessionRows }] = await Promise.all([
        supabase
          .from("trainer_clients")
          .select("member_id, members(users(full_name))")
          .eq("trainer_id", trainerRow.id),
        supabase
          .from("trainer_sessions")
          .select("id, member_id, session_start, session_end, status")
          .eq("trainer_id", trainerRow.id)
          .order("session_start", { ascending: false }),
      ]);

      setTrainer(trainerRow as TrainerRow);
      setClients((clientRows ?? []) as ClientRow[]);
      setSessions((sessionRows ?? []) as SessionRow[]);
      setLoading(false);
    };

    loadData();
  }, []);

  const createSession = async () => {
    if (!trainer || !selectedMemberId || !startTime || !endTime) return;
    const { data } = await supabase
      .from("trainer_sessions")
      .insert({
        trainer_id: trainer.id,
        member_id: selectedMemberId,
        session_start: startTime,
        session_end: endTime,
        status: "SCHEDULED",
      })
      .select("id, member_id, session_start, session_end, status")
      .maybeSingle();

    if (data) {
      setSessions((prev) => [data as SessionRow, ...prev]);
    }
  };

  const updateStatus = async (sessionId: string, status: string) => {
    const { data } = await supabase
      .from("trainer_sessions")
      .update({ status })
      .eq("id", sessionId)
      .select("id, member_id, session_start, session_end, status")
      .maybeSingle();

    if (data) {
      setSessions((prev) => prev.map((row) => (row.id === sessionId ? (data as SessionRow) : row)));
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading schedule...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Schedule</Text>
      <Text>Select client</Text>
      <FlatList
        data={clients}
        keyExtractor={(item) => item.member_id}
        horizontal
        renderItem={({ item }) => (
          <Button
            title={item.members?.users?.full_name ?? item.member_id}
            onPress={() => setSelectedMemberId(item.member_id)}
          />
        )}
        ListEmptyComponent={<Text>No clients assigned.</Text>}
      />
      <TextInput
        placeholder="Start time (ISO)"
        value={startTime}
        onChangeText={setStartTime}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <TextInput
        placeholder="End time (ISO)"
        value={endTime}
        onChangeText={setEndTime}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <Button title="Create session" onPress={createSession} />

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text>Member: {item.member_id}</Text>
            <Text>{new Date(item.session_start).toLocaleString()}</Text>
            <Text>Status: {item.status}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title="Complete" onPress={() => updateStatus(item.id, "COMPLETED")} />
              <Button title="Cancel" onPress={() => updateStatus(item.id, "CANCELLED")} />
              <Button title="No-show" onPress={() => updateStatus(item.id, "NO_SHOW")} />
            </View>
          </View>
        )}
      />
    </View>
  );
}
