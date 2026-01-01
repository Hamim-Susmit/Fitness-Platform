import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "../supabase";

const getProjectId = () => {
  const expoConfig = Constants.expoConfig;
  return expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
};

export async function registerPushToken(userId: string) {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let status = existingStatus;

  if (status !== "granted") {
    const request = await Notifications.requestPermissionsAsync();
    status = request.status;
  }

  if (status !== "granted") {
    return null;
  }

  const projectId = getProjectId();
  const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const token = tokenResponse.data;

  if (!token) {
    return null;
  }

  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

  await supabase
    .from("push_tokens")
    .upsert({ user_id: userId, token, platform }, { onConflict: "user_id,token,platform" });

  return token;
}
