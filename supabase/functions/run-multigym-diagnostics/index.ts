import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type DiagnosticScope = "ALL" | "ACCESS_ONLY" | "GYM_REFS_ONLY";

type DiagnosticRequest = {
  scope?: DiagnosticScope;
};

const SAMPLE_LIMIT = 50;

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: DiagnosticRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  const scope = payload.scope ?? "ALL";

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

  const { data: orgRole } = await serviceClient
    .from("organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!orgRole || orgRole.role !== "CORPORATE_ADMIN") {
    return jsonResponse(403, { error: "not_authorized" });
  }

  const includeGymRefs = scope === "ALL" || scope === "GYM_REFS_ONLY";
  const includeAccess = scope === "ALL" || scope === "ACCESS_ONLY";

  const invalidGymRefsPromise = includeGymRefs
    ? serviceClient.from("invalid_gym_references_v").select("*").limit(SAMPLE_LIMIT)
    : Promise.resolve({ data: [] });

  const orphanedAccessPromise = includeAccess
    ? serviceClient.from("orphaned_member_access_v").select("*").limit(SAMPLE_LIMIT)
    : Promise.resolve({ data: [] });

  const inconsistentAccessPromise = includeAccess
    ? serviceClient
        .from("inconsistent_access_vs_subscription_v")
        .select("*")
        .neq("mismatch_type", "OK")
        .limit(SAMPLE_LIMIT)
    : Promise.resolve({ data: [] });

  const [invalidGymRefs, orphanedAccess, inconsistentAccess] = await Promise.all([
    invalidGymRefsPromise,
    orphanedAccessPromise,
    inconsistentAccessPromise,
  ]);

  const invalidGymRefsCount = includeGymRefs
    ? (await serviceClient.from("invalid_gym_references_v").select("*", { count: "exact", head: true })).count ?? 0
    : 0;
  const orphanedAccessCount = includeAccess
    ? (await serviceClient.from("orphaned_member_access_v").select("*", { count: "exact", head: true })).count ?? 0
    : 0;
  const inconsistentAccessCount = includeAccess
    ? (await serviceClient
        .from("inconsistent_access_vs_subscription_v")
        .select("*", { count: "exact", head: true })
        .neq("mismatch_type", "OK")).count ?? 0
    : 0;

  return jsonResponse(200, {
    timestamp: new Date().toISOString(),
    summary: {
      invalid_gym_refs: invalidGymRefsCount,
      orphaned_member_access: orphanedAccessCount,
      inconsistent_access: inconsistentAccessCount,
    },
    samples: {
      invalid_gym_refs: invalidGymRefs.data ?? [],
      orphaned_member_access: orphanedAccess.data ?? [],
      inconsistent_access: inconsistentAccess.data ?? [],
    },
  });
});
