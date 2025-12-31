import React, { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AuthNavigator from "./AuthNavigator";
import MemberNavigator from "./MemberNavigator";
import StaffNavigator from "./StaffNavigator";
import { loadSessionAndRole } from "../lib/auth";
import { useSessionStore } from "../store/useSessionStore";
import { View, ActivityIndicator } from "react-native";
import { colors } from "../styles/theme";

export type RootStackParamList = {
  Auth: undefined;
  MemberRoot: undefined;
  StaffRoot: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const { session, role, loading } = useSessionStore();

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        ) : role === "member" ? (
          <Stack.Screen name="MemberRoot" component={MemberNavigator} />
        ) : (
          <Stack.Screen name="StaffRoot" component={StaffNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
