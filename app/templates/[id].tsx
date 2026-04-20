import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
  StyleSheet,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useDB } from "../../src/db/provider";
import {
  getPrescribedExercises,
  addExerciseToTemplate,
  removeExerciseFromTemplate,
  moveTemplateExercise,
  updateTemplateName,
  PrescribedExercise,
} from "../../src/db/queries";
import { workoutStore } from "../../src/store/workout";
import { colors } from "../../src/theme/colors";

function fmtRest(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function TemplateEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const templateId = Number(id);
  const db = useDB();
  const router = useRouter();
  const [exercises, setExercises] = useState<PrescribedExercise[]>([]);
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);

  const reload = useCallback(async () => {
    const rows = await getPrescribedExercises(db, templateId);
    setExercises(rows);
  }, [db, templateId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  useEffect(() => {
    db.getFirstAsync<{ name: string }>(
      "SELECT name FROM templates WHERE id = ?",
      [templateId]
    ).then((row) => {
      if (row) setName(row.name);
    });
  }, [db, templateId]);

  // Listen for exercise picked from the modal picker
  useEffect(() => {
    return workoutStore.subscribe(async () => {
      if (workoutStore.getContext() !== "template") return;
      const ex = workoutStore.getExercise();
      if (ex) {
        await addExerciseToTemplate(db, templateId, ex.id);
        workoutStore.setExercise(null);
        workoutStore.setContext("workout");
        await reload();
      }
    });
  }, [db, templateId, reload]);

  const handleAddExercise = () => {
    workoutStore.setContext("template");
    router.push("/workout/pick-exercise");
  };

  const handleRemove = (pe: PrescribedExercise) => {
    Alert.alert("Remove Exercise", `Remove ${pe.exercise_name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await removeExerciseFromTemplate(db, pe.id);
          await reload();
        },
      },
    ]);
  };

  const handleMove = async (teId: number, dir: "up" | "down") => {
    await moveTemplateExercise(db, templateId, teId, dir);
    await reload();
  };

  const handleSaveName = async () => {
    if (name.trim()) {
      await updateTemplateName(db, templateId, name.trim());
    }
    setEditingName(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.nameRow}>
        {editingName ? (
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            onBlur={handleSaveName}
            onSubmitEditing={handleSaveName}
            autoFocus
            selectTextOnFocus
          />
        ) : (
          <Pressable onPress={() => setEditingName(true)}>
            <Text style={styles.nameText}>{name}</Text>
            <Text style={styles.nameHint}>Tap to rename</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={exercises}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No exercises added</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const modeSuffix: string[] = [];
          if (item.is_per_arm) modeSuffix.push("per arm");
          if (item.weight_display_mode === "per_hand") modeSuffix.push("per hand");
          if (item.special_rules === "deadlift_ht")
            modeSuffix.push("heavy / technique alternating");
          return (
            <View style={styles.exerciseRow}>
              <View style={styles.exerciseInfo}>
                <Text style={styles.indexNum}>{index + 1}.</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exerciseName}>{item.exercise_name}</Text>
                  <Text style={styles.prescription}>
                    {item.default_sets} set{item.default_sets !== 1 ? "s" : ""} ×{" "}
                    {item.default_rep_min}–{item.default_rep_max} reps
                    {"   "}Rest: {fmtRest(item.default_rest_seconds)}
                  </Text>
                  {modeSuffix.length > 0 && (
                    <Text style={styles.modeHint}>{modeSuffix.join(" · ")}</Text>
                  )}
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.arrowBtn, index === 0 && styles.arrowDisabled]}
                  onPress={() => handleMove(item.id, "up")}
                  disabled={index === 0}
                >
                  <Text style={styles.arrowText}>{"\u25B2"}</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.arrowBtn,
                    index === exercises.length - 1 && styles.arrowDisabled,
                  ]}
                  onPress={() => handleMove(item.id, "down")}
                  disabled={index === exercises.length - 1}
                >
                  <Text style={styles.arrowText}>{"\u25BC"}</Text>
                </Pressable>
                <Pressable
                  style={styles.removeBtn}
                  onPress={() => handleRemove(item)}
                >
                  <Text style={styles.removeBtnText}>{"\u00D7"}</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.bottomBar}>
        <Pressable style={styles.addBtn} onPress={handleAddExercise}>
          <Text style={styles.addBtnText}>+ Add Exercise</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  nameRow: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  nameText: { color: colors.text, fontSize: 24, fontWeight: "800" },
  nameHint: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  nameInput: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    backgroundColor: colors.surface,
    padding: 8,
    borderRadius: 8,
  },
  empty: { paddingTop: 40, alignItems: "center" },
  emptyText: { color: colors.textSecondary, fontSize: 16 },
  exerciseRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  exerciseInfo: { flex: 1, flexDirection: "row", gap: 8 },
  indexNum: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 1,
    minWidth: 22,
  },
  exerciseName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  prescription: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  modeHint: {
    color: colors.accent,
    fontSize: 11,
    marginTop: 3,
    fontWeight: "700",
  },
  actions: { flexDirection: "row", gap: 4, alignItems: "center" },
  arrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: colors.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
  },
  arrowDisabled: { opacity: 0.3 },
  arrowText: { color: colors.textSecondary, fontSize: 12 },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: colors.danger + "22",
    justifyContent: "center",
    alignItems: "center",
  },
  removeBtnText: { color: colors.danger, fontSize: 18, fontWeight: "700" },
  bottomBar: { padding: 16 },
  addBtn: {
    backgroundColor: colors.accent,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  addBtnText: { color: colors.text, fontWeight: "700", fontSize: 16 },
});
