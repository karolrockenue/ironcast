import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { PRKind } from "../db/queries";

// Mid-workout PR toast. Slides down from the top and fades out — non-blocking,
// so the rest timer and the rest of the screen stay interactive. Parent owns
// mount/unmount via `visible`.
export function PrCelebration({
  visible,
  kind,
  exerciseName,
  value,
}: {
  visible: boolean;
  kind: PRKind;
  exerciseName: string;
  value: string;
}) {
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      translateY.setValue(-80);
      opacity.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]).start();
  }, [visible]);

  if (!visible) return null;

  const kindLabel =
    kind === "weight" ? "WEIGHT" : kind === "rep" ? "REPS" : "VOLUME";

  return (
    <Animated.View
      style={[s.toast, { opacity, transform: [{ translateY }] }]}
      pointerEvents="none"
    >
      <View style={s.badge}>
        <Text style={s.badgeText}>PR</Text>
      </View>
      <View style={s.body}>
        <Text style={s.kindText}>NEW {kindLabel} RECORD</Text>
        <Text style={s.exText} numberOfLines={1}>
          {exerciseName} · {value}
        </Text>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  toast: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    zIndex: 200,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  badge: {
    borderWidth: 2,
    borderColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  body: { flex: 1 },
  kindText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
  },
  exText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 2,
  },
});
