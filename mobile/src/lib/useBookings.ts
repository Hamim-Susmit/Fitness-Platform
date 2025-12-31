import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callEdgeFunction } from "./api";

export function useBookings() {
  const queryClient = useQueryClient();

  const bookClass = useMutation({
    mutationFn: async (classInstanceId: string) => {
      const response = await callEdgeFunction<{ booking: unknown }>("book_class", {
        body: { class_instance_id: classInstanceId },
      });
      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to book class");
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class-instances"] });
      queryClient.invalidateQueries({ queryKey: ["class-bookings"] });
    },
  });

  const cancelBooking = useMutation({
    mutationFn: async (bookingId: string) => {
      const response = await callEdgeFunction<{ status: string; late: boolean }>("cancel_booking", {
        body: { booking_id: bookingId },
      });
      if (response.error || !response.data) {
        throw new Error(response.error ?? "Unable to cancel booking");
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class-instances"] });
      queryClient.invalidateQueries({ queryKey: ["class-bookings"] });
    },
  });

  return { bookClass, cancelBooking };
}
