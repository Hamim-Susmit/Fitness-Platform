import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type RangeInput = { from: string; to: string };

type GymAnalyticsRequest = {
  gym_id?: string;
  range?: RangeInput;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function average(values: number[]) {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

// Access control for gym analytics lives here (service role reads).
// TODO: add corporate admin roles + chain-level analytics for Phase 4+.
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: GymAnalyticsRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.gym_id) {
    return jsonResponse(400, { error: "gym_id_required" });
  }

  const rangeFrom = parseDate(payload.range?.from);
  const rangeTo = parseDate(payload.range?.to);

  if (!rangeFrom || !rangeTo) {
    return jsonResponse(400, { error: "invalid_range" });
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

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: staffRoles } = await serviceClient
    .from("staff_roles")
    .select("gym_id")
    .eq("user_id", user.id)
    .eq("gym_id", payload.gym_id)
    .limit(1);

  const { data: legacyStaff } = await serviceClient
    .from("staff")
    .select("gym_id")
    .eq("user_id", user.id)
    .eq("gym_id", payload.gym_id)
    .limit(1);

  const { data: instructor } = await serviceClient
    .from("instructors")
    .select("gym_id")
    .eq("user_id", user.id)
    .eq("gym_id", payload.gym_id)
    .eq("active", true)
    .limit(1);

  const hasAccess = (staffRoles?.length ?? 0) > 0 || (legacyStaff?.length ?? 0) > 0 || (instructor?.length ?? 0) > 0;

  if (!hasAccess) {
    return jsonResponse(403, { error: "not_authorized" });
  }

  const { data: performanceRows, error: performanceError } = await serviceClient
    .from("gym_performance_mv")
    .select("period_start, total_checkins, unique_members, total_classes, avg_fill_rate, avg_attendance_rate")
    .eq("gym_id", payload.gym_id)
    .gte("period_start", rangeFrom)
    .lte("period_start", rangeTo)
    .order("period_start", { ascending: true });

  if (performanceError) {
    return jsonResponse(500, { error: "analytics_fetch_failed" });
  }

  const { data: checkinsRows, error: checkinsError } = await serviceClient
    .from("checkins")
    .select("member_id, checked_in_at")
    .eq("gym_id", payload.gym_id)
    .gte("checked_in_at", `${rangeFrom}T00:00:00`)
    .lte("checked_in_at", `${rangeTo}T23:59:59`);

  if (checkinsError) {
    return jsonResponse(500, { error: "checkins_fetch_failed" });
  }

  const totalCheckins = checkinsRows?.length ?? 0;
  const uniqueMembers = new Set((checkinsRows ?? []).map((row) => row.member_id)).size;

  const { data: insightsRows, error: insightsError } = await serviceClient
    .from("class_insights_mv")
    .select("instance_id, class_type_id, fill_rate, attendance_rate, booked_count, waitlist_count, no_show_count")
    .eq("gym_id", payload.gym_id)
    .gte("date", rangeFrom)
    .lte("date", rangeTo);

  if (insightsError) {
    return jsonResponse(500, { error: "insights_fetch_failed" });
  }

  const fillRates = (insightsRows ?? []).map((row) => row.fill_rate).filter((value): value is number => value !== null);
  const attendanceRates = (insightsRows ?? [])
    .map((row) => row.attendance_rate)
    .filter((value): value is number => value !== null);
  const totalBooked = (insightsRows ?? []).reduce((sum, row) => sum + (row.booked_count ?? 0), 0);
  const totalNoShows = (insightsRows ?? []).reduce((sum, row) => sum + (row.no_show_count ?? 0), 0);

  const summary = {
    total_checkins: totalCheckins,
    unique_members: uniqueMembers,
    avg_checkins_per_member: uniqueMembers === 0 ? 0 : totalCheckins / uniqueMembers,
    avg_fill_rate: average(fillRates),
    avg_attendance_rate: average(attendanceRates),
    no_show_rate: totalBooked === 0 ? 0 : totalNoShows / totalBooked,
  };

  const timeSeries = (performanceRows ?? []).map((row) => ({
    date: row.period_start,
    checkins: row.total_checkins,
    classes: row.total_classes,
    avg_fill_rate: row.avg_fill_rate ?? 0,
    avg_attendance_rate: row.avg_attendance_rate ?? 0,
  }));

  const classTypeMap = new Map<string, {
    sessions: number;
    fillRates: number[];
    attendanceRates: number[];
  }>();

  (insightsRows ?? []).forEach((row) => {
    if (!row.class_type_id) return;
    const entry = classTypeMap.get(row.class_type_id) ?? { sessions: 0, fillRates: [], attendanceRates: [] };
    entry.sessions += 1;
    if (row.fill_rate !== null) entry.fillRates.push(row.fill_rate);
    if (row.attendance_rate !== null) entry.attendanceRates.push(row.attendance_rate);
    classTypeMap.set(row.class_type_id, entry);
  });

  const classTypeIds = Array.from(classTypeMap.keys());
  const { data: classTypes } = await serviceClient
    .from("class_types")
    .select("id, name")
    .in("id", classTypeIds)
    .eq("gym_id", payload.gym_id);

  const classTypeNameMap = new Map((classTypes ?? []).map((row) => [row.id, row.name]));

  const topClassTypes = classTypeIds
    .map((classTypeId) => {
      const entry = classTypeMap.get(classTypeId)!;
      return {
        class_type_id: classTypeId,
        name: classTypeNameMap.get(classTypeId) ?? "Class",
        avg_fill_rate: average(entry.fillRates),
        avg_attendance_rate: average(entry.attendanceRates),
        sessions: entry.sessions,
      };
    })
    .sort((a, b) => b.avg_fill_rate - a.avg_fill_rate)
    .slice(0, 5);

  const { data: instanceRows } = await serviceClient
    .from("class_instances")
    .select("id, class_date, class_schedules(instructor_id, instructors(users(full_name)))")
    .eq("gym_id", payload.gym_id)
    .gte("class_date", rangeFrom)
    .lte("class_date", rangeTo);

  const insightsByInstance = new Map<string, { fillRate: number; attendanceRate: number }>();
  (insightsRows ?? []).forEach((row) => {
    insightsByInstance.set(row.instance_id, {
      fillRate: row.fill_rate ?? 0,
      attendanceRate: row.attendance_rate ?? 0,
    });
  });

  const instructorMap = new Map<string, {
    name: string;
    sessions: number;
    fillRates: number[];
    attendanceRates: number[];
  }>();

  (instanceRows ?? []).forEach((row) => {
    const instructorId = row.class_schedules?.instructor_id;
    if (!instructorId) return;
    const name = row.class_schedules?.instructors?.users?.full_name ?? "Instructor";
    const metrics = insightsByInstance.get(row.id);
    const entry = instructorMap.get(instructorId) ?? { name, sessions: 0, fillRates: [], attendanceRates: [] };
    entry.sessions += 1;
    if (metrics) {
      entry.fillRates.push(metrics.fillRate);
      entry.attendanceRates.push(metrics.attendanceRate);
    }
    instructorMap.set(instructorId, entry);
  });

  const topInstructors = Array.from(instructorMap.entries())
    .map(([instructorId, entry]) => ({
      instructor_id: instructorId,
      name: entry.name,
      sessions: entry.sessions,
      fill_rate: average(entry.fillRates),
      attendance_rate: average(entry.attendanceRates),
    }))
    .sort((a, b) => b.attendance_rate - a.attendance_rate)
    .slice(0, 5);

  return jsonResponse(200, {
    summary,
    time_series: timeSeries,
    top_class_types: topClassTypes,
    top_instructors: topInstructors,
  });
});
