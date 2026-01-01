import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import StaffDashboardScreen from "../screens/staff/StaffDashboardScreen";
import ScannerScreen from "../screens/staff/ScannerScreen";
import { colors } from "../styles/theme";

export type StaffTabParamList = {
  StaffDashboard: undefined;
  Scanner: undefined;
};

const Tab = createBottomTabNavigator<StaffTabParamList>();

export default function StaffNavigator() {
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
      <Tab.Screen name="StaffDashboard" component={StaffDashboardScreen} options={{ title: "Dashboard" }} />
      <Tab.Screen name="Scanner" component={ScannerScreen} options={{ title: "Scan" }} />
    </Tab.Navigator>
  );
}
