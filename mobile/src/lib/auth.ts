import { supabase } from "./supabase";
import type { UserRole } from "./types";
import { useSessionStore } from "../store/useSessionStore";

export async function fetchUserRole(userId: string): Promise<UserRole | null> {
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.role as UserRole;
}

export async function loadSessionAndRole() {
  const { data } = await supabase.auth.getSession();
  const session = data.session ?? null;
  useSessionStore.getState().setSession(session);

  if (!session?.user) {
    useSessionStore.getState().setRole(null);
    useSessionStore.getState().setLoading(false);
    return;
  }

  const role = await fetchUserRole(session.user.id);
  useSessionStore.getState().setRole(role);
  useSessionStore.getState().setLoading(false);
}
