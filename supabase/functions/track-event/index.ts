import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

const ALLOWED_EVENTS = new Set([
  "member.checkin.created",
  "class.booking.created",
  "class.booking.cancelled",
  "subscription.created",
  "subscription.renewed",
  "payment.failed",
  "app.login",
  "app.session.start",
]);

type TrackEventRequest = {
  event_type?: string;
  context?: Record<string, unknown>;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function inferSource(req: Request) {
  const explicit = req.headers.get("x-client-source")?.toLowerCase();
  if (explicit === "web" || explicit === "mobile") {
    return explicit;
  }

  const userAgent = (req.headers.get("user-agent") ?? "").toLowerCase();
  if (userAgent.includes("expo") || userAgent.includes("reactnative") || userAgent.includes("okhttp")) {
    return "mobile";
  }

  return "web";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: TrackEventRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.event_type || !ALLOWED_EVENTS.has(payload.event_type)) {
    return jsonResponse(400, { error: "invalid_event_type" });
  }

  const context = payload.context ?? {};
  const encodedContext = JSON.stringify(context);
  if (encodedContext.length > 5 * 1024) {
    return jsonResponse(413, { error: "payload_too_large" });
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

  const [{ data: member }, { data: staff }] = await Promise.all([
    serviceClient.from("members").select("id, gym_id").eq("user_id", user.id).maybeSingle(),
    serviceClient.from("staff").select("id, gym_id").eq("user_id", user.id).maybeSingle(),
  ]);

  const memberId = member?.id ?? null;
  const staffId = staff?.id ?? null;
  const gymId = member?.gym_id ?? staff?.gym_id ?? null;

  await serviceClient.rpc("log_analytics_event", {
    p_event_type: payload.event_type,
    p_user_id: user.id,
    p_member_id: memberId,
    p_staff_id: staffId,
    p_gym_id: gymId,
    p_source: inferSource(req),
    p_context: context,
  });

  return jsonResponse(200, { status: "ok" });
});
