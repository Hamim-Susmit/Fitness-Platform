"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callEdgeFunction } from "../api";
import type { RosterMember, WaitlistMember } from "./useClassInstance";

type RosterCache = {
  roster: RosterMember[];
  waitlist: WaitlistMember[];
};

export function useRosterActions(instanceId?: string) {
  const queryClient = useQueryClient();

  const markAttended = useMutation({
    mutationFn: async (bookingId: string) => {
      const response = await callEdgeFunction("manage-class-roster", {
        body: { action: "MARK_ATTENDED", instance_id: instanceId, booking_id: bookingId },
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onMutate: async (bookingId) => {
      await queryClient.cancelQueries({ queryKey: ["class-roster", instanceId] });
      const previous = queryClient.getQueryData<{ roster: RosterMember[]; waitlist: WaitlistMember[] }>([
        "class-roster",
        instanceId,
      ]);

      if (previous) {
        queryClient.setQueryData(["class-roster", instanceId], {
          ...previous,
          roster: previous.roster.map((entry) =>
            entry.booking_id === bookingId
              ? { ...entry, attendance_status: "checked_in", attendance_marked_at: new Date().toISOString() }
              : entry
          ),
        });
      }

      return { previous };
    },
    onError: (_error, _bookingId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["class-roster", instanceId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["class-roster", instanceId] });
    },
  });

  const removeMember = useMutation({
    mutationFn: async (bookingId: string) => {
      const response = await callEdgeFunction("manage-class-roster", {
        body: { action: "REMOVE_MEMBER", instance_id: instanceId, booking_id: bookingId },
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onMutate: async (bookingId) => {
      await queryClient.cancelQueries({ queryKey: ["class-roster", instanceId] });
      const previous = queryClient.getQueryData<{ roster: RosterMember[]; waitlist: WaitlistMember[] }>([
        "class-roster",
        instanceId,
      ]);

      if (previous) {
        queryClient.setQueryData(["class-roster", instanceId], {
          ...previous,
          roster: previous.roster.filter((entry) => entry.booking_id !== bookingId),
        });
      }

      return { previous };
    },
    onError: (_error, _bookingId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["class-roster", instanceId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["class-roster", instanceId] });
    },
  });

  const promoteFromWaitlist = useMutation({
    mutationFn: async (waitlistId: string) => {
      const response = await callEdgeFunction("manage-class-roster", {
        body: { action: "MOVE_FROM_WAITLIST", instance_id: instanceId, waitlist_id: waitlistId },
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data;
    },
    onMutate: async (waitlistId) => {
      await queryClient.cancelQueries({ queryKey: ["class-roster", instanceId] });
      const previous = queryClient.getQueryData<{ roster: RosterMember[]; waitlist: WaitlistMember[] }>([
        "class-roster",
        instanceId,
      ]);

      if (previous) {
        const waitlistEntry = previous.waitlist.find((entry) => entry.waitlist_id === waitlistId);
        queryClient.setQueryData(["class-roster", instanceId], {
          ...previous,
          waitlist: previous.waitlist.filter((entry) => entry.waitlist_id !== waitlistId),
          roster: waitlistEntry
            ? [
                ...previous.roster,
                {
                  booking_id: `pending-${waitlistEntry.waitlist_id}`,
                  member_id: waitlistEntry.member_id,
                  member_name: waitlistEntry.member_name,
                  status: "booked",
                  attendance_status: "pending",
                  attendance_marked_at: null,
                  booking_type: "plan",
                },
              ]
            : previous.roster,
        });
      }

      return { previous };
    },
    onError: (_error, _waitlistId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["class-roster", instanceId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["class-roster", instanceId] });
    },
  });

  return { markAttended, removeMember, promoteFromWaitlist };
}
