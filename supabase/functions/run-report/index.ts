import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type RunReportRequest = {
  report_id: string;
  include_download?: boolean;
};

type ReportDefinition = {
  id: string;
  owner_user_id: string;
  name: string;
  entity_type: string;
  filters: Record<string, unknown> | null;
  columns: string[] | null;
};

type FilterRule = {
  column: string;
  operator: "eq" | "neq" | "gte" | "lte" | "ilike" | "in" | "contains";
  value: unknown;
};

const ENTITY_CONFIG: Record<
  string,
  {
    table: string;
    allowedColumns: string[];
  }
> = {
  members: {
    table: "members",
    allowedColumns: ["id", "user_id", "gym_id", "status", "joined_at"],
  },
  attendance: {
    table: "gym_daily_attendance_mv",
    allowedColumns: ["gym_id", "day", "total_checkins", "unique_members"],
  },
  revenue: {
    table: "revenue_by_plan_mv",
    allowedColumns: ["plan_id", "gym_id", "month", "mrr_total", "arr_contribution", "active_subscriptions"],
  },
  classes: {
    table: "class_instance_attendance_mv",
    allowedColumns: [
      "class_instance_id",
      "class_id",
      "gym_id",
      "start_time",
      "capacity",
      "booked_count",
      "attended_count",
      "no_show_count",
    ],
  },
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeColumns(columns: string[] | null, allowedColumns: string[]) {
  if (!columns || columns.length === 0) {
    return allowedColumns;
  }
  return columns.filter((column) => allowedColumns.includes(column));
}

function parseFilters(rawFilters: unknown): FilterRule[] {
  if (!rawFilters || typeof rawFilters !== "object") return [];
  if (!Array.isArray((rawFilters as { rules?: unknown }).rules)) return [];
  const rules = (rawFilters as { rules: unknown[] }).rules;
  return rules
    .map((rule) => {
      if (!rule || typeof rule !== "object") return null;
      const { column, operator, value } = rule as FilterRule;
      if (!column || !operator) return null;
      return { column, operator, value } as FilterRule;
    })
    .filter((rule): rule is FilterRule => !!rule);
}

function applyFilter(query: any, rule: FilterRule) {
  switch (rule.operator) {
    case "eq":
      return query.eq(rule.column, rule.value);
    case "neq":
      return query.neq(rule.column, rule.value);
    case "gte":
      return query.gte(rule.column, rule.value);
    case "lte":
      return query.lte(rule.column, rule.value);
    case "ilike":
      return typeof rule.value === "string" ? query.ilike(rule.column, rule.value) : query;
    case "in":
      return Array.isArray(rule.value) ? query.in(rule.column, rule.value) : query;
    case "contains":
      return query.contains(rule.column, rule.value);
    default:
      return query;
  }
}

// Report execution uses the user-scoped client so RLS remains enforced.
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: RunReportRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.report_id) {
    return jsonResponse(400, { error: "report_id_required" });
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

  const { data: report, error: reportError } = await userClient
    .from("reports")
    .select("id, owner_user_id, name, entity_type, filters, columns")
    .eq("id", payload.report_id)
    .maybeSingle();

  if (reportError || !report) {
    return jsonResponse(404, { error: "report_not_found" });
  }

  if (report.owner_user_id !== user.id) {
    return jsonResponse(403, { error: "not_authorized" });
  }

  const config = ENTITY_CONFIG[report.entity_type];
  if (!config) {
    return jsonResponse(400, { error: "unsupported_entity" });
  }

  const columns = normalizeColumns(report.columns, config.allowedColumns);
  const filters = parseFilters(report.filters);

  let query: any = userClient.from(config.table).select(columns.join(", "));

  filters
    .filter((rule) => config.allowedColumns.includes(rule.column))
    .forEach((rule) => {
      query = applyFilter(query, rule);
    });

  const { data: rows, error: queryError } = await query.limit(500);

  if (queryError) {
    return jsonResponse(500, { error: "query_failed" });
  }

  const metadata = {
    report_id: report.id,
    name: report.name,
    row_count: rows?.length ?? 0,
    generated_at: new Date().toISOString(),
    columns,
  };

  return jsonResponse(200, {
    rows: rows ?? [],
    metadata,
    download: payload.include_download ? null : undefined,
    // TODO: Add export file generation (CSV/XLSX/PDF) in a subsequent step.
  });
});
