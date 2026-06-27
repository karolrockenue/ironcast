import * as SQLite from "expo-sqlite";
import { PLAN_NAMES } from "./schema";

// ───────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────

export type Exercise = {
  id: number;
  name: string;
  category: string;
  movement_type: string;
  muscle_group: string;
  default_sets: number;
  default_rep_min: number;
  default_rep_max: number;
  default_rest_seconds: number;
  weight_increment: number;
  min_increment_kg: number;
  back_off_ratio: number;
  weight_display_mode: "total" | "per_hand";
  is_per_arm: number; // sqlite stores bool as 0/1
  special_rules: string | null;
};

export type Workout = {
  id: number;
  started_at: string;
  finished_at: string | null;
  notes: string | null;
  template_id: number | null;
  deadlift_mode: "heavy" | "technique" | null;
};

export type SetRow = {
  id: number;
  workout_id: number;
  exercise_id: number;
  exercise_name: string;
  exercise_muscle_group: string;
  exercise_movement_type: string;
  exercise_special_rules: string | null; // 'timed' → reps holds seconds
  set_number: number;
  reps: number;
  weight: number;
  completed_at: string;
};

// One reduced-weight burnout stage of a drop set, attached to a parent set
// row (`set_id` → sets.id). drop_seq is 1..n in performed order.
export type DropRow = {
  id: number;
  set_id: number;
  drop_seq: number;
  weight: number;
  reps: number;
};

export type Template = {
  id: number;
  name: string;
  created_at: string;
};

export type TemplateWithCount = Template & { exercise_count: number };

export type TemplateExercise = {
  id: number;
  template_id: number;
  exercise_id: number;
  sort_order: number;
  exercise_name: string;
  muscle_group: string;
  movement_type: string;
};

export type PrescribedExercise = TemplateExercise & {
  default_sets: number; // effective: per-plan template_exercises.sets if set, else exercise default
  default_rep_min: number;
  default_rep_max: number;
  default_rest_seconds: number;
  weight_increment: number;
  min_increment_kg: number;
  back_off_ratio: number;
  weight_display_mode: "total" | "per_hand";
  is_per_arm: number;
  special_rules: string | null;
  is_drop_set: number; // per-plan: show the DROP SET pill (reminder, not logged)
};

// ───────────────────────────────────────────────────────────
// Exercises / Templates
// ───────────────────────────────────────────────────────────

export async function getAllExercises(db: SQLite.SQLiteDatabase) {
  return db.getAllAsync<Exercise>(
    "SELECT * FROM exercises ORDER BY muscle_group, name"
  );
}

export async function getAllTemplates(db: SQLite.SQLiteDatabase) {
  return db.getAllAsync<TemplateWithCount>(
    `SELECT t.*, COUNT(te.id) as exercise_count
     FROM templates t
     LEFT JOIN template_exercises te ON te.template_id = t.id
     GROUP BY t.id
     ORDER BY t.name`
  );
}

export async function getTemplateById(
  db: SQLite.SQLiteDatabase,
  templateId: number
) {
  return db.getFirstAsync<Template>("SELECT * FROM templates WHERE id = ?", [
    templateId,
  ]);
}

export async function getTemplateByName(
  db: SQLite.SQLiteDatabase,
  name: string
) {
  return db.getFirstAsync<Template>("SELECT * FROM templates WHERE name = ?", [
    name,
  ]);
}

export async function getTemplateExercises(
  db: SQLite.SQLiteDatabase,
  templateId: number
) {
  return db.getAllAsync<TemplateExercise>(
    `SELECT te.*, e.name as exercise_name, e.muscle_group, e.movement_type
     FROM template_exercises te
     JOIN exercises e ON e.id = te.exercise_id
     WHERE te.template_id = ?
     ORDER BY te.sort_order`,
    [templateId]
  );
}

export async function getPrescribedExercises(
  db: SQLite.SQLiteDatabase,
  templateId: number
) {
  return db.getAllAsync<PrescribedExercise>(
    `SELECT te.*, e.name as exercise_name, e.muscle_group, e.movement_type,
            COALESCE(te.sets, e.default_sets) as default_sets,
            e.default_rep_min, e.default_rep_max,
            e.default_rest_seconds, e.weight_increment,
            e.min_increment_kg, e.back_off_ratio, e.weight_display_mode,
            e.is_per_arm, e.special_rules,
            te.is_drop_set as is_drop_set
     FROM template_exercises te
     JOIN exercises e ON e.id = te.exercise_id
     WHERE te.template_id = ?
     ORDER BY te.sort_order`,
    [templateId]
  );
}

export async function createTemplate(db: SQLite.SQLiteDatabase, name: string) {
  const result = await db.runAsync("INSERT INTO templates (name) VALUES (?)", [
    name,
  ]);
  return result.lastInsertRowId;
}

export async function deleteTemplate(
  db: SQLite.SQLiteDatabase,
  templateId: number
) {
  await db.runAsync("DELETE FROM template_exercises WHERE template_id = ?", [
    templateId,
  ]);
  await db.runAsync("DELETE FROM templates WHERE id = ?", [templateId]);
}

export async function updateTemplateName(
  db: SQLite.SQLiteDatabase,
  templateId: number,
  name: string
) {
  await db.runAsync("UPDATE templates SET name = ? WHERE id = ?", [
    name,
    templateId,
  ]);
}

// Update an exercise's prescription (sets / rep range / rest). This lives on
// the shared `exercises` row, so the change applies to every template that
// uses the exercise — and the rep range also feeds the progression engine
// (rep_max = the target it pushes toward). Deadlift set count is overridden at
// runtime by heavy/technique mode, so callers should not edit its default_sets.
export async function updateExercisePrescription(
  db: SQLite.SQLiteDatabase,
  exerciseId: number,
  p: {
    default_sets: number;
    default_rep_min: number;
    default_rep_max: number;
    default_rest_seconds: number;
  }
) {
  await db.runAsync(
    `UPDATE exercises
        SET default_sets = ?, default_rep_min = ?, default_rep_max = ?, default_rest_seconds = ?
      WHERE id = ?`,
    [
      p.default_sets,
      p.default_rep_min,
      p.default_rep_max,
      p.default_rest_seconds,
      exerciseId,
    ]
  );
}

// Per-plan working-set count (template_exercises.sets). Unlike the rep range /
// rest (which live on the shared exercise row), set count is per-plan: the same
// exercise can be 2 sets in one template and 3 in another.
export async function updateTemplateExerciseSets(
  db: SQLite.SQLiteDatabase,
  templateExerciseId: number,
  sets: number
) {
  await db.runAsync(
    "UPDATE template_exercises SET sets = ? WHERE id = ?",
    [sets, templateExerciseId]
  );
}

// Per-plan drop-set flag (template_exercises.is_drop_set) — drives the yellow
// DROP SET pill on the active card. A reminder only; drops aren't logged.
export async function updateTemplateExerciseDropSet(
  db: SQLite.SQLiteDatabase,
  templateExerciseId: number,
  isDropSet: boolean
) {
  await db.runAsync(
    "UPDATE template_exercises SET is_drop_set = ? WHERE id = ?",
    [isDropSet ? 1 : 0, templateExerciseId]
  );
}

// No-op if the exercise is already in the template — the active screen keys
// state by exercise_id, so duplicate rows would corrupt it.
export async function addExerciseToTemplate(
  db: SQLite.SQLiteDatabase,
  templateId: number,
  exerciseId: number
) {
  const existing = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM template_exercises WHERE template_id = ? AND exercise_id = ?",
    [templateId, exerciseId]
  );
  if (existing) return;
  const max = await db.getFirstAsync<{ m: number | null }>(
    "SELECT MAX(sort_order) as m FROM template_exercises WHERE template_id = ?",
    [templateId]
  );
  const sortOrder = (max?.m ?? -1) + 1;
  await db.runAsync(
    "INSERT INTO template_exercises (template_id, exercise_id, sort_order) VALUES (?, ?, ?)",
    [templateId, exerciseId, sortOrder]
  );
}

export async function removeExerciseFromTemplate(
  db: SQLite.SQLiteDatabase,
  templateExerciseId: number
) {
  await db.runAsync("DELETE FROM template_exercises WHERE id = ?", [
    templateExerciseId,
  ]);
}

export async function moveTemplateExercise(
  db: SQLite.SQLiteDatabase,
  templateId: number,
  templateExerciseId: number,
  direction: "up" | "down"
) {
  const exercises = await getTemplateExercises(db, templateId);
  const idx = exercises.findIndex((e) => e.id === templateExerciseId);
  if (idx < 0) return;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= exercises.length) return;

  const a = exercises[idx];
  const b = exercises[swapIdx];
  await db.runAsync(
    "UPDATE template_exercises SET sort_order = ? WHERE id = ?",
    [b.sort_order, a.id]
  );
  await db.runAsync(
    "UPDATE template_exercises SET sort_order = ? WHERE id = ?",
    [a.sort_order, b.id]
  );
}

// ───────────────────────────────────────────────────────────
// Workouts / Sets
// ───────────────────────────────────────────────────────────

export async function startWorkout(
  db: SQLite.SQLiteDatabase,
  opts: { templateId?: number } = {}
) {
  const result = await db.runAsync(
    "INSERT INTO workouts (template_id) VALUES (?)",
    [opts.templateId ?? null]
  );
  return result.lastInsertRowId;
}

export async function finishWorkout(
  db: SQLite.SQLiteDatabase,
  workoutId: number,
  notes?: string
) {
  await db.runAsync(
    "UPDATE workouts SET finished_at = datetime('now'), notes = ? WHERE id = ?",
    [notes ?? null, workoutId]
  );
}

export async function deleteWorkout(
  db: SQLite.SQLiteDatabase,
  workoutId: number
) {
  await db.runAsync(
    `DELETE FROM set_drops WHERE set_id IN
       (SELECT id FROM sets WHERE workout_id = ?)`,
    [workoutId]
  );
  await db.runAsync("DELETE FROM sets WHERE workout_id = ?", [workoutId]);
  await db.runAsync("DELETE FROM workouts WHERE id = ?", [workoutId]);
}

export async function addSet(
  db: SQLite.SQLiteDatabase,
  workoutId: number,
  exerciseId: number,
  setNumber: number,
  reps: number,
  weight: number
) {
  const result = await db.runAsync(
    "INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight) VALUES (?, ?, ?, ?, ?)",
    [workoutId, exerciseId, setNumber, reps, weight]
  );
  return result.lastInsertRowId;
}

export async function deleteSet(db: SQLite.SQLiteDatabase, setId: number) {
  // FK cascade isn't relied on (foreign_keys pragma isn't force-enabled), so
  // drop the set's burnout stages explicitly.
  await db.runAsync("DELETE FROM set_drops WHERE set_id = ?", [setId]);
  await db.runAsync("DELETE FROM sets WHERE id = ?", [setId]);
}

// ───────────────────────────────────────────────────────────
// Drop sets — burnout stages attached to a parent set row
// ───────────────────────────────────────────────────────────

export async function addDrop(
  db: SQLite.SQLiteDatabase,
  setId: number,
  dropSeq: number,
  weight: number,
  reps: number
) {
  const result = await db.runAsync(
    "INSERT INTO set_drops (set_id, drop_seq, weight, reps) VALUES (?, ?, ?, ?)",
    [setId, dropSeq, weight, reps]
  );
  return result.lastInsertRowId;
}

export async function deleteDrop(db: SQLite.SQLiteDatabase, dropId: number) {
  await db.runAsync("DELETE FROM set_drops WHERE id = ?", [dropId]);
}

// All drop stages for a workout, oldest-first per set. Keyed in the UI by
// set_id to render the ladder under each parent set.
export async function getDropsForWorkout(
  db: SQLite.SQLiteDatabase,
  workoutId: number
): Promise<DropRow[]> {
  return db.getAllAsync<DropRow>(
    `SELECT d.id, d.set_id, d.drop_seq, d.weight, d.reps
     FROM set_drops d
     JOIN sets s ON s.id = d.set_id
     WHERE s.workout_id = ?
     ORDER BY d.set_id, d.drop_seq`,
    [workoutId]
  );
}

export async function updateSet(
  db: SQLite.SQLiteDatabase,
  setId: number,
  reps: number,
  weight: number
) {
  await db.runAsync(
    "UPDATE sets SET reps = ?, weight = ? WHERE id = ?",
    [reps, weight, setId]
  );
}

// After a set is deleted, renumber the remaining sets for that exercise in
// that workout so set_number stays 1…N contiguous (keeps Set 1 = top set,
// Set 2 = back-off invariants intact for progression).
export async function renumberSetsForExercise(
  db: SQLite.SQLiteDatabase,
  workoutId: number,
  exerciseId: number
) {
  const rows = await db.getAllAsync<{ id: number }>(
    `SELECT id FROM sets
     WHERE workout_id = ? AND exercise_id = ?
     ORDER BY completed_at, id`,
    [workoutId, exerciseId]
  );
  for (let i = 0; i < rows.length; i++) {
    await db.runAsync(
      "UPDATE sets SET set_number = ? WHERE id = ?",
      [i + 1, rows[i].id]
    );
  }
}

export async function getSetsForWorkout(
  db: SQLite.SQLiteDatabase,
  workoutId: number
) {
  return db.getAllAsync<SetRow>(
    `SELECT s.*, e.name as exercise_name, e.muscle_group as exercise_muscle_group,
            e.movement_type as exercise_movement_type,
            e.special_rules as exercise_special_rules
     FROM sets s
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.workout_id = ?
     ORDER BY s.completed_at, s.set_number`,
    [workoutId]
  );
}

export type WorkoutHistoryRow = Workout & {
  exercise_count: number;
  set_count: number;
  template_name: string | null;
};

export async function getWorkoutHistory(db: SQLite.SQLiteDatabase) {
  return db.getAllAsync<WorkoutHistoryRow>(
    `SELECT w.*,
       COUNT(DISTINCT s.exercise_id) as exercise_count,
       COUNT(s.id) as set_count,
       t.name as template_name
     FROM workouts w
     LEFT JOIN sets s ON s.workout_id = w.id
     LEFT JOIN templates t ON t.id = w.template_id
     WHERE w.finished_at IS NOT NULL
     GROUP BY w.id
     ORDER BY w.started_at DESC`
  );
}

// ───────────────────────────────────────────────────────────
// CSV export — full set-level history for offline / LLM analysis
// ───────────────────────────────────────────────────────────

export type ExportRow = {
  date: string;
  started_at: string;
  finished_at: string | null;
  template_name: string | null;
  deadlift_mode: string | null;
  exercise_name: string;
  muscle_group: string;
  set_number: number;
  drop_seq: number; // 0 = top working set, 1..n = drop-set burnout stage
  weight: number;
  reps: number;
};

// Every logged set + drop-set stage across all *finished* workouts, oldest
// first. One row per set (drop_seq 0) plus one row per burnout stage — the
// natural grain for a spreadsheet or for handing to Claude.
export async function getAllSetsForExport(
  db: SQLite.SQLiteDatabase
): Promise<ExportRow[]> {
  return db.getAllAsync<ExportRow>(
    `SELECT date(w.started_at) as date,
            w.started_at as started_at,
            w.finished_at as finished_at,
            t.name as template_name,
            w.deadlift_mode as deadlift_mode,
            e.name as exercise_name,
            e.muscle_group as muscle_group,
            s.set_number as set_number,
            0 as drop_seq,
            s.weight as weight,
            s.reps as reps,
            s.exercise_id as exercise_id
     FROM sets s
     JOIN workouts w ON w.id = s.workout_id
     JOIN exercises e ON e.id = s.exercise_id
     LEFT JOIN templates t ON t.id = w.template_id
     WHERE w.finished_at IS NOT NULL
     UNION ALL
     SELECT date(w.started_at) as date,
            w.started_at as started_at,
            w.finished_at as finished_at,
            t.name as template_name,
            w.deadlift_mode as deadlift_mode,
            e.name as exercise_name,
            e.muscle_group as muscle_group,
            s.set_number as set_number,
            d.drop_seq as drop_seq,
            d.weight as weight,
            d.reps as reps,
            s.exercise_id as exercise_id
     FROM set_drops d
     JOIN sets s ON s.id = d.set_id
     JOIN workouts w ON w.id = s.workout_id
     JOIN exercises e ON e.id = s.exercise_id
     LEFT JOIN templates t ON t.id = w.template_id
     WHERE w.finished_at IS NOT NULL
     ORDER BY started_at ASC, exercise_id ASC, set_number ASC, drop_seq ASC`
  );
}

export async function getUnfinishedWorkout(db: SQLite.SQLiteDatabase) {
  return db.getFirstAsync<Workout & { template_name: string | null }>(
    `SELECT w.*, t.name as template_name
     FROM workouts w
     LEFT JOIN templates t ON t.id = w.template_id
     WHERE w.finished_at IS NULL
     ORDER BY w.started_at DESC LIMIT 1`
  );
}

// ───────────────────────────────────────────────────────────
// A/B/C plan rotation (3-way cycle)
// ───────────────────────────────────────────────────────────

// 3-way rotation: look at the most recent *finished* workout's template and
// advance to the next plan in PLAN_NAMES order (A→B→C→A). If the last plan
// isn't in the rotation (or there's no history), start at the first plan.
export async function getNextWorkoutPlan(db: SQLite.SQLiteDatabase) {
  const last = await db.getFirstAsync<{ template_name: string }>(
    `SELECT t.name as template_name
     FROM workouts w
     JOIN templates t ON t.id = w.template_id
     WHERE w.finished_at IS NOT NULL
     ORDER BY w.started_at DESC LIMIT 1`
  );
  const idx = last ? PLAN_NAMES.indexOf(last.template_name) : -1;
  const nextName =
    idx === -1 ? PLAN_NAMES[0] : PLAN_NAMES[(idx + 1) % PLAN_NAMES.length];
  return db.getFirstAsync<TemplateWithCount>(
    `SELECT t.*, COUNT(te.id) as exercise_count
     FROM templates t
     LEFT JOIN template_exercises te ON te.template_id = t.id
     WHERE t.name = ?
     GROUP BY t.id`,
    [nextName]
  );
}

// ───────────────────────────────────────────────────────────
// Progression engine
// ───────────────────────────────────────────────────────────

export type ProgressionDirection =
  | "increase"
  | "same"
  | "decrease"
  | "reps_only"
  | "none";

export type Progression = {
  direction: ProgressionDirection;
  suggested_weight: number;
  last_weight: number;
  last_reps: number;
  message: string;
};

type ProgressionInput = {
  rep_min: number;
  rep_max: number;
  weight_increment: number;
  special_rules?: string | null;
};

export function decideProgression(
  ex: ProgressionInput,
  lastSet: { weight: number; reps: number } | null
): Progression {
  if (!lastSet) {
    return {
      direction: "none",
      suggested_weight: 0,
      last_weight: 0,
      last_reps: 0,
      message: "First time — pick a starting weight",
    };
  }

  const { weight, reps } = lastSet;
  const { rep_min, rep_max, weight_increment } = ex;

  // Bodyweight / "add a rep" exercises (e.g. hanging leg raises) and time-based
  // exercises (Plank — `reps` holds the held duration in seconds).
  if (weight_increment === 0) {
    const timed = ex.special_rules === "timed";
    if (reps >= rep_max) {
      return {
        direction: "reps_only",
        suggested_weight: weight,
        last_weight: weight,
        last_reps: reps,
        message: timed
          ? `Held past ${rep_max}s — aim for more time`
          : `Hit top of range — aim past ${rep_max} reps next time`,
      };
    }
    return {
      direction: "reps_only",
      suggested_weight: weight,
      last_weight: weight,
      last_reps: reps,
      message: reps >= rep_min
        ? timed
          ? "Hold longer next time"
          : "Add a rep next time"
        : "Below target — aim for the range",
    };
  }

  if (reps >= rep_max) {
    return {
      direction: "increase",
      suggested_weight: +(weight + weight_increment).toFixed(2),
      last_weight: weight,
      last_reps: reps,
      message: `Hit top of range — try +${weight_increment} kg`,
    };
  }
  if (reps >= rep_min) {
    return {
      direction: "same",
      suggested_weight: weight,
      last_weight: weight,
      last_reps: reps,
      message: "Same weight, aim for more reps",
    };
  }
  const dropped = Math.max(0, +(weight - weight_increment).toFixed(2));
  return {
    direction: "decrease",
    suggested_weight: dropped,
    last_weight: weight,
    last_reps: reps,
    message: `Below range — drop to ${dropped} kg`,
  };
}

export type LastSet = { weight: number; reps: number; set_number: number };

// Returns the *top working set* (Set 1) of the given exercise from the most
// recent finished workout. In our design Set 1 is always the heaviest working
// set; Set 2+ are back-offs, so they'd mislead the progression engine.
export async function getLastSetForExercise(
  db: SQLite.SQLiteDatabase,
  exerciseId: number,
  excludeWorkoutId?: number
) {
  const params: (string | number)[] = [exerciseId];
  let excludeClause = "";
  if (excludeWorkoutId) {
    excludeClause = " AND w.id != ?";
    params.push(excludeWorkoutId);
  }
  return db.getFirstAsync<LastSet>(
    `SELECT s.weight, s.reps, s.set_number
     FROM sets s
     JOIN workouts w ON w.id = s.workout_id
     WHERE s.exercise_id = ? AND w.finished_at IS NOT NULL${excludeClause}
     ORDER BY w.started_at DESC, s.set_number ASC
     LIMIT 1`,
    params
  );
}

// Returns every set of the most recent finished session of this exercise,
// keyed by set_number. Used for per-set placeholder + regression detection
// (so Set 2's placeholder reflects last session's Set 2, not Set 1).
export async function getLastSessionSetsForExercise(
  db: SQLite.SQLiteDatabase,
  exerciseId: number,
  excludeWorkoutId?: number
): Promise<Map<number, LastSet>> {
  const params: (string | number)[] = [exerciseId];
  let excludeClause = "";
  if (excludeWorkoutId) {
    excludeClause = " AND w.id != ?";
    params.push(excludeWorkoutId);
  }
  const workout = await db.getFirstAsync<{ id: number }>(
    `SELECT w.id FROM workouts w
     JOIN sets s ON s.workout_id = w.id
     WHERE s.exercise_id = ? AND w.finished_at IS NOT NULL${excludeClause}
     ORDER BY w.started_at DESC LIMIT 1`,
    params
  );
  if (!workout) return new Map();
  const rows = await db.getAllAsync<LastSet>(
    `SELECT weight, reps, set_number
     FROM sets WHERE workout_id = ? AND exercise_id = ?
     ORDER BY set_number`,
    [workout.id, exerciseId]
  );
  return new Map(rows.map((r) => [r.set_number, r]));
}

// Regression hint: if last session's top set (Set 1) is BELOW a heavier weight
// you hit in an earlier session, surface that earlier weight as a comeback
// target. Returns null when the last session was your best (no regression) or
// there's no history. Prevents a weak-day backslide from reading as progress.
export type RegressionHint = {
  last_weight: number;
  prev_best_weight: number;
};

export async function getRegressionHint(
  db: SQLite.SQLiteDatabase,
  exerciseId: number,
  excludeWorkoutId?: number
): Promise<RegressionHint | null> {
  const params: (string | number)[] = [exerciseId];
  let excludeClause = "";
  if (excludeWorkoutId) {
    excludeClause = " AND w.id != ?";
    params.push(excludeWorkoutId);
  }
  // The most recent finished session that logged this exercise.
  const lastWorkout = await db.getFirstAsync<{ id: number; started_at: string }>(
    `SELECT w.id, w.started_at
     FROM workouts w
     JOIN sets s ON s.workout_id = w.id
     WHERE s.exercise_id = ? AND w.finished_at IS NOT NULL${excludeClause}
     ORDER BY w.started_at DESC LIMIT 1`,
    params
  );
  if (!lastWorkout) return null;

  const lastSet1 = await db.getFirstAsync<{ weight: number }>(
    `SELECT weight FROM sets
     WHERE workout_id = ? AND exercise_id = ? AND set_number = 1
     LIMIT 1`,
    [lastWorkout.id, exerciseId]
  );
  if (!lastSet1) return null;

  // Heaviest Set 1 across sessions STRICTLY BEFORE the last one.
  const best = await db.getFirstAsync<{ w: number | null }>(
    `SELECT MAX(s.weight) as w
     FROM sets s
     JOIN workouts w ON w.id = s.workout_id
     WHERE s.exercise_id = ? AND s.set_number = 1
       AND w.finished_at IS NOT NULL
       AND w.started_at < ?`,
    [exerciseId, lastWorkout.started_at]
  );
  const prevBest = best?.w ?? 0;
  if (prevBest > lastSet1.weight) {
    return { last_weight: lastSet1.weight, prev_best_weight: prevBest };
  }
  return null;
}

// ───────────────────────────────────────────────────────────
// Summary + progressions for a finished workout
// ───────────────────────────────────────────────────────────

export type PR = {
  exercise_name: string;
  kind: "weight" | "rep" | "volume";
  value: number; // kg for weight, count for reps, kg·reps for volume
  prev: number;
};

export type WorkoutSummary = {
  duration_min: number;
  total_sets: number;
  total_reps: number;
  total_volume: number;
  exercise_count: number;
  exercises: {
    name: string;
    sets: number;
    best_weight: number;
    best_reps: number;
    drops: number; // count of drop-set burnout stages logged for this exercise
    special_rules: string | null; // 'timed' → best_reps holds seconds
  }[];
  prs: PR[];
};

export async function getWorkoutSummary(
  db: SQLite.SQLiteDatabase,
  workoutId: number
): Promise<WorkoutSummary> {
  const workout = await db.getFirstAsync<Workout>(
    "SELECT * FROM workouts WHERE id = ?",
    [workoutId]
  );

  const sets = await db.getAllAsync<SetRow & { exercise_special_rules: string | null }>(
    `SELECT s.*, e.name as exercise_name, e.muscle_group as exercise_muscle_group,
            e.movement_type as exercise_movement_type,
            e.special_rules as exercise_special_rules
     FROM sets s JOIN exercises e ON e.id = s.exercise_id
     WHERE s.workout_id = ? ORDER BY s.exercise_id, s.set_number`,
    [workoutId]
  );

  let duration_min = 0;
  if (workout?.started_at && workout?.finished_at) {
    const ms =
      new Date(workout.finished_at + "Z").getTime() -
      new Date(workout.started_at + "Z").getTime();
    duration_min = Math.round(ms / 60000);
  }

  // Drop-set burnout stages count toward session totals (you did the reps),
  // but NOT toward per-exercise PR comparison below — PRs track the top set.
  const drops = await getDropsForWorkout(db, workoutId);
  const dropReps = drops.reduce((s, d) => s + d.reps, 0);
  const dropVolume = drops.reduce((s, d) => s + d.reps * d.weight, 0);

  const total_sets = sets.length; // a drop set is still one set
  const total_reps = sets.reduce((s, r) => s + r.reps, 0) + dropReps;
  const total_volume =
    sets.reduce((s, r) => s + r.reps * r.weight, 0) + dropVolume;

  // Map each drop stage to its parent set's exercise so we can count drops
  // per exercise for the summary badge.
  const exIdBySetId = new Map<number, number>(sets.map((s) => [s.id, s.exercise_id]));
  const dropCountByEx = new Map<number, number>();
  for (const d of drops) {
    const exId = exIdBySetId.get(d.set_id);
    if (exId != null) dropCountByEx.set(exId, (dropCountByEx.get(exId) ?? 0) + 1);
  }

  // Per-exercise breakdown
  const byEx = new Map<
    number,
    {
      name: string;
      sets: number;
      best_weight: number;
      best_reps: number;
      volume: number;
      special_rules: string | null;
    }
  >();
  for (const st of sets) {
    const cur = byEx.get(st.exercise_id);
    const v = st.reps * st.weight;
    if (!cur) {
      byEx.set(st.exercise_id, {
        name: st.exercise_name,
        sets: 1,
        best_weight: st.weight,
        best_reps: st.reps,
        volume: v,
        special_rules: st.exercise_special_rules,
      });
    } else {
      cur.sets++;
      cur.volume += v;
      if (st.weight > cur.best_weight) {
        cur.best_weight = st.weight;
        cur.best_reps = st.reps;
      } else if (st.weight === cur.best_weight && st.reps > cur.best_reps) {
        cur.best_reps = st.reps;
      }
    }
  }

  // PR detection — compute weight / rep / volume PRs independently against
  // prior finished workouts.
  const prs: PR[] = [];
  for (const [exId, info] of byEx) {
    const prev = await db.getFirstAsync<{
      w: number | null;
      r: number | null;
      v: number | null;
    }>(
      `SELECT
         MAX(s.weight) as w,
         MAX(s.reps) as r,
         MAX(v.total) as v
       FROM sets s
       LEFT JOIN (
         SELECT workout_id, exercise_id, SUM(reps * weight) as total
         FROM sets GROUP BY workout_id, exercise_id
       ) v ON v.workout_id = s.workout_id AND v.exercise_id = s.exercise_id
       JOIN workouts w ON w.id = s.workout_id
       WHERE s.exercise_id = ? AND w.finished_at IS NOT NULL AND w.id != ?`,
      [exId, workoutId]
    );

    if ((prev?.w ?? 0) < info.best_weight) {
      prs.push({
        exercise_name: info.name,
        kind: "weight",
        value: info.best_weight,
        prev: prev?.w ?? 0,
      });
    }

    const bestRepInThisSession = Math.max(
      ...sets.filter((s) => s.exercise_id === exId).map((s) => s.reps)
    );
    if ((prev?.r ?? 0) < bestRepInThisSession) {
      prs.push({
        exercise_name: info.name,
        kind: "rep",
        value: bestRepInThisSession,
        prev: prev?.r ?? 0,
      });
    }

    if ((prev?.v ?? 0) < info.volume) {
      prs.push({
        exercise_name: info.name,
        kind: "volume",
        value: Math.round(info.volume),
        prev: Math.round(prev?.v ?? 0),
      });
    }
  }

  return {
    duration_min,
    total_sets,
    total_reps,
    total_volume,
    exercise_count: byEx.size,
    exercises: [...byEx.entries()].map(([exId, e]) => ({
      name: e.name,
      sets: e.sets,
      best_weight: e.best_weight,
      best_reps: e.best_reps,
      drops: dropCountByEx.get(exId) ?? 0,
      special_rules: e.special_rules,
    })),
    prs,
  };
}

// ───────────────────────────────────────────────────────────
// Workout-level progression recap (for summary screen)
// ───────────────────────────────────────────────────────────

export type WorkoutProgression = {
  exercise_name: string;
  progression: Progression;
  rep_min: number;
  rep_max: number;
};

export async function getWorkoutProgressions(
  db: SQLite.SQLiteDatabase,
  workoutId: number
): Promise<WorkoutProgression[]> {
  // Pull each exercise's last set from this workout + its prescription.
  const rows = await db.getAllAsync<{
    exercise_id: number;
    exercise_name: string;
    rep_min: number;
    rep_max: number;
    weight_increment: number;
    special_rules: string | null;
    last_weight: number;
    last_reps: number;
  }>(
    `SELECT
       s.exercise_id,
       e.name as exercise_name,
       e.default_rep_min as rep_min,
       e.default_rep_max as rep_max,
       e.weight_increment as weight_increment,
       e.special_rules as special_rules,
       s.weight as last_weight,
       s.reps as last_reps
     FROM sets s
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.workout_id = ?
       AND s.set_number = (
         SELECT MIN(set_number) FROM sets
         WHERE workout_id = s.workout_id AND exercise_id = s.exercise_id
       )
     ORDER BY s.id`,
    [workoutId]
  );

  return rows.map((r) => ({
    exercise_name: r.exercise_name,
    rep_min: r.rep_min,
    rep_max: r.rep_max,
    progression: decideProgression(
      {
        rep_min: r.rep_min,
        rep_max: r.rep_max,
        weight_increment: r.weight_increment,
        special_rules: r.special_rules,
      },
      { weight: r.last_weight, reps: r.last_reps }
    ),
  }));
}

// ───────────────────────────────────────────────────────────
// Dashboard: stats overview / current weights / all-time PRs
// ───────────────────────────────────────────────────────────

export type StatsOverview = {
  total_sessions: number;
  total_duration_min: number;
  total_volume_kg: number;
  this_week_sessions: number;
  last_30d_sessions: number;
};

export async function getStatsOverview(
  db: SQLite.SQLiteDatabase
): Promise<StatsOverview> {
  const totals = await db.getFirstAsync<{
    sessions: number | null;
    duration_min: number | null;
  }>(
    `SELECT COUNT(*) as sessions,
            COALESCE(SUM((julianday(finished_at) - julianday(started_at)) * 24 * 60), 0) as duration_min
     FROM workouts WHERE finished_at IS NOT NULL`
  );
  const vol = await db.getFirstAsync<{ v: number | null }>(
    `SELECT
       SUM(s.weight * s.reps)
       + COALESCE((
           SELECT SUM(d.weight * d.reps) FROM set_drops d
           JOIN sets s2 ON s2.id = d.set_id
           JOIN workouts w2 ON w2.id = s2.workout_id
           WHERE w2.finished_at IS NOT NULL
         ), 0) as v
     FROM sets s
     JOIN workouts w ON w.id = s.workout_id
     WHERE w.finished_at IS NOT NULL`
  );
  // SQLite's strftime('%Y-%W') — Sunday-based weeks. Good enough for counts.
  const week = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM workouts
     WHERE finished_at IS NOT NULL
       AND strftime('%Y-%W', started_at) = strftime('%Y-%W', 'now')`
  );
  const last30 = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM workouts
     WHERE finished_at IS NOT NULL
       AND started_at >= datetime('now', '-30 days')`
  );
  return {
    total_sessions: totals?.sessions ?? 0,
    total_duration_min: Math.round(totals?.duration_min ?? 0),
    total_volume_kg: Math.round(vol?.v ?? 0),
    this_week_sessions: week?.c ?? 0,
    last_30d_sessions: last30?.c ?? 0,
  };
}

export type CurrentWeightRow = {
  exercise_id: number;
  exercise_name: string;
  muscle_group: string;
  movement_type: string;
  weight: number;
  reps: number;
  date: string;
};

// Most-recent Set 1 weight+reps for every exercise that's been logged in a
// finished workout. Drives the "current working weights" table.
export async function getCurrentWeights(
  db: SQLite.SQLiteDatabase
): Promise<CurrentWeightRow[]> {
  const rows = await db.getAllAsync<CurrentWeightRow>(
    `SELECT e.id as exercise_id, e.name as exercise_name,
            e.muscle_group, e.movement_type,
            s.weight, s.reps, w.started_at as date
     FROM sets s
     JOIN exercises e ON e.id = s.exercise_id
     JOIN workouts w ON w.id = s.workout_id
     WHERE w.finished_at IS NOT NULL AND s.set_number = 1
     ORDER BY w.started_at DESC, s.id DESC`
  );
  // Keep only the most recent row per exercise (rows already sorted desc).
  const seen = new Set<number>();
  const out: CurrentWeightRow[] = [];
  for (const r of rows) {
    if (seen.has(r.exercise_id)) continue;
    seen.add(r.exercise_id);
    out.push(r);
  }
  out.sort((a, b) => a.exercise_name.localeCompare(b.exercise_name));
  return out;
}

export type AllTimePR = {
  exercise_id: number;
  exercise_name: string;
  muscle_group: string;
  weight_pr: number;
  rep_pr: number;
  volume_pr: number;
};

// All-time bests per exercise across every finished workout (any set, not
// just Set 1 — historical reality is messier than the new design).
export async function getAllTimePRs(
  db: SQLite.SQLiteDatabase
): Promise<AllTimePR[]> {
  return db.getAllAsync<AllTimePR>(
    `SELECT e.id as exercise_id,
            e.name as exercise_name,
            e.muscle_group,
            MAX(s.weight) as weight_pr,
            MAX(s.reps) as rep_pr,
            MAX(s.weight * s.reps) as volume_pr
     FROM sets s
     JOIN exercises e ON e.id = s.exercise_id
     JOIN workouts w ON w.id = s.workout_id
     WHERE w.finished_at IS NOT NULL
     GROUP BY e.id
     ORDER BY e.muscle_group, e.name`
  );
}

export type PRKind = "weight" | "rep" | "volume";

// Compare a newly-logged Set 1 against all *previous finished* Set 1s of the
// same exercise. Used for mid-workout PR celebration. Unfinished workouts
// (including the current one) are implicitly excluded via finished_at filter.
export async function detectPRsForSet1(
  db: SQLite.SQLiteDatabase,
  exerciseId: number,
  weight: number,
  reps: number
): Promise<PRKind[]> {
  const prev = await db.getFirstAsync<{
    w: number | null;
    r: number | null;
    v: number | null;
  }>(
    `SELECT MAX(s.weight) as w, MAX(s.reps) as r, MAX(s.weight * s.reps) as v
     FROM sets s
     JOIN workouts wk ON wk.id = s.workout_id
     WHERE s.exercise_id = ? AND wk.finished_at IS NOT NULL
       AND s.set_number = 1`,
    [exerciseId]
  );
  const kinds: PRKind[] = [];
  const prevW = prev?.w ?? 0;
  const prevR = prev?.r ?? 0;
  const prevV = prev?.v ?? 0;
  const volume = weight * reps;
  if (weight > prevW) kinds.push("weight");
  if (reps > prevR) kinds.push("rep");
  if (volume > prevV) kinds.push("volume");
  return kinds;
}

// ───────────────────────────────────────────────────────────
// Per-exercise progress chart
// ───────────────────────────────────────────────────────────

export type ProgressPoint = {
  date: string;
  max_weight: number;
  total_volume: number;
};

export async function getExerciseProgress(
  db: SQLite.SQLiteDatabase,
  exerciseId: number
) {
  return db.getAllAsync<ProgressPoint>(
    `SELECT
       date(w.started_at) as date,
       MAX(s.weight) as max_weight,
       SUM(s.reps * s.weight) as total_volume
     FROM sets s
     JOIN workouts w ON w.id = s.workout_id
     WHERE s.exercise_id = ? AND w.finished_at IS NOT NULL
     GROUP BY date(w.started_at)
     ORDER BY date(w.started_at)`,
    [exerciseId]
  );
}

// ───────────────────────────────────────────────────────────
// Workout-level exercise skip state
// ───────────────────────────────────────────────────────────

export async function skipExercise(
  db: SQLite.SQLiteDatabase,
  workoutId: number,
  exerciseId: number
) {
  await db.runAsync(
    `INSERT OR IGNORE INTO workout_skipped_exercises (workout_id, exercise_id)
     VALUES (?, ?)`,
    [workoutId, exerciseId]
  );
}

export async function unskipExercise(
  db: SQLite.SQLiteDatabase,
  workoutId: number,
  exerciseId: number
) {
  await db.runAsync(
    `DELETE FROM workout_skipped_exercises WHERE workout_id = ? AND exercise_id = ?`,
    [workoutId, exerciseId]
  );
}

export async function getSkippedForWorkout(
  db: SQLite.SQLiteDatabase,
  workoutId: number
): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ exercise_id: number }>(
    `SELECT exercise_id FROM workout_skipped_exercises WHERE workout_id = ?`,
    [workoutId]
  );
  return new Set(rows.map((r) => r.exercise_id));
}

export async function bulkSkipExercises(
  db: SQLite.SQLiteDatabase,
  workoutId: number,
  exerciseIds: number[]
) {
  for (const id of exerciseIds) {
    await skipExercise(db, workoutId, id);
  }
}

// ───────────────────────────────────────────────────────────
// User settings (single-row key/value store in user_settings)
// ───────────────────────────────────────────────────────────

export type SettingKey =
  | "rest_sound_enabled"
  | "vibration_enabled"
  | "health_write_enabled";

export async function getSetting(
  db: SQLite.SQLiteDatabase,
  key: SettingKey
): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ?",
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: SQLite.SQLiteDatabase,
  key: SettingKey,
  value: string
) {
  await db.runAsync(
    `INSERT INTO user_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export async function getBoolSetting(
  db: SQLite.SQLiteDatabase,
  key: SettingKey,
  defaultValue: boolean
): Promise<boolean> {
  const v = await getSetting(db, key);
  if (v === null) return defaultValue;
  return v === "1";
}

export async function setBoolSetting(
  db: SQLite.SQLiteDatabase,
  key: SettingKey,
  value: boolean
) {
  await setSetting(db, key, value ? "1" : "0");
}
