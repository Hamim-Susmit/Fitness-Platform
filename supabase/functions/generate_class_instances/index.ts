import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rrulestr } from "npm:rrule@2.8.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type GenerateRequest = {
  gym_id?: string;
  from?: string;
  to?: string;
  regenerate?: boolean;
};

type Schedule = {
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
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isValidDateRange(from: Date, to: Date) {
  return !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to;
}

function daysBetween(from: Date, to: Date) {
  const diff = to.getTime() - from.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
}

function toClassDate(date: Date, timezone: string) {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

function buildInstanceTimes(classDate: string, startTime: string, endTime: string) {
  const startAt = new Date(`${classDate}T${startTime}`);
  const endAt = new Date(`${classDate}T${endTime}`);
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: GenerateRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.gym_id || !payload.from || !payload.to) {
    return jsonResponse(400, { error: "missing_parameters" });
  }

  const fromDate = new Date(`${payload.from}T00:00:00Z`);
  const toDate = new Date(`${payload.to}T23:59:59Z`);

  if (!isValidDateRange(fromDate, toDate)) {
    return jsonResponse(400, { error: "invalid_date_range" });
  }

  if (daysBetween(fromDate, toDate) > 90) {
    return jsonResponse(400, { error: "range_too_large" });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse(401, { error: "invalid_user" });
  }

  const { data: staff } = await userClient
    .from("staff")
    .select("gym_id")
    .eq("user_id", user.id)
    .eq("gym_id", payload.gym_id)
    .maybeSingle();

  const { data: gymOwner } = await userClient
    .from("gyms")
    .select("id")
    .eq("id", payload.gym_id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!staff && !gymOwner) {
    return jsonResponse(403, { error: "not_authorized" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (payload.regenerate) {
    await serviceClient
      .from("class_instances")
      .delete()
      .eq("gym_id", payload.gym_id)
      .gte("class_date", payload.from)
      .lte("class_date", payload.to);
  }

  const { data: schedules } = await serviceClient
    .from("class_schedules")
    .select(
      "id, gym_id, class_type_id, instructor_id, capacity, start_time, end_time, timezone, recurrence_rule, start_date, end_date, is_active"
    )
    .eq("gym_id", payload.gym_id)
    .eq("is_active", true)
    .lte("start_date", payload.to)
    .or(`end_date.is.null,end_date.gte.${payload.from}`);

  const { data: existing } = await serviceClient
    .from("class_instances")
    .select("schedule_id, class_date")
    .eq("gym_id", payload.gym_id)
    .gte("class_date", payload.from)
    .lte("class_date", payload.to);

  const existingKeys = new Set(
    (existing ?? []).map((row: { schedule_id: string; class_date: string }) => `${row.schedule_id}-${row.class_date}`)
  );

  let created = 0;
  let skipped = 0;
  const affectedSchedules: string[] = [];
  const inserts: Record<string, unknown>[] = [];

  for (const schedule of (schedules ?? []) as Schedule[]) {
    affectedSchedules.push(schedule.id);
    const scheduleStart = schedule.start_date;
    const scheduleEnd = schedule.end_date ?? payload.to;

    if (!schedule.recurrence_rule) {
      if (scheduleStart >= payload.from && scheduleStart <= payload.to) {
        const key = `${schedule.id}-${scheduleStart}`;
        if (existingKeys.has(key)) {
          skipped += 1;
        } else {
          const { startAt, endAt } = buildInstanceTimes(scheduleStart, schedule.start_time, schedule.end_time);
          inserts.push({
            schedule_id: schedule.id,
            gym_id: schedule.gym_id,
            class_date: scheduleStart,
            start_at: startAt,
            end_at: endAt,
            capacity: schedule.capacity,
          });
          created += 1;
        }
      }
      continue;
    }

    // TODO: handle holiday blackouts and instructor substitutions
    // TODO: add per-instance overrides and capacity overrides

    const rule = rrulestr(schedule.recurrence_rule, {
      dtstart: new Date(`${scheduleStart}T00:00:00Z`),
    });

    const occurrences = rule.between(new Date(`${payload.from}T00:00:00Z`), new Date(`${scheduleEnd}T23:59:59Z`), true);

    for (const occurrence of occurrences) {
      const classDate = toClassDate(occurrence, schedule.timezone);
      if (classDate < payload.from || classDate > payload.to) {
        continue;
      }
      const key = `${schedule.id}-${classDate}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      const { startAt, endAt } = buildInstanceTimes(classDate, schedule.start_time, schedule.end_time);
      inserts.push({
        schedule_id: schedule.id,
        gym_id: schedule.gym_id,
        class_date: classDate,
        start_at: startAt,
        end_at: endAt,
        capacity: schedule.capacity,
      });
      created += 1;
    }
  }

  if (inserts.length > 0) {
    const { error } = await serviceClient.from("class_instances").insert(inserts);
    if (error) {
      return jsonResponse(500, { error: "insert_failed", details: error.message });
    }
  }

  console.log("class instance generation", {
    created,
    skipped,
    schedules: affectedSchedules,
  });

  return jsonResponse(200, {
    created,
    skipped_existing: skipped,
    range: { from: payload.from, to: payload.to },
  });
});
