import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDB } from "../../src/db/provider";
import {
  getWorkoutSummary,
  getWorkoutProgressions,
  WorkoutSummary,
  WorkoutProgression,
  PR,
} from "../../src/db/queries";
import { colors } from "../../src/theme/colors";

function fmtVol(kg: number) {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)}kg`;
}

function prLabel(pr: PR) {
  if (pr.kind === "weight")
    return {
      label: `${pr.value} kg`,
      sub: pr.prev > 0 ? `was ${pr.prev} kg` : "first time!",
      icon: "\u{1F3C6}",
    };
  if (pr.kind === "rep")
    return {
      label: `${pr.value} reps`,
      sub: pr.prev > 0 ? `was ${pr.prev}` : "first time!",
      icon: "\u{1F504}",
    };
  return {
    label: `${pr.value} kg volume`,
    sub: pr.prev > 0 ? `was ${pr.prev}` : "first time!",
    icon: "\u{1F4C8}",
  };
}

function progColor(dir: WorkoutProgression["progression"]["direction"]) {
  switch (dir) {
    case "increase":
      return colors.accent;
    case "same":
      return colors.success;
    case "decrease":
      return colors.warning;
    case "reps_only":
      return colors.success;
    default:
      return colors.textSecondary;
  }
}

function progIcon(dir: WorkoutProgression["progression"]["direction"]) {
  switch (dir) {
    case "increase":
      return "\u2191";
    case "same":
      return "\u2192";
    case "decrease":
      return "\u2193";
    case "reps_only":
      return "+1";
    default:
      return "\u2022";
  }
}

export default function Summary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDB();
  const router = useRouter();
  const [data, setData] = useState<WorkoutSummary | null>(null);
  const [progs, setProgs] = useState<WorkoutProgression[]>([]);

  useEffect(() => {
    const wid = Number(id);
    getWorkoutSummary(db, wid).then(setData);
    getWorkoutProgressions(db, wid).then(setProgs);
  }, [db, id]);

  if (!data) return null;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>Workout Complete</Text>

      {/* Hero stats */}
      <View style={s.heroRow}>
        <View style={s.heroCard}>
          <Text style={s.heroVal}>{fmtVol(data.total_volume)}</Text>
          <Text style={s.heroLabel}>Total Volume</Text>
        </View>
        <View style={s.heroCard}>
          <Text style={s.heroVal}>{data.duration_min}m</Text>
          <Text style={s.heroLabel}>Duration</Text>
        </View>
      </View>
      <View style={s.heroRow}>
        <View style={s.heroCard}>
          <Text style={s.heroVal}>{data.total_sets}</Text>
          <Text style={s.heroLabel}>Sets</Text>
        </View>
        <View style={s.heroCard}>
          <Text style={s.heroVal}>{data.exercise_count}</Text>
          <Text style={s.heroLabel}>Exercises</Text>
        </View>
      </View>

      {/* PRs */}
      {data.prs.length > 0 && (
        <View style={{ marginTop: 6 }}>
          <Text style={s.sectionTitle}>NEW PERSONAL RECORDS</Text>
          {data.prs.map((pr, i) => {
            const info = prLabel(pr);
            return (
              <View key={i} style={s.prRow}>
                <Text style={s.prIcon}>{info.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.prName}>
                    {pr.exercise_name} · {pr.kind.toUpperCase()} PR
                  </Text>
                  <Text style={s.prDetail}>
                    {info.label}
                    {"  "}
                    <Text style={s.prDetailDim}>({info.sub})</Text>
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Next-session progressions */}
      {progs.length > 0 && (
        <>
          <Text style={s.sectionTitle}>NEXT SESSION</Text>
          {progs.map((p, i) => {
            const col = progColor(p.progression.direction);
            return (
              <View
                key={i}
                style={[s.progRow, { borderLeftColor: col }]}
              >
                <Text style={[s.progIcon, { color: col }]}>
                  {progIcon(p.progression.direction)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.progName}>{p.exercise_name}</Text>
                  <Text style={s.progMsg}>{p.progression.message}</Text>
                </View>
                {(p.progression.direction === "increase" ||
                  p.progression.direction === "decrease") && (
                  <Text style={[s.progWeight, { color: col }]}>
                    {p.progression.suggested_weight} kg
                  </Text>
                )}
              </View>
            );
          })}
        </>
      )}

      {/* Exercise breakdown */}
      <Text style={s.sectionTitle}>EXERCISES</Text>
      {data.exercises.map((ex, i) => (
        <View key={i} style={s.exRow}>
          <Text style={s.exName}>{ex.name}</Text>
          <Text style={s.exDetail}>
            {ex.sets} set{ex.sets !== 1 ? "s" : ""} {"\u00B7"} best {ex.best_weight}
            kg {"\u00D7"} {ex.best_reps}
            {ex.drops > 0
              ? ` \u00B7 +${ex.drops} drop${ex.drops !== 1 ? "s" : ""}`
              : ""}
          </Text>
        </View>
      ))}

      <Pressable style={s.doneBtn} onPress={() => router.replace("/(tabs)")}>
        <Text style={s.doneBtnText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, paddingBottom: 48 },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: colors.text,
    textAlign: "center",
    marginTop: 20,
    marginBottom: 24,
  },

  heroRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  heroCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
  },
  heroVal: { color: colors.text, fontSize: 28, fontWeight: "900" },
  heroLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
    letterSpacing: 1.5,
    marginBottom: 10,
    marginTop: 20,
  },

  prRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1A1A0D",
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#3D3500",
  },
  prIcon: { fontSize: 22 },
  prName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  prDetail: { color: colors.warning, fontSize: 13, marginTop: 2 },
  prDetailDim: { color: colors.textSecondary },

  progRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderLeftWidth: 3,
  },
  progIcon: { fontSize: 20, fontWeight: "900", width: 28, textAlign: "center" },
  progName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  progMsg: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  progWeight: {
    fontSize: 15,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },

  exRow: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  exName: { color: colors.text, fontSize: 14, fontWeight: "600", flex: 1 },
  exDetail: { color: colors.textSecondary, fontSize: 13 },

  doneBtn: {
    backgroundColor: colors.accent,
    padding: 18,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 24,
  },
  doneBtnText: { color: "#fff", fontSize: 17, fontWeight: "800" },
});
