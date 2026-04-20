import * as SQLite from "expo-sqlite";

// Schema version — bump and reseed on change.
// v2: deadlift_mode on workouts, special_rules on exercises, A/B plans.
// v3: bulk-insert historical session data to seed the progression engine.
// v4: back_off_ratio, min_increment_kg, weight_display_mode, is_per_arm.
// v5: replace history with 2 authoritative sessions (Apr 18 A, Apr 15 B).
// v6: drop Lat Pulldown from Apr 18 A — it was an orphan from the old plan
//     and was contaminating the B-plan "last session" lookup.
const SCHEMA_VERSION = 6;

type ExerciseSeed = {
  name: string;
  category: string;
  movement_type: "Compound" | "Isolation";
  muscle_group: string;
  default_sets: number;
  default_rep_min: number;
  default_rep_max: number;
  default_rest_seconds: number;
  weight_increment: number;
  special_rules: string | null;
  back_off_ratio: number; // 0.80–1.00 — Set 2+ = Set 1 × ratio
  min_increment_kg: number; // equipment granularity (5 kg stack, 2.5 kg plate, …)
  weight_display_mode: "total" | "per_hand";
  is_per_arm: boolean; // cosmetic only — user logs 2 sets, does both arms
};

// ─── The single source of truth for the seeded plans ───────
// Exercise names here are exactly what the app shows.
// weight_increment is aligned with min_increment_kg: the progression bump
// should match what the equipment actually allows. This also matches the
// user's real gym (Lat Pulldown / Seated Row stacks step by 5 kg).
const WORKOUT_A: ExerciseSeed[] = [
  { name: "Hack Squat (Machine)",              category: "legs",  movement_type: "Compound",  muscle_group: "Quads",     default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Bench Press (Smith Machine)",       category: "push",  movement_type: "Compound",  muscle_group: "Chest",     default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Incline Bench Press (Dumbbell)",    category: "push",  movement_type: "Compound",  muscle_group: "Chest",     default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Leg Extension (Machine)",           category: "legs",  movement_type: "Isolation", muscle_group: "Quads",     default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Single Arm Cable Tricep Pushdown",  category: "push",  movement_type: "Isolation", muscle_group: "Triceps",   default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 75,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Single Arm Lateral Raise (Cable)",  category: "push",  movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Hanging Leg Raises",                category: "core",  movement_type: "Isolation", muscle_group: "Core",      default_sets: 2, default_rep_min: 8,  default_rep_max: 15, default_rest_seconds: 75,  weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
];

const WORKOUT_B: ExerciseSeed[] = [
  { name: "Deadlift (Barbell)",                category: "pull",  movement_type: "Compound",  muscle_group: "Back",      default_sets: 2, default_rep_min: 3,  default_rep_max: 5,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: "deadlift_ht" },
  { name: "Shoulder Press (Machine Plates)",   category: "push",  movement_type: "Compound",  muscle_group: "Shoulders", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Lat Pulldown (Cable)",              category: "pull",  movement_type: "Compound",  muscle_group: "Back",      default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 150, weight_increment: 5,   min_increment_kg: 5,   back_off_ratio: 0.80, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Seated Row (Machine)",              category: "pull",  movement_type: "Compound",  muscle_group: "Back",      default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 120, weight_increment: 5,   min_increment_kg: 5,   back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Bicep Curl (Dumbbell)",             category: "pull",  movement_type: "Isolation", muscle_group: "Biceps",    default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 75,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Single Arm Lateral Raise (Cable)",  category: "push",  movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Hanging Leg Raises",                category: "core",  movement_type: "Isolation", muscle_group: "Core",      default_sets: 2, default_rep_min: 8,  default_rep_max: 15, default_rest_seconds: 75,  weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
];

export async function initDB(db: SQLite.SQLiteDatabase) {
  const { user_version: current = 0 } =
    (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version")) ??
    { user_version: 0 };

  if (current < SCHEMA_VERSION) {
    // Nuke: drop everything, rebuild, reseed.
    await db.execAsync(`
      DROP TABLE IF EXISTS sets;
      DROP TABLE IF EXISTS workouts;
      DROP TABLE IF EXISTS template_exercises;
      DROP TABLE IF EXISTS templates;
      DROP TABLE IF EXISTS exercises;
    `);
    await createSchema(db);
    await seedExercisesAndPlans(db);
    await seedHistory(db);
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  } else {
    // Same version — ensure tables exist (idempotent) for first-launch paths
    await createSchema(db);
  }
}

async function createSchema(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      movement_type TEXT NOT NULL DEFAULT 'Compound',
      muscle_group TEXT NOT NULL DEFAULT '',
      default_sets INTEGER NOT NULL DEFAULT 2,
      default_rep_min INTEGER NOT NULL DEFAULT 8,
      default_rep_max INTEGER NOT NULL DEFAULT 12,
      default_rest_seconds INTEGER NOT NULL DEFAULT 120,
      weight_increment REAL NOT NULL DEFAULT 2.5,
      min_increment_kg REAL NOT NULL DEFAULT 2.5,
      back_off_ratio REAL NOT NULL DEFAULT 0.90,
      weight_display_mode TEXT NOT NULL DEFAULT 'total',
      is_per_arm INTEGER NOT NULL DEFAULT 0,
      special_rules TEXT
    );

    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      notes TEXT,
      template_id INTEGER,
      deadlift_mode TEXT
    );

    CREATE TABLE IF NOT EXISTS sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      set_number INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      weight REAL NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS template_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    );
  `);
}

async function seedExercisesAndPlans(db: SQLite.SQLiteDatabase) {
  // Merge the two workouts' exercise seeds into a de-duped set by name.
  // Each exercise has one row; templates reference it by id.
  const byName = new Map<string, ExerciseSeed>();
  for (const e of [...WORKOUT_A, ...WORKOUT_B]) {
    if (!byName.has(e.name)) byName.set(e.name, e);
  }

  const idsByName = new Map<string, number>();
  for (const e of byName.values()) {
    const r = await db.runAsync(
      `INSERT INTO exercises
        (name, category, movement_type, muscle_group,
         default_sets, default_rep_min, default_rep_max,
         default_rest_seconds, weight_increment,
         min_increment_kg, back_off_ratio, weight_display_mode,
         is_per_arm, special_rules)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.name, e.category, e.movement_type, e.muscle_group,
        e.default_sets, e.default_rep_min, e.default_rep_max,
        e.default_rest_seconds, e.weight_increment,
        e.min_increment_kg, e.back_off_ratio, e.weight_display_mode,
        e.is_per_arm ? 1 : 0, e.special_rules,
      ]
    );
    idsByName.set(e.name, r.lastInsertRowId);
  }

  const seedPlan = async (templateName: string, exercises: ExerciseSeed[]) => {
    const t = await db.runAsync(
      "INSERT INTO templates (name) VALUES (?)",
      [templateName]
    );
    for (let i = 0; i < exercises.length; i++) {
      const exId = idsByName.get(exercises[i].name);
      if (exId === undefined) continue;
      await db.runAsync(
        "INSERT INTO template_exercises (template_id, exercise_id, sort_order) VALUES (?, ?, ?)",
        [t.lastInsertRowId, exId, i]
      );
    }
  };

  await seedPlan("Workout A", WORKOUT_A);
  await seedPlan("Workout B", WORKOUT_B);
}

// ─── Historical session seed ────────────────────────────────
// Two authoritative sessions (corrected bulk insert, supersedes earlier data).
// These set the "last session" reference for every current-plan exercise, so
// the first guided workout has an accurate starting point.
//
// Name mappings from the source data to the canonical plan names:
//   "Triceps Pushdown"       → "Single Arm Cable Tricep Pushdown"
//   "Leg Raise Parallel Bars" → "Hanging Leg Raises"
//   "Plank"                   → skipped (not in current plan; no time tracking)
//
// Deadlift in Apr 15 B is marked HEAVY; next B will be TECHNIQUE.
type HistoricalSession = {
  date: string;            // "YYYY-MM-DD HH:MM:SS" (UTC)
  duration_min: number;
  plan: "Workout A" | "Workout B";
  deadlift_mode?: "heavy" | "technique";
  sets: { exercise: string; weight: number; reps: number }[];
};

const HISTORY: HistoricalSession[] = [
  {
    date: "2026-04-18 18:00:00",
    duration_min: 49,
    plan: "Workout A",
    sets: [
      { exercise: "Hack Squat (Machine)",              weight: 15,   reps: 7 },
      { exercise: "Hack Squat (Machine)",              weight: 15,   reps: 6 },
      { exercise: "Hack Squat (Machine)",              weight: 12.5, reps: 5 },
      { exercise: "Bench Press (Smith Machine)",       weight: 55,   reps: 8 },
      { exercise: "Bench Press (Smith Machine)",       weight: 50,   reps: 5 },
      { exercise: "Incline Bench Press (Dumbbell)",    weight: 22,   reps: 4 },
      { exercise: "Incline Bench Press (Dumbbell)",    weight: 18,   reps: 8 },
      { exercise: "Leg Extension (Machine)",           weight: 73,   reps: 11 },
      { exercise: "Leg Extension (Machine)",           weight: 73,   reps: 11 },
      { exercise: "Single Arm Cable Tricep Pushdown",  weight: 7.5,  reps: 9 },
      { exercise: "Single Arm Cable Tricep Pushdown",  weight: 7.5,  reps: 7 },
      // Lat Pulldown was done on April 18 under the old plan but lives on
      // Workout B now. Skipping here so the "last Lat Pulldown" reference
      // resolves to the April 15 B session, which is what today's Workout B
      // should progress from.
      // "Leg Raise Parallel Bars" was the old core finisher — maps to
      // Hanging Leg Raises (bodyweight, reps only).
      { exercise: "Hanging Leg Raises",                weight: 0,    reps: 12 },
      { exercise: "Hanging Leg Raises",                weight: 0,    reps: 8 },
      { exercise: "Hanging Leg Raises",                weight: 0,    reps: 8 },
    ],
  },
  {
    date: "2026-04-15 18:00:00",
    duration_min: 48,
    plan: "Workout B",
    deadlift_mode: "heavy",
    sets: [
      { exercise: "Deadlift (Barbell)",                weight: 95,   reps: 4 },
      { exercise: "Lat Pulldown (Cable)",              weight: 60,   reps: 4 },
      { exercise: "Lat Pulldown (Cable)",              weight: 55,   reps: 6 },
      { exercise: "Lat Pulldown (Cable)",              weight: 50,   reps: 7 },
      { exercise: "Bicep Curl (Dumbbell)",             weight: 12,   reps: 8 },
      { exercise: "Bicep Curl (Dumbbell)",             weight: 12,   reps: 6 },
      // Plank in the source was time-based and isn't in the current plan —
      // skipped entirely.
      { exercise: "Shoulder Press (Machine Plates)",   weight: 80,   reps: 5 },
      { exercise: "Shoulder Press (Machine Plates)",   weight: 75,   reps: 5 },
      { exercise: "Single Arm Lateral Raise (Cable)",  weight: 30,   reps: 6 },
      { exercise: "Single Arm Lateral Raise (Cable)",  weight: 25,   reps: 10 },
      { exercise: "Seated Row (Machine)",              weight: 60,   reps: 8 },
      { exercise: "Seated Row (Machine)",              weight: 60,   reps: 5 },
      { exercise: "Seated Row (Machine)",              weight: 50,   reps: 7 },
    ],
  },
];

// "2026-04-18 18:00:00" + 49 minutes → "2026-04-18 18:49:00"
function addMinutesToDatetime(dt: string, minutes: number) {
  const d = new Date(dt.replace(" ", "T") + "Z");
  d.setMinutes(d.getMinutes() + minutes);
  // Format back to SQLite datetime (UTC).
  return d.toISOString().replace("T", " ").replace(/\..*/, "");
}

async function seedHistory(db: SQLite.SQLiteDatabase) {
  const exRows = await db.getAllAsync<{ id: number; name: string }>(
    "SELECT id, name FROM exercises"
  );
  const exByName = new Map(exRows.map((r) => [r.name, r.id]));

  const tplRows = await db.getAllAsync<{ id: number; name: string }>(
    "SELECT id, name FROM templates"
  );
  const tplByName = new Map(tplRows.map((r) => [r.name, r.id]));

  for (const session of HISTORY) {
    const templateId = tplByName.get(session.plan);
    if (!templateId) continue;

    const startedAt = session.date;
    const finishedAt = addMinutesToDatetime(startedAt, session.duration_min);

    const workout = await db.runAsync(
      `INSERT INTO workouts (started_at, finished_at, template_id, deadlift_mode)
       VALUES (?, ?, ?, ?)`,
      [startedAt, finishedAt, templateId, session.deadlift_mode ?? null]
    );

    const setNumByEx = new Map<number, number>();
    for (const s of session.sets) {
      const exId = exByName.get(s.exercise);
      if (exId === undefined) continue; // exercise not in DB (shouldn't happen)
      const n = (setNumByEx.get(exId) ?? 0) + 1;
      setNumByEx.set(exId, n);
      await db.runAsync(
        `INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [workout.lastInsertRowId, exId, n, s.reps, s.weight, finishedAt]
      );
    }
  }
}
