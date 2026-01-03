import { useEffect, useState } from "react";
import { Button, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FeedVisibility, setDefaultFeedVisibility } from "../../lib/social/events";

const STORAGE_KEY = "defaultFeedVisibility";

export default function PrivacySettingsScreen() {
  const [visibility, setVisibility] = useState<FeedVisibility>("FRIENDS_ONLY");

  useEffect(() => {
    const load = async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored === "PUBLIC" || stored === "FRIENDS_ONLY" || stored === "PRIVATE") {
        setVisibility(stored);
      }
    };
    load();
  }, []);

  const updateVisibility = async (value: FeedVisibility) => {
    setVisibility(value);
    await setDefaultFeedVisibility(value);
  };

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Privacy</Text>
      <Text>Default feed visibility</Text>
      <Button title="Public" onPress={() => updateVisibility("PUBLIC")} />
      <Button title="Friends only" onPress={() => updateVisibility("FRIENDS_ONLY")} />
      <Button title="Private" onPress={() => updateVisibility("PRIVATE")} />
      <Text>Current: {visibility}</Text>
    </View>
  );
}
