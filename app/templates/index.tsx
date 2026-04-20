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
  TemplateWithCount,
} from "../../src/db/queries";
import { colors } from "../../src/theme/colors";

export default function TemplateList() {
  const db = useDB();
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateWithCount[]>([]);

  const reload = useCallback(() => {
    getAllTemplates(db).then(setTemplates);
  }, [db]);

  useFocusEffect(reload);

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

  return (
    <View style={styles.container}>
      <FlatList
        data={templates}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
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
