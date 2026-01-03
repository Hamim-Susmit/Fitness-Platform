import { useEffect, useMemo, useState } from "react";
import { FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";

type TrainerRow = {
  id: string;
  user_id: string;
  bio: string;
  certifications: string[];
  specialties: string[];
  hourly_rate: number;
  users?: { full_name: string | null } | null;
};

export default function TrainerDirectoryScreen() {
  const [trainers, setTrainers] = useState<TrainerRow[]>([]);
  const [specialtyFilter, setSpecialtyFilter] = useState("");
  const [certFilter, setCertFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      let query = supabase
        .from("personal_trainers")
        .select("id, user_id, bio, certifications, specialties, hourly_rate, users(full_name)")
        .order("rating_avg", { ascending: false });

      if (specialtyFilter) {
        query = query.contains("specialties", [specialtyFilter]);
      }
      if (certFilter) {
        query = query.contains("certifications", [certFilter]);
      }

      const { data } = await query;
      setTrainers((data ?? []) as TrainerRow[]);
      setLoading(false);
    };

    loadData();
  }, [certFilter, specialtyFilter]);

  const specialties = useMemo(() => {
    return Array.from(new Set(trainers.flatMap((trainer) => trainer.specialties ?? []))).sort();
  }, [trainers]);

  const certifications = useMemo(() => {
    return Array.from(new Set(trainers.flatMap((trainer) => trainer.certifications ?? []))).sort();
  }, [trainers]);

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading trainers...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Trainer Directory</Text>
      <TextInput
        placeholder="Filter specialty"
        value={specialtyFilter}
        onChangeText={setSpecialtyFilter}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />
      <TextInput
        placeholder="Filter certification"
        value={certFilter}
        onChangeText={setCertFilter}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />

      <FlatList
        data={trainers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text style={{ fontSize: 16, fontWeight: "600" }}>{item.users?.full_name ?? "Trainer"}</Text>
            <Text>{item.bio}</Text>
            <Text>Specialties: {(item.specialties ?? []).join(", ")}</Text>
            <Text>Certifications: {(item.certifications ?? []).join(", ")}</Text>
            <Text>${item.hourly_rate}/hr</Text>
            <TouchableOpacity onPress={() => alert("Training request sent.")}> 
              <Text style={{ color: "#0ea5e9" }}>Request training</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text>No trainers available.</Text>}
      />
    </View>
  );
}
