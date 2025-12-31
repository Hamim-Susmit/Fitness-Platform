import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MemberDashboardScreen from "../screens/member/MemberDashboardScreen";
import BillingScreen from "../screens/member/BillingScreen";
import BillingHistoryScreen from "../screens/member/BillingHistoryScreen";
import ClassScheduleScreen from "../screens/member/ClassScheduleScreen";
import ClassDetailsScreen from "../screens/member/ClassDetailsScreen";
import { colors } from "../styles/theme";
import type { MemberStackParamList, MemberTabParamList } from "./member";

const Tab = createBottomTabNavigator<MemberTabParamList>();
const Stack = createNativeStackNavigator<MemberStackParamList>();

function MemberTabs() {
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

export default function MemberNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
      }}
    >
      <Stack.Screen name="MemberTabs" component={MemberTabs} options={{ headerShown: false }} />
      <Stack.Screen name="ClassSchedule" component={ClassScheduleScreen} options={{ title: "Classes" }} />
      <Stack.Screen name="ClassDetails" component={ClassDetailsScreen} options={{ title: "Class Details" }} />
    </Stack.Navigator>
  );
}
