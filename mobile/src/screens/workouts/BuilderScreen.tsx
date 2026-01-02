import { useEffect, useMemo, useState } from "react";
import { Button, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { supabase } from "../../lib/supabase";

type ExerciseRow = {
  id: string;
  name: string;
};

type TemplateRow = {
  id: string;
  title: string;
};

type TemplateExerciseRow = {
  exercise_id: string;
  order_index: number;
};

type WorkoutRow = {
  id: string;
  title: string;
};

export default function BuilderScreen() {
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [workoutTitle, setWorkoutTitle] = useState("Custom Workout");
  const [selectedExercises, setSelectedExercises] = useState<ExerciseRow[]>([]);
  const [draftWorkout, setDraftWorkout] = useState<WorkoutRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const [{ data: exerciseRows }, { data: templateRows }, { data: workoutRows }] = await Promise.all([
        supabase.from("exercises").select("id, name").order("name"),
        supabase.from("workout_templates").select("id, title").order("created_at", { ascending: false }),
        supabase
          .from("workouts")
          .select("id, title, completed_at")
          .eq("member_id", user?.id ?? "")
          .is("completed_at", null)
          .limit(1),
      ]);

      setExercises((exerciseRows ?? []) as ExerciseRow[]);
      setTemplates((templateRows ?? []) as TemplateRow[]);
      setDraftWorkout((workoutRows ?? [])[0] ?? null);
      setLoading(false);
    };

    loadData();
  }, []);

  const applyTemplate = async (template: TemplateRow) => {
    setTemplateId(template.id);
    setWorkoutTitle(template.title);

    const { data } = await supabase
      .from("workout_template_exercises")
      .select("exercise_id, order_index")
      .eq("template_id", template.id)
      .order("order_index", { ascending: true });

    const templateExercises = (data ?? []) as TemplateExerciseRow[];
    const mapped = templateExercises
      .map((row) => exercises.find((exercise) => exercise.id === row.exercise_id))
      .filter((exercise): exercise is ExerciseRow => !!exercise);

    setSelectedExercises(mapped);
  };

  const addExercise = (exercise: ExerciseRow) => {
    setSelectedExercises((prev) => [...prev, exercise]);
  };

  const removeExercise = (index: number) => {
    setSelectedExercises((prev) => prev.filter((_, idx) => idx !== index));
  };

  const moveExercise = (index: number, direction: -1 | 1) => {
    setSelectedExercises((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const saveWorkout = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: workoutRow } = await supabase
      .from("workouts")
      .insert({
        member_id: user.id,
        title: workoutTitle,
        source: templateId ? "TEMPLATE" : "CUSTOM",
        template_id: templateId,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (workoutRow?.id) {
      const payload = selectedExercises.map((exercise, index) => ({
        workout_id: workoutRow.id,
        exercise_id: exercise.id,
        order_index: index,
      }));
      if (payload.length) {
        await supabase.from("workout_exercises").insert(payload);
      }
    }
  };

  const availableExercises = useMemo(() => exercises, [exercises]);

  if (loading) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Workout Builder</Text>
      {draftWorkout ? <Text>Draft workout available: {draftWorkout.title}</Text> : null}

      <Text>Templates</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <TouchableOpacity onPress={() => {
          setTemplateId(null);
          setWorkoutTitle("Custom Workout");
          setSelectedExercises([]);
        }}>
          <Text style={{ color: "#0ea5e9" }}>Custom Blank</Text>
        </TouchableOpacity>
        {templates.map((template) => (
          <TouchableOpacity key={template.id} onPress={() => applyTemplate(template)}>
            <Text style={{ color: templateId === template.id ? "#22c55e" : "#0ea5e9" }}>{template.title}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text>Workout title</Text>
      <TextInput
        value={workoutTitle}
        onChangeText={setWorkoutTitle}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8 }}
      />

      <Text>Add exercise</Text>
      <FlatList
        data={availableExercises}
        keyExtractor={(item) => item.id}
        horizontal
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => addExercise(item)} style={{ marginRight: 12 }}>
            <Text style={{ color: "#0ea5e9" }}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />

      <Text>Selected exercises</Text>
      {selectedExercises.map((exercise, index) => (
        <View key={`${exercise.id}-${index}`} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text>{exercise.name}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Up" onPress={() => moveExercise(index, -1)} />
            <Button title="Down" onPress={() => moveExercise(index, 1)} />
            <Button title="Remove" onPress={() => removeExercise(index)} />
          </View>
        </View>
      ))}

      <Button title="Save workout" onPress={saveWorkout} disabled={!selectedExercises.length} />
    </View>
  );
}
