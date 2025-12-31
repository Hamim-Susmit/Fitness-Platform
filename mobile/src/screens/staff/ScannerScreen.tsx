import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { colors, spacing, fontSize } from "../../styles/theme";
import { useToastStore } from "../../store/useSessionStore";

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const { message, status, setToast } = useToastStore();

  const validateToken = useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.functions.invoke("validate_qr_token", {
        body: { token },
      });
      if (error) {
        throw error;
      }
      return data as { checkin_id: string };
    },
    onSuccess: () => {
      setToast("Check-in confirmed!", "success");
      setTimeout(() => setToast(null, null), 3000);
    },
    onError: (error) => {
      setToast(error.message ?? "Invalid token", "error");
      setTimeout(() => setToast(null, null), 3000);
    },
  });

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleScan = ({ data }: { data: string }) => {
    if (!scanning || validateToken.isPending) return;
    setScanning(false);
    validateToken.mutate(data, {
      onSettled: () => {
        setTimeout(() => setScanning(true), 2000);
      },
    });
  };

  if (!permission?.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.subtitle}>Camera permission is required to scan QR codes.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Enable Camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Scan Member QR</Text>
        <Text style={styles.subtitle}>Align the QR code within the frame.</Text>
      </View>
      <View style={styles.cameraWrapper}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={handleScan}
        />
      </View>
      {message ? (
        <View
          style={[
            styles.toast,
            status === "success" ? styles.toastSuccess : styles.toastError,
          ]}
        >
          <Text style={styles.toastText}>{message}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  cameraWrapper: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  camera: {
    flex: 1,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  buttonText: {
    color: colors.background,
    fontWeight: "600",
  },
  toast: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
  },
  toastSuccess: {
    borderColor: colors.success,
    backgroundColor: "rgba(52, 211, 153, 0.1)",
  },
  toastError: {
    borderColor: colors.error,
    backgroundColor: "rgba(251, 113, 133, 0.1)",
  },
  toastText: {
    color: colors.textPrimary,
  },
});
