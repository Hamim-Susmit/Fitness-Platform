export type ClassType = {
  id: string;
  gym_id: string;
  name: string;
  description: string | null;
  intensity: string | null;
  duration_minutes: number;
  created_at: string;
};

export type Instructor = {
  id: string;
  gym_id: string;
  user_id: string | null;
  bio: string | null;
  specialties: string[];
  active: boolean;
  created_at: string;
};

export type ClassSchedule = {
  id: string;
  gym_id: string;
  class_type_id: string;
  instructor_id: string | null;
  capacity: number;
  start_time: string;
  end_time: string;
  timezone: string;
  recurrence_rule: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ClassInstance = {
  id: string;
  schedule_id: string;
  gym_id: string;
  class_date: string;
  start_at: string;
  end_at: string;
  capacity: number;
  status: "scheduled" | "canceled" | "completed";
  created_at: string;
};
