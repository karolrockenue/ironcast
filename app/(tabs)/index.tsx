import { useCallback, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useDB } from "../../src/db/provider";
import {
  startWorkout,
  getNextWorkoutPlan,
  getRotationOrder,
  getAllTemplates,
  getUnfinishedWorkout,
  getWorkoutHistory,
  TemplateWithCount,
  Workout,
  WorkoutHistoryRow,
} from "../../src/db/queries";
import { colors } from "../../src/theme/colors";
import { PLAN_NAMES } from "../../src/db/schema";

function fmtDay(dateStr: string): { weekday: string; monthDay: string } {
  // SQLite 'YYYY-MM-DD HH:MM:SS' is interpreted in local time by the browser's
  // Date; force UTC by appending Z.
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return { weekday, monthDay };
}

function fmtToday(): string {
  const d = new Date();
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${weekday} · ${monthDay}`;
}

function fmtDurationMin(started: string, finished: string | null): number {
  if (!finished) return 0;
  const s = new Date(started.replace(" ", "T") + "Z").getTime();
  const f = new Date(finished.replace(" ", "T") + "Z").getTime();
  return Math.round((f - s) / 60000);
}

// A/B/C letter from the plan's position in the user's rotation order.
function planLetterOf(
  name: string | null | undefined,
  order: string[]
): string {
  if (!name) return "?";
  const i = order.indexOf(name);
  return i >= 0 ? String.fromCharCode(65 + i) : "A";
}

export default function WorkoutTab() {
  const db = useDB();
  const router = useRouter();
  // `autoPlan` is the strict-alternation suggestion; `chosenName` is a manual
  // override for today only (reset on every focus). The displayed `nextPlan`
  // is the override if set, else the alternation default.
  const [autoPlan, setAutoPlan] = useState<TemplateWithCount | null>(null);
  const [templates, setTemplates] = useState<TemplateWithCount[]>([]);
  const [chosenName, setChosenName] = useState<string | null>(null);
  const [rotationOrder, setRotationOrder] = useState<string[]>(PLAN_NAMES);
  const [unfinished, setUnfinished] = useState<
    (Workout & { template_name: string | null }) | null
  >(null);
  const [history, setHistory] = useState<WorkoutHistoryRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const [next, all, un, hist, order] = await Promise.all([
          getNextWorkoutPlan(db),
          getAllTemplates(db),
          getUnfinishedWorkout(db),
          getWorkoutHistory(db),
          getRotationOrder(db),
        ]);
        if (!alive) return;
        setAutoPlan(next ?? null);
        setTemplates(all);
        setRotationOrder(order);
        setUnfinished(un ?? null);
        setHistory(hist.slice(0, 5));
        setChosenName(null);
      })();
      return () => {
        alive = false;
      };
    }, [db])
  );

  // Displayed plan = manual override (if it resolves to a known template) else
  // the alternation default.
  const nextPlan = chosenName
    ? templates.find((t) => t.name === chosenName) ?? autoPlan
    : autoPlan;

  const handleStart = async () => {
    if (!nextPlan) return;
    const id = await startWorkout(db, { templateId: nextPlan.id });
    router.push({
      pathname: "/workout/active",
      params: { id: String(id), templateId: String(nextPlan.id) },
    });
  };

  const handleResume = () => {
    if (!unfinished) return;
    router.push({
      pathname: "/workout/active",
      params: {
        id: String(unfinished.id),
        templateId: unfinished.template_id
          ? String(unfinished.template_id)
          : undefined,
      } as Record<string, string>,
    });
  };

  const planLetter = nextPlan ? planLetterOf(nextPlan.name, rotationOrder) : "A";

  // Override state: the displayed plan differs from the alternation default.
  const isOverride =
    !!autoPlan && !!nextPlan && nextPlan.name !== autoPlan.name;
  // Rotation plans in A→B→C order, then the next one to offer as a one-tap
  // switch. Repeated taps cycle through all three (A→B→C→A).
  const rotationPlans = rotationOrder
    .map((n) => templates.find((t) => t.name === n))
    .filter((t): t is TemplateWithCount => !!t);
  const curIdx = rotationPlans.findIndex((t) => t.name === nextPlan?.name);
  const nextInCycle =
    rotationPlans.length > 1 && curIdx >= 0
      ? rotationPlans[(curIdx + 1) % rotationPlans.length]
      : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.logo}>IronCast</Text>
      <Text style={styles.today}>{fmtToday()}</Text>

      {/* In-progress entry */}
      {unfinished && (
        <Pressable
          style={[styles.entry, styles.entryInProgress]}
          onPress={handleResume}
        >
          <Text style={[styles.date, styles.dateInProgress]}>IN PROGRESS</Text>
          <View style={styles.row1}>
            <Text style={styles.name}>
              {unfinished.template_name ?? "Workout"} (resume)
            </Text>
            <Text style={styles.stats}>tap to continue</Text>
          </View>
          <View style={[styles.btn, styles.btnOk]}>
            <Text style={styles.btnText}>RESUME ›</Text>
          </View>
        </Pressable>
      )}

      {/* Today / next up entry */}
      {nextPlan && !unfinished && (
        <View style={[styles.entry, styles.entryNext]}>
          <Text style={[styles.date, styles.dateNext]}>
            {isOverride ? "TODAY · YOUR PICK" : "TODAY · NEXT UP"}
          </Text>
          <View style={styles.row1}>
            <Text style={styles.name}>{nextPlan.name}</Text>
            <Text style={styles.stats}>
              {nextPlan.exercise_count} exercise
              {nextPlan.exercise_count !== 1 ? "s" : ""}
            </Text>
          </View>
          {isOverride && autoPlan && (
            <Text style={[styles.note, styles.noteOverride]}>
              Overriding alternation · normally {autoPlan.name}
            </Text>
          )}
          <Pressable style={[styles.btn, styles.btnAccent]} onPress={handleStart}>
            <Text style={styles.btnText}>START WORKOUT {planLetter}</Text>
          </Pressable>
          {nextInCycle && (
            <Pressable
              style={styles.switchBtn}
              onPress={() => setChosenName(nextInCycle.name)}
            >
              <Text style={styles.switchText}>
                {"⇄"}  Do {nextInCycle.name} instead
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Past sessions — reverse chronological */}
      {history.map((h) => {
        const { weekday, monthDay } = fmtDay(h.started_at);
        const dur = fmtDurationMin(h.started_at, h.finished_at);
        return (
          <View key={h.id} style={styles.entry}>
            <Text style={styles.date}>
              {weekday} · {monthDay}
            </Text>
            <View style={styles.row1}>
              <Text style={styles.name}>{h.template_name ?? "Workout"}</Text>
              <Text style={styles.stats}>
                {dur} min · {h.set_count} sets
              </Text>
            </View>
          </View>
        );
      })}

      {/* Optional footer link to template editor */}
      <Pressable
        style={styles.footer}
        onPress={() => router.push("/templates/")}
      >
        <Text style={styles.footerText}>View / edit plan</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },

  logo: { fontSize: 26, fontWeight: "900", color: colors.text, marginTop: 8 },
  today: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 2,
    marginBottom: 18,
  },

  entry: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#3A3A3A",
  },
  entryInProgress: {
    backgroundColor: "rgba(76,175,80,0.08)",
    borderLeftColor: colors.success,
  },
  entryNext: {
    backgroundColor: "rgba(74,144,217,0.08)",
    borderLeftColor: colors.accent,
  },

  date: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  dateInProgress: { color: colors.success },
  dateNext: { color: colors.accent },

  row1: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 2,
  },
  name: { color: colors.text, fontSize: 15, fontWeight: "800" },
  stats: {
    color: colors.textSecondary,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },

  note: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 3,
  },
  noteNext: { color: colors.accent, fontWeight: "700" },
  noteOverride: { color: colors.warning, fontWeight: "700" },

  btn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  btnAccent: { backgroundColor: colors.accent },
  btnOk: { backgroundColor: colors.success },
  btnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  switchBtn: {
    marginTop: 8,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  switchText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  footer: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
});
