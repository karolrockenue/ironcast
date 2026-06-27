import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
  StyleSheet,
  TextInput,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useDB } from "../../src/db/provider";
import {
  getPrescribedExercises,
  addExerciseToTemplate,
  removeExerciseFromTemplate,
  moveTemplateExercise,
  updateTemplateName,
  updateExercisePrescription,
  updateTemplateExerciseSets,
  updateTemplateExerciseDropSet,
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

  // Prescription edit modal (sets / rep range / rest). Edits the shared
  // exercise row, so they apply everywhere the exercise is used.
  const [editing, setEditing] = useState<PrescribedExercise | null>(null);
  const [eSets, setESets] = useState(2);
  const [eRepMin, setERepMin] = useState(5);
  const [eRepMax, setERepMax] = useState(8);
  const [eRest, setERest] = useState(120);
  const [eDrop, setEDrop] = useState(false);

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

  const openEdit = (pe: PrescribedExercise) => {
    setEditing(pe);
    setESets(pe.default_sets);
    setERepMin(pe.default_rep_min);
    setERepMax(pe.default_rep_max);
    setERest(pe.default_rest_seconds);
    setEDrop(!!pe.is_drop_set);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const repMin = Math.max(1, eRepMin);
    const repMax = Math.max(repMin, eRepMax);
    // Set count + drop flag are per-plan (template_exercises); rep range + rest
    // live on the shared exercise row and apply everywhere it's used.
    await updateTemplateExerciseSets(db, editing.id, Math.max(1, eSets));
    await updateTemplateExerciseDropSet(db, editing.id, eDrop);
    await updateExercisePrescription(db, editing.exercise_id, {
      default_sets: Math.max(1, eSets),
      default_rep_min: repMin,
      default_rep_max: repMax,
      default_rest_seconds: Math.max(0, eRest),
    });
    setEditing(null);
    await reload();
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
          return (
            <View style={styles.exerciseRow}>
              <View style={styles.exerciseInfo}>
                <Text style={styles.indexNum}>{index + 1}.</Text>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameTagRow}>
                    <Text style={styles.exerciseName}>{item.exercise_name}</Text>
                    {item.is_drop_set ? (
                      <Text style={styles.dropTag}>DROP SET</Text>
                    ) : null}
                  </View>
                  <Pressable
                    style={styles.prescriptionBtn}
                    onPress={() => openEdit(item)}
                  >
                    <Text style={styles.prescription}>
                      {item.default_sets} set
                      {item.default_sets !== 1 ? "s" : ""} ×{" "}
                      {item.default_rep_min}–{item.default_rep_max} reps
                      {"   "}Rest: {fmtRest(item.default_rest_seconds)}
                    </Text>
                    <Text style={styles.editTag}>EDIT</Text>
                  </Pressable>
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

      <Modal
        visible={!!editing}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setEditing(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>{editing?.exercise_name}</Text>
            <Text style={styles.modalSub}>
              Sets & drop-set flag apply to this plan · reps & rest apply
              everywhere this exercise is used
            </Text>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>SETS</Text>
              <Stepper value={eSets} min={1} max={6} onChange={setESets} />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>REP RANGE</Text>
              <View style={styles.repRow}>
                <Stepper
                  value={eRepMin}
                  min={1}
                  max={99}
                  onChange={(v) => {
                    setERepMin(v);
                    if (v > eRepMax) setERepMax(v);
                  }}
                />
                <Text style={styles.repDash}>–</Text>
                <Stepper
                  value={eRepMax}
                  min={1}
                  max={99}
                  onChange={(v) => setERepMax(Math.max(v, eRepMin))}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>REST</Text>
              <Stepper
                value={eRest}
                step={15}
                min={0}
                max={600}
                onChange={setERest}
                format={fmtRest}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>DROP SET</Text>
              <Pressable
                style={[styles.dropToggle, eDrop && styles.dropToggleOn]}
                onPress={() => setEDrop((v) => !v)}
              >
                <Text
                  style={[
                    styles.dropToggleText,
                    eDrop && styles.dropToggleTextOn,
                  ]}
                >
                  {eDrop ? "ON" : "OFF"}
                </Text>
              </Pressable>
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalCancel]}
                onPress={() => setEditing(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalSave]}
                onPress={saveEdit}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        style={styles.stepBtn}
        onPress={() => onChange(Math.max(min, value - step))}
      >
        <Text style={styles.stepBtnText}>{"−"}</Text>
      </Pressable>
      <Text style={styles.stepValue}>{format ? format(value) : value}</Text>
      <Pressable
        style={styles.stepBtn}
        onPress={() => onChange(Math.min(max, value + step))}
      >
        <Text style={styles.stepBtnText}>+</Text>
      </Pressable>
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
  nameTagRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  exerciseName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  dropTag: {
    color: colors.warning,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    backgroundColor: "rgba(255,167,38,0.18)",
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  prescriptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    alignSelf: "flex-start",
  },
  prescription: {
    color: colors.textSecondary,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  editTag: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
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

  // ── Prescription edit modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  modalSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
    marginBottom: 8,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  fieldLocked: {
    color: colors.textSecondary,
    fontSize: 13,
    fontStyle: "italic",
  },
  dropToggle: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: "transparent",
  },
  dropToggleOn: {
    backgroundColor: "rgba(255,167,38,0.18)",
    borderColor: "rgba(255,167,38,0.45)",
  },
  dropToggleText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },
  dropToggleTextOn: { color: colors.warning },
  repRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  repDash: { color: colors.textSecondary, fontSize: 16, fontWeight: "700" },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
  },
  stepBtn: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  stepBtnText: { color: colors.accent, fontSize: 20, fontWeight: "800" },
  stepValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    minWidth: 48,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 24 },
  modalBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
  },
  modalCancel: { backgroundColor: colors.surfaceLight },
  modalCancelText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  modalSave: { backgroundColor: colors.accent },
  modalSaveText: { color: colors.text, fontWeight: "800", fontSize: 15 },
});
