import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type ClassInstanceRow = {
  id: string;
  start_at: string;
  gym_id: string;
  gyms: { name: string | null } | null;
  class_schedules: {
    class_types: { name: string } | null;
    instructors: { users: { full_name: string | null } | null } | null;
  } | null;
};

const REMINDER_WINDOWS = [60, 15];
const WINDOW_BUFFER_MINUTES = 5;

// TODO: Add SMS reminders.
// TODO: Add email confirmations.
// TODO: Add smart reminder timing based on user behavior.
// TODO: Add quiet hours settings.
// TODO: Add digest mode for batch notifications.
// TODO: Add per-class reminder overrides.

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildPayload(instance: ClassInstanceRow, reminderMinutes: number) {
  return {
    class_instance_id: instance.id,
    class_name: instance.class_schedules?.class_types?.name ?? "Class",
    start_time: instance.start_at,
    location: instance.gyms?.name ?? "Gym",
    instructor: instance.class_schedules?.instructors?.users?.full_name ?? "Staff",
    reminder_minutes: reminderMinutes,
  };
}

Deno.serve(async () => {
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const inserted: Array<{ window: number; count: number }> = [];

  for (const reminderMinutes of REMINDER_WINDOWS) {
    const start = new Date(now.getTime() + reminderMinutes * 60 * 1000);
    const end = new Date(start.getTime() + WINDOW_BUFFER_MINUTES * 60 * 1000);

    const { data: instances, error: instanceError } = await serviceClient
      .from("class_instances")
      .select("id, start_at, gym_id, gyms(name), class_schedules(class_types(name), instructors(users(full_name)))")
      .eq("status", "scheduled")
      .gte("start_at", start.toISOString())
      .lt("start_at", end.toISOString());

    if (instanceError || !instances?.length) {
      inserted.push({ window: reminderMinutes, count: 0 });
      continue;
    }

    const instanceIds = instances.map((instance) => instance.id);

    const { data: bookings } = await serviceClient
      .from("class_bookings")
      .select("member_id, class_instance_id")
      .in("class_instance_id", instanceIds)
      .eq("status", "booked");

    if (!bookings?.length) {
      inserted.push({ window: reminderMinutes, count: 0 });
      continue;
    }

    const memberIds = Array.from(new Set(bookings.map((booking) => booking.member_id)));

    const { data: members } = await serviceClient
      .from("members")
      .select("id, user_id")
      .in("id", memberIds);

    const memberMap = new Map<string, string>();
    members?.forEach((member) => memberMap.set(member.id, member.user_id));

    const userIds = Array.from(new Set(members?.map((member) => member.user_id) ?? []));

    const { data: preferences } = await serviceClient
      .from("notification_preferences")
      .select("user_id, class_reminders_enabled")
      .in("user_id", userIds);

    const preferenceMap = new Map<string, boolean>();
    preferences?.forEach((pref) => preferenceMap.set(pref.user_id, pref.class_reminders_enabled));

    const { data: existingNotifications } = await serviceClient
      .from("notifications")
      .select("user_id, payload")
      .eq("status", "queued")
      .eq("type", "CLASS_REMINDER")
      .in("user_id", userIds)
      .in("payload->>class_instance_id", instanceIds)
      .eq("payload->>reminder_minutes", String(reminderMinutes));

    const existingKeys = new Set<string>();
    existingNotifications?.forEach((row) => {
      const payload = row.payload as { class_instance_id?: string; reminder_minutes?: number | string };
      if (payload?.class_instance_id) {
        existingKeys.add(`${row.user_id}:${payload.class_instance_id}:${payload.reminder_minutes}`);
      }
    });

    const inserts = [] as Array<{
      user_id: string;
      type: "CLASS_REMINDER";
      payload: Record<string, unknown>;
      status: "queued";
    }>;

    for (const booking of bookings) {
      const userId = memberMap.get(booking.member_id);
      if (!userId) {
        continue;
      }

      const enabled = preferenceMap.get(userId);
      if (enabled === false) {
        continue;
      }

      const instance = instances.find((item) => item.id === booking.class_instance_id);
      if (!instance) {
        continue;
      }

      const key = `${userId}:${instance.id}:${reminderMinutes}`;
      if (existingKeys.has(key)) {
        continue;
      }

      inserts.push({
        user_id: userId,
        type: "CLASS_REMINDER",
        payload: buildPayload(instance, reminderMinutes),
        status: "queued",
      });
    }

    if (inserts.length) {
      const { error: insertError } = await serviceClient.from("notifications").insert(inserts);
      if (insertError) {
        console.log("class_reminder_insert_error", insertError.message);
      }
    }

    inserted.push({ window: reminderMinutes, count: inserts.length });
  }

  return jsonResponse(200, { inserted });
});
