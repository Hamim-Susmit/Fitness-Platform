import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { useSessionStore } from "../store/useSessionStore";

const STORAGE_KEY = "activeGymId";

// TODO: Auto-select nearest gym using geolocation when available.
// TODO: Add corporate-level "All locations" view for staff/admin.

export type GymOption = { id: string; name: string; code: string | null };

export function useActiveGym() {
  const { session } = useSessionStore();
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

    const storedGymId = await AsyncStorage.getItem(STORAGE_KEY);

    const { data: member } = await supabase
      .from("members")
      .select("id, home_gym_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    const { data: accessRows } = await supabase
      .from("member_gym_access")
      .select("gym_id, access_type, status, gyms(id, name, code)")
      .eq("member_id", member?.id ?? "")
      .eq("status", "ACTIVE");

    const hasAllAccess = (accessRows ?? []).some((row) => row.access_type === "ALL_ACCESS");

    let resolvedGyms: GymOption[] = [];

    if (hasAllAccess) {
      const { data: allGyms } = await supabase.from("gyms").select("id, name, code").eq("active", true);
      resolvedGyms = (allGyms ?? []) as GymOption[];
    } else {
      resolvedGyms = (accessRows ?? [])
        .map((row) => row.gyms as GymOption | null)
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

  const setActiveGym = useCallback(async (gymId: string) => {
    await AsyncStorage.setItem(STORAGE_KEY, gymId);
    setActiveGymId(gymId);
  }, []);

  const activeGym = useMemo(() => gyms.find((gym) => gym.id === activeGymId) ?? null, [gyms, activeGymId]);

  return { activeGymId, activeGym, gyms, setActiveGym, loading };
}
