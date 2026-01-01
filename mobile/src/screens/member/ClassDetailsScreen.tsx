import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  ToastAndroid,
} from "react-native";
import { RouteProp, useRoute } from "@react-navigation/native";
import { colors, spacing, fontSize } from "../../styles/theme";
import { useBookings } from "../../lib/useBookings";
import {
  useBookingMaps,
  useClassBookingCounts,
  useClassInstance,
  useMemberAccessState,
  useMemberBookings,
  useMemberWaitlist,
} from "../../lib/useClassSchedule";
import { useMemberProfile } from "../../lib/useBilling";
import { useSessionStore } from "../../store/useSessionStore";
import type { MemberStackParamList } from "../../navigation/member";

const showToast = (message: string) => {
  if (Platform.OS === "android") {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert("Class", message);
  }
};

export default function ClassDetailsScreen() {
  const route = useRoute<RouteProp<MemberStackParamList, "ClassDetails">>();
  const { session } = useSessionStore();
  const [pendingInstanceId, setPendingInstanceId] = useState<string | null>(null);
  const { data: member } = useMemberProfile(session?.user.id);
  const { data: accessState } = useMemberAccessState(member?.id);
  const { data: instance } = useClassInstance(route.params.instanceId);

  const instanceIds = useMemo(() => (instance ? [instance.id] : []), [instance]);
  const { data: bookings = [] } = useMemberBookings(member?.id, instanceIds);
  const { data: waitlist = [] } = useMemberWaitlist(member?.id, instanceIds);
  const { data: bookingCounts = [] } = useClassBookingCounts(instanceIds);
  const { bookingMap, waitlistMap } = useBookingMaps(bookings, waitlist);
  const { bookClass, cancelBooking, joinWaitlist } = useBookings();

  const booking = instance ? bookingMap.get(instance.id) : undefined;
  const waitlisted = instance ? waitlistMap.get(instance.id) : undefined;
  const booked = booking?.status === "booked";
  const count = instance ? bookingCounts.find((entry) => entry.class_instance_id === instance.id)?.count ?? 0 : 0;
  const spotsLeft = instance ? Math.max(instance.capacity - count, 0) : 0;
  const isFull = spotsLeft <= 0;
  const isPast = instance ? new Date(instance.end_at).getTime() < Date.now() : false;
  const isRestricted = accessState?.access_state === "restricted";
  const isCanceled = instance?.status !== "scheduled";

  const disableActions = isRestricted || isPast || isCanceled;
  const pending = pendingInstanceId === instance?.id || pendingInstanceId === booking?.id;

  const handleBook = async () => {
    if (!instance) {
      return;
    }
    setPendingInstanceId(instance.id);
    try {
      await bookClass.mutateAsync(instance.id);
      showToast("Class booked successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to book class.";
      showToast(message);
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleCancel = async () => {
    if (!booking) {
      return;
    }
    setPendingInstanceId(booking.id);
    try {
      await cancelBooking.mutateAsync(booking.id);
      showToast("Booking canceled.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to cancel booking.";
      showToast(message);
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleJoinWaitlist = async () => {
    if (!instance) {
      return;
    }
    setPendingInstanceId(instance.id);
    try {
      await joinWaitlist.mutateAsync(instance.id);
      showToast("Added to waitlist.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to join waitlist.";
      showToast(message);
    } finally {
      setPendingInstanceId(null);
    }
  };

  if (!instance) {
    return (
      <View style={styles.container}>
        <Text style={styles.helper}>Loading class details...</Text>
      </View>
    );
  }

  const instructorName = instance.class_schedules?.instructors?.users?.full_name ?? "Staff";
  const instructorBio = instance.class_schedules?.instructors?.bio ?? "Instructor bio coming soon.";
  const className = instance.class_schedules?.class_types?.name ?? "Class";
  const timeRange = `${new Date(instance.start_at).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} - ${new Date(instance.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const attendanceStatus = booking?.attendance_status ? booking.attendance_status.replace("_", " ") : "pending";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {isRestricted ? (
        <View style={styles.bannerError}>
          <Text style={styles.bannerText}>Access restricted — update billing to book classes.</Text>
        </View>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.title}>{className}</Text>
        <Text style={styles.subtitle}>{instructorName}</Text>
        <Text style={styles.time}>{timeRange}</Text>
        <Text style={styles.capacity}>
          {spotsLeft} spots left · {instance.capacity} capacity
        </Text>
        <Text style={styles.statusLabel}>Status: {booked ? "Booked" : waitlisted ? "Waitlist" : isFull ? "Full" : "Available"}</Text>
        {booked ? <Text style={styles.attendance}>Attendance: {attendanceStatus}</Text> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Instructor</Text>
        <Text style={styles.body}>{instructorBio}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Actions</Text>
        {booked ? (
          <Pressable style={[styles.secondaryButton, disableActions && styles.buttonDisabled]} onPress={handleCancel} disabled={disableActions || pending}>
            <Text style={styles.secondaryText}>{pending ? "Canceling..." : "Cancel Booking"}</Text>
          </Pressable>
        ) : isFull ? (
          <Pressable
            style={[styles.secondaryButton, disableActions && styles.buttonDisabled]}
            onPress={handleJoinWaitlist}
            disabled={disableActions || pending || !!waitlisted}
          >
            <Text style={styles.secondaryText}>{waitlisted ? "On Waitlist" : pending ? "Joining..." : "Join Waitlist"}</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.primaryButton, disableActions && styles.buttonDisabled]} onPress={handleBook} disabled={disableActions || pending}>
            <Text style={styles.primaryText}>{pending ? "Booking..." : "Book Class"}</Text>
          </Pressable>
        )}
        {isPast ? <Text style={styles.helper}>This class has already ended.</Text> : null}
        {instance.status !== "scheduled" ? <Text style={styles.helper}>This class is no longer scheduled.</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    backgroundColor: colors.background,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: "600",
  },
  subtitle: {
    color: colors.textSecondary,
  },
  time: {
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  capacity: {
    color: colors.textSecondary,
  },
  statusLabel: {
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  attendance: {
    color: colors.success,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  body: {
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  primaryButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.accent,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: {
    color: colors.background,
    fontWeight: "600",
  },
  secondaryButton: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryText: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  helper: {
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  bannerError: {
    backgroundColor: "rgba(251, 113, 133, 0.2)",
    padding: spacing.md,
    borderRadius: 12,
  },
  bannerText: {
    color: colors.textPrimary,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
