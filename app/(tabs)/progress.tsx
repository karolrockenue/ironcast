import { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { useDB } from "../../src/db/provider";
import {
  getStatsOverview,
  getCurrentWeights,
  getAllTimePRs,
  StatsOverview,
  CurrentWeightRow,
  AllTimePR,
} from "../../src/db/queries";
import { colors } from "../../src/theme/colors";

const heavyFont = Platform.select({
  ios: "Impact",
  android: "sans-serif-condensed",
  default: undefined,
}) as string | undefined;

function fmtVolume(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)}kg`;
}

function fmtHours(min: number): string {
  if (min >= 60) return `${(min / 60).toFixed(1)}h`;
  return `${Math.round(min)}m`;
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ProgressTab() {
  const db = useDB();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [weights, setWeights] = useState<CurrentWeightRow[]>([]);
  const [prs, setPrs] = useState<AllTimePR[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const [s, w, p] = await Promise.all([
          getStatsOverview(db),
          getCurrentWeights(db),
          getAllTimePRs(db),
        ]);
        if (!alive) return;
        setStats(s);
        setWeights(w);
        setPrs(p);
      })();
      return () => {
        alive = false;
      };
    }, [db])
  );

  if (stats && stats.total_sessions === 0) {
    return (
      <View style={styles.emptyRoot}>
        <Text style={styles.emptyTitle}>NO DATA YET</Text>
        <View style={styles.emptyBar} />
        <Text style={styles.emptyText}>
          Finish your first workout to see stats, PRs, and current weights.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Hero — total volume */}
      {stats && (
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>TOTAL VOLUME LIFTED</Text>
          <Text
            style={[
              styles.heroValue,
              heavyFont ? { fontFamily: heavyFont } : null,
            ]}
          >
            {fmtVolume(stats.total_volume_kg)}
          </Text>
          <View style={styles.heroBar} />
          <View style={styles.heroMetaRow}>
            <HeroMeta label="SESSIONS" value={String(stats.total_sessions)} />
            <View style={styles.heroDivider} />
            <HeroMeta label="TIME" value={fmtHours(stats.total_duration_min)} />
            <View style={styles.heroDivider} />
            <HeroMeta
              label="THIS WEEK"
              value={String(stats.this_week_sessions)}
            />
          </View>
          <Text style={styles.heroFootnote}>
            {stats.last_30d_sessions} session
            {stats.last_30d_sessions !== 1 ? "s" : ""} in the last 30 days
          </Text>
        </View>
      )}

      {/* All-time PRs */}
      {prs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ALL-TIME PERSONAL RECORDS</Text>
          <View style={styles.tableHead}>
            <Text style={[styles.tableHeadCell, styles.colExercise]}>
              EXERCISE
            </Text>
            <Text style={[styles.tableHeadCell, styles.colNum]}>WEIGHT</Text>
            <Text style={[styles.tableHeadCell, styles.colNum]}>REPS</Text>
            <Text style={[styles.tableHeadCell, styles.colNum]}>VOL</Text>
          </View>
          <View style={styles.tableBody}>
            {prs.map((p, i) => (
              <View
                key={p.exercise_id}
                style={[
                  styles.tableRow,
                  i === prs.length - 1 && styles.tableRowLast,
                ]}
              >
                <Text
                  style={[styles.rowName, styles.colExercise]}
                  numberOfLines={1}
                >
                  {p.exercise_name}
                </Text>
                <Text style={[styles.rowVal, styles.colNum]}>
                  {p.weight_pr}
                  <Text style={styles.unit}> kg</Text>
                </Text>
                <Text style={[styles.rowVal, styles.colNum]}>{p.rep_pr}</Text>
                <Text style={[styles.rowVal, styles.colNum]}>
                  {fmtVolume(p.volume_pr)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Current working weights */}
      {weights.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CURRENT WORKING WEIGHTS</Text>
          <View style={styles.tableHead}>
            <Text style={[styles.tableHeadCell, styles.colExercise]}>
              EXERCISE
            </Text>
            <Text style={[styles.tableHeadCell, styles.colLastSet]}>
              LAST SET
            </Text>
          </View>
          <View style={styles.tableBody}>
            {weights.map((w, i) => (
              <View
                key={w.exercise_id}
                style={[
                  styles.tableRow,
                  i === weights.length - 1 && styles.tableRowLast,
                ]}
              >
                <View style={styles.colExercise}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {w.exercise_name}
                  </Text>
                  <Text style={styles.rowMeta}>{fmtDateShort(w.date)}</Text>
                </View>
                <Text style={[styles.rowVal, styles.colLastSet]}>
                  {w.weight}
                  <Text style={styles.unit}> kg</Text>
                  <Text style={styles.unit}> × </Text>
                  {w.reps}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function HeroMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroMeta}>
      <Text style={styles.heroMetaVal}>{value}</Text>
      <Text style={styles.heroMetaLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },

  // Hero
  hero: {
    borderWidth: 2,
    borderColor: colors.accent,
    paddingVertical: 22,
    paddingHorizontal: 18,
    alignItems: "center",
    marginBottom: 6,
  },
  heroLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2.5,
  },
  heroValue: {
    color: colors.accent,
    fontSize: 64,
    fontWeight: "900",
    letterSpacing: 1,
    lineHeight: 66,
    marginTop: 6,
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
  },
  heroBar: {
    width: 42,
    height: 2,
    backgroundColor: colors.accent,
    marginTop: 12,
    marginBottom: 14,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  heroMeta: {
    alignItems: "center",
  },
  heroMetaVal: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  heroMetaLabel: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginTop: 2,
  },
  heroDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.border,
  },
  heroFootnote: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 12,
    letterSpacing: 0.3,
  },

  // Sections
  section: {
    marginTop: 26,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 10,
  },

  // Tables (shared)
  tableHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  tableHeadCell: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  tableBody: {
    backgroundColor: colors.surface,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 8,
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },

  // Column sizing
  colExercise: { flex: 1, textAlign: "left" },
  colNum: { width: 62, textAlign: "right" },
  colLastSet: { width: 110, textAlign: "right" },

  rowName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  rowMeta: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  rowVal: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  unit: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },

  // Empty state
  emptyRoot: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 3,
  },
  emptyBar: {
    width: 42,
    height: 2,
    backgroundColor: colors.accent,
    marginTop: 14,
    marginBottom: 18,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
