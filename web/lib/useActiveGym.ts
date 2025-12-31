"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "./supabase-browser";
import { useAuthStore } from "./auth";

const STORAGE_KEY = "activeGymId";

// TODO: Auto-select nearest gym using geolocation when available.
// TODO: Add corporate-level "All locations" view for staff/admin.

type GymOption = { id: string; name: string; code: string | null };

type GymAccessRow = {
  gym_id: string;
  access_type: "HOME" | "SECONDARY" | "ALL_ACCESS";
  status: "ACTIVE" | "SUSPENDED" | "EXPIRED";
  gyms: { id: string; name: string; code: string | null } | null;
};

export function useActiveGym() {
  const { session } = useAuthStore();
  const [gyms, setGyms] = useState<GymOption[]>([]);
  const [activeGymId, setActiveGymId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadGyms = useCallback(async () => {
    if (!session?.user.id) {
      setGyms([]);
      setActiveGymId(null);
      setLoading(false);
      return;
    }

    const storedGymId = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;

    const { data: member } = await supabaseBrowser
      .from("members")
      .select("id, home_gym_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    const { data: staffRoles } = await supabaseBrowser
      .from("staff_roles")
      .select("gym_id")
      .eq("user_id", session.user.id);

    const { data: legacyStaff } = await supabaseBrowser
      .from("staff")
      .select("gym_id")
      .eq("user_id", session.user.id);

    const staffGymIds = Array.from(new Set([...(staffRoles ?? []).map((row) => row.gym_id), ...(legacyStaff ?? []).map((row) => row.gym_id)]));

    if (staffGymIds.length) {
      const { data: staffGyms } = await supabaseBrowser
        .from("gyms")
        .select("id, name, code")
        .in("id", staffGymIds)
        .eq("active", true);

      const resolvedGyms = (staffGyms ?? []) as GymOption[];
      setGyms(resolvedGyms);

      const fallbackGym = resolvedGyms.find((gym) => gym.id === storedGymId) ?? resolvedGyms[0] ?? null;
      setActiveGymId(fallbackGym?.id ?? null);
      setLoading(false);
      return;
    }

    const { data: accessRows } = await supabaseBrowser
      .from("member_gym_access")
      .select("gym_id, access_type, status, gyms(id, name, code)")
      .eq("member_id", member?.id ?? "")
      .eq("status", "ACTIVE");

    const hasAllAccess = (accessRows ?? []).some((row) => row.access_type === "ALL_ACCESS");

    let resolvedGyms: GymOption[] = [];

    if (hasAllAccess) {
      const { data: allGyms } = await supabaseBrowser.from("gyms").select("id, name, code").eq("active", true);
      resolvedGyms = (allGyms ?? []) as GymOption[];
    } else {
      resolvedGyms = (accessRows ?? [])
        .map((row) => row.gyms)
        .filter((gym): gym is GymOption => !!gym);
    }

    setGyms(resolvedGyms);

    const fallbackGym =
      resolvedGyms.find((gym) => gym.id === storedGymId) ??
      resolvedGyms.find((gym) => gym.id === member?.home_gym_id) ??
      resolvedGyms[0] ??
      null;
    setActiveGymId(fallbackGym?.id ?? null);
    setLoading(false);
  }, [session?.user.id]);

  useEffect(() => {
    loadGyms();
  }, [loadGyms]);

  const setActiveGym = useCallback((gymId: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, gymId);
    }
    setActiveGymId(gymId);
  }, []);

  const activeGym = useMemo(() => gyms.find((gym) => gym.id === activeGymId) ?? null, [gyms, activeGymId]);

  return { activeGymId, activeGym, gyms, setActiveGym, loading };
}
