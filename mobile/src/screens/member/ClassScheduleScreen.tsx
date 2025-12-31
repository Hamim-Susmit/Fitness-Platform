import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ScrollView,
  RefreshControl,
  Alert,
  Platform,
  ToastAndroid,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { colors, spacing, fontSize } from "../../styles/theme";
import ClassInstanceCard from "../../components/ClassInstanceCard";
import { useBookings } from "../../lib/useBookings";
import {
  useBookingMaps,
  useClassBookingCounts,
  useClassInstances,
  useClassTypes,
  useMemberAccessState,
  useMemberBookings,
  useMemberWaitlist,
} from "../../lib/useClassSchedule";
import { useMemberProfile } from "../../lib/useBilling";
import { useSessionStore } from "../../store/useSessionStore";
import type { MemberStackParamList } from "../../navigation/member";
import { useActiveGym } from "../../lib/useActiveGym";
import LocationSwitcher from "../../components/LocationSwitcher";

// TODO: Add calendar grid view for class browsing.
// TODO: Add class reminders and notifications.
// TODO: Add “add to calendar” actions.
// TODO: Add swipe booking gestures in the list.
// TODO: Add attendance badge history insights.

type DateFilter = "today" | "tomorrow" | "week";

const dateOptions: { key: DateFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This Week" },
];

const showToast = (message: string) => {
  if (Platform.OS === "android") {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert("Classes", message);
  }
};

const formatDateRange = (filter: DateFilter) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(startOfDay);
  const end = new Date(startOfDay);

  if (filter === "tomorrow") {
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
  }

  if (filter === "week") {
    end.setDate(end.getDate() + 6);
  }

  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
};

export default function ClassScheduleScreen() {
  const { session } = useSessionStore();
  const navigation = useNavigation<NativeStackNavigationProp<MemberStackParamList>>();
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [classTypeId, setClassTypeId] = useState<string | "all">("all");
  const [pendingInstanceId, setPendingInstanceId] = useState<string | null>(null);

  const { data: member } = useMemberProfile(session?.user.id);
  const { data: accessState } = useMemberAccessState(member?.id);
  const { activeGymId, gyms, setActiveGym, isMultiGymUser, accessNotice, loading: gymsLoading } = useActiveGym();
  const { data: classTypes = [] } = useClassTypes(activeGymId ?? undefined);
  const dateRange = useMemo(() => formatDateRange(dateFilter), [dateFilter]);
  const filter = useMemo(
    () => ({
      from: dateRange.from,
      to: dateRange.to,
      classTypeId: classTypeId === "all" ? undefined : classTypeId,
    }),
    [dateRange.from, dateRange.to, classTypeId]
  );

  const {
    data: instances = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useClassInstances(activeGymId ?? undefined, filter);

  const instanceIds = useMemo(() => instances.map((instance) => instance.id), [instances]);
  const { data: bookings = [] } = useMemberBookings(member?.id, instanceIds);
  const { data: waitlist = [] } = useMemberWaitlist(member?.id, instanceIds);
  const { data: bookingCounts = [] } = useClassBookingCounts(instanceIds);
  const { bookingMap, waitlistMap } = useBookingMaps(bookings, waitlist);
  const bookingCountMap = useMemo(() => {
    const map = new Map<string, number>();
    bookingCounts.forEach((entry) => map.set(entry.class_instance_id, entry.count));
    return map;
  }, [bookingCounts]);

  const { bookClass, cancelBooking, joinWaitlist } = useBookings();

  const isRestricted = accessState?.access_state === "restricted";
  const isGrace = accessState?.access_state === "grace";

  const handleBook = async (instanceId: string) => {
    setPendingInstanceId(instanceId);
    try {
      await bookClass.mutateAsync(instanceId);
      showToast("Class booked successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to book class.";
      showToast(message);
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleCancel = async (bookingId: string) => {
    setPendingInstanceId(bookingId);
    try {
      await cancelBooking.mutateAsync(bookingId);
      showToast("Booking canceled.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to cancel booking.";
      showToast(message);
    } finally {
      setPendingInstanceId(null);
    }
  };

  const handleJoinWaitlist = async (instanceId: string) => {
    setPendingInstanceId(instanceId);
    try {
      await joinWaitlist.mutateAsync(instanceId);
      showToast("Added to waitlist.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to join waitlist.";
      showToast(message);
    } finally {
      setPendingInstanceId(null);
    }
  };

  const renderItem = ({ item }: { item: (typeof instances)[number] }) => {
    const booking = bookingMap.get(item.id);
    const waitlisted = waitlistMap.get(item.id);
    const booked = booking?.status === "booked";
    const isWaitlisted = !!waitlisted;
    const count = bookingCountMap.get(item.id) ?? 0;
    const spotsLeft = Math.max(item.capacity - count, 0);
    const isFull = spotsLeft <= 0;
    const isPast = new Date(item.end_at).getTime() < Date.now();
    const isCanceled = item.status !== "scheduled";

    const statusLabel = booked ? "BOOKED" : isWaitlisted ? "WAITLIST" : isFull ? "FULL" : "AVAILABLE";
    const timeRange = `${new Date(item.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${new Date(
      item.end_at
    ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const instructorName = item.class_schedules?.instructors?.users?.full_name ?? "Staff";
    const className = item.class_schedules?.class_types?.name ?? "Class";
    const attendanceStatus = booking?.attendance_status
      ? booking.attendance_status.replace("_", " ")
      : "pending";
    const attendanceLabel = booked && isPast ? `Attendance: ${attendanceStatus}` : undefined;

    const disableActions = isRestricted || isPast || isCanceled;
    const pending = pendingInstanceId === item.id || pendingInstanceId === booking?.id;

    return (
      <ClassInstanceCard
        title={className}
        instructor={instructorName}
        timeRange={timeRange}
        capacityLabel={`${spotsLeft} spots left · ${item.capacity} capacity`}
        statusLabel={statusLabel}
        attendanceLabel={attendanceLabel}
        onPressDetails={() => navigation.navigate("ClassDetails", { instanceId: item.id })}
        onBook={!booked && !isFull ? () => handleBook(item.id) : undefined}
        onCancel={booked ? () => handleCancel(booking?.id ?? "") : undefined}
        onJoinWaitlist={!booked && isFull ? () => handleJoinWaitlist(item.id) : undefined}
        disabled={disableActions}
        pending={pending}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <LocationSwitcher
          gyms={gyms}
          activeGym={gyms.find((gym) => gym.id === activeGymId) ?? null}
          activeGymId={activeGymId}
          isMultiGymUser={isMultiGymUser}
          accessNotice={accessNotice}
          loading={gymsLoading}
          onSelect={setActiveGym}
          onChange={() => refetch()}
        />
      </View>
      {isRestricted ? (
        <View style={styles.bannerError}>
          <Text style={styles.bannerText}>Access restricted — update billing to book classes.</Text>
        </View>
      ) : null}
      {isGrace ? (
        <View style={styles.bannerWarning}>
          <Text style={styles.bannerText}>Payment issue detected — booking still allowed during grace period.</Text>
        </View>
      ) : null}
      <View style={styles.filters}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {dateOptions.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => setDateFilter(option.key)}
              style={[styles.filterChip, dateFilter === option.key && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, dateFilter === option.key && styles.filterChipTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <Pressable
            onPress={() => setClassTypeId("all")}
            style={[styles.filterChip, classTypeId === "all" && styles.filterChipActive]}
          >
            <Text style={[styles.filterChipText, classTypeId === "all" && styles.filterChipTextActive]}>All classes</Text>
          </Pressable>
          {classTypes.map((type) => (
            <Pressable
              key={type.id}
              onPress={() => setClassTypeId(type.id)}
              style={[styles.filterChip, classTypeId === type.id && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, classTypeId === type.id && styles.filterChipTextActive]}>
                {type.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {!activeGymId && gyms.length > 0 ? <Text style={styles.helper}>Select a gym to view classes.</Text> : null}
      {isFetching ? <Text style={styles.helper}>Updating schedule...</Text> : null}
      {isError && instances.length === 0 ? (
        <Text style={styles.helper}>Unable to load classes. Check your connection.</Text>
      ) : null}
      {!isLoading && instances.length === 0 && !isError ? (
        <Text style={styles.helper}>No classes in this range.</Text>
      ) : null}
      <FlatList
        data={instances}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl tintColor={colors.accent} refreshing={isFetching} onRefresh={refetch} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  filters: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  filterRow: {
    gap: spacing.sm,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  filterChipActive: {
    backgroundColor: "rgba(34, 211, 238, 0.2)",
    borderColor: colors.accent,
  },
  filterChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  filterChipTextActive: {
    color: colors.accent,
    fontWeight: "600",
  },
  list: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  helper: {
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  bannerError: {
    backgroundColor: "rgba(251, 113, 133, 0.2)",
    padding: spacing.md,
  },
  bannerWarning: {
    backgroundColor: "rgba(251, 191, 36, 0.2)",
    padding: spacing.md,
  },
  bannerText: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
  },
});
