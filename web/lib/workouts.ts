import { z } from "zod";
import { supabaseBrowser } from "./supabase-browser";
import {
  ExerciseSchema,
  WorkoutTemplateSchema,
  WorkoutTemplateExerciseSchema,
  WorkoutGoalSchema,
  ExerciseDifficultySchema,
} from "./types/workouts";

const createTemplateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  target_goal: WorkoutGoalSchema,
  difficulty: ExerciseDifficultySchema,
});

const attachExerciseSchema = z.object({
  exercise_id: z.string().uuid(),
  order_index: z.number().int().min(0),
  default_sets: z.number().int().min(1),
  default_reps: z.number().int().nullable().optional(),
  default_weight_unit: z.enum(["kg", "lb"]).nullable().optional(),
  default_rest_seconds: z.number().int().nullable().optional(),
});

// List exercises for pickers and template builders.
export async function listExercises() {
  const { data, error } = await supabaseBrowser.from("exercises").select("*").order("name");

  if (error) {
    throw new Error(`Failed to load exercises: ${error.message}`);
  }

  const parsed = z.array(ExerciseSchema).safeParse(data ?? []);
  if (!parsed.success) {
    throw new Error("Invalid exercise payload received.");
  }

  return parsed.data;
}

// Return templates a member can use (system + their own + trainer templates).
export async function listWorkoutTemplatesForMember(memberId: string) {
  const memberIdSchema = z.string().uuid();
  const parsedMemberId = memberIdSchema.safeParse(memberId);
  if (!parsedMemberId.success) {
    throw new Error("Invalid member id.");
  }

  const { data, error } = await supabaseBrowser
    .from("workout_templates")
    .select("*")
    .or(`owner_type.eq.SYSTEM,owner_type.eq.TRAINER,owner_id.eq.${memberId}`)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load workout templates: ${error.message}`);
  }

  const parsed = z.array(WorkoutTemplateSchema).safeParse(data ?? []);
  if (!parsed.success) {
    throw new Error("Invalid workout template payload received.");
  }

  return parsed.data;
}

// Create a member-owned template (custom workout plan).
export async function createCustomWorkoutTemplate(memberId: string, payload: z.input<typeof createTemplateSchema>) {
  const parsedMemberId = z.string().uuid().safeParse(memberId);
  if (!parsedMemberId.success) {
    throw new Error("Invalid member id.");
  }

  const parsedPayload = createTemplateSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new Error("Invalid template payload.");
  }

  const { data, error } = await supabaseBrowser
    .from("workout_templates")
    .insert({
      owner_type: "MEMBER",
      owner_id: memberId,
      title: parsedPayload.data.title,
      description: parsedPayload.data.description ?? "",
      target_goal: parsedPayload.data.target_goal,
      difficulty: parsedPayload.data.difficulty,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to create workout template: ${error.message}`);
  }

  const parsed = WorkoutTemplateSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Invalid template payload returned.");
  }

  return parsed.data;
}

// Attach an exercise to a template. Consumers should ensure ownership before calling.
export async function attachExerciseToTemplate(
  templateId: string,
  payload: z.input<typeof attachExerciseSchema>
) {
  const parsedTemplateId = z.string().uuid().safeParse(templateId);
  if (!parsedTemplateId.success) {
    throw new Error("Invalid template id.");
  }

  const parsedPayload = attachExerciseSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new Error("Invalid exercise attachment payload.");
  }

  const { data, error } = await supabaseBrowser
    .from("workout_template_exercises")
    .insert({
      template_id: templateId,
      exercise_id: parsedPayload.data.exercise_id,
      order_index: parsedPayload.data.order_index,
      default_sets: parsedPayload.data.default_sets,
      default_reps: parsedPayload.data.default_reps ?? null,
      default_weight_unit: parsedPayload.data.default_weight_unit ?? null,
      default_rest_seconds: parsedPayload.data.default_rest_seconds ?? null,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to attach exercise: ${error.message}`);
  }

  const parsed = WorkoutTemplateExerciseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Invalid template exercise payload returned.");
  }

  return parsed.data;
}
