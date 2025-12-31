import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required Supabase environment variables");
}

type ValidateRequest = {
  token?: string;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mapRpcError(message: string | null) {
  switch (message) {
    case "token_not_found":
      return { status: 404, error: "token_not_found" };
    case "token_already_used":
      return { status: 409, error: "token_already_used" };
    case "token_expired":
      return { status: 410, error: "token_expired" };
    case "member_inactive":
      return { status: 403, error: "member_inactive" };
    case "staff_not_found":
      return { status: 403, error: "staff_not_found" };
    case "staff_gym_mismatch":
      return { status: 403, error: "staff_gym_mismatch" };
    case "member_not_found":
      return { status: 404, error: "member_not_found" };
    default:
      return { status: 500, error: "checkin_failed" };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_authorization" });
  }

  let payload: ValidateRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!payload.token) {
    return jsonResponse(400, { error: "token_required" });
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

  const { data, error } = await serviceClient.rpc("complete_checkin", {
    p_token: payload.token,
    p_staff_user_id: user.id,
  });

  if (error) {
    const mapped = mapRpcError(error.message ?? null);
    return jsonResponse(mapped.status, { error: mapped.error });
  }

  return jsonResponse(200, { checkin_id: data });
});
