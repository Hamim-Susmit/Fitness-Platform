import { useEffect, useState } from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";

type NoteRow = {
  id: string;
  note: string;
  visibility: "TRAINER_ONLY" | "SHARED_WITH_MEMBER";
  created_at: string;
};

type TrainerRow = {
  id: string;
};

type Props = {
  memberId: string;
};

export default function MemberNotesScreen({ memberId }: Props) {
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteText, setNoteText] = useState("");
  const [visibility, setVisibility] = useState<NoteRow["visibility"]>("TRAINER_ONLY");
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

      const { data: noteRows } = await supabase
        .from("trainer_progress_notes")
        .select("id, note, visibility, created_at")
        .eq("trainer_id", trainerRow.id)
        .eq("member_id", memberId)
        .order("created_at", { ascending: false });

      setTrainer(trainerRow as TrainerRow);
      setNotes((noteRows ?? []) as NoteRow[]);
      setLoading(false);
    };

    loadData();
  }, [memberId]);

  const addNote = async () => {
    if (!trainer || !noteText.trim()) return;
    const { data } = await supabase
      .from("trainer_progress_notes")
      .insert({
        trainer_id: trainer.id,
        member_id: memberId,
        note: noteText,
        visibility,
      })
      .select("id, note, visibility, created_at")
      .maybeSingle();

    if (data) {
      setNotes((prev) => [data as NoteRow, ...prev]);
      setNoteText("");
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading notes...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Progress Notes</Text>
      <TextInput
        placeholder="Write a note"
        value={noteText}
        onChangeText={setNoteText}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button title="Trainer only" onPress={() => setVisibility("TRAINER_ONLY")} />
        <Button title="Shared" onPress={() => setVisibility("SHARED_WITH_MEMBER")} />
      </View>
      <Button title="Add note" onPress={addNote} />

      <FlatList
        data={notes}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text>{item.note}</Text>
            <Text>{item.visibility}</Text>
          </View>
        )}
      />
    </View>
  );
}
