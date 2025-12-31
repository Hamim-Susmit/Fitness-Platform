"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "./supabase-browser";
import { useAuthStore } from "./auth";

const STORAGE_KEY = "activeGymId";
const COOKIE_KEY = "activeGymId";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// TODO: Auto-select nearest gym using geolocation when available.
// TODO: Add region-based defaulting (multi-region rollouts).
// TODO: Add corporate-level "All locations" view for staff/admin.

type GymAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
};

type GymOption = { id: string; name: string; code: string | null; address?: GymAddress | null };

export function useActiveGym() {
  const { session } = useAuthStore();
  const [gyms, setGyms] = useState<GymOption[]>([]);
  const [activeGymId, setActiveGymId] = useState<string | null>(null);
  const [accessNotice, setAccessNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const noticeTimeoutRef = useRef<number | null>(null);

  const setNotice = useCallback((message: string | null) => {
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = null;
    }
    setAccessNotice(message);
    if (message) {
      noticeTimeoutRef.current = window.setTimeout(() => {
        setAccessNotice(null);
        noticeTimeoutRef.current = null;
      }, 4000);
    }
  }, []);

  const readCookieGymId = useCallback(() => {
    if (typeof document === "undefined") {
      return null;
    }
    const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }, []);

  const persistGymId = useCallback((gymId: string | null) => {
    if (typeof window === "undefined") {
      return;
    }
    if (gymId) {
      window.localStorage.setItem(STORAGE_KEY, gymId);
      document.cookie = `${COOKIE_KEY}=${encodeURIComponent(gymId)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
      document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; samesite=lax`;
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

    const storedGymId =
      typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) ?? readCookieGymId() : null;

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
        .select("id, name, code, address")
        .in("id", staffGymIds)
        .eq("active", true);

      const resolvedGyms = (staffGyms ?? []) as GymOption[];
      setGyms(resolvedGyms);

      const nextGymId = resolveDefaultGymId({
        gyms: resolvedGyms,
        storedGymId,
        homeGymId: member?.home_gym_id ?? null,
      });

      if (storedGymId && nextGymId && storedGymId !== nextGymId) {
        setNotice("Your access to this location changed.");
      }

      setActiveGymId(nextGymId);
      persistGymId(nextGymId);
      setLoading(false);
      return;
    }

    const { data: accessRows } = await supabaseBrowser
      .from("member_gym_access")
      .select("gym_id, access_type, status, gyms(id, name, code, address)")
      .eq("member_id", member?.id ?? "")
      .eq("status", "ACTIVE");

    const hasAllAccess = (accessRows ?? []).some((row) => row.access_type === "ALL_ACCESS");

    let resolvedGyms: GymOption[] = [];

    if (hasAllAccess) {
      const { data: allGyms } = await supabaseBrowser
        .from("gyms")
        .select("id, name, code, address")
        .eq("active", true);
      resolvedGyms = (allGyms ?? []) as GymOption[];
    } else {
      resolvedGyms = (accessRows ?? [])
        .map((row) => row.gyms)
        .filter((gym): gym is GymOption => !!gym);
    }

    setGyms(resolvedGyms);

    const nextGymId = resolveDefaultGymId({
      gyms: resolvedGyms,
      storedGymId,
      homeGymId: member?.home_gym_id ?? null,
    });

    if (!resolvedGyms.length) {
      setNotice("No active gym access — contact support.");
    } else if (storedGymId && nextGymId && storedGymId !== nextGymId) {
      setNotice("Your access to this location changed.");
    }

    setActiveGymId(nextGymId);
    persistGymId(nextGymId);
    setLoading(false);
  }, [persistGymId, readCookieGymId, resolveDefaultGymId, session?.user.id, setNotice]);

  useEffect(() => {
    loadGyms();
  }, [loadGyms]);

  const setActiveGym = useCallback(
    (gymId: string) => {
      const validGym = gyms.find((gym) => gym.id === gymId);
      if (!validGym) {
        const fallbackGymId = gyms[0]?.id ?? null;
        setActiveGymId(fallbackGymId);
        persistGymId(fallbackGymId);
        if (fallbackGymId) {
          setNotice("Your access to this location changed.");
        }
        return;
      }
      setActiveGymId(validGym.id);
      persistGymId(validGym.id);
      setNotice(null);
    },
    [gyms, persistGymId, setNotice]
  );

  const activeGym = useMemo(() => gyms.find((gym) => gym.id === activeGymId) ?? null, [gyms, activeGymId]);
  const isMultiGymUser = gyms.length > 1;

  return { activeGymId, activeGym, gyms, setActiveGym, isMultiGymUser, accessNotice, loading };
}
