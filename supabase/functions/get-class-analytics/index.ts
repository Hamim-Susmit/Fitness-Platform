import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type DateRange = { start: string; end: string };

type AnalyticsAction = "INSTANCE_OVERVIEW" | "CLASS_TYPE_SUMMARY" | "INSTRUCTOR_SUMMARY" | "GYM_TRENDS";

type AnalyticsRequest = {
  action?: AnalyticsAction;
  instance_id?: string;
  class_type_id?: string;
  instructor_id?: string;
  gym_id?: string;
  date_range?: DateRange;
};

type ActorContext = {
  userId: string;
  staffGymId: string | null;
  instructorId: string | null;
  instructorGymId: string | null;
};

// RLS note: analytics are served via Edge Functions with service role reads.
// Access control enforced here ensures instructors only see their own analytics,
// and staff access is scoped to their gym.
// TODO: analytic anomaly detection.
// TODO: failed data refresh detection.
// TODO: report export to CSV.
// TODO: scheduled weekly email report.

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseDateRange(range?: DateRange) {
  if (!range?.start || !range?.end) return null;
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function resolveActor(serviceClient: ReturnType<typeof createClient>, userId: string) {
  const { data: staff } = await serviceClient
    .from("staff")
    .select("gym_id")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: instructor } = await serviceClient
    .from("instructors")
    .select("id, gym_id")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  return {
    userId,
    staffGymId: staff?.gym_id ?? null,
    instructorId: instructor?.id ?? null,
    instructorGymId: instructor?.gym_id ?? null,
  } as ActorContext;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: AnalyticsRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.action) {
    return jsonResponse(400, { error: "missing_action" });
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

  const actor = await resolveActor(serviceClient, user.id);

  if (!actor.staffGymId && !actor.instructorId) {
    return jsonResponse(403, { error: "not_authorized" });
  }

  if (payload.action === "INSTANCE_OVERVIEW") {
    if (!payload.instance_id) {
      return jsonResponse(400, { error: "instance_id_required" });
    }

    const { data: instance } = await serviceClient
      .from("class_instances")
      .select("id, gym_id, schedule_id")
      .eq("id", payload.instance_id)
      .maybeSingle();

    if (!instance) {
      return jsonResponse(404, { error: "instance_not_found" });
    }

    if (actor.staffGymId && actor.staffGymId !== instance.gym_id) {
      return jsonResponse(403, { error: "gym_mismatch" });
    }

    if (actor.instructorId) {
      const { data: schedule } = await serviceClient
        .from("class_schedules")
        .select("instructor_id")
        .eq("id", instance.schedule_id)
        .maybeSingle();

      if (schedule?.instructor_id !== actor.instructorId) {
        return jsonResponse(403, { error: "not_authorized" });
      }
    }

    const { data: insight } = await serviceClient
      .from("class_insights_mv")
      .select("*")
      .eq("instance_id", instance.id)
      .maybeSingle();

    return jsonResponse(200, { insight });
  }

  if (payload.action === "CLASS_TYPE_SUMMARY") {
    if (!payload.class_type_id) {
      return jsonResponse(400, { error: "class_type_id_required" });
    }

    const range = parseDateRange(payload.date_range);
    if (!range) {
      return jsonResponse(400, { error: "invalid_date_range" });
    }

    const { data: classType } = await serviceClient
      .from("class_types")
      .select("gym_id")
      .eq("id", payload.class_type_id)
      .maybeSingle();

    if (!classType) {
      return jsonResponse(404, { error: "class_type_not_found" });
    }

    if (actor.staffGymId && actor.staffGymId !== classType.gym_id) {
      return jsonResponse(403, { error: "gym_mismatch" });
    }

    if (actor.instructorId && actor.instructorGymId !== classType.gym_id) {
      return jsonResponse(403, { error: "not_authorized" });
    }

    let query = serviceClient
      .from("class_insights_mv")
      .select("fill_rate, waitlist_count, attendance_rate")
      .eq("class_id", payload.class_type_id)
      .gte("date", range.start)
      .lte("date", range.end);

    if (actor.instructorId) {
      const { data: scheduleIds } = await serviceClient
        .from("class_schedules")
        .select("id")
        .eq("instructor_id", actor.instructorId);
      const schedules = scheduleIds?.map((row) => row.id) ?? [];
      if (!schedules.length) {
        return jsonResponse(200, { total_sessions: 0, avg_fill_rate: 0, avg_attendance_rate: 0, avg_waitlist_count: 0 });
      }
      const { data: instanceIds } = await serviceClient
        .from("class_instances")
        .select("id")
        .in("schedule_id", schedules);
      const instances = instanceIds?.map((row) => row.id) ?? [];
      if (!instances.length) {
        return jsonResponse(200, { total_sessions: 0, avg_fill_rate: 0, avg_attendance_rate: 0, avg_waitlist_count: 0 });
      }
      query = query.in("instance_id", instances);
    }

    const { data: insights } = await query;

    const total = insights?.length ?? 0;
    const avgFill = total ? insights!.reduce((sum, row) => sum + Number(row.fill_rate ?? 0), 0) / total : 0;
    const avgAttendance = total ? insights!.reduce((sum, row) => sum + Number(row.attendance_rate ?? 0), 0) / total : 0;
    const avgWaitlist = total ? insights!.reduce((sum, row) => sum + Number(row.waitlist_count ?? 0), 0) / total : 0;

    return jsonResponse(200, {
      total_sessions: total,
      avg_fill_rate: avgFill,
      avg_attendance_rate: avgAttendance,
      avg_waitlist_count: avgWaitlist,
    });
  }

  if (payload.action === "INSTRUCTOR_SUMMARY") {
    if (!payload.instructor_id) {
      return jsonResponse(400, { error: "instructor_id_required" });
    }

    const range = parseDateRange(payload.date_range);
    if (!range) {
      return jsonResponse(400, { error: "invalid_date_range" });
    }

    if (actor.instructorId && actor.instructorId !== payload.instructor_id) {
      return jsonResponse(403, { error: "not_authorized" });
    }

    if (actor.staffGymId) {
      const { data: instructor } = await serviceClient
        .from("instructors")
        .select("gym_id")
        .eq("id", payload.instructor_id)
        .maybeSingle();

      if (!instructor || instructor.gym_id !== actor.staffGymId) {
        return jsonResponse(403, { error: "gym_mismatch" });
      }
    }

    const { data: scheduleIds } = await serviceClient
      .from("class_schedules")
      .select("id")
      .eq("instructor_id", payload.instructor_id);
    const schedules = scheduleIds?.map((row) => row.id) ?? [];
    if (!schedules.length) {
      return jsonResponse(200, { total_sessions: 0, avg_fill_rate: 0, avg_attendance_rate: 0 });
    }
    const { data: instanceIds } = await serviceClient
      .from("class_instances")
      .select("id")
      .in("schedule_id", schedules);
    const instances = instanceIds?.map((row) => row.id) ?? [];
    if (!instances.length) {
      return jsonResponse(200, { total_sessions: 0, avg_fill_rate: 0, avg_attendance_rate: 0 });
    }

    const { data: insights } = await serviceClient
      .from("class_insights_mv")
      .select("fill_rate, attendance_rate")
      .gte("date", range.start)
      .lte("date", range.end)
      .in("instance_id", instances);

    const total = insights?.length ?? 0;
    const avgFill = total ? insights!.reduce((sum, row) => sum + Number(row.fill_rate ?? 0), 0) / total : 0;
    const avgAttendance = total ? insights!.reduce((sum, row) => sum + Number(row.attendance_rate ?? 0), 0) / total : 0;

    return jsonResponse(200, {
      total_sessions: total,
      avg_fill_rate: avgFill,
      avg_attendance_rate: avgAttendance,
    });
  }

  if (payload.action === "GYM_TRENDS") {
    if (!payload.gym_id) {
      return jsonResponse(400, { error: "gym_id_required" });
    }

    const range = parseDateRange(payload.date_range);
    if (!range) {
      return jsonResponse(400, { error: "invalid_date_range" });
    }

    if (actor.staffGymId && actor.staffGymId !== payload.gym_id) {
      return jsonResponse(403, { error: "gym_mismatch" });
    }

    if (actor.instructorId && actor.instructorGymId !== payload.gym_id) {
      return jsonResponse(403, { error: "not_authorized" });
    }

    let insightsQuery = serviceClient
      .from("class_insights_mv")
      .select("date, booked_count, attendance_count, waitlist_count, fill_rate, attendance_rate")
      .gte("date", range.start)
      .lte("date", range.end);

    if (actor.instructorId) {
      const { data: scheduleIds } = await serviceClient
        .from("class_schedules")
        .select("id")
        .eq("instructor_id", actor.instructorId);
      const schedules = scheduleIds?.map((row) => row.id) ?? [];
      if (!schedules.length) {
        return jsonResponse(200, { metrics: { avg_fill_rate: 0, avg_attendance_rate: 0, avg_waitlist_count: 0, avg_no_show_rate: 0 }, trends: [], top_classes: [], instructor_performance: [] });
      }
      const { data: instanceIds } = await serviceClient
        .from("class_instances")
        .select("id")
        .in("schedule_id", schedules);
      const instances = instanceIds?.map((row) => row.id) ?? [];
      if (!instances.length) {
        return jsonResponse(200, { metrics: { avg_fill_rate: 0, avg_attendance_rate: 0, avg_waitlist_count: 0, avg_no_show_rate: 0 }, trends: [], top_classes: [], instructor_performance: [] });
      }
      insightsQuery = insightsQuery.in("instance_id", instances);
    } else {
      insightsQuery = insightsQuery.eq("gym_id", payload.gym_id);
    }

    const { data: insights } = await insightsQuery;

    const trendsMap = new Map<string, { date: string; bookings: number; attendance: number; waitlist: number }>();
    insights?.forEach((row) => {
      const key = row.date as string;
      const existing = trendsMap.get(key) ?? { date: key, bookings: 0, attendance: 0, waitlist: 0 };
      trendsMap.set(key, {
        date: key,
        bookings: existing.bookings + Number(row.booked_count ?? 0),
        attendance: existing.attendance + Number(row.attendance_count ?? 0),
        waitlist: existing.waitlist + Number(row.waitlist_count ?? 0),
      });
    });

    const trends = Array.from(trendsMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    const fillRates = insights?.map((row) => Number(row.fill_rate ?? 0)) ?? [];
    const attendanceRates = insights?.map((row) => Number(row.attendance_rate ?? 0)) ?? [];
    const waitlistCounts = insights?.map((row) => Number(row.waitlist_count ?? 0)) ?? [];
    const bookedCounts = insights?.map((row) => Number(row.booked_count ?? 0)) ?? [];
    const noShowCounts = insights?.map((row) => Math.max(Number(row.booked_count ?? 0) - Number(row.attendance_count ?? 0), 0)) ?? [];

    const avg = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);

    let topClassesQuery = serviceClient
      .from("class_type_performance_mv")
      .select("class_type_id, gym_id, total_sessions, avg_fill_rate, avg_attendance_rate")
      .eq("gym_id", payload.gym_id)
      .order("avg_fill_rate", { ascending: false })
      .limit(5);

    if (actor.instructorId) {
      const { data: scheduleIds } = await serviceClient
        .from("class_schedules")
        .select("class_type_id")
        .eq("instructor_id", actor.instructorId);
      const classTypeIds = Array.from(new Set(scheduleIds?.map((row) => row.class_type_id) ?? []));
      if (!classTypeIds.length) {
        return jsonResponse(200, {
          metrics: {
            avg_fill_rate: avg(fillRates),
            avg_attendance_rate: avg(attendanceRates),
            avg_waitlist_count: avg(waitlistCounts),
            avg_no_show_rate: avg(bookedCounts.map((value, index) => (value ? noShowCounts[index] / value : 0))),
          },
          trends,
          top_classes: [],
          instructor_performance: [],
        });
      }
      topClassesQuery = topClassesQuery.in("class_type_id", classTypeIds);
    }

    const { data: topClasses } = await topClassesQuery;

    let instructorQuery = serviceClient
      .from("instructor_performance_mv")
      .select("instructor_id, total_sessions, avg_attendance_rate, avg_fill_rate, member_feedback_score");

    if (actor.instructorId) {
      instructorQuery = instructorQuery.eq("instructor_id", actor.instructorId);
    }

    const { data: instructorPerf } = await instructorQuery;

    return jsonResponse(200, {
      metrics: {
        avg_fill_rate: avg(fillRates),
        avg_attendance_rate: avg(attendanceRates),
        avg_waitlist_count: avg(waitlistCounts),
        avg_no_show_rate: avg(bookedCounts.map((value, index) => (value ? noShowCounts[index] / value : 0))),
      },
      trends,
      top_classes: topClasses ?? [],
      instructor_performance: instructorPerf ?? [],
    });
  }

  return jsonResponse(400, { error: "invalid_action" });
});
