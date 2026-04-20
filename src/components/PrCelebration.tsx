import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { PRKind } from "../db/queries";

const heavyFont = Platform.select({
  ios: "Impact",
  android: "sans-serif-condensed",
  default: undefined,
}) as string | undefined;

// Mid-workout PR celebration — fades in for ~1.6 s then fades out. The parent
// controls the mount/unmount via `visible`; this component handles the animation.
export function PrCelebration({
  visible,
  kind,
  exerciseName,
  value,
}: {
  visible: boolean;
  kind: PRKind;
  exerciseName: string;
  value: string; // pre-formatted display value, e.g. "55 kg × 8"
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (!visible) {
      opacity.setValue(0);
      scale.setValue(0.9);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible]);

  if (!visible) return null;

  const kindLabel = kind === "weight"
    ? "WEIGHT"
    : kind === "rep"
    ? "REPS"
    : "VOLUME";

  return (
    <Animated.View
      style={[s.backdrop, { opacity }]}
      pointerEvents="none"
    >
      <Animated.View style={[s.card, { transform: [{ scale }] }]}>
        <View style={s.badge}>
          <Text
            style={[s.badgeText, heavyFont ? { fontFamily: heavyFont } : null]}
          >
            PR
          </Text>
        </View>
        <View style={s.bar} />
        <Text style={s.newLabel}>NEW {kindLabel} RECORD</Text>
        <Text style={s.ex} numberOfLines={2}>{exerciseName}</Text>
        <Text style={s.value}>{value}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(13,13,13,0.96)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 200,
  },
  card: {
    alignItems: "center",
    paddingHorizontal: 32,
  },
  badge: {
    borderWidth: 3,
    borderColor: colors.accent,
    paddingHorizontal: 28,
    paddingVertical: 6,
    marginBottom: 18,
  },
  badgeText: {
    color: colors.accent,
    fontSize: 96,
    fontWeight: "900",
    letterSpacing: 6,
    lineHeight: 96,
    includeFontPadding: false,
  },
  bar: {
    width: 56,
    height: 3,
    backgroundColor: colors.accent,
    marginBottom: 14,
  },
  newLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 4,
    marginBottom: 14,
  },
  ex: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  value: {
    color: colors.text,
    fontSize: 36,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
});
