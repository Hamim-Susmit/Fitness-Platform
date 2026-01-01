import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

type ManageAction =
  | "UPDATE_GYM_METADATA"
  | "UPDATE_HOURS"
  | "ADD_HOLIDAY"
  | "REMOVE_HOLIDAY"
  | "ADD_AMENITY"
  | "REMOVE_AMENITY"
  | "ADD_NOTE";

type HourInput = {
  day_of_week: number;
  open_time: string;
  close_time: string;
};

type ManageRequest = {
  action?: ManageAction;
  gym_id?: string;
  name?: string;
  address?: Record<string, unknown>;
  timezone?: string;
  latitude?: number | null;
  longitude?: number | null;
  hours?: HourInput[];
  holiday_date?: string;
  holiday_label?: string | null;
  holiday_id?: string;
  amenity_label?: string;
  amenity_icon?: string | null;
  amenity_id?: string;
  note?: string;
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

  if (!staffRole?.role) {
    return null;
  }

  return staffRole.role as string;
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

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: ManageRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.action || !payload.gym_id) {
    return jsonResponse(400, { error: "missing_action_or_gym" });
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

  const actorRole = await resolveActorRole(serviceClient, user.id, payload.gym_id);
  if (!actorRole || !["MANAGER", "ADMIN"].includes(actorRole)) {
    return jsonResponse(403, { error: "not_authorized" });
  }

  if (payload.action === "UPDATE_GYM_METADATA") {
    const updatePayload: Record<string, unknown> = {};
    if (payload.name !== undefined) updatePayload.name = payload.name;
    if (payload.address !== undefined) updatePayload.address = payload.address;
    if (payload.timezone !== undefined) updatePayload.timezone = payload.timezone;
    if (payload.latitude !== undefined) updatePayload.latitude = payload.latitude;
    if (payload.longitude !== undefined) updatePayload.longitude = payload.longitude;

    if (!Object.keys(updatePayload).length) {
      return jsonResponse(400, { error: "missing_metadata_fields" });
    }

    const { error } = await serviceClient.from("gyms").update(updatePayload).eq("id", payload.gym_id);
    if (error) {
      console.log("gym_update_failed", error.message);
      return jsonResponse(500, { error: "gym_update_failed" });
    }

    await insertAuditEvent(serviceClient, {
      gymId: payload.gym_id,
      actorUserId: user.id,
      eventType: "GYM_UPDATED",
      payload: updatePayload,
    });

    return jsonResponse(200, { status: "ok" });
  }

  if (payload.action === "UPDATE_HOURS") {
    const hours = payload.hours ?? [];
    const invalidHours = hours.some(
      (hour) =>
        hour.day_of_week < 0 || hour.day_of_week > 6 || !hour.open_time || !hour.close_time
    );
    if (invalidHours) {
      return jsonResponse(400, { error: "invalid_hours_payload" });
    }

    const { error: deleteError } = await serviceClient.from("gym_hours").delete().eq("gym_id", payload.gym_id);
    if (deleteError) {
      console.log("gym_hours_clear_failed", deleteError.message);
      return jsonResponse(500, { error: "gym_hours_clear_failed" });
    }

    if (hours.length) {
      const { error: insertError } = await serviceClient.from("gym_hours").insert(
        hours.map((hour) => ({
          gym_id: payload.gym_id,
          day_of_week: hour.day_of_week,
          open_time: hour.open_time,
          close_time: hour.close_time,
        }))
      );

      if (insertError) {
        console.log("gym_hours_insert_failed", insertError.message);
        return jsonResponse(500, { error: "gym_hours_insert_failed" });
      }
    }

    await insertAuditEvent(serviceClient, {
      gymId: payload.gym_id,
      actorUserId: user.id,
      eventType: "HOURS_UPDATED",
      payload: { count: hours.length },
    });

    return jsonResponse(200, { status: "ok" });
  }

  if (payload.action === "ADD_HOLIDAY") {
    if (!payload.holiday_date) {
      return jsonResponse(400, { error: "missing_holiday_date" });
    }

    const { data: holiday, error } = await serviceClient.from("gym_holidays").insert({
      gym_id: payload.gym_id,
      date: payload.holiday_date,
      label: payload.holiday_label ?? null,
    }).select("id, date, label").maybeSingle();

    if (error) {
      console.log("holiday_insert_failed", error.message);
      return jsonResponse(500, { error: "holiday_insert_failed" });
    }

    await insertAuditEvent(serviceClient, {
      gymId: payload.gym_id,
      actorUserId: user.id,
      eventType: "HOLIDAY_ADDED",
      payload: { holiday_id: holiday?.id, date: holiday?.date, label: holiday?.label },
    });

    return jsonResponse(200, { status: "ok", holiday });
  }

  if (payload.action === "REMOVE_HOLIDAY") {
    if (!payload.holiday_id) {
      return jsonResponse(400, { error: "missing_holiday_id" });
    }

    // TODO: consider soft-delete if historical data needs to retain holiday references.
    const { data: holiday, error } = await serviceClient
      .from("gym_holidays")
      .select("id, date, label")
      .eq("id", payload.holiday_id)
      .maybeSingle();

    if (!holiday) {
      return jsonResponse(404, { error: "holiday_not_found" });
    }

    const { error: deleteError } = await serviceClient.from("gym_holidays").delete().eq("id", payload.holiday_id);
    if (deleteError) {
      console.log("holiday_delete_failed", deleteError.message);
      return jsonResponse(500, { error: "holiday_delete_failed" });
    }

    await insertAuditEvent(serviceClient, {
      gymId: payload.gym_id,
      actorUserId: user.id,
      eventType: "HOLIDAY_REMOVED",
      payload: { holiday_id: holiday.id, date: holiday.date, label: holiday.label },
    });

    return jsonResponse(200, { status: "ok" });
  }

  if (payload.action === "ADD_AMENITY") {
    if (!payload.amenity_label) {
      return jsonResponse(400, { error: "missing_amenity_label" });
    }

    const { data: amenity, error } = await serviceClient.from("gym_amenities").insert({
      gym_id: payload.gym_id,
      label: payload.amenity_label,
      icon: payload.amenity_icon ?? null,
    }).select("id, label, icon").maybeSingle();

    if (error) {
      console.log("amenity_insert_failed", error.message);
      return jsonResponse(500, { error: "amenity_insert_failed" });
    }

    await insertAuditEvent(serviceClient, {
      gymId: payload.gym_id,
      actorUserId: user.id,
      eventType: "AMENITY_ADDED",
      payload: { amenity_id: amenity?.id, label: amenity?.label },
    });

    return jsonResponse(200, { status: "ok", amenity });
  }

  if (payload.action === "REMOVE_AMENITY") {
    if (!payload.amenity_id) {
      return jsonResponse(400, { error: "missing_amenity_id" });
    }

    // TODO: consider soft-delete if amenities need historical retention.
    const { data: amenity, error } = await serviceClient
      .from("gym_amenities")
      .select("id, label, icon")
      .eq("id", payload.amenity_id)
      .maybeSingle();

    if (!amenity) {
      return jsonResponse(404, { error: "amenity_not_found" });
    }

    const { error: deleteError } = await serviceClient.from("gym_amenities").delete().eq("id", payload.amenity_id);
    if (deleteError) {
      console.log("amenity_delete_failed", deleteError.message);
      return jsonResponse(500, { error: "amenity_delete_failed" });
    }

    await insertAuditEvent(serviceClient, {
      gymId: payload.gym_id,
      actorUserId: user.id,
      eventType: "AMENITY_REMOVED",
      payload: { amenity_id: amenity.id, label: amenity.label },
    });

    return jsonResponse(200, { status: "ok" });
  }

  if (payload.action === "ADD_NOTE") {
    if (!payload.note) {
      return jsonResponse(400, { error: "missing_note" });
    }

    const { data: note, error } = await serviceClient.from("gym_notes").insert({
      gym_id: payload.gym_id,
      author_user_id: user.id,
      note: payload.note,
    }).select("id, note, created_at").maybeSingle();

    if (error) {
      console.log("note_insert_failed", error.message);
      return jsonResponse(500, { error: "note_insert_failed" });
    }

    await insertAuditEvent(serviceClient, {
      gymId: payload.gym_id,
      actorUserId: user.id,
      eventType: "NOTE_ADDED",
      payload: { note_id: note?.id, note_preview: payload.note.slice(0, 120) },
    });

    return jsonResponse(200, { status: "ok", note });
  }

  return jsonResponse(400, { error: "unsupported_action" });
});
