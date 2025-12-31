import React from "react";
import { View, Text, StyleSheet } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { colors, spacing, fontSize } from "../styles/theme";

type QRDisplayProps = {
  token: string | null;
  expiresInSeconds: number | null;
};

export default function QRDisplay({ token, expiresInSeconds }: QRDisplayProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.subtitle}>Show this QR at the front desk</Text>
      <View style={styles.qrWrapper}>
        {token ? (
          <QRCode value={token} size={220} color={colors.textPrimary} backgroundColor={colors.surface} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No active token</Text>
          </View>
        )}
      </View>
      <Text style={styles.helperText}>
        {expiresInSeconds !== null && expiresInSeconds > 0
          ? `Expires in ${expiresInSeconds}s`
          : "Tap refresh to generate a new token."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: spacing.lg,
    alignItems: "center",
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  qrWrapper: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  placeholder: {
    height: 220,
    width: 220,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    color: colors.textSecondary,
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
});
