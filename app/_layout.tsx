import { useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import { DBProvider } from "../src/db/provider";
import { colors } from "../src/theme/colors";

// Heavy condensed display face — closest system match to Anton from the Start 06 mock.
const heavyFont = Platform.select({
  ios: "Impact",
  android: "sans-serif-condensed",
  default: undefined,
}) as string | undefined;

function SplashOverlay({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Pressable style={sp.root} onPress={onDismiss}>
      <View style={sp.wordmark}>
        <Text
          style={[sp.line, sp.iron, heavyFont ? { fontFamily: heavyFont } : null]}
        >
          IRON
        </Text>
        <Text
          style={[sp.line, sp.log, heavyFont ? { fontFamily: heavyFont } : null]}
        >
          CAST
        </Text>
      </View>
      <View style={sp.bar} />
      <Text style={sp.tag}>ALT A · B · A · B</Text>
      <Text style={sp.tap}>TAP TO CONTINUE</Text>
    </Pressable>
  );
}

export default function RootLayout() {
  const [splashShown, setSplashShown] = useState(true);

  return (
    <DBProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="workout/active"
          options={{ title: "Workout", headerBackTitle: "Cancel" }}
        />
        <Stack.Screen
          name="workout/pick-exercise"
          options={{ title: "Add Exercise", presentation: "modal" }}
        />
        <Stack.Screen
          name="workout/summary"
          options={{ title: "", headerBackVisible: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="templates/index"
          options={{ title: "Templates", headerBackTitle: "Back" }}
        />
        <Stack.Screen
          name="templates/[id]"
          options={{ title: "Edit Template", headerBackTitle: "Templates" }}
        />
      </Stack>
      {splashShown && <SplashOverlay onDismiss={() => setSplashShown(false)} />}
    </DBProvider>
  );
}

const sp = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  wordmark: { alignItems: "center" },
  line: {
    fontSize: 92,
    fontWeight: "900",
    letterSpacing: 3,
    lineHeight: 86,
  },
  iron: { color: "#FFFFFF" },
  log: { color: colors.accent, marginTop: -6 },
  bar: {
    width: 88,
    height: 4,
    backgroundColor: colors.accent,
    marginTop: 20,
  },
  tag: {
    marginTop: 14,
    fontSize: 10,
    letterSpacing: 3,
    color: "rgba(255,255,255,0.45)",
    fontWeight: "700",
  },
  tap: {
    position: "absolute",
    bottom: 42,
    fontSize: 11,
    letterSpacing: 3,
    color: "rgba(255,255,255,0.45)",
    fontWeight: "700",
  },
});
