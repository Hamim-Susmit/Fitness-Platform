import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { useSessionStore } from "../store/useSessionStore";

const STORAGE_KEY = "activeGymId";

// TODO: Auto-select nearest gym using geolocation when available.
// TODO: Add region-based defaulting (multi-region rollouts).
// TODO: Add corporate-level "All locations" view for staff/admin.

export type GymAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
};

export type GymOption = { id: string; name: string; code: string | null; address?: GymAddress | null };

export function useActiveGym() {
  const { session } = useSessionStore();
  const [gyms, setGyms] = useState<GymOption[]>([]);
  const [activeGymId, setActiveGymId] = useState<string | null>(null);
  const [accessNotice, setAccessNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setNotice = useCallback((message: string | null) => {
    if (noticeTimeoutRef.current) {
      clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = null;
    }
    setAccessNotice(message);
    if (message) {
      noticeTimeoutRef.current = setTimeout(() => {
        setAccessNotice(null);
        noticeTimeoutRef.current = null;
      }, 4000);
    }
  }, []);

  const resolveDefaultGymId = useCallback(
    (options: { gyms: GymOption[]; storedGymId: string | null; homeGymId: string | null }) => {
      const { gyms: availableGyms, storedGymId, homeGymId } = options;
      const hasStoredGym = storedGymId && availableGyms.some((gym) => gym.id === storedGymId);
      if (hasStoredGym) {
        return storedGymId!;
      }

      const hasHomeGym = homeGymId && availableGyms.some((gym) => gym.id === homeGymId);
      if (hasHomeGym) {
        return homeGymId!;
      }

      return availableGyms[0]?.id ?? null;
    },
    []
  );

  const loadGyms = useCallback(async () => {
    if (!session?.user.id) {
      setGyms([]);
      setActiveGymId(null);
      setNotice(null);
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
      .select("gym_id, access_type, status, gyms(id, name, code, address)")
      .eq("member_id", member?.id ?? "")
      .eq("status", "ACTIVE");

    const hasAllAccess = (accessRows ?? []).some((row) => row.access_type === "ALL_ACCESS");

    let resolvedGyms: GymOption[] = [];

    if (hasAllAccess) {
      const { data: allGyms } = await supabase.from("gyms").select("id, name, code, address").eq("active", true);
      resolvedGyms = (allGyms ?? []) as GymOption[];
    } else {
      resolvedGyms = (accessRows ?? [])
        .map((row) => row.gyms as GymOption | null)
        .filter((gym): gym is GymOption => !!gym);
    }

    setGyms(resolvedGyms);

    const fallbackGymId = resolveDefaultGymId({
      gyms: resolvedGyms,
      storedGymId,
      homeGymId: member?.home_gym_id ?? null,
    });

    if (!resolvedGyms.length) {
      setNotice("No active gym access — contact support.");
    } else if (storedGymId && fallbackGymId && storedGymId !== fallbackGymId) {
      setNotice("Your access to this location changed.");
    }

    setActiveGymId(fallbackGymId ?? null);
    if (fallbackGymId) {
      await AsyncStorage.setItem(STORAGE_KEY, fallbackGymId);
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
    setLoading(false);
  }, [resolveDefaultGymId, session?.user.id, setNotice]);

  useEffect(() => {
    loadGyms();
  }, [loadGyms]);

  const setActiveGym = useCallback(
    async (gymId: string) => {
      const validGym = gyms.find((gym) => gym.id === gymId);
      if (!validGym) {
        const fallbackGymId = gyms[0]?.id ?? null;
        setActiveGymId(fallbackGymId);
        if (fallbackGymId) {
          await AsyncStorage.setItem(STORAGE_KEY, fallbackGymId);
          setNotice("Your access to this location changed.");
        } else {
          await AsyncStorage.removeItem(STORAGE_KEY);
        }
        return;
      }
      await AsyncStorage.setItem(STORAGE_KEY, validGym.id);
      setActiveGymId(validGym.id);
      setNotice(null);
    },
    [gyms, setNotice]
  );

  const activeGym = useMemo(() => gyms.find((gym) => gym.id === activeGymId) ?? null, [gyms, activeGymId]);
  const isMultiGymUser = gyms.length > 1;

  return { activeGymId, activeGym, gyms, setActiveGym, isMultiGymUser, accessNotice, loading };
}
