import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  FlatList,
  Platform,
  Alert,
  ToastAndroid,
} from "react-native";
import { colors, spacing, fontSize } from "../styles/theme";
import type { GymOption } from "../lib/useActiveGym";

const showToast = (message: string) => {
  if (Platform.OS === "android") {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert("Location", message);
  }
};

const formatSecondaryLine = (gym: GymOption) => {
  const address = gym.address ?? {};
  const city = typeof address.city === "string" ? address.city : "";
  const region = typeof address.region === "string" ? address.region : "";
  const line1 = typeof address.line1 === "string" ? address.line1 : "";
  const fallback = [city, region].filter(Boolean).join(", ");

  if (fallback) {
    return fallback;
  }
  if (line1) {
    return line1;
  }
  return gym.code ?? "Location";
};

type LocationSwitcherProps = {
  gyms: GymOption[];
  activeGym: GymOption | null;
  activeGymId: string | null;
  isMultiGymUser: boolean;
  accessNotice: string | null;
  loading: boolean;
  onSelect: (gymId: string) => Promise<void> | void;
  onChange?: (gymId: string) => void;
};

export default function LocationSwitcher({
  gyms,
  activeGym,
  activeGymId,
  isMultiGymUser,
  accessNotice,
  loading,
  onSelect,
  onChange,
}: LocationSwitcherProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (accessNotice) {
      showToast(accessNotice);
    }
  }, [accessNotice]);

  const sortedGyms = useMemo(() => gyms.slice().sort((a, b) => a.name.localeCompare(b.name)), [gyms]);

  const handleSelect = async (gymId: string) => {
    await onSelect(gymId);
    onChange?.(gymId);
    showToast("Location updated.");
    setOpen(false);
  };

  if (loading || (!isMultiGymUser && gyms.length > 0)) {
    return null;
  }

  if (!gyms.length) {
    return (
      <View style={styles.noAccess}>
        <Text style={styles.noAccessText}>No active gym access — contact support.</Text>
      </View>
    );
  }

  return (
    <View>
      <Pressable style={styles.button} onPress={() => setOpen(true)}>
        <Text style={styles.buttonLabel}>Location</Text>
        <Text style={styles.buttonValue}>{activeGym?.name ?? "Select gym"}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet}>
            <Text style={styles.sheetTitle}>Choose Location</Text>
            <FlatList
              data={sortedGyms}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const selected = item.id === activeGymId;
                return (
                  <Pressable
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => handleSelect(item.id)}
                  >
                    <View>
                      <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>{item.name}</Text>
                      <Text style={styles.optionSubtitle}>{formatSecondaryLine(item)}</Text>
                    </View>
                    {selected ? <Text style={styles.activeBadge}>Active</Text> : null}
                  </Pressable>
                );
              }}
              contentContainerStyle={styles.listContent}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignSelf: "flex-start",
  },
  buttonLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
  buttonValue: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  noAccess: {
    backgroundColor: "rgba(251, 113, 133, 0.2)",
    padding: spacing.md,
    borderRadius: spacing.md,
  },
  noAccessText: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.6)",
  },
  sheet: {
    backgroundColor: colors.background,
    padding: spacing.lg,
    borderTopLeftRadius: spacing.lg,
    borderTopRightRadius: spacing.lg,
    maxHeight: "70%",
  },
  sheetTitle: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  listContent: {
    gap: spacing.sm,
  },
  option: {
    borderRadius: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: "rgba(34, 211, 238, 0.15)",
  },
  optionTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  optionTitleSelected: {
    color: colors.accent,
  },
  optionSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  activeBadge: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: "600",
  },
});
