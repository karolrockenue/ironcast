import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  SectionList,
  ScrollView,
  StyleSheet,
  TextInput,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useDB } from "../../src/db/provider";
import { getAllExercises, Exercise } from "../../src/db/queries";
import { workoutStore } from "../../src/store/workout";
import { colors } from "../../src/theme/colors";

type Section = { title: string; data: Exercise[] };

const ALL_GROUPS = "All";

export default function PickExercise() {
  const db = useDB();
  const router = useRouter();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string>(ALL_GROUPS);

  useEffect(() => {
    getAllExercises(db).then(setExercises);
  }, [db]);

  // Muscle-group chips, ordered by exercise count desc so popular groups
  // surface first. "All" is pinned to the left.
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of exercises) {
      const k = e.muscle_group || "Other";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [
      ALL_GROUPS,
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k]) => k),
    ];
  }, [exercises]);

  const filtered = exercises.filter((e) => {
    if (group !== ALL_GROUPS && (e.muscle_group || "Other") !== group)
      return false;
    return e.name.toLowerCase().includes(search.toLowerCase());
  });

  const sections: Section[] = Object.entries(
    filtered.reduce<Record<string, Exercise[]>>((acc, ex) => {
      const key = ex.muscle_group || "Other";
      (acc[key] ??= []).push(ex);
      return acc;
    }, {})
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, data]) => ({ title, data }));

  const pick = (ex: Exercise) => {
    workoutStore.setExercise({ id: ex.id, name: ex.name });
    router.back();
  };

  const movementColor = (type: string) =>
    type === "Compound" ? colors.accent : colors.warning;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Text style={styles.headerAction}>Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <TextInput
        style={styles.search}
        placeholder="Search exercises..."
        placeholderTextColor={colors.textSecondary}
        value={search}
        onChangeText={setSearch}
        autoFocus
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.chipRow}
      >
        {groups.map((g) => {
          const active = g === group;
          return (
            <Pressable
              key={g}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setGroup(g)}
            >
              <Text
                numberOfLines={1}
                style={[styles.chipText, active && styles.chipTextActive]}
              >
                {g.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>
            {section.title.toUpperCase()}
          </Text>
        )}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => pick(item)}>
            <Text style={styles.rowText}>{item.name}</Text>
            <Text
              style={[
                styles.badge,
                { color: movementColor(item.movement_type) },
              ]}
            >
              {item.movement_type}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  search: {
    margin: 16,
    padding: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    color: colors.text,
    fontSize: 16,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: "700",
    color: colors.accent,
    backgroundColor: colors.bg,
    letterSpacing: 1,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowText: { color: colors.text, fontSize: 16 },
  badge: { fontSize: 12, fontWeight: "600" },
  chipRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
    letterSpacing: 1,
  },
  chipTextActive: {
    color: colors.bg,
  },
  headerAction: {
    color: colors.accent,
    fontSize: 16,
    paddingHorizontal: 4,
  },
});
