import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
} from "react-native";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../../src/theme/colors";
import { useDB } from "../../src/db/provider";
import { getAllSetsForExport, ExportRow } from "../../src/db/queries";
import { PLAN_NAMES } from "../../src/db/schema";

const PRIVACY_URL = "https://karolrockenue.github.io/ironcast/privacy.html";

// Quote a CSV cell only when it contains a comma, quote, or newline.
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per logged set. Leading columns match the agreed schema; muscle
// group + session duration are appended for richer analysis.
function buildCsv(rows: ExportRow[]): string {
  const header =
    "date,workout,deadlift_mode,exercise,set,drop,weight_kg,reps,volume_kg,muscle_group,session_duration_min";
  const lines = rows.map((r) => {
    // Map the plan name to its rotation letter (A/B/C); fall back to the raw
    // name for custom templates.
    const planIdx = r.template_name ? PLAN_NAMES.indexOf(r.template_name) : -1;
    const workout =
      planIdx >= 0
        ? String.fromCharCode(65 + planIdx)
        : r.template_name ?? "";
    const volume = +(r.weight * r.reps).toFixed(2);
    let dur = "";
    if (r.started_at && r.finished_at) {
      // Timestamps are stored UTC-naive; append Z to parse as UTC (matches the
      // rest of the app's duration math).
      const ms =
        new Date(r.finished_at + "Z").getTime() -
        new Date(r.started_at + "Z").getTime();
      if (!Number.isNaN(ms)) dur = String(Math.round(ms / 60000));
    }
    return [
      r.date,
      csvCell(workout),
      r.deadlift_mode ?? "",
      csvCell(r.exercise_name),
      r.set_number,
      r.drop_seq,
      r.weight,
      r.reps,
      volume,
      csvCell(r.muscle_group),
      dur,
    ].join(",");
  });
  return [header, ...lines].join("\n");
}

export default function SettingsScreen() {
  const db = useDB();
  const [exporting, setExporting] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const version = Constants.expoConfig?.version ?? "—";
  const buildNumber =
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString() ??
    "—";

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const src = new File(Paths.document, "SQLite", "ironlog.db");
      if (!src.exists) {
        Alert.alert("Backup failed", "No database file found.");
        return;
      }
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);
      const dest = new File(Paths.cache, `ironcast-backup-${stamp}.db`);
      if (dest.exists) dest.delete();
      src.copy(dest);

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(
          "Sharing unavailable",
          "Saved backup to app cache but sharing isn't available on this device."
        );
        return;
      }
      await Sharing.shareAsync(dest.uri, {
        mimeType: "application/octet-stream",
        dialogTitle: "Save IronCast backup",
        UTI: "public.database",
      });
    } catch (e) {
      Alert.alert("Backup failed", String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = async () => {
    if (exportingCsv) return;
    setExportingCsv(true);
    try {
      const rows = await getAllSetsForExport(db);
      if (rows.length === 0) {
        Alert.alert("Nothing to export", "No finished workouts yet.");
        return;
      }
      const csv = buildCsv(rows);
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);
      const dest = new File(Paths.cache, `ironcast-log-${stamp}.csv`);
      if (dest.exists) dest.delete();
      dest.write(csv);

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(
          "Sharing unavailable",
          "Saved the log to the app cache but sharing isn't available on this device."
        );
        return;
      }
      await Sharing.shareAsync(dest.uri, {
        mimeType: "text/csv",
        dialogTitle: "Export IronCast workout log",
        UTI: "public.comma-separated-values-text",
      });
    } catch (e) {
      Alert.alert("Export failed", String(e));
    } finally {
      setExportingCsv(false);
    }
  };

  const openPrivacy = () => {
    Linking.openURL(PRIVACY_URL).catch(() => {
      Alert.alert("Could not open link", PRIVACY_URL);
    });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Section title="Data">
        <Row
          label={exportingCsv ? "Exporting…" : "Export workout log (CSV)"}
          detail="Every set — date, weight, reps, volume — for analysis"
          onPress={handleExportCsv}
          disabled={exportingCsv}
          accent
        />
        <Row
          label={exporting ? "Exporting…" : "Export backup"}
          detail="Full database copy to Files or iCloud (for restore)"
          onPress={handleExport}
          disabled={exporting}
        />
        <Hint>
          The CSV is a readable spreadsheet of every logged set — handy for
          your own analysis or to hand to an AI. The backup is the full database
          file: keep it safe, and you can restore it by opening it with IronCast
          on a new device.
        </Hint>
      </Section>

      <Section title="Legal">
        <Row label="Privacy Policy" onPress={openPrivacy} />
      </Section>

      <Section title="About">
        <MetaRow label="Version" value={version} />
        <MetaRow label="Build" value={buildNumber} />
      </Section>
    </ScrollView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{title.toUpperCase()}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({
  label,
  detail,
  onPress,
  disabled,
  accent,
}: {
  label: string;
  detail?: string;
  onPress?: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.rowPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.rowLabel,
            accent && styles.rowLabelAccent,
            disabled && styles.rowDisabled,
          ]}
        >
          {label}
        </Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  section: { marginBottom: 24 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: colors.textSecondary,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceLight },
  rowLabel: { color: colors.text, fontSize: 16 },
  rowLabelAccent: { color: colors.accent, fontWeight: "600" },
  rowDisabled: { opacity: 0.4 },
  rowDetail: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    color: colors.textSecondary,
    fontSize: 22,
    marginLeft: 8,
  },
  metaValue: {
    color: colors.textSecondary,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
  hint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    paddingHorizontal: 4,
  },
});
