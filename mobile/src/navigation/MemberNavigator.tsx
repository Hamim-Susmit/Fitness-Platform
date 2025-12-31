import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import MemberDashboardScreen from "../screens/member/MemberDashboardScreen";
import { colors } from "../styles/theme";

export type MemberTabParamList = {
  MemberDashboard: undefined;
};

const Tab = createBottomTabNavigator<MemberTabParamList>();

export default function MemberNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
      }}
    >
      <Tab.Screen name="MemberDashboard" component={MemberDashboardScreen} options={{ title: "Dashboard" }} />
    </Tab.Navigator>
  );
}
