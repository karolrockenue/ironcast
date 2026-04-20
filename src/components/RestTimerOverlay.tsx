import { View, Text, Pressable, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../theme/colors";
import { RestState } from "../store/restTimer";

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SIZE = 260;
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const CIRCUM = 2 * Math.PI * R;

type Props = {
  rest: RestState;
  onAdjust: (delta: number) => void;
  onSkip: () => void;
};

export function RestTimerOverlay({ rest, onAdjust, onSkip }: Props) {
  if (!rest.running || rest.remaining <= 0) return null;

  const fraction = rest.totalSeconds > 0 ? rest.remaining / rest.totalSeconds : 0;
  const dashOffset = CIRCUM * (1 - fraction);

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <Text style={styles.heading}>REST</Text>

      <View style={styles.ringWrap}>
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={colors.surfaceLight}
            strokeWidth={STROKE}
            fill="none"
          />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={colors.accent}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${CIRCUM} ${CIRCUM}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <View style={styles.ringCenter} pointerEvents="none">
          <Text style={styles.timeText}>{fmt(rest.remaining)}</Text>
          <Text style={styles.totalText}>of {fmt(rest.totalSeconds)}</Text>
        </View>
      </View>

      <View style={styles.adjustRow}>
        <Pressable style={styles.adjustBtn} onPress={() => onAdjust(-30)}>
          <Text style={styles.adjustText}>−30s</Text>
        </Pressable>
        <Pressable style={styles.adjustBtn} onPress={() => onAdjust(30)}>
          <Text style={styles.adjustText}>+30s</Text>
        </Pressable>
      </View>

      {rest.label && (
        <View style={styles.nextBox}>
          <Text style={styles.nextLabel}>UP NEXT</Text>
          <Text style={styles.nextText}>{rest.label}</Text>
        </View>
      )}

      <Pressable style={styles.skipBtn} onPress={onSkip}>
        <Text style={styles.skipText}>Skip Rest</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(13,13,13,0.97)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    zIndex: 100,
  },
  heading: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 3,
    marginBottom: 16,
  },
  ringWrap: {
    width: SIZE,
    height: SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
  ringCenter: {
    position: "absolute",
    alignItems: "center",
  },
  timeText: {
    color: colors.text,
    fontSize: 72,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    letterSpacing: -2,
  },
  totalText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  adjustRow: { flexDirection: "row", gap: 16, marginTop: 28 },
  adjustBtn: {
    backgroundColor: colors.surface,
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 100,
    alignItems: "center",
  },
  adjustText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  nextBox: { marginTop: 32, alignItems: "center", maxWidth: "100%" },
  nextLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },
  nextText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginTop: 6,
    textAlign: "center",
  },
  skipBtn: {
    position: "absolute",
    bottom: 36,
    left: 24,
    right: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  skipText: { color: colors.textSecondary, fontSize: 15, fontWeight: "700" },
});
