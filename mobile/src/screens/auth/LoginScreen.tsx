import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../../lib/supabase";
import { fetchUserRole } from "../../lib/auth";
import { useSessionStore } from "../../store/useSessionStore";
import { colors, spacing, fontSize } from "../../styles/theme";
import { registerPushToken } from "../../lib/push/registerPushToken";

export default function LoginScreen() {
  const navigation = useNavigation();
  const { loading, setLoading, setRole, setSession } = useSessionStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session?.user) {
        const nextRole = await fetchUserRole(session.user.id);
        setRole(nextRole);
        registerPushToken(session.user.id);
      } else {
        setRole(null);
      }
      setLoading(false);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [setLoading, setRole, setSession]);

  const handleLogin = async () => {
    setSubmitting(true);
    setError(null);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.session) {
      setError(signInError?.message ?? "Unable to sign in");
      setSubmitting(false);
      return;
    }

    const nextRole = await fetchUserRole(data.session.user.id);
    setRole(nextRole);
    setSession(data.session);
    registerPushToken(data.session.user.id);
    setSubmitting(false);

    if (nextRole === "member") {
      navigation.reset({ index: 0, routes: [{ name: "MemberRoot" as never }] });
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: "StaffRoot" as never }] });
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Gym Membership</Text>
        <Text style={styles.subtitle}>Sign in to access your dashboard.</Text>
        <View style={styles.formField}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={handleLogin} disabled={submitting}>
          {submitting || loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: "600",
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  formField: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.textPrimary,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: "center",
  },
  buttonText: {
    color: colors.background,
    fontWeight: "600",
  },
  error: {
    color: colors.error,
    marginBottom: spacing.sm,
  },
});
