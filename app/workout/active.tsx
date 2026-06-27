import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useDB } from "../../src/db/provider";
import {
  addSet,
  deleteSet,
  updateSet,
  renumberSetsForExercise,
  skipExercise,
  unskipExercise,
  getSkippedForWorkout,
  bulkSkipExercises,
  finishWorkout,
  deleteWorkout,
  getSetsForWorkout,
  getPrescribedExercises,
  getLastSetForExercise,
  getLastSessionSetsForExercise,
  addExerciseToTemplate,
  removeExerciseFromTemplate,
  decideProgression,
  detectPRsForSet1,
  getRegressionHint,
  SetRow,
  PrescribedExercise,
  LastSet,
  RegressionHint,
  PRKind,
} from "../../src/db/queries";
import { useRestTimer } from "../../src/store/restTimer";
import { RestTimerOverlay } from "../../src/components/RestTimerOverlay";
import { PrCelebration } from "../../src/components/PrCelebration";
import { workoutStore } from "../../src/store/workout";
import { colors } from "../../src/theme/colors";

// ─── Helpers ───────────────────────────────────────────────
function useElapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const i = setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(i);
  }, []);
  return s;
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Suggested weight logic ────────────────────────────────
// The weight we pre-fill into the stepper for the next set of an exercise:
//  - progression engine suggestion (based on last finished session)
//  - else 0 (user picks)
function suggestStartingWeight(
  ex: PrescribedExercise,
  lastSet: LastSet | null
): number {
  const p = decideProgression(
    {
      rep_min: ex.default_rep_min,
      rep_max: ex.default_rep_max,
      weight_increment: ex.weight_increment,
      special_rules: ex.special_rules,
    },
    lastSet
  );
  if (p.direction !== "none") return p.suggested_weight;
  return 0;
}

// ─── Stepper with typed input ──────────────────────────────
// Used for both kg and reps. The value lives in the parent; this component
// just mirrors it and commits on button taps or when the user types.
function NumericStepper({
  value,
  step,
  unit,
  onChange,
  disabled,
  placeholder = "—",
  tint,
  allowEmpty = false,
  style,
}: {
  value: number | null;
  step: number;
  unit?: string;
  onChange: (n: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  tint?: string;
  allowEmpty?: boolean;
  style?: any;
}) {
  const eff = step <= 0 ? 1 : step;
  const [text, setText] = useState<string>(value == null ? "" : String(value));

  // Keep the text in sync when the external value changes (e.g. after log).
  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);

  const handleDec = () => {
    if (disabled) return;
    const cur = value ?? 0;
    const next = +(cur - eff).toFixed(2);
    if (next <= 0 && allowEmpty) onChange(null);
    else onChange(Math.max(0, next));
    Haptics.selectionAsync();
  };
  const handleInc = () => {
    if (disabled) return;
    const cur = value ?? 0;
    onChange(+(cur + eff).toFixed(2));
    Haptics.selectionAsync();
  };

  return (
    <View
      style={[
        st.wrap,
        tint ? { backgroundColor: tint } : null,
        disabled && { opacity: 0.65 },
        style,
      ]}
    >
      <Pressable style={st.btn} onPress={handleDec} disabled={disabled}>
        <Text style={st.btnText}>-</Text>
      </Pressable>
      <TextInput
        style={st.val}
        value={text}
        editable={!disabled}
        keyboardType="numeric"
        selectTextOnFocus
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        onChangeText={(t) => {
          setText(t);
          if (t === "") {
            if (allowEmpty) onChange(null);
            return;
          }
          const n = parseFloat(t);
          if (!isNaN(n)) onChange(n);
        }}
      />
      {unit ? <Text style={st.unit}>{unit}</Text> : null}
      <Pressable style={st.btn} onPress={handleInc} disabled={disabled}>
        <Text style={st.btnText}>+</Text>
      </Pressable>
    </View>
  );
}

// Tint the reps stepper background based on the entered value vs the target
// range AND the previous session's reps.
// Red (regression vs last session) always wins — it's the stronger signal.
function repsTint(
  reps: number | null,
  min: number,
  max: number,
  lastReps: number | null
): string | undefined {
  if (reps == null || reps <= 0) return undefined;
  if (lastReps != null && reps < lastReps)
    return "rgba(224,85,85,0.18)"; // red — fewer reps than last time
  if (reps >= max) return "rgba(74,144,217,0.16)"; // at/above top → push
  if (reps >= min) return "rgba(76,175,80,0.18)"; // in range
  return "rgba(255,167,38,0.16)"; // below target
}

// Round a weight to the equipment's nearest step.
function roundToIncrement(weight: number, increment: number) {
  if (increment <= 0) return weight;
  return +(Math.round(weight / increment) * increment).toFixed(2);
}

const st = StyleSheet.create({
  wrap: {
    // sizing is left to the caller — pass `flex: 1` to take remainder,
    // or `width: N` to fix width. (Don't put `flex` here; it conflicts with
    // downstream `width` overrides in RN/Yoga and collapses the stepper.)
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    height: 38,
    paddingHorizontal: 2,
  },
  btn: {
    width: 28,
    height: 38,
    justifyContent: "center",
    alignItems: "center",
  },
  btnText: { color: colors.text, fontSize: 16, fontWeight: "800" },
  val: {
    flex: 1,
    paddingHorizontal: 1,
    paddingVertical: 0,
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    minWidth: 28,
  },
  unit: {
    color: colors.textSecondary,
    fontSize: 9,
    letterSpacing: 0.3,
    marginRight: 2,
  },
});

// Log / delete button for a set row.
function LogButton({
  logged,
  disabled,
  onPress,
}: {
  logged: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  if (logged) {
    return (
      <Pressable style={[lb.btn, lb.btnDel]} onPress={onPress} hitSlop={8}>
        <Text style={lb.btnDelText}>{"\u00D7"}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      style={[lb.btn, lb.btnLog, disabled && { opacity: 0.35 }]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
    >
      <Text style={lb.btnLogText}>LOG</Text>
    </Pressable>
  );
}
const lb = StyleSheet.create({
  btn: {
    width: 52,
    height: 38,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  btnLog: { backgroundColor: colors.accent },
  btnLogText: { color: "#fff", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  btnDel: { backgroundColor: "rgba(224,85,85,0.15)" },
  btnDelText: { color: colors.danger, fontSize: 20, fontWeight: "700" },
});

// ─── Set edit modal ───────────────────────────────────────
// Long-press a logged set row → opens this. Edits the reps/weight stored on
// the row; save writes straight to the DB. Editing Set 1 will retrigger the
// ActiveCard's useEffect that recalculates Set 2+ back-off weights.
function SetEditModal({
  visible,
  initial,
  exerciseName,
  setNumber,
  increment,
  onSave,
  onCancel,
}: {
  visible: boolean;
  initial: { weight: number; reps: number } | null;
  exerciseName: string;
  setNumber: number;
  increment: number;
  onSave: (weight: number, reps: number) => void;
  onCancel: () => void;
}) {
  const [weight, setWeight] = useState<number | null>(initial?.weight ?? 0);
  const [reps, setReps] = useState<number | null>(initial?.reps ?? 0);

  useEffect(() => {
    if (visible && initial) {
      setWeight(initial.weight);
      setReps(initial.reps);
    }
  }, [visible, initial]);

  const canSave = weight != null && weight >= 0 && reps != null && reps > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={em.backdrop} onPress={onCancel}>
        <Pressable style={em.sheet} onPress={() => {}}>
          <Text style={em.title}>Edit Set {setNumber}</Text>
          <Text style={em.sub}>{exerciseName}</Text>
          <View style={em.row}>
            <Text style={em.label}>WEIGHT</Text>
            <NumericStepper
              value={weight}
              step={increment || 1}
              unit="kg"
              style={{ width: 140 }}
              onChange={(n) => setWeight(n ?? 0)}
            />
          </View>
          <View style={em.row}>
            <Text style={em.label}>REPS</Text>
            <NumericStepper
              value={reps}
              step={1}
              style={{ width: 140 }}
              onChange={(n) => setReps(n ?? 0)}
            />
          </View>
          <View style={em.actions}>
            <Pressable style={em.btnCancel} onPress={onCancel}>
              <Text style={em.btnCancelText}>CANCEL</Text>
            </Pressable>
            <Pressable
              style={[em.btnSave, !canSave && { opacity: 0.35 }]}
              disabled={!canSave}
              onPress={() => {
                if (canSave) onSave(weight!, reps!);
              }}
            >
              <Text style={em.btnSaveText}>SAVE</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
const em = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 1,
  },
  sub: { color: colors.textSecondary, fontSize: 13, marginTop: 2, marginBottom: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 8 },
  btnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
  },
  btnCancelText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  btnSave: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: colors.accent,
  },
  btnSaveText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
});

// ─── Cards ────────────────────────────────────────────────
function DoneCard({
  ex,
  logged,
}: {
  ex: PrescribedExercise;
  logged: SetRow[];
}) {
  const timed = ex.special_rules === "timed";
  const chips = logged.map((s) => {
    const state =
      s.reps >= ex.default_rep_max
        ? "push"
        : s.reps >= ex.default_rep_min
        ? "ok"
        : "low";
    const bg =
      state === "ok"
        ? "rgba(76,175,80,0.16)"
        : state === "push"
        ? "rgba(74,144,217,0.16)"
        : "rgba(255,167,38,0.16)";
    const fg =
      state === "ok"
        ? colors.success
        : state === "push"
        ? colors.accent
        : colors.warning;
    return (
      <View key={s.id} style={[c.chip, { backgroundColor: bg }]}>
        <Text style={[c.chipText, { color: fg }]}>
          {timed ? fmtSecs(s.reps) : s.reps}
        </Text>
      </View>
    );
  });
  return (
    <View style={[c.card, c.cardDone]}>
      <View style={c.hdr}>
        <View style={{ flex: 1 }}>
          <View style={c.nameRow}>
            <View style={c.check}>
              <Text style={c.checkText}>{"\u2713"}</Text>
            </View>
            <Text style={c.name} numberOfLines={1}>
              {ex.exercise_name}
            </Text>
          </View>
          <Text style={c.sub}>
            {timed
              ? `${logged.length} sets · best ${fmtSecs(
                  Math.max(...logged.map((l) => l.reps))
                )}`
              : `${logged.length} sets · ${logged[0]?.weight ?? "?"} kg`}
          </Text>
        </View>
        {ex.is_drop_set ? <DropSetPill /> : null}
        <View style={[c.pill, c.pillDone]}>
          <Text style={[c.pillText, c.pillDoneText]}>DONE</Text>
        </View>
      </View>
      <View style={c.chips}>{chips}</View>
    </View>
  );
}

function PendingCard({
  ex,
  loggedCount,
  onActivate,
  onSkip,
}: {
  ex: PrescribedExercise;
  loggedCount: number;
  onActivate: () => void;
  onSkip: () => void;
}) {
  const partial = loggedCount > 0;
  const timed = ex.special_rules === "timed";
  const range = `${ex.default_rep_min}–${ex.default_rep_max}${timed ? "s" : ""}`;
  return (
    <Pressable
      style={[c.card, c.cardPending]}
      onPress={onActivate}
      onLongPress={onSkip}
      delayLongPress={500}
    >
      <View style={c.hdr}>
        <View style={{ flex: 1 }}>
          <Text style={c.name} numberOfLines={1}>
            {ex.exercise_name}
          </Text>
          <Text style={c.sub}>
            {partial
              ? `${loggedCount}/${ex.default_sets} sets done · resume`
              : `${ex.default_sets} sets · target ${range}`}
          </Text>
        </View>
        {ex.is_drop_set ? <DropSetPill /> : null}
        <View style={[c.pill, c.pillPending]}>
          <Text style={[c.pillText, c.pillPendingText]}>{range}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function SkippedCard({
  ex,
  onUnskip,
}: {
  ex: PrescribedExercise;
  onUnskip: () => void;
}) {
  return (
    <Pressable style={[c.card, c.cardSkipped]} onPress={onUnskip}>
      <View style={c.hdr}>
        <View style={{ flex: 1 }}>
          <Text style={[c.name, c.nameSkipped]} numberOfLines={1}>
            {ex.exercise_name}
          </Text>
          <Text style={c.sub}>Not today · tap to bring back</Text>
        </View>
        <View style={[c.pill, c.pillSkipped]}>
          <Text style={[c.pillText, c.pillSkippedText]}>NOT TODAY</Text>
        </View>
      </View>
    </Pressable>
  );
}

// Yellow DROP SET pill. A reminder that the last working set of this exercise
// is a drop set (do it on the floor) — drops are no longer logged in-app, so
// this is purely a cue. Driven by template_exercises.is_drop_set.
function DropSetPill() {
  return (
    <View style={[c.pill, c.pillDrop]}>
      <Text style={[c.pillText, c.pillDropText]}>DROP SET</Text>
    </View>
  );
}

// Format seconds as M:SS for time-based exercises (Plank).
function fmtSecs(s: number) {
  return fmt(s);
}

// Count-up timer for a time-based exercise (Plank). START begins the hold;
// STOP & LOG records the elapsed seconds (stored in the reps column, weight 0).
function PlankTimer({ onLog }: { onLog: (secs: number) => void }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now() - elapsed * 1000;
    const i = setInterval(
      () => setElapsed(Math.round((Date.now() - t0) / 1000)),
      250
    );
    return () => clearInterval(i);
  }, [running]);

  return (
    <View style={c.timerRow}>
      <Text style={c.timerElapsed}>{fmtSecs(elapsed)}</Text>
      {!running ? (
        <Pressable
          style={[c.timerBtn, c.timerStart]}
          onPress={() => {
            setRunning(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }}
        >
          <Text style={c.timerStartText}>{elapsed > 0 ? "RESUME" : "START"}</Text>
        </Pressable>
      ) : (
        <Pressable
          style={[c.timerBtn, c.timerStop]}
          onPress={() => {
            setRunning(false);
            if (elapsed > 0) onLog(elapsed);
          }}
        >
          <Text style={c.timerStopText}>STOP &amp; LOG</Text>
        </Pressable>
      )}
    </View>
  );
}

function ActiveCard({
  ex,
  logged,
  lastSet,
  lastSessionSets,
  regression,
  onLogSet,
  onDeleteSet,
  onEditSet,
  onSkip,
}: {
  ex: PrescribedExercise;
  logged: SetRow[];
  lastSet: LastSet | null;
  lastSessionSets: Map<number, LastSet>;
  regression: RegressionHint | null;
  onLogSet: (setIdx: number, weight: number, reps: number) => void;
  onDeleteSet: (setId: number) => void;
  onEditSet: (row: SetRow) => void;
  onSkip: () => void;
}) {
  const timed = ex.special_rules === "timed";
  const suggested = suggestStartingWeight(ex, lastSet);

  // Per-set KG. Each row owns its own value: logged sets are locked to the
  // stored weight; pending sets default to the most recent logged set's weight,
  // or the suggestion.
  const lastLoggedWeight =
    logged.length > 0 ? logged[logged.length - 1].weight : suggested;
  const defaultPendingKg = lastLoggedWeight;

  const backOff = ex.back_off_ratio;

  // Initial Set 1 kg = last session's weight (or progression), Set 2+ = back-off.
  const [kgPerSet, setKgPerSet] = useState<number[]>(() =>
    Array.from({ length: ex.default_sets }, (_, i) => {
      const row = logged.find((l) => l.set_number === i + 1);
      if (row) return row.weight;
      if (i === 0) return suggested || defaultPendingKg;
      // Back-off sets derive from Set 1's current weight.
      const s1 = logged.find((l) => l.set_number === 1);
      const base = s1?.weight ?? suggested ?? defaultPendingKg;
      return roundToIncrement(base * backOff, ex.min_increment_kg);
    })
  );
  // Reps per pending set — pre-fill with last session's matching set's reps so
  // tapping ± adjusts from a sensible baseline instead of jumping to 1. The
  // user can clear or edit before logging.
  const [repsPerSet, setRepsPerSet] = useState<(number | null)[]>(() =>
    Array.from({ length: ex.default_sets }, (_, i) => {
      const row = logged.find((l) => l.set_number === i + 1);
      if (row) return row.reps;
      return lastSessionSets.get(i + 1)?.reps ?? null;
    })
  );
  // Per-set "user has manually edited the kg" flag. When true, the back-off
  // auto-recalc skips that index — so a user-typed 70 kg on Set 2 isn't
  // overwritten when Set 1 is logged.
  const [kgUserEdited, setKgUserEdited] = useState<boolean[]>(() =>
    Array.from({ length: ex.default_sets }, () => false)
  );

  // Sync logged sets' weights into state when new sets arrive.
  useEffect(() => {
    setKgPerSet((prev) => {
      const next = [...prev];
      for (let i = 0; i < ex.default_sets; i++) {
        const row = logged.find((l) => l.set_number === i + 1);
        if (row) next[i] = row.weight;
      }
      return next;
    });
  }, [logged, ex.default_sets]);

  // Dynamic Set 2+ recalculation: once Set 1 is logged, every back-off set
  // updates to reflect the actual Set 1 weight. Skips sets that are themselves
  // already logged, AND sets the user has manually edited (their typed value
  // wins over the auto-calc).
  useEffect(() => {
    const set1 = logged.find((l) => l.set_number === 1);
    if (!set1 || ex.default_sets < 2) return;
    setKgPerSet((prev) => {
      const next = [...prev];
      for (let i = 1; i < ex.default_sets; i++) {
        const alreadyLogged = logged.find((l) => l.set_number === i + 1);
        if (alreadyLogged) continue;
        if (kgUserEdited[i]) continue;
        next[i] = roundToIncrement(set1.weight * backOff, ex.min_increment_kg);
      }
      return next;
    });
  }, [logged, ex.default_sets, backOff, ex.min_increment_kg, kgUserEdited]);

  const currentSetIdx = logged.length; // first pending set
  const allDone = logged.length >= ex.default_sets;

  const progMsg = useMemo(() => {
    const p = decideProgression(
      {
        rep_min: ex.default_rep_min,
        rep_max: ex.default_rep_max,
        weight_increment: ex.weight_increment,
        special_rules: ex.special_rules,
      },
      lastSet
    );
    return p.message;
  }, [ex, lastSet]);

  return (
    <View style={[c.card, c.cardActive]}>
      <Pressable
        style={c.hdr}
        onLongPress={onSkip}
        delayLongPress={500}
      >
        <View style={{ flex: 1 }}>
          <View style={c.nameRow}>
            <View style={c.activeDot} />
            <Text style={c.name} numberOfLines={1}>
              {ex.exercise_name}
            </Text>
          </View>
          <Text style={c.sub}>
            {ex.default_sets} sets · last time{" "}
            {lastSet
              ? timed
                ? fmtSecs(lastSet.reps)
                : `${lastSet.weight} kg × ${lastSet.reps}`
              : "—"}
          </Text>
        </View>
        {ex.is_drop_set ? <DropSetPill /> : null}
        <View style={c.pill}>
          <Text style={c.pillText}>
            {ex.default_rep_min}–{ex.default_rep_max}
            {timed ? "s" : ""}
          </Text>
        </View>
      </Pressable>

      {/* Regression hint — last session dropped below an earlier best, so the
          aim is to get back to that weight (don't celebrate a recovered weight
          as a fresh PR). */}
      {regression && (
        <View style={c.regress}>
          <Text style={c.regressText}>
            {"↩ last was "}
            {regression.last_weight} kg — you hit {regression.prev_best_weight}{" "}
            kg before. Aim to get back to it.
          </Text>
        </View>
      )}

      {/* Coach line — only when nothing logged yet */}
      {logged.length === 0 && (
        <View style={c.coach}>
          <Text style={c.coachText}>{progMsg}</Text>
        </View>
      )}

      {/* Set rows — column headers + blocks with optional inline last-session */}
      <View style={c.setsWrap}>
        <View style={c.colHeaders}>
          <Text style={c.colHeaderSet}>SET</Text>
          {timed ? (
            <Text style={[c.colHeaderReps, { textAlign: "left" }]}>TIME</Text>
          ) : (
            <>
              <Text style={c.colHeaderKg}>WEIGHT</Text>
              <Text style={c.colHeaderReps}>REPS</Text>
              <View style={{ width: 52 }} />
            </>
          )}
        </View>

        {Array.from({ length: ex.default_sets }).map((_, idx) => {
          const row = logged.find((l) => l.set_number === idx + 1);
          const isCurrent = !row && idx === currentSetIdx;
          const kg = kgPerSet[idx] ?? defaultPendingKg;
          const pendingReps = repsPerSet[idx];
          const displayedReps = row?.reps ?? pendingReps;
          const last = lastSessionSets.get(idx + 1);
          const isLastSet = idx === ex.default_sets - 1;
          const commit = () => {
            if (row) return;
            if (pendingReps == null || pendingReps <= 0) return;
            onLogSet(idx, kg, pendingReps);
          };
          return (
            <Pressable
              key={idx}
              onLongPress={row ? () => onEditSet(row) : undefined}
              delayLongPress={400}
              style={[
                c.setBlock,
                isCurrent && c.setBlockCurrent,
                isLastSet && !isCurrent && c.setBlockLast,
              ]}
            >
              <View style={c.setInner}>
                <Text
                  style={[
                    c.setN,
                    isCurrent && { color: "#fff" },
                    row && { color: colors.success },
                  ]}
                >
                  SET {idx + 1}
                </Text>
                {timed ? (
                  row ? (
                    <>
                      <Text style={c.timerLogged}>{fmtSecs(row.reps)}</Text>
                      <LogButton logged onPress={() => onDeleteSet(row.id)} />
                    </>
                  ) : (
                    <PlankTimer onLog={(secs) => onLogSet(idx, 0, secs)} />
                  )
                ) : (
                  <>
                    <NumericStepper
                      value={kg}
                      step={ex.min_increment_kg}
                      unit="kg"
                      disabled={!!row}
                      style={{ width: 108 }}
                      onChange={(n) => {
                        setKgPerSet((prev) => {
                          const next = [...prev];
                          next[idx] = n ?? 0;
                          return next;
                        });
                        setKgUserEdited((prev) => {
                          if (prev[idx]) return prev;
                          const next = [...prev];
                          next[idx] = true;
                          return next;
                        });
                      }}
                    />
                    <NumericStepper
                      value={displayedReps ?? null}
                      step={1}
                      placeholder={
                        last?.reps != null ? String(last.reps) : "reps"
                      }
                      disabled={!!row}
                      allowEmpty
                      style={{ flex: 1 }}
                      tint={
                        row
                          ? undefined
                          : repsTint(
                              pendingReps,
                              ex.default_rep_min,
                              ex.default_rep_max,
                              last?.reps ?? null
                            )
                      }
                      onChange={(n) => {
                        setRepsPerSet((prev) => {
                          const next = [...prev];
                          next[idx] = n;
                          return next;
                        });
                      }}
                    />
                    <LogButton
                      logged={!!row}
                      disabled={
                        !row && (pendingReps == null || pendingReps <= 0)
                      }
                      onPress={() => {
                        if (row) onDeleteSet(row.id);
                        else commit();
                      }}
                    />
                  </>
                )}
              </View>
              {last && (
                <View style={c.setLastInline}>
                  <View style={{ width: 42 }} />
                  {timed ? (
                    <Text style={c.setLastInlineReps}>
                      last · {fmtSecs(last.reps)}
                    </Text>
                  ) : (
                    <>
                      <Text style={c.setLastInlineKg}>
                        last · {last.weight} kg
                      </Text>
                      <Text style={c.setLastInlineReps}>last · {last.reps}</Text>
                      <View style={{ width: 52 }} />
                    </>
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Skip-for-today. Visible but low-emphasis, sat below the set rows so it
          isn't fat-fingered while logging — and it routes through a confirm
          dialog (onSkip), so it takes a deliberate second tap to activate. */}
      <Pressable style={c.notTodayBtn} onPress={onSkip} hitSlop={6}>
        <Text style={c.notTodayText}>NOT TODAY</Text>
      </Pressable>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────
export default function ActiveWorkout() {
  const { id, templateId } = useLocalSearchParams<{
    id: string;
    templateId?: string;
  }>();
  const workoutId = Number(id);
  const db = useDB();
  const router = useRouter();
  const rest = useRestTimer();
  const elapsed = useElapsed();

  const [sets, setSets] = useState<SetRow[]>([]);
  const [prescribed, setPrescribed] = useState<PrescribedExercise[]>([]);
  const [lastSetByEx, setLastSetByEx] = useState<Map<number, LastSet>>(new Map());
  const [lastSessionByEx, setLastSessionByEx] = useState<
    Map<number, Map<number, LastSet>>
  >(new Map());
  const [manualActiveId, setManualActiveId] = useState<number | null>(null);
  const [celebration, setCelebration] = useState<{
    kind: PRKind;
    exerciseName: string;
    value: string;
  } | null>(null);
  const [editingSet, setEditingSet] = useState<SetRow | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [regressionByEx, setRegressionByEx] = useState<
    Map<number, RegressionHint>
  >(new Map());

  // Load prescription + last-session data. Reusable so mid-workout template
  // edits (add / remove exercise) can refresh the list in place.
  const loadPrescription = useCallback(async () => {
    if (!templateId) return;
    const rows = await getPrescribedExercises(db, Number(templateId));
    const byEx = new Map<number, LastSet>();
    const bySession = new Map<number, Map<number, LastSet>>();
    const byReg = new Map<number, RegressionHint>();
    for (const p of rows) {
      const [ls, session, reg] = await Promise.all([
        getLastSetForExercise(db, p.exercise_id, workoutId),
        getLastSessionSetsForExercise(db, p.exercise_id, workoutId),
        getRegressionHint(db, p.exercise_id, workoutId),
      ]);
      if (ls) byEx.set(p.exercise_id, ls);
      if (session.size > 0) bySession.set(p.exercise_id, session);
      if (reg) byReg.set(p.exercise_id, reg);
    }
    // Set everything in one render so ActiveCard's state initializer sees
    // a populated lastSessionSets map (used to pre-fill reps).
    setLastSetByEx(byEx);
    setLastSessionByEx(bySession);
    setRegressionByEx(byReg);
    setPrescribed(rows);
  }, [db, templateId, workoutId]);
  useEffect(() => {
    loadPrescription();
  }, [loadPrescription]);

  // Exercise picked from the modal picker → append to the template (persistent
  // template edit, applies to future sessions too) and refresh the list.
  useEffect(() => {
    return workoutStore.subscribe(async () => {
      if (workoutStore.getContext() !== "workout") return;
      const picked = workoutStore.getExercise();
      if (picked && templateId) {
        await addExerciseToTemplate(db, Number(templateId), picked.id);
        workoutStore.setExercise(null);
        await loadPrescription();
      }
    });
  }, [db, templateId, loadPrescription]);

  const reload = useCallback(async () => {
    const [rows, skip] = await Promise.all([
      getSetsForWorkout(db, workoutId),
      getSkippedForWorkout(db, workoutId),
    ]);
    setSets(rows);
    setSkipped(skip);
  }, [db, workoutId]);
  useEffect(() => {
    reload();
  }, [reload]);

  // Compute active exercise — manual override, else first incomplete.
  const setsCount = useCallback(
    (exId: number) => sets.filter((x) => x.exercise_id === exId).length,
    [sets]
  );
  const isIncomplete = useCallback(
    (p: PrescribedExercise) =>
      !skipped.has(p.exercise_id) &&
      setsCount(p.exercise_id) < p.default_sets,
    [setsCount, skipped]
  );

  const activeId = useMemo(() => {
    if (manualActiveId != null) {
      const ex = prescribed.find((p) => p.exercise_id === manualActiveId);
      if (ex && isIncomplete(ex)) return manualActiveId;
    }
    const first = prescribed.find(isIncomplete);
    return first?.exercise_id ?? null;
  }, [manualActiveId, prescribed, isIncomplete]);

  const handleLogSet = async (
    ex: PrescribedExercise,
    setIdx: number,
    weight: number,
    reps: number
  ) => {
    // PR detection — only Set 1 counts per the design. Compare against all
    // previous finished Set 1s; unfinished workouts (including this one)
    // are excluded via the finished_at filter.
    const prKinds =
      setIdx === 0
        ? await detectPRsForSet1(db, ex.exercise_id, weight, reps)
        : [];

    await addSet(db, workoutId, ex.exercise_id, setIdx + 1, reps, weight);
    await reload();

    // Figure out the label for the rest overlay.
    const loggedAfter = setIdx + 1;
    const willBeDone = loggedAfter >= ex.default_sets;
    let label: string;
    if (willBeDone) {
      const idx = prescribed.findIndex((p) => p.exercise_id === ex.exercise_id);
      const nextEx = prescribed
        .slice(idx + 1)
        .find((p) => setsCount(p.exercise_id) + 0 < p.default_sets);
      label = nextEx
        ? `${nextEx.exercise_name} · Set 1 of ${nextEx.default_sets}`
        : "Last set done — finish up";
    } else {
      label = `${ex.exercise_name} · Set ${loggedAfter + 1} of ${ex.default_sets}`;
    }

    if (prKinds.length > 0) {
      // Pick the highest-priority PR kind for the headline.
      const kind: PRKind = prKinds.includes("weight")
        ? "weight"
        : prKinds.includes("rep")
        ? "rep"
        : "volume";
      setCelebration({
        kind,
        exerciseName: ex.exercise_name,
        value: `${weight} kg × ${reps}`,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // PR toast is non-blocking — start rest immediately, fade toast out.
      setTimeout(() => setCelebration(null), 2200);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    await rest.start({ seconds: ex.default_rest_seconds, label });

    // If this was the last set, clear any manual override so auto-advance picks up.
    if (willBeDone) setManualActiveId(null);
  };

  const handleDeleteSet = async (setId: number) => {
    const row = sets.find((s) => s.id === setId);
    await deleteSet(db, setId);
    if (row)
      await renumberSetsForExercise(db, workoutId, row.exercise_id);
    await reload();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleEditSet = (row: SetRow) => {
    Haptics.selectionAsync();
    setEditingSet(row);
  };

  const handleSkip = (ex: PrescribedExercise) => {
    Haptics.selectionAsync();
    Alert.alert(
      "Not today?",
      `Skip ${ex.exercise_name} for this session, or remove it from the plan entirely?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove from plan",
          style: "destructive",
          onPress: async () => {
            // Persistent template edit — gone from this and future sessions.
            // Any sets already logged stay in history.
            await removeExerciseFromTemplate(db, ex.id);
            if (manualActiveId === ex.exercise_id) setManualActiveId(null);
            await loadPrescription();
          },
        },
        {
          text: "Skip it",
          onPress: async () => {
            await skipExercise(db, workoutId, ex.exercise_id);
            if (manualActiveId === ex.exercise_id) setManualActiveId(null);
            await reload();
          },
        },
      ]
    );
  };

  const handleAddExercise = () => {
    workoutStore.setContext("workout");
    router.push("/workout/pick-exercise");
  };

  const handleUnskip = (ex: PrescribedExercise) => {
    Haptics.selectionAsync();
    Alert.alert("Bring back", `Mark ${ex.exercise_name} as pending again?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Bring back",
        onPress: async () => {
          await unskipExercise(db, workoutId, ex.exercise_id);
          await reload();
        },
      },
    ]);
  };

  const handleSaveEdit = async (weight: number, reps: number) => {
    if (!editingSet) return;
    await updateSet(db, editingSet.id, reps, weight);
    setEditingSet(null);
    await reload();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleFinish = () => {
    const finishNow = async () => {
      await finishWorkout(db, workoutId);
      await rest.skip();
      router.replace({
        pathname: "/workout/summary",
        params: { id: String(workoutId) },
      });
    };

    const remaining = prescribed.filter(
      (p) =>
        !skipped.has(p.exercise_id) &&
        setsCount(p.exercise_id) < p.default_sets
    );

    if (remaining.length === 0) {
      Alert.alert("Finish Workout", "Save and finish?", [
        { text: "Cancel", style: "cancel" },
        { text: "Finish", onPress: finishNow },
      ]);
      return;
    }

    const names = remaining
      .map((r) => `• ${r.exercise_name}`)
      .slice(0, 6)
      .join("\n");
    const more =
      remaining.length > 6 ? `\n…and ${remaining.length - 6} more` : "";

    Alert.alert(
      `${remaining.length} unfinished exercise${remaining.length === 1 ? "" : "s"}`,
      `${names}${more}\n\nMark them as skipped and finish?`,
      [
        { text: "Keep Going", style: "cancel" },
        {
          text: "Skip & Finish",
          style: "destructive",
          onPress: async () => {
            await bulkSkipExercises(
              db,
              workoutId,
              remaining.map((r) => r.exercise_id)
            );
            await finishNow();
          },
        },
      ]
    );
  };

  const handleDiscard = () => {
    Alert.alert("Discard Workout", "This can't be undone.", [
      { text: "Keep Going", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: async () => {
          await deleteWorkout(db, workoutId);
          await rest.skip();
          router.back();
        },
      },
    ]);
  };

  const totalPrescribed = prescribed.reduce((s, p) => s + p.default_sets, 0);
  // Count only sets of exercises still in the plan — an exercise removed
  // mid-workout keeps its logged sets in the DB but not in this counter.
  const completed = sets.filter((s) =>
    prescribed.some((p) => p.exercise_id === s.exercise_id)
  ).length;

  return (
    <View style={m.root}>
      <View style={m.top}>
        <Text style={m.topTimer}>{fmt(elapsed)}</Text>
        <Text style={m.topProgress}>
          {completed} / {totalPrescribed || "?"} sets
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
      >
        {prescribed.map((ex) => {
          const logged = sets
            .filter((x) => x.exercise_id === ex.exercise_id)
            .sort((a, b) => a.set_number - b.set_number);
          const isSkipped = skipped.has(ex.exercise_id);
          const done = !isSkipped && logged.length >= ex.default_sets;
          if (isSkipped)
            return (
              <SkippedCard
                key={ex.id}
                ex={ex}
                onUnskip={() => handleUnskip(ex)}
              />
            );
          if (done)
            return <DoneCard key={ex.id} ex={ex} logged={logged} />;
          if (ex.exercise_id === activeId)
            return (
              <ActiveCard
                key={ex.id}
                ex={ex}
                logged={logged}
                lastSet={lastSetByEx.get(ex.exercise_id) ?? null}
                lastSessionSets={
                  lastSessionByEx.get(ex.exercise_id) ?? new Map()
                }
                regression={regressionByEx.get(ex.exercise_id) ?? null}
                onLogSet={(idx, w, r) => handleLogSet(ex, idx, w, r)}
                onDeleteSet={handleDeleteSet}
                onEditSet={handleEditSet}
                onSkip={() => handleSkip(ex)}
              />
            );
          return (
            <PendingCard
              key={ex.id}
              ex={ex}
              loggedCount={logged.length}
              onActivate={() => setManualActiveId(ex.exercise_id)}
              onSkip={() => handleSkip(ex)}
            />
          );
        })}

        {/* Mid-workout template edit — appends to the plan permanently. */}
        <Pressable style={m.addExBtn} onPress={handleAddExercise} hitSlop={6}>
          <Text style={m.addExText}>＋ ADD EXERCISE</Text>
        </Pressable>
      </ScrollView>

      <RestTimerOverlay
        rest={rest.state}
        onAdjust={rest.adjust}
        onSkip={rest.skip}
      />

      <View style={m.bottom}>
        <Pressable style={m.discardBtn} onPress={handleDiscard}>
          <Text style={m.discardText}>Discard</Text>
        </Pressable>
        <Pressable style={m.finishBtn} onPress={handleFinish}>
          <Text style={m.finishText}>Finish</Text>
        </Pressable>
      </View>

      {celebration && (
        <PrCelebration
          visible
          kind={celebration.kind}
          exerciseName={celebration.exerciseName}
          value={celebration.value}
        />
      )}

      <SetEditModal
        visible={editingSet !== null}
        initial={
          editingSet
            ? { weight: editingSet.weight, reps: editingSet.reps }
            : null
        }
        exerciseName={editingSet?.exercise_name ?? ""}
        setNumber={editingSet?.set_number ?? 0}
        increment={
          prescribed.find((p) => p.exercise_id === editingSet?.exercise_id)
            ?.min_increment_kg ?? 1
        }
        onSave={handleSaveEdit}
        onCancel={() => setEditingSet(null)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────
const m = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topTimer: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  topProgress: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  bottom: {
    flexDirection: "row",
    padding: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  discardBtn: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  discardText: { color: colors.danger, fontWeight: "700", fontSize: 16 },
  finishBtn: {
    flex: 2,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.success,
    alignItems: "center",
  },
  finishText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  addExBtn: {
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(74,144,217,0.5)",
    marginTop: 4,
  },
  addExText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
});

const c = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  cardActive: {
    borderColor: "rgba(74,144,217,0.4)",
    backgroundColor: "#0F141C",
  },
  cardDone: {
    backgroundColor: "rgba(76,175,80,0.06)",
    borderColor: "rgba(76,175,80,0.3)",
  },
  cardPending: {
    opacity: 0.55,
  },
  cardSkipped: {
    opacity: 0.9,
    backgroundColor: "rgba(255,167,38,0.08)",
    borderColor: "rgba(255,167,38,0.4)",
  },
  nameSkipped: {
    textDecorationLine: "line-through",
    color: colors.warning,
  },

  hdr: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: colors.text, fontSize: 17, fontWeight: "800", flex: 1 },
  sub: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },

  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(76,175,80,0.18)",
    justifyContent: "center",
    alignItems: "center",
  },
  checkText: { color: colors.success, fontSize: 14, fontWeight: "900" },

  pill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: "rgba(74,144,217,0.14)",
  },
  pillText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  pillDone: { backgroundColor: "rgba(76,175,80,0.18)" },
  pillDoneText: { color: colors.success },
  pillPending: { backgroundColor: colors.surfaceLight },
  pillPendingText: { color: colors.textSecondary },
  pillSkipped: { backgroundColor: "rgba(255,167,38,0.18)" },
  pillSkippedText: { color: colors.warning, letterSpacing: 1 },

  notTodayBtn: {
    marginTop: 12,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,167,38,0.45)",
  },
  notTodayText: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },

  // ── Drop-set pill ──
  pillDrop: { backgroundColor: "rgba(255,167,38,0.18)" },
  pillDropText: { color: colors.warning, letterSpacing: 1 },

  // ── Regression hint ──
  regress: {
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    paddingLeft: 10,
    paddingVertical: 6,
    marginTop: 10,
    marginBottom: 4,
  },
  regressText: { color: colors.warning, fontSize: 12, fontWeight: "700" },

  // ── Plank / time-based timer ──
  timerRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  timerElapsed: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  timerBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 124,
    alignItems: "center",
  },
  timerStart: { backgroundColor: colors.accent },
  timerStartText: { color: "#fff", fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  timerStop: { backgroundColor: colors.danger },
  timerStopText: { color: "#fff", fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  timerLogged: {
    flex: 1,
    color: colors.success,
    fontSize: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },

  coach: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: 10,
    paddingVertical: 6,
    marginTop: 10,
    marginBottom: 4,
  },
  coachText: { color: colors.accent, fontSize: 13, fontWeight: "700" },

  setsWrap: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },

  colHeaders: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 6,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  colHeaderSet: {
    width: 42,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: colors.textSecondary,
    textAlign: "left",
  },
  colHeaderKg: {
    width: 108,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: colors.textSecondary,
    textAlign: "center",
  },
  colHeaderReps: {
    flex: 1,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: colors.textSecondary,
    textAlign: "center",
  },

  setBlock: {
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  setBlockCurrent: {
    backgroundColor: "rgba(74,144,217,0.14)",
    borderWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(74,144,217,0.35)",
    borderBottomColor: "rgba(74,144,217,0.35)",
    borderRadius: 8,
    marginHorizontal: -4,
    marginVertical: 2,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  setBlockLast: {
    borderBottomWidth: 0,
  },
  setInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  setLastInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  setLastInlineKg: {
    width: 108,
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.3,
  },
  setLastInlineReps: {
    flex: 1,
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.3,
  },
  setN: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.textSecondary,
    letterSpacing: 1.5,
    width: 42,
  },

  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 8 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },

});
