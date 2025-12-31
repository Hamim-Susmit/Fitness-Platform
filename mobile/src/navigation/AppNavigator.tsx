import React, { useEffect } from "react";
import { NavigationContainer, NavigatorScreenParams, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AuthNavigator from "./AuthNavigator";
import MemberNavigator from "./MemberNavigator";
import StaffNavigator from "./StaffNavigator";
import { loadSessionAndRole } from "../lib/auth";
import { useSessionStore } from "../store/useSessionStore";
import { roleRootRoute } from "../lib/roles";
import { View, ActivityIndicator } from "react-native";
import { colors } from "../styles/theme";
import type { MemberStackParamList } from "./member";
import { registerPushToken } from "../lib/push/registerPushToken";
import { useNotificationRouter } from "../lib/push/useNotificationRouter";

export type RootStackParamList = {
  Auth: undefined;
  MemberRoot: NavigatorScreenParams<MemberStackParamList> | undefined;
  StaffRoot: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function AppNavigator() {
  const { session, role, loading } = useSessionStore();

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (session?.user.id) {
      registerPushToken(session.user.id);
    }
  }, [session?.user.id]);

  useNotificationRouter(navigationRef);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        ) : roleRootRoute(role) === "MemberRoot" ? (
          <Stack.Screen name="MemberRoot" component={MemberNavigator} />
        ) : (
          <Stack.Screen name="StaffRoot" component={StaffNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
