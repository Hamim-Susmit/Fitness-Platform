import { useEffect } from "react";
import { Alert, AppState } from "react-native";
import * as Notifications from "expo-notifications";
import type { NavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "../../navigation/AppNavigator";

// TODO: Add SMS reminders.
// TODO: Add email confirmations.
// TODO: Add smart reminder timing based on user behavior.
// TODO: Add quiet hours settings.
// TODO: Add digest mode for batch notifications.
// TODO: Add per-class reminder overrides.

const getClassInstanceId = (data: Record<string, unknown>) => {
  if (typeof data.class_instance_id === "string") {
    return data.class_instance_id;
  }
  if (typeof data.classInstanceId === "string") {
    return data.classInstanceId;
  }
  return null;
};

export function useNotificationRouter(navigationRef: NavigationContainerRef<RootStackParamList>) {
  useEffect(() => {
    const receivedListener = Notifications.addNotificationReceivedListener((notification) => {
      if (AppState.currentState === "active") {
        const title = notification.request.content.title ?? "Gym update";
        const body = notification.request.content.body ?? "Open to view details.";
        Alert.alert(title, body);
      }
    });

    const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const instanceId = getClassInstanceId(data ?? {});
      if (!instanceId || !navigationRef.isReady()) {
        return;
      }

      navigationRef.navigate("MemberRoot", {
        screen: "ClassDetails",
        params: { instanceId },
      });
    });

    return () => {
      receivedListener.remove();
      responseListener.remove();
    };
  }, [navigationRef]);
}
