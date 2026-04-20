import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  SectionList,
  StyleSheet,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { useDB } from "../../src/db/provider";
import { getAllExercises, Exercise } from "../../src/db/queries";
import { workoutStore } from "../../src/store/workout";
import { colors } from "../../src/theme/colors";

type Section = { title: string; data: Exercise[] };

export default function PickExercise() {
  const db = useDB();
  const router = useRouter();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getAllExercises(db).then(setExercises);
  }, [db]);

  const filtered = exercises.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase())
  );

  // Group by muscle_group
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
      <TextInput
        style={styles.search}
        placeholder="Search exercises..."
        placeholderTextColor={colors.textSecondary}
        value={search}
        onChangeText={setSearch}
        autoFocus
      />
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
});
