import { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useDB } from "../../src/db/provider";
import { getWorkoutHistory, getSetsForWorkout, SetRow } from "../../src/db/queries";
import { colors } from "../../src/theme/colors";

type WorkoutSummary = {
  id: number;
  started_at: string;
  finished_at: string | null;
  notes: string | null;
  exercise_count: number;
  set_count: number;
};

function formatDate(iso: string) {
  const d = new Date(iso + "Z");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDuration(start: string, end: string | null) {
  if (!end) return "";
  const ms = new Date(end + "Z").getTime() - new Date(start + "Z").getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function HistoryTab() {
  const db = useDB();
  const [workouts, setWorkouts] = useState<WorkoutSummary[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [expandedSets, setExpandedSets] = useState<SetRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      getWorkoutHistory(db).then(setWorkouts);
    }, [db])
  );

  const toggleExpand = async (id: number) => {
    if (expanded === id) {
      setExpanded(null);
      setExpandedSets([]);
      return;
    }
    const sets = await getSetsForWorkout(db, id);
    setExpandedSets(sets);
    setExpanded(id);
  };

  if (workouts.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No workouts yet</Text>
        <Text style={styles.emptySubtext}>
          Complete your first workout to see it here
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={workouts}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <View>
          <Pressable
            style={styles.card}
            onPress={() => toggleExpand(item.id)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.date}>{formatDate(item.started_at)}</Text>
              <Text style={styles.duration}>
                {formatDuration(item.started_at, item.finished_at)}
              </Text>
            </View>
            <Text style={styles.stats}>
              {item.exercise_count} exercise{item.exercise_count !== 1 ? "s" : ""}{" "}
              {"\u00B7"} {item.set_count} set{item.set_count !== 1 ? "s" : ""}
            </Text>
          </Pressable>
          {expanded === item.id && expandedSets.length > 0 && (
            <View style={styles.detail}>
              {expandedSets.map((s) => (
                <View key={s.id} style={styles.detailRow}>
                  <Text style={styles.detailExercise}>{s.exercise_name}</Text>
                  <Text style={styles.detailSet}>
                    {s.weight} kg {"\u00D7"} {s.reps}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  date: { color: colors.text, fontSize: 16, fontWeight: "700" },
  duration: { color: colors.textSecondary, fontSize: 14 },
  stats: { color: colors.textSecondary, fontSize: 14 },
  detail: {
    marginHorizontal: 16,
    backgroundColor: colors.surfaceLight,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  detailExercise: { color: colors.text, fontSize: 14 },
  detailSet: { color: colors.textSecondary, fontSize: 14 },
  empty: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: { color: colors.text, fontSize: 18, fontWeight: "600" },
  emptySubtext: { color: colors.textSecondary, fontSize: 14, marginTop: 8 },
});
