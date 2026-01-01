import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import type { Checkin } from "./types";

const RECONNECT_MS = 2000;

export function useRealtimeCheckins(
  gymId: string | null,
  onInsert: (checkin: Checkin) => void
) {
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!gymId) return;

    const channel = supabase
      .channel(`checkins-${gymId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "checkins",
          filter: `gym_id=eq.${gymId}`,
        },
        (payload) => {
          onInsert(payload.new as Checkin);
        }
      )
      .subscribe((status) => {
        if (status === "CLOSED") {
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          reconnectTimer.current = setTimeout(() => {
            supabase.removeChannel(channel);
          }, RECONNECT_MS);
        }
      });

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      supabase.removeChannel(channel);
    };
  }, [gymId, onInsert]);
}
