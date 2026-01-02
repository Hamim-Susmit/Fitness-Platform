import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type ScheduleRow = {
  id: string;
  report_id: string;
  cadence: "daily" | "weekly" | "monthly";
  timezone: string;
  last_run_at: string | null;
  next_run_at: string | null;
  delivery_emails: string[];
  format: "csv" | "pdf" | "xlsx";
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function computeNextRun(cadence: ScheduleRow["cadence"], from: Date) {
  const next = new Date(from.getTime());
  if (cadence === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (cadence === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

// Skeleton scheduler for report exports.
// TODO: Move orchestration to Inngest (or similar) with retries + queues.
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();

  const { data: schedules, error: scheduleError } = await serviceClient
    .from("report_schedules")
    .select("id, report_id, cadence, timezone, last_run_at, next_run_at, delivery_emails, format")
    .eq("is_active", true)
    .lte("next_run_at", now.toISOString());

  if (scheduleError) {
    return jsonResponse(500, { error: "schedule_fetch_failed" });
  }

  const processed: string[] = [];

  for (const schedule of (schedules ?? []) as ScheduleRow[]) {
    // TODO: Call run-report for schedule.report_id, generate export file, and email via Resend.
    // TODO: Use delivery_emails to route the generated file.

    const nextRun = computeNextRun(schedule.cadence, now);

    const { error: updateError } = await serviceClient
      .from("report_schedules")
      .update({ last_run_at: now.toISOString(), next_run_at: nextRun.toISOString() })
      .eq("id", schedule.id);

    if (!updateError) {
      processed.push(schedule.id);
    }
  }

  return jsonResponse(200, {
    processed_count: processed.length,
    processed,
    // Email delivery + export generation will be wired up in a later step.
  });
});
