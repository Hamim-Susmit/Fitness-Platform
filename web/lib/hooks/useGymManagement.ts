"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "../supabase-browser";
import { callEdgeFunction } from "../api";
import { useToastStore } from "../auth";

export type GymMetadata = {
  id: string;
  name: string;
  address: Record<string, unknown>;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
};

export type GymHour = {
  id: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
};

export type GymHoliday = {
  id: string;
  date: string;
  label: string | null;
};

export type GymAmenity = {
  id: string;
  label: string;
  icon: string | null;
  created_at: string;
};

export type GymStaffRole = {
  id: string;
  user_id: string;
  role: string;
  users?: { full_name: string | null } | null;
  created_at: string;
};

export type GymNote = {
  id: string;
  author_user_id: string;
  note: string;
  created_at: string;
  users?: { full_name: string | null } | null;
};

export type GymAuditEvent = {
  id: string;
  actor_user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  users?: { full_name: string | null } | null;
};

const toastDelayMs = 3000;

function useToastFeedback() {
  const { setToast } = useToastStore();

  const notify = (message: string, status: "success" | "error") => {
    setToast(message, status);
    setTimeout(() => setToast(null, null), toastDelayMs);
  };

  return { notify };
}

export function useGymMetadata(gymId?: string) {
  return useQuery<GymMetadata | null>({
    queryKey: ["gym-metadata", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("gyms")
        .select("id, name, address, timezone, latitude, longitude")
        .eq("id", gymId)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? null) as GymMetadata | null;
    },
  });
}

export function useUpdateGymMetadata() {
  const queryClient = useQueryClient();
  const { notify } = useToastFeedback();

  return useMutation({
    mutationFn: async (payload: { gymId: string } & Partial<Omit<GymMetadata, "id">>) => {
      const response = await callEdgeFunction("manage-gym", {
        body: {
          action: "UPDATE_GYM_METADATA",
          gym_id: payload.gymId,
          name: payload.name,
          address: payload.address,
          timezone: payload.timezone,
          latitude: payload.latitude,
          longitude: payload.longitude,
        },
      });

      if (response.error) {
        throw new Error(response.error);
      }

      return response.data;
    },
    onSuccess: (_data, variables) => {
      notify("Gym updated", "success");
      queryClient.invalidateQueries({ queryKey: ["gym-metadata", variables.gymId] });
      queryClient.invalidateQueries({ queryKey: ["gym-audit-log", variables.gymId] });
    },
    onError: (error: Error) => {
      notify(error.message, "error");
    },
  });
}

export function useGymHours(gymId?: string) {
  return useQuery<GymHour[]>({
    queryKey: ["gym-hours", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("gym_hours")
        .select("id, day_of_week, open_time, close_time")
        .eq("gym_id", gymId)
        .order("day_of_week");

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? []) as GymHour[];
    },
  });
}

export function useUpdateHours() {
  const queryClient = useQueryClient();
  const { notify } = useToastFeedback();

  return useMutation({
    mutationFn: async (payload: { gymId: string; hours: Array<Omit<GymHour, "id">> }) => {
      const response = await callEdgeFunction("manage-gym", {
        body: {
          action: "UPDATE_HOURS",
          gym_id: payload.gymId,
          hours: payload.hours,
        },
      });

      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: (_data, variables) => {
      notify("Hours updated", "success");
      queryClient.invalidateQueries({ queryKey: ["gym-hours", variables.gymId] });
      queryClient.invalidateQueries({ queryKey: ["gym-audit-log", variables.gymId] });
    },
    onError: (error: Error) => {
      notify(error.message, "error");
    },
  });
}

export function useGymHolidays(gymId?: string) {
  return useQuery<GymHoliday[]>({
    queryKey: ["gym-holidays", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("gym_holidays")
        .select("id, date, label")
        .eq("gym_id", gymId)
        .order("date", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? []) as GymHoliday[];
    },
  });
}

export function useManageHolidays() {
  const queryClient = useQueryClient();
  const { notify } = useToastFeedback();

  const addHoliday = useMutation({
    mutationFn: async (payload: { gymId: string; date: string; label?: string }) => {
      const response = await callEdgeFunction("manage-gym", {
        body: {
          action: "ADD_HOLIDAY",
          gym_id: payload.gymId,
          holiday_date: payload.date,
          holiday_label: payload.label ?? null,
        },
      });

      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: (_data, variables) => {
      notify("Holiday added", "success");
      queryClient.invalidateQueries({ queryKey: ["gym-holidays", variables.gymId] });
      queryClient.invalidateQueries({ queryKey: ["gym-audit-log", variables.gymId] });
    },
    onError: (error: Error) => {
      notify(error.message, "error");
    },
  });

  const removeHoliday = useMutation({
    mutationFn: async (payload: { gymId: string; holidayId: string }) => {
      const response = await callEdgeFunction("manage-gym", {
        body: { action: "REMOVE_HOLIDAY", gym_id: payload.gymId, holiday_id: payload.holidayId },
      });

      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: (_data, variables) => {
      notify("Holiday removed", "success");
      queryClient.invalidateQueries({ queryKey: ["gym-holidays", variables.gymId] });
      queryClient.invalidateQueries({ queryKey: ["gym-audit-log", variables.gymId] });
    },
    onError: (error: Error) => {
      notify(error.message, "error");
    },
  });

  return { addHoliday, removeHoliday };
}

export function useGymAmenities(gymId?: string) {
  return useQuery<GymAmenity[]>({
    queryKey: ["gym-amenities", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("gym_amenities")
        .select("id, label, icon, created_at")
        .eq("gym_id", gymId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? []) as GymAmenity[];
    },
  });
}

export function useManageAmenities() {
  const queryClient = useQueryClient();
  const { notify } = useToastFeedback();

  const addAmenity = useMutation({
    mutationFn: async (payload: { gymId: string; label: string; icon?: string }) => {
      const response = await callEdgeFunction("manage-gym", {
        body: {
          action: "ADD_AMENITY",
          gym_id: payload.gymId,
          amenity_label: payload.label,
          amenity_icon: payload.icon ?? null,
        },
      });

      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: (_data, variables) => {
      notify("Amenity added", "success");
      queryClient.invalidateQueries({ queryKey: ["gym-amenities", variables.gymId] });
      queryClient.invalidateQueries({ queryKey: ["gym-audit-log", variables.gymId] });
    },
    onError: (error: Error) => {
      notify(error.message, "error");
    },
  });

  const removeAmenity = useMutation({
    mutationFn: async (payload: { gymId: string; amenityId: string }) => {
      const response = await callEdgeFunction("manage-gym", {
        body: { action: "REMOVE_AMENITY", gym_id: payload.gymId, amenity_id: payload.amenityId },
      });

      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: (_data, variables) => {
      notify("Amenity removed", "success");
      queryClient.invalidateQueries({ queryKey: ["gym-amenities", variables.gymId] });
      queryClient.invalidateQueries({ queryKey: ["gym-audit-log", variables.gymId] });
    },
    onError: (error: Error) => {
      notify(error.message, "error");
    },
  });

  return { addAmenity, removeAmenity };
}

export function useGymStaff(gymId?: string) {
  return useQuery<GymStaffRole[]>({
    queryKey: ["gym-staff", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("staff_roles")
        .select("id, user_id, role, created_at, users(full_name)")
        .eq("gym_id", gymId)
        .order("created_at", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? []) as GymStaffRole[];
    },
  });
}

export function useManageStaffActions() {
  const queryClient = useQueryClient();
  const { notify } = useToastFeedback();

  const assignStaff = useMutation({
    mutationFn: async (payload: { gymId: string; userId: string; role: string }) => {
      const response = await callEdgeFunction("manage-gym-staff", {
        body: { action: "ASSIGN_STAFF", gym_id: payload.gymId, user_id: payload.userId, role: payload.role },
      });

      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: (_data, variables) => {
      notify("Staff assigned", "success");
      queryClient.invalidateQueries({ queryKey: ["gym-staff", variables.gymId] });
      queryClient.invalidateQueries({ queryKey: ["gym-audit-log", variables.gymId] });
    },
    onError: (error: Error) => {
      notify(error.message, "error");
    },
  });

  const updateRole = useMutation({
    mutationFn: async (payload: { gymId: string; staffRoleId: string; role: string }) => {
      const response = await callEdgeFunction("manage-gym-staff", {
        body: { action: "UPDATE_ROLE", gym_id: payload.gymId, staff_role_id: payload.staffRoleId, role: payload.role },
      });

      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: (_data, variables) => {
      notify("Role updated", "success");
      queryClient.invalidateQueries({ queryKey: ["gym-staff", variables.gymId] });
      queryClient.invalidateQueries({ queryKey: ["gym-audit-log", variables.gymId] });
    },
    onError: (error: Error) => {
      notify(error.message, "error");
    },
  });

  const removeStaff = useMutation({
    mutationFn: async (payload: { gymId: string; staffRoleId: string }) => {
      const response = await callEdgeFunction("manage-gym-staff", {
        body: { action: "REMOVE_STAFF", gym_id: payload.gymId, staff_role_id: payload.staffRoleId },
      });

      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onSuccess: (_data, variables) => {
      notify("Staff removed", "success");
      queryClient.invalidateQueries({ queryKey: ["gym-staff", variables.gymId] });
      queryClient.invalidateQueries({ queryKey: ["gym-audit-log", variables.gymId] });
    },
    onError: (error: Error) => {
      notify(error.message, "error");
    },
  });

  return { assignStaff, updateRole, removeStaff };
}

export function useGymNotes(gymId?: string) {
  return useQuery<GymNote[]>({
    queryKey: ["gym-notes", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("gym_notes")
        .select("id, author_user_id, note, created_at, users(full_name)")
        .eq("gym_id", gymId)
        .order("created_at", { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? []) as GymNote[];
    },
  });
}

export function useAddGymNote() {
  const queryClient = useQueryClient();
  const { notify } = useToastFeedback();

  return useMutation({
    mutationFn: async (payload: { gymId: string; note: string }) => {
      const response = await callEdgeFunction("manage-gym", {
        body: { action: "ADD_NOTE", gym_id: payload.gymId, note: payload.note },
      });

      if (response.error) {
        throw new Error(response.error);
      }

      return response.data;
    },
    onSuccess: (_data, variables) => {
      notify("Note added", "success");
      queryClient.invalidateQueries({ queryKey: ["gym-notes", variables.gymId] });
      queryClient.invalidateQueries({ queryKey: ["gym-audit-log", variables.gymId] });
    },
    onError: (error: Error) => {
      notify(error.message, "error");
    },
  });
}

export function useAuditLog(gymId?: string) {
  return useQuery<GymAuditEvent[]>({
    queryKey: ["gym-audit-log", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("gym_audit_events")
        .select("id, actor_user_id, event_type, payload, created_at, users(full_name)")
        .eq("gym_id", gymId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? []) as GymAuditEvent[];
    },
  });
}
