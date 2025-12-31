import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import MemberDashboardScreen from "../screens/member/MemberDashboardScreen";
import BillingScreen from "../screens/member/BillingScreen";
import BillingHistoryScreen from "../screens/member/BillingHistoryScreen";
import { colors } from "../styles/theme";

export type MemberTabParamList = {
  MemberDashboard: undefined;
  Billing: undefined;
  History: undefined;
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
      <Tab.Screen name="Billing" component={BillingScreen} options={{ title: "Billing" }} />
      <Tab.Screen name="History" component={BillingHistoryScreen} options={{ title: "History" }} />
    </Tab.Navigator>
  );
}
