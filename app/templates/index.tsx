import { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
  StyleSheet,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useDB } from "../../src/db/provider";
import {
  getAllTemplates,
  createTemplate,
  deleteTemplate,
  getRotationOrder,
  setRotationOrder,
  TemplateWithCount,
} from "../../src/db/queries";
import { PLAN_NAMES } from "../../src/db/schema";
import { colors } from "../../src/theme/colors";

export default function TemplateList() {
  const db = useDB();
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateWithCount[]>([]);
  const [rotation, setRotation] = useState<string[]>(PLAN_NAMES);

  const reload = useCallback(() => {
    getAllTemplates(db).then(setTemplates);
    getRotationOrder(db).then(setRotation);
  }, [db]);

  useFocusEffect(reload);

  // Swap two entries in the rotation order and persist. Optimistic: update
  // local state immediately, then write through.
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= rotation.length) return;
    const next = [...rotation];
    [next[index], next[j]] = [next[j], next[index]];
    setRotation(next);
    setRotationOrder(db, next);
  };

  const handleCreate = () => {
    Alert.prompt("New Template", "Enter a name", async (name) => {
      if (!name?.trim()) return;
      const id = await createTemplate(db, name.trim());
      reload();
      router.push({ pathname: "/templates/[id]", params: { id: String(id) } });
    });
  };

  const handleDelete = (t: TemplateWithCount) => {
    Alert.alert("Delete Template", `Delete "${t.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteTemplate(db, t.id);
          reload();
        },
      },
    ]);
  };

  const header = (
    <View>
      <Text style={styles.section}>Rotation order</Text>
      <View style={styles.rotCard}>
        {rotation.map((name, i) => {
          const count = templates.find((t) => t.name === name)?.exercise_count;
          return (
            <View
              key={name}
              style={[
                styles.rotRow,
                i === rotation.length - 1 && styles.rotRowLast,
              ]}
            >
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {String.fromCharCode(65 + i)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rotName}>{name}</Text>
                <Text style={styles.rotPos}>
                  {i === 0 ? "NEXT UP" : `${i} after`}
                  {count != null ? ` · ${count} exercises` : ""}
                </Text>
              </View>
              <View style={styles.arrows}>
                <Pressable
                  style={[styles.arrow, i === 0 && styles.arrowDisabled]}
                  disabled={i === 0}
                  onPress={() => move(i, -1)}
                  hitSlop={4}
                >
                  <Text style={styles.arrowText}>▲</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.arrow,
                    i === rotation.length - 1 && styles.arrowDisabled,
                  ]}
                  disabled={i === rotation.length - 1}
                  onPress={() => move(i, 1)}
                  hitSlop={4}
                >
                  <Text style={styles.arrowText}>▼</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={styles.rotHint}>
        Your next workout follows this order; finishing one suggests the next in
        the cycle. Letter badges follow the order — top = A.
      </Text>

      <Text style={styles.section}>Your plans</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={templates}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No templates yet</Text>
            <Text style={styles.emptySubtext}>
              Create one to pre-define your workouts
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() =>
              router.push({
                pathname: "/templates/[id]",
                params: { id: String(item.id) },
              })
            }
            onLongPress={() => handleDelete(item)}
          >
            <Text style={styles.cardName}>{item.name}</Text>
            <Text style={styles.cardCount}>
              {item.exercise_count} exercise
              {item.exercise_count !== 1 ? "s" : ""}
            </Text>
          </Pressable>
        )}
      />
      <View style={styles.bottomBar}>
        <Pressable style={styles.createBtn} onPress={handleCreate}>
          <Text style={styles.createBtnText}>+ New Template</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  empty: { paddingTop: 60, alignItems: "center" },
  emptyText: { color: colors.text, fontSize: 18, fontWeight: "600" },
  emptySubtext: { color: colors.textSecondary, fontSize: 14, marginTop: 8 },

  section: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 6,
    marginBottom: 10,
    marginLeft: 4,
  },
  rotCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: "hidden",
  },
  rotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rotRowLast: { borderBottomWidth: 0 },
  badge: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  rotName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  rotPos: { color: colors.textSecondary, fontSize: 11, fontWeight: "700", marginTop: 2 },
  arrows: { gap: 4 },
  arrow: {
    width: 40,
    height: 26,
    borderRadius: 7,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowDisabled: { opacity: 0.25 },
  arrowText: { color: colors.text, fontSize: 13 },
  rotHint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    marginHorizontal: 4,
  },

  card: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  cardCount: { color: colors.textSecondary, fontSize: 14 },
  bottomBar: { padding: 16 },
  createBtn: {
    backgroundColor: colors.accent,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  createBtnText: { color: colors.text, fontWeight: "700", fontSize: 16 },
});
