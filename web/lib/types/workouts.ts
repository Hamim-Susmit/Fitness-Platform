import { z } from "zod";

export const ExerciseCategorySchema = z.enum(["strength", "cardio", "mobility", "stretch"]);
export const ExerciseDifficultySchema = z.enum(["beginner", "intermediate", "advanced"]);
export const WorkoutOwnerTypeSchema = z.enum(["SYSTEM", "TRAINER", "MEMBER"]);
export const WorkoutGoalSchema = z.enum(["strength", "hypertrophy", "endurance", "mobility"]);
export const WorkoutWeightUnitSchema = z.enum(["kg", "lb"]);
export const WorkoutSourceSchema = z.enum(["TEMPLATE", "CUSTOM", "IMPORT"]);

export const ExerciseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: ExerciseCategorySchema,
  primary_muscle_group: z.string(),
  secondary_muscle_groups: z.array(z.string()),
  equipment: z.array(z.string()),
  difficulty: ExerciseDifficultySchema,
  is_bodyweight: z.boolean(),
  video_url: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const WorkoutTemplateSchema = z.object({
  id: z.string().uuid(),
  owner_type: WorkoutOwnerTypeSchema,
  owner_id: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string(),
  target_goal: WorkoutGoalSchema,
  difficulty: ExerciseDifficultySchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export const WorkoutTemplateExerciseSchema = z.object({
  id: z.string().uuid(),
  template_id: z.string().uuid(),
  exercise_id: z.string().uuid(),
  order_index: z.number().int(),
  default_sets: z.number().int(),
  default_reps: z.number().int().nullable(),
  default_weight_unit: WorkoutWeightUnitSchema.nullable(),
  default_rest_seconds: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const WorkoutInstanceSchema = z.object({
  id: z.string().uuid(),
  member_id: z.string().uuid(),
  template_id: z.string().uuid().nullable(),
  title: z.string(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  source: WorkoutSourceSchema,
});

export const WorkoutExerciseSchema = z.object({
  id: z.string().uuid(),
  workout_id: z.string().uuid(),
  exercise_id: z.string().uuid(),
  order_index: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const WorkoutLogSchema = z.object({
  id: z.string().uuid(),
  workout_exercise_id: z.string().uuid(),
  set_number: z.number().int(),
  reps: z.number().int().nullable(),
  weight: z.number().nullable(),
  weight_unit: WorkoutWeightUnitSchema.nullable(),
  rpe: z.number().nullable(),
  notes: z.string().nullable(),
  logged_at: z.string(),
});

export const WorkoutPrSchema = z.object({
  id: z.string().uuid(),
  member_id: z.string().uuid(),
  exercise_id: z.string().uuid(),
  pr_type: z.enum(["1RM", "MAX_WEIGHT", "MAX_REPS"]),
  value: z.number(),
  achieved_at: z.string(),
});

export type Exercise = z.infer<typeof ExerciseSchema>;
export type WorkoutTemplate = z.infer<typeof WorkoutTemplateSchema>;
export type WorkoutTemplateExercise = z.infer<typeof WorkoutTemplateExerciseSchema>;
export type WorkoutInstance = z.infer<typeof WorkoutInstanceSchema>;
export type WorkoutExercise = z.infer<typeof WorkoutExerciseSchema>;
export type WorkoutLog = z.infer<typeof WorkoutLogSchema>;
export type WorkoutPr = z.infer<typeof WorkoutPrSchema>;
