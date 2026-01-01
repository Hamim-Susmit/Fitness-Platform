import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type StaffAction = "ASSIGN_STAFF" | "UPDATE_ROLE" | "REMOVE_STAFF";

type StaffRequest = {
  action?: StaffAction;
  gym_id?: string;
  user_id?: string;
  staff_role_id?: string;
  role?: string;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function resolveActorRole(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  gymId: string
) {
  const { data: staffRole } = await serviceClient
    .from("staff_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("gym_id", gymId)
    .maybeSingle();

  return staffRole?.role ?? null;
}

async function insertAuditEvent(
  serviceClient: ReturnType<typeof createClient>,
  options: { gymId: string; actorUserId: string; eventType: string; payload: Record<string, unknown> }
) {
  await serviceClient.from("gym_audit_events").insert({
    gym_id: options.gymId,
    actor_user_id: options.actorUserId,
    event_type: options.eventType,
    payload: options.payload,
  });
}

async function countAdmins(serviceClient: ReturnType<typeof createClient>, gymId: string) {
  const { data } = await serviceClient
    .from("staff_roles")
    .select("id", { count: "exact" })
    .eq("gym_id", gymId)
    .eq("role", "ADMIN");
  return data?.length ?? 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: StaffRequest;
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

  const resolveTargetGymId = async () => {
    if (payload.gym_id) return payload.gym_id;
    if (!payload.staff_role_id) return null;
    const { data } = await serviceClient
      .from("staff_roles")
      .select("gym_id")
      .eq("id", payload.staff_role_id)
      .maybeSingle();
    return data?.gym_id ?? null;
  };

  const gymId = await resolveTargetGymId();
  if (!gymId) {
    return jsonResponse(400, { error: "missing_gym_id" });
  }

  const actorRole = await resolveActorRole(serviceClient, user.id, gymId);
  if (!actorRole || !["MANAGER", "ADMIN"].includes(actorRole)) {
    return jsonResponse(403, { error: "not_authorized" });
  }

  const isActorAdmin = actorRole === "ADMIN";

  if (payload.action === "ASSIGN_STAFF") {
    if (!payload.user_id || !payload.role) {
      return jsonResponse(400, { error: "missing_staff_fields" });
    }

    if (payload.role === "ADMIN" && !isActorAdmin) {
      return jsonResponse(403, { error: "admin_required" });
    }

    const { data: existingRole } = await serviceClient
      .from("staff_roles")
      .select("id, role")
      .eq("user_id", payload.user_id)
      .eq("gym_id", gymId)
      .maybeSingle();

    if (existingRole?.id) {
      const { error: updateError } = await serviceClient
        .from("staff_roles")
        .update({ role: payload.role })
        .eq("id", existingRole.id);

      if (updateError) {
        console.log("staff_role_update_failed", updateError.message);
        return jsonResponse(500, { error: "staff_role_update_failed" });
      }

      await insertAuditEvent(serviceClient, {
        gymId,
        actorUserId: user.id,
        eventType: "STAFF_ROLE_CHANGED",
        payload: { staff_role_id: existingRole.id, user_id: payload.user_id, role: payload.role },
      });

      return jsonResponse(200, { status: "ok", staff_role_id: existingRole.id });
    }

    const { data: staffRole, error } = await serviceClient
      .from("staff_roles")
      .insert({
        user_id: payload.user_id,
        gym_id: gymId,
        role: payload.role,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.log("staff_role_insert_failed", error.message);
      return jsonResponse(500, { error: "staff_role_insert_failed" });
    }

    await insertAuditEvent(serviceClient, {
      gymId,
      actorUserId: user.id,
      eventType: "STAFF_ASSIGNED",
      payload: { staff_role_id: staffRole?.id, user_id: payload.user_id, role: payload.role },
    });

    return jsonResponse(200, { status: "ok", staff_role_id: staffRole?.id });
  }

  if (payload.action === "UPDATE_ROLE") {
    if (!payload.staff_role_id || !payload.role) {
      return jsonResponse(400, { error: "missing_role_fields" });
    }

    if (payload.role === "ADMIN" && !isActorAdmin) {
      return jsonResponse(403, { error: "admin_required" });
    }

    const { data: targetRole } = await serviceClient
      .from("staff_roles")
      .select("id, role, user_id")
      .eq("id", payload.staff_role_id)
      .maybeSingle();

    if (!targetRole) {
      return jsonResponse(404, { error: "staff_role_not_found" });
    }

    if (targetRole.role === "ADMIN" && !isActorAdmin) {
      return jsonResponse(403, { error: "admin_required" });
    }

    if (targetRole.role === "ADMIN" && payload.role !== "ADMIN") {
      const adminCount = await countAdmins(serviceClient, gymId);
      if (adminCount <= 1) {
        return jsonResponse(409, { error: "last_admin" });
      }
    }

    const { error: updateError } = await serviceClient
      .from("staff_roles")
      .update({ role: payload.role })
      .eq("id", payload.staff_role_id);

    if (updateError) {
      console.log("staff_role_update_failed", updateError.message);
      return jsonResponse(500, { error: "staff_role_update_failed" });
    }

    await insertAuditEvent(serviceClient, {
      gymId,
      actorUserId: user.id,
      eventType: "STAFF_ROLE_CHANGED",
      payload: { staff_role_id: payload.staff_role_id, user_id: targetRole.user_id, role: payload.role },
    });

    return jsonResponse(200, { status: "ok" });
  }

  if (payload.action === "REMOVE_STAFF") {
    if (!payload.staff_role_id) {
      return jsonResponse(400, { error: "missing_staff_role_id" });
    }

    const { data: targetRole } = await serviceClient
      .from("staff_roles")
      .select("id, role, user_id")
      .eq("id", payload.staff_role_id)
      .maybeSingle();

    if (!targetRole) {
      return jsonResponse(404, { error: "staff_role_not_found" });
    }

    if (targetRole.role === "ADMIN" && !isActorAdmin) {
      return jsonResponse(403, { error: "admin_required" });
    }

    if (targetRole.role === "ADMIN") {
      const adminCount = await countAdmins(serviceClient, gymId);
      if (adminCount <= 1) {
        return jsonResponse(409, { error: "last_admin" });
      }
    }

    const { error: deleteError } = await serviceClient.from("staff_roles").delete().eq("id", payload.staff_role_id);
    if (deleteError) {
      console.log("staff_role_delete_failed", deleteError.message);
      return jsonResponse(500, { error: "staff_role_delete_failed" });
    }

    await insertAuditEvent(serviceClient, {
      gymId,
      actorUserId: user.id,
      eventType: "STAFF_REMOVED",
      payload: { staff_role_id: payload.staff_role_id, user_id: targetRole.user_id, role: targetRole.role },
    });

    return jsonResponse(200, { status: "ok" });
  }

  return jsonResponse(400, { error: "unsupported_action" });
});
