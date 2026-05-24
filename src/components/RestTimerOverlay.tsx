import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { RestState } from "../store/restTimer";

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  rest: RestState;
  onAdjust: (delta: number) => void;
  onSkip: () => void;
};

// Compact rest-timer bar. Renders inline above the bottom action row when a
// rest is running. Non-blocking — the user can still tap exercise cards while
// the timer counts down. A thin progress fill across the top of the bar
// communicates remaining time without a full-screen takeover.
export function RestTimerOverlay({ rest, onAdjust, onSkip }: Props) {
  if (!rest.running || rest.remaining <= 0) return null;

  const fraction =
    rest.totalSeconds > 0 ? rest.remaining / rest.totalSeconds : 0;

  return (
    <View style={s.bar}>
      <View style={s.progressTrack} pointerEvents="none">
        <View style={[s.progressFill, { width: `${fraction * 100}%` }]} />
      </View>
      <View style={s.row}>
        <View style={s.left}>
          <Text style={s.label}>REST</Text>
          <Text style={s.time}>{fmt(rest.remaining)}</Text>
        </View>
        <View style={s.actions}>
          <Pressable style={s.adjBtn} onPress={() => onAdjust(-30)} hitSlop={6}>
            <Text style={s.adjText}>−30</Text>
          </Pressable>
          <Pressable style={s.adjBtn} onPress={() => onAdjust(30)} hitSlop={6}>
            <Text style={s.adjText}>+30</Text>
          </Pressable>
          <Pressable style={s.skipBtn} onPress={onSkip} hitSlop={6}>
            <Text style={s.skipText}>SKIP</Text>
          </Pressable>
        </View>
      </View>
      {rest.label ? (
        <Text style={s.next} numberOfLines={1}>
          UP NEXT · {rest.label}
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
  },
  progressTrack: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "rgba(74,144,217,0.15)",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  left: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  time: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.5,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  adjBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  adjText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  skipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "rgba(74,144,217,0.18)",
    marginLeft: 4,
  },
  skipText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  next: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginTop: 6,
  },
});
