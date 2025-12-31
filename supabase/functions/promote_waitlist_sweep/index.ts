import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_FUNCTIONS_URL = Deno.env.get("SUPABASE_FUNCTIONS_URL") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function promote(classInstanceId: string) {
  if (!SUPABASE_FUNCTIONS_URL) return null;
  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/promote_waitlist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ class_instance_id: classInstanceId }),
  });

  if (!res.ok) {
    return null;
  }

  return await res.json();
}

Deno.serve(async () => {
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: instances } = await serviceClient
    .from("class_instances")
    .select("id, capacity")
    .eq("status", "scheduled")
    .gte("start_at", new Date().toISOString())
    .limit(50);

  let promoted = 0;

  for (const instance of instances ?? []) {
    const { data: bookedRows } = await serviceClient
      .from("class_bookings")
      .select("id", { count: "exact" })
      .eq("class_instance_id", instance.id)
      .eq("status", "booked");

    const bookedCount = bookedRows?.length ?? 0;
    if (bookedCount >= instance.capacity) {
      continue;
    }

    const result = await promote(instance.id);
    if (result?.promoted) {
      promoted += 1;
    }
  }

  return jsonResponse(200, { promoted, scanned: instances?.length ?? 0 });
});
