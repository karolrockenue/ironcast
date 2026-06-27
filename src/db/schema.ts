import * as SQLite from "expo-sqlite";

// Schema version — bump and reseed on change.
// v2: deadlift_mode on workouts, special_rules on exercises, A/B plans.
// v3: bulk-insert historical session data to seed the progression engine.
// v4: back_off_ratio, min_increment_kg, weight_display_mode, is_per_arm.
// v5: replace history with 2 authoritative sessions (Apr 18 A, Apr 15 B).
// v6: drop Lat Pulldown from Apr 18 A — it was an orphan from the old plan
//     and was contaminating the B-plan "last session" lookup.
// v7: expand exercise catalog from 11 to ~140 so users can build their own
//     templates from a broad library (chest / back / shoulders / arms / legs
//     / core). WORKOUT_A and WORKOUT_B plans unchanged.
// v8: user_settings table (single-row key/value store for app prefs — rest
//     sound, vibration, health-write toggle, etc.).
// v9: workout_skipped_exercises table — per-workout explicit skip state so
//     exercise states are not_started | in_progress | completed | skipped.
//     Skipping is orthogonal to set data (doesn't delete existing sets).
// v10: set_drops table (drop-set stages hung off a parent set row) + rename
//     "Reverse Pec Deck" → "Reverse Machine Fly (Rear Delt)". FIRST schema
//     change shipped AFTER the app went live, so the migration is ADDITIVE
//     for live installs (v9+) — it preserves logged workouts instead of the
//     historical nuke-and-reseed (see initDB).
// v11: deadlift heavy/technique alternation removed — clear the 'deadlift_ht'
//     special rule so Deadlift progresses like any other exercise. The
//     workouts.deadlift_mode column stays as read-only history.
// v12: A/B → A/B/C 3-way split. Templates renamed by dominant muscle
//     ("Chest & Quads" / "Back & Hamstrings" / "Shoulders & Arms") and their
//     contents replaced; a third template is added. ADDITIVE for live installs:
//     template_exercises gains `sets` (per-plan set count, since the same
//     exercise can be 2 sets in one plan and 3 in another) and `is_drop_set`
//     (drives the yellow DROP SET pill — a reminder, not logged). Plank added
//     as the first time-based exercise (special_rules='timed', seconds stored
//     in the reps column). No workout/set data is dropped.
const SCHEMA_VERSION = 12;

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

// ─── Plan exercise definitions (the exercise ROWS) ───────
// These define the exercise rows for the movements used by the seeded plans;
// the plan structure itself (which exercise, how many sets, drop flag) lives in
// PLANS below. Kept as two arrays for historical continuity (WORKOUT_A also
// holds legacy rows like Incline Bench DB / Hanging Leg Raises that the seed
// history references but the new 3-way plans no longer use).
// Exercise names here are exactly what the app shows.
// weight_increment is aligned with min_increment_kg: the progression bump
// should match what the equipment actually allows. This also matches the
// user's real gym (Lat Pulldown / Seated Row stacks step by 5 kg).
const WORKOUT_A: ExerciseSeed[] = [
  { name: "Hack Squat (Machine)",              category: "legs",  movement_type: "Compound",  muscle_group: "Quads",     default_sets: 3, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Bench Press (Smith Machine)",       category: "push",  movement_type: "Compound",  muscle_group: "Chest",     default_sets: 3, default_rep_min: 6,  default_rep_max: 9,  default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Incline Bench Press (Dumbbell)",    category: "push",  movement_type: "Compound",  muscle_group: "Chest",     default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Leg Extension (Machine)",           category: "legs",  movement_type: "Isolation", muscle_group: "Quads",     default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Single Arm Cable Tricep Pushdown",  category: "push",  movement_type: "Isolation", muscle_group: "Triceps",   default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 75,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Single Arm Lateral Raise (Cable)",  category: "push",  movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 12, default_rest_seconds: 60,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Hanging Leg Raises",                category: "core",  movement_type: "Isolation", muscle_group: "Core",      default_sets: 2, default_rep_min: 8,  default_rep_max: 15, default_rest_seconds: 75,  weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
];

const WORKOUT_B: ExerciseSeed[] = [
  { name: "Deadlift (Barbell)",                category: "pull",  movement_type: "Compound",  muscle_group: "Back",      default_sets: 2, default_rep_min: 3,  default_rep_max: 5,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Shoulder Press (Machine Plates)",   category: "push",  movement_type: "Compound",  muscle_group: "Shoulders", default_sets: 3, default_rep_min: 6,  default_rep_max: 9,  default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Lat Pulldown (Cable)",              category: "pull",  movement_type: "Compound",  muscle_group: "Back",      default_sets: 3, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 5,   min_increment_kg: 5,   back_off_ratio: 0.80, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Seated Row (Machine)",              category: "pull",  movement_type: "Compound",  muscle_group: "Back",      default_sets: 3, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 5,   min_increment_kg: 5,   back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Bicep Curl (Dumbbell)",             category: "pull",  movement_type: "Isolation", muscle_group: "Biceps",    default_sets: 3, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 75,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Single Arm Lateral Raise (Cable)",  category: "push",  movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 12, default_rest_seconds: 60,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Hanging Leg Raises",                category: "core",  movement_type: "Isolation", muscle_group: "Core",      default_sets: 2, default_rep_min: 8,  default_rep_max: 15, default_rest_seconds: 75,  weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
];

// ─── Extended exercise catalog ────────────────────────────────
// Everything here is available in the exercise picker so users can build
// their own templates. Excludes the 11 exercises already in WORKOUT_A/B.
// Defaults follow the app's pattern: 2 working sets; compound heavy = 5–8
// reps / 150–180s rest / 2.5 kg; isolation = 8–12 reps / 75–90s; small
// isolation = 10–15 reps / 60s / 1 kg per hand. Bodyweight movements use
// `reps_only` and weight_increment 0.
const CATALOG: ExerciseSeed[] = [
  // ── Chest (push) ─────────────────────────────────────────────
  { name: "Bench Press (Barbell)",              category: "push", movement_type: "Compound",  muscle_group: "Chest", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Bench Press (Dumbbell)",             category: "push", movement_type: "Compound",  muscle_group: "Chest", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Incline Bench Press (Barbell)",      category: "push", movement_type: "Compound",  muscle_group: "Chest", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Incline Bench Press (Smith Machine)", category: "push", movement_type: "Compound", muscle_group: "Chest", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Decline Bench Press (Barbell)",      category: "push", movement_type: "Compound",  muscle_group: "Chest", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Decline Bench Press (Dumbbell)",     category: "push", movement_type: "Compound",  muscle_group: "Chest", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Chest Press (Machine)",              category: "push", movement_type: "Compound",  muscle_group: "Chest", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  // Flat Bench (Machine) added in v12. Note: the seeded "Chest & Quads" plan's
  // flat-bench slot deliberately uses the existing "Bench Press (Smith Machine)"
  // row (it carries the user's logged history) — this row is the standalone
  // machine-bench option for custom templates.
  { name: "Flat Bench (Machine)",               category: "push", movement_type: "Compound",  muscle_group: "Chest", default_sets: 3, default_rep_min: 6,  default_rep_max: 9,  default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Incline Chest Press (Machine)",      category: "push", movement_type: "Compound",  muscle_group: "Chest", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Dumbbell Fly (Flat)",                category: "push", movement_type: "Isolation", muscle_group: "Chest", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Dumbbell Fly (Incline)",             category: "push", movement_type: "Isolation", muscle_group: "Chest", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Cable Fly (Mid)",                    category: "push", movement_type: "Isolation", muscle_group: "Chest", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Cable Fly (High to Low)",            category: "push", movement_type: "Isolation", muscle_group: "Chest", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Cable Fly (Low to High)",            category: "push", movement_type: "Isolation", muscle_group: "Chest", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Pec Deck (Machine)",                 category: "push", movement_type: "Isolation", muscle_group: "Chest", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Dip (Chest)",                        category: "push", movement_type: "Compound",  muscle_group: "Chest", default_sets: 2, default_rep_min: 6,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },

  // ── Back — Vertical Pull ─────────────────────────────────────
  { name: "Pull-Up",                            category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 5,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Chin-Up",                            category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 5,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Neutral Grip Lat Pulldown (Cable)",  category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 5,   min_increment_kg: 5,   back_off_ratio: 0.80, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Wide Grip Lat Pulldown (Cable)",     category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 5,   min_increment_kg: 5,   back_off_ratio: 0.80, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Single Arm Lat Pulldown (Cable)",    category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Straight Arm Lat Pulldown (Cable)",  category: "pull", movement_type: "Isolation", muscle_group: "Back", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },

  // ── Back — Horizontal Pull ───────────────────────────────────
  { name: "Bent-Over Row (Barbell)",            category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Pendlay Row (Barbell)",              category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "T-Bar Row",                          category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Seated Cable Row",                   category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Chest-Supported Row (Machine)",      category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Single Arm Dumbbell Row",            category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: true,  special_rules: null },
  { name: "Meadows Row",                        category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Inverted Row",                       category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 8,  default_rep_max: 15, default_rest_seconds: 90,  weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
  { name: "Face Pull (Cable)",                  category: "pull", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 12, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Reverse Machine Fly (Rear Delt)",    category: "pull", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Bent-Over Rear Delt Fly (Dumbbell)", category: "pull", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Cable Rear Delt Fly",                category: "pull", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },

  // ── Back — Hinge / Posterior Chain ───────────────────────────
  { name: "Romanian Deadlift (Barbell)",        category: "pull", movement_type: "Compound",  muscle_group: "Hamstrings", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Romanian Deadlift (Dumbbell)",       category: "pull", movement_type: "Compound",  muscle_group: "Hamstrings", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Stiff Leg Deadlift (Barbell)",       category: "pull", movement_type: "Compound",  muscle_group: "Hamstrings", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Sumo Deadlift (Barbell)",            category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 3,  default_rep_max: 5,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Trap Bar Deadlift",                  category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Rack Pull",                          category: "pull", movement_type: "Compound",  muscle_group: "Back", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Good Morning (Barbell)",             category: "pull", movement_type: "Compound",  muscle_group: "Hamstrings", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Back Extension",                     category: "pull", movement_type: "Isolation", muscle_group: "Hamstrings", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Reverse Hyperextension",             category: "pull", movement_type: "Isolation", muscle_group: "Glutes", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Cable Pull-Through",                 category: "pull", movement_type: "Compound",  muscle_group: "Glutes", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Hip Thrust (Barbell)",               category: "pull", movement_type: "Compound",  muscle_group: "Glutes", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Hip Thrust (Machine)",               category: "pull", movement_type: "Compound",  muscle_group: "Glutes", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Glute Bridge (Barbell)",             category: "pull", movement_type: "Compound",  muscle_group: "Glutes", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Kettlebell Swing",                   category: "pull", movement_type: "Compound",  muscle_group: "Glutes", default_sets: 2, default_rep_min: 10, default_rep_max: 20, default_rest_seconds: 60,  weight_increment: 2,   min_increment_kg: 2,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: null },

  // ── Shoulders ────────────────────────────────────────────────
  { name: "Overhead Press (Barbell)",           category: "push", movement_type: "Compound",  muscle_group: "Shoulders", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Overhead Press (Dumbbell)",          category: "push", movement_type: "Compound",  muscle_group: "Shoulders", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 120, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Shoulder Press (Machine Selectorized)", category: "push", movement_type: "Compound", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 6, default_rep_max: 10, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Arnold Press (Dumbbell)",            category: "push", movement_type: "Compound",  muscle_group: "Shoulders", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Push Press (Barbell)",               category: "push", movement_type: "Compound",  muscle_group: "Shoulders", default_sets: 2, default_rep_min: 3,  default_rep_max: 6,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Behind-the-Neck Press (Barbell)",    category: "push", movement_type: "Compound",  muscle_group: "Shoulders", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Landmine Press",                     category: "push", movement_type: "Compound",  muscle_group: "Shoulders", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Lateral Raise (Dumbbell)",           category: "push", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Lateral Raise (Machine)",            category: "push", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Lateral Raise (Cable, Two Arms)",    category: "push", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Single Arm Lateral Raise (Dumbbell)", category: "push", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 1.00, weight_display_mode: "per_hand", is_per_arm: true, special_rules: null },
  { name: "Front Raise (Dumbbell)",             category: "push", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Front Raise (Barbell)",              category: "push", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Front Raise (Cable)",                category: "push", movement_type: "Isolation", muscle_group: "Shoulders", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Upright Row (Barbell)",              category: "push", movement_type: "Compound",  muscle_group: "Shoulders", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Upright Row (Cable)",                category: "push", movement_type: "Compound",  muscle_group: "Shoulders", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },

  // ── Traps ────────────────────────────────────────────────────
  { name: "Shrug (Barbell)",                    category: "pull", movement_type: "Isolation", muscle_group: "Traps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Shrug (Dumbbell)",                   category: "pull", movement_type: "Isolation", muscle_group: "Traps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Shrug (Machine)",                    category: "pull", movement_type: "Isolation", muscle_group: "Traps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Cable Shrug",                        category: "pull", movement_type: "Isolation", muscle_group: "Traps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },

  // ── Biceps ───────────────────────────────────────────────────
  { name: "Bicep Curl (Barbell)",               category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Bicep Curl (EZ-Bar)",                category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Bicep Curl (Cable)",                 category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Hammer Curl (Dumbbell)",             category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Hammer Curl (Cable Rope)",           category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Incline Dumbbell Curl",              category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Preacher Curl (Barbell)",            category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Preacher Curl (EZ-Bar)",             category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Preacher Curl (Machine)",            category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Preacher Curl (Dumbbell)",           category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Spider Curl (Dumbbell)",             category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Concentration Curl (Dumbbell)",      category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: true, special_rules: null },
  { name: "Reverse Curl (EZ-Bar)",              category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Cable Single Arm Curl",              category: "pull", movement_type: "Isolation", muscle_group: "Biceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },

  // ── Triceps ──────────────────────────────────────────────────
  { name: "Close-Grip Bench Press",             category: "push", movement_type: "Compound",  muscle_group: "Triceps", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Skullcrusher (Barbell)",             category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Skullcrusher (EZ-Bar)",              category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Skullcrusher (Dumbbell)",            category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Overhead Tricep Extension (Dumbbell)", category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Overhead Tricep Extension (Cable Rope)", category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Overhead Tricep Extension (EZ-Bar)", category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Tricep Pushdown (Cable Bar)",        category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Tricep Pushdown (Cable Rope)",       category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Reverse Grip Tricep Pushdown (Cable)", category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Dip (Triceps)",                      category: "push", movement_type: "Compound",  muscle_group: "Triceps", default_sets: 2, default_rep_min: 6,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Bench Dip",                          category: "push", movement_type: "Compound",  muscle_group: "Triceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
  { name: "Kickback (Dumbbell)",                category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Kickback (Cable)",                   category: "push", movement_type: "Isolation", muscle_group: "Triceps", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Tricep Dip (Machine)",               category: "push", movement_type: "Compound",  muscle_group: "Triceps", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },

  // ── Quads ────────────────────────────────────────────────────
  { name: "Back Squat (Barbell)",               category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Front Squat (Barbell)",              category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "High-Bar Squat (Barbell)",           category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Low-Bar Squat (Barbell)",            category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Safety Bar Squat",                   category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 5,  default_rep_max: 8,  default_rest_seconds: 180, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Smith Machine Squat",                category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Goblet Squat (Dumbbell)",            category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Goblet Squat (Kettlebell)",          category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 2,   min_increment_kg: 2,   back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Bulgarian Split Squat (Dumbbell)",   category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: true,  special_rules: null },
  { name: "Bulgarian Split Squat (Barbell)",    category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 120, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Leg Press (Horizontal)",             category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 5,   min_increment_kg: 5,   back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Leg Press (45°)",                    category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 5,   min_increment_kg: 5,   back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "V-Squat (Machine)",                  category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Pendulum Squat",                     category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 6,  default_rep_max: 10, default_rest_seconds: 150, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Single Leg Leg Extension",           category: "legs", movement_type: "Isolation", muscle_group: "Quads", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 75,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Sissy Squat",                        category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 8,  default_rep_max: 15, default_rest_seconds: 90,  weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
  { name: "Step-Up (Dumbbell)",                 category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: true,  special_rules: null },
  { name: "Lunge (Dumbbell)",                   category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Walking Lunge (Barbell)",            category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Reverse Lunge (Dumbbell)",           category: "legs", movement_type: "Compound",  muscle_group: "Quads", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },

  // ── Hamstrings ───────────────────────────────────────────────
  { name: "Leg Curl (Lying Machine)",           category: "legs", movement_type: "Isolation", muscle_group: "Hamstrings", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Leg Curl (Seated Machine)",          category: "legs", movement_type: "Isolation", muscle_group: "Hamstrings", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 90,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Single Leg Curl (Machine)",          category: "legs", movement_type: "Isolation", muscle_group: "Hamstrings", default_sets: 2, default_rep_min: 8,  default_rep_max: 12, default_rest_seconds: 75,  weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Nordic Curl",                        category: "legs", movement_type: "Isolation", muscle_group: "Hamstrings", default_sets: 2, default_rep_min: 5,  default_rep_max: 10, default_rest_seconds: 120, weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
  { name: "Glute-Ham Raise",                    category: "legs", movement_type: "Isolation", muscle_group: "Hamstrings", default_sets: 2, default_rep_min: 6,  default_rep_max: 12, default_rest_seconds: 120, weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },

  // ── Glutes / Adductors ───────────────────────────────────────
  { name: "Glute Kickback (Cable)",             category: "legs", movement_type: "Isolation", muscle_group: "Glutes", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Glute Kickback (Machine)",           category: "legs", movement_type: "Isolation", muscle_group: "Glutes", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Abductor (Machine)",                 category: "legs", movement_type: "Isolation", muscle_group: "Glutes", default_sets: 2, default_rep_min: 12, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Adductor (Machine)",                 category: "legs", movement_type: "Isolation", muscle_group: "Glutes", default_sets: 2, default_rep_min: 12, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Cable Abductor",                     category: "legs", movement_type: "Isolation", muscle_group: "Glutes", default_sets: 2, default_rep_min: 12, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },

  // ── Calves ───────────────────────────────────────────────────
  { name: "Standing Calf Raise (Machine)",      category: "legs", movement_type: "Isolation", muscle_group: "Calves", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Seated Calf Raise (Machine)",        category: "legs", movement_type: "Isolation", muscle_group: "Calves", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Standing Calf Raise (Smith Machine)", category: "legs", movement_type: "Isolation", muscle_group: "Calves", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Calf Raise (Leg Press)",             category: "legs", movement_type: "Isolation", muscle_group: "Calves", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 5,   min_increment_kg: 5,   back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Donkey Calf Raise",                  category: "legs", movement_type: "Isolation", muscle_group: "Calves", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 75, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Single Leg Standing Calf Raise (Dumbbell)", category: "legs", movement_type: "Isolation", muscle_group: "Calves", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 1, min_increment_kg: 1, back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: true, special_rules: null },

  // ── Core ─────────────────────────────────────────────────────
  { name: "Hanging Knee Raise",                 category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 8,  default_rep_max: 15, default_rest_seconds: 60, weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
  { name: "Captain's Chair Leg Raise",          category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 8,  default_rep_max: 15, default_rest_seconds: 60, weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
  { name: "Ab Crunch (Machine)",                category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Cable Crunch",                       category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Sit-Up",                             category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 10, default_rep_max: 20, default_rest_seconds: 60, weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
  { name: "Decline Sit-Up",                     category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
  { name: "Russian Twist (Dumbbell)",           category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 10, default_rep_max: 20, default_rest_seconds: 60, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Woodchopper (Cable)",                category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Pallof Press (Cable)",               category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 10, default_rep_max: 12, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  { name: "Side Bend (Dumbbell or Cable)",      category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 2.5, min_increment_kg: 2.5, back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: true,  special_rules: null },
  // Plank — first time-based exercise. special_rules 'timed': the active screen
  // shows a count-up timer and stores the held duration (seconds) in the reps
  // column; weight is 0. Progression aims for more seconds.
  { name: "Plank",                              category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 30, default_rep_max: 60, default_rest_seconds: 60, weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "timed" },
  { name: "Dragon Flag",                        category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 5,  default_rep_max: 10, default_rest_seconds: 120, weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
  { name: "Ab Wheel Rollout",                   category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 5,  default_rep_max: 15, default_rest_seconds: 90,  weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },
  { name: "Oblique Crunch",                     category: "core", movement_type: "Isolation", muscle_group: "Core", default_sets: 2, default_rep_min: 10, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 0,   min_increment_kg: 0,   back_off_ratio: 1.00, weight_display_mode: "total",    is_per_arm: false, special_rules: "reps_only" },

  // ── Forearms ─────────────────────────────────────────────────
  { name: "Wrist Curl (Barbell)",               category: "pull", movement_type: "Isolation", muscle_group: "Forearms", default_sets: 2, default_rep_min: 12, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Wrist Curl (Dumbbell)",              category: "pull", movement_type: "Isolation", muscle_group: "Forearms", default_sets: 2, default_rep_min: 12, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
  { name: "Reverse Wrist Curl (Barbell)",       category: "pull", movement_type: "Isolation", muscle_group: "Forearms", default_sets: 2, default_rep_min: 12, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "total",    is_per_arm: false, special_rules: null },
  { name: "Reverse Wrist Curl (Dumbbell)",      category: "pull", movement_type: "Isolation", muscle_group: "Forearms", default_sets: 2, default_rep_min: 12, default_rep_max: 15, default_rest_seconds: 60, weight_increment: 1,   min_increment_kg: 1,   back_off_ratio: 0.90, weight_display_mode: "per_hand", is_per_arm: false, special_rules: null },
];

// ─── The 3-way split (v12) ───────────────────────────────────
// Templates are titled by dominant muscle. Each entry references an exercise by
// name (defined in WORKOUT_A/WORKOUT_B/CATALOG above) plus per-plan overrides:
//   sets        — working-set count for THIS plan (the same exercise can be 2
//                 sets in one plan and 3 in another)
//   is_drop_set — show the yellow DROP SET pill on the last working set
// NB: "Chest & Quads" intentionally uses "Bench Press (Smith Machine)" for its
// flat-bench slot because that row carries the user's logged history.
type PlanItem = { name: string; sets: number; is_drop_set?: boolean };
type Plan = { name: string; items: PlanItem[] };

const PLANS: Plan[] = [
  {
    name: "Chest & Quads",
    items: [
      { name: "Hack Squat (Machine)", sets: 3 },
      { name: "Leg Extension (Machine)", sets: 2, is_drop_set: true },
      { name: "Bench Press (Smith Machine)", sets: 3 },
      { name: "Incline Chest Press (Machine)", sets: 2 },
      { name: "Single Arm Cable Tricep Pushdown", sets: 2, is_drop_set: true },
      { name: "Single Arm Lateral Raise (Cable)", sets: 2, is_drop_set: true },
      { name: "Cable Crunch", sets: 2 },
      { name: "Pallof Press (Cable)", sets: 2 },
    ],
  },
  {
    name: "Back & Hamstrings",
    items: [
      { name: "Deadlift (Barbell)", sets: 2 },
      { name: "Glute Bridge (Barbell)", sets: 3 },
      { name: "Leg Curl (Seated Machine)", sets: 3, is_drop_set: true },
      { name: "Lat Pulldown (Cable)", sets: 3 },
      { name: "Seated Row (Machine)", sets: 3 },
      { name: "Bicep Curl (Dumbbell)", sets: 3, is_drop_set: true },
      { name: "Side Bend (Dumbbell or Cable)", sets: 2 },
      { name: "Cable Crunch", sets: 2 },
      { name: "Plank", sets: 2 },
    ],
  },
  {
    name: "Shoulders & Arms",
    items: [
      { name: "Shoulder Press (Machine Plates)", sets: 3 },
      { name: "Incline Chest Press (Machine)", sets: 2 },
      { name: "Single Arm Lateral Raise (Cable)", sets: 3, is_drop_set: true },
      { name: "Overhead Tricep Extension (Cable Rope)", sets: 2, is_drop_set: true },
      { name: "Bicep Curl (Dumbbell)", sets: 2, is_drop_set: true },
      { name: "Back Extension", sets: 2 },
      { name: "Side Bend (Dumbbell or Cable)", sets: 2 },
      { name: "Cable Crunch", sets: 2 },
      { name: "Pallof Press (Cable)", sets: 2 },
    ],
  },
];

// Ordered plan names — the rotation cycle and the A/B/C letters derive from
// this. Kept in sync with PLANS; also exported for the rotation engine.
export const PLAN_NAMES = PLANS.map((p) => p.name);

// Merged exercise library, de-duped by name (plans/WORKOUT win over CATALOG so
// the user-specific rep ranges survive). Single source of truth for both the
// fresh-install seed and the live-install upsert.
function mergedExerciseSeeds(): Map<string, ExerciseSeed> {
  const byName = new Map<string, ExerciseSeed>();
  for (const e of [...WORKOUT_A, ...WORKOUT_B, ...CATALOG]) {
    if (!byName.has(e.name)) byName.set(e.name, e);
  }
  return byName;
}

export async function initDB(db: SQLite.SQLiteDatabase) {
  const { user_version: current = 0 } =
    (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version")) ??
    { user_version: 0 };

  if (current === SCHEMA_VERSION) {
    // Same version — ensure tables exist (idempotent) for first-launch paths.
    await createSchema(db);
    return;
  }

  if (current >= 9 && current < SCHEMA_VERSION) {
    // LIVE-USER PATH. v9 is the version that shipped to the App Store, so any
    // install at v9+ may hold real, irreplaceable workout history. Migrate
    // forward in place — never drop user tables.
    await createSchema(db); // CREATE TABLE IF NOT EXISTS adds new tables only
    await migrateForward(db, current);
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return;
  }

  // Fresh install (current === 0) or a legacy pre-launch dev version (< 9):
  // safe to nuke and rebuild from seed.
  await db.execAsync(`
    DROP TABLE IF EXISTS set_drops;
    DROP TABLE IF EXISTS sets;
    DROP TABLE IF EXISTS workouts;
    DROP TABLE IF EXISTS template_exercises;
    DROP TABLE IF EXISTS templates;
    DROP TABLE IF EXISTS exercises;
    DROP TABLE IF EXISTS user_settings;
    DROP TABLE IF EXISTS workout_skipped_exercises;
  `);
  await createSchema(db);
  await seedExercisesAndPlans(db);
  await seedHistory(db);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

// Additive, non-destructive migrations for live installs. Each step only adds
// tables (via createSchema's IF NOT EXISTS) or transforms existing rows in
// place — it must never DROP a table that can hold user data.
async function migrateForward(db: SQLite.SQLiteDatabase, from: number) {
  if (from < 10) {
    // v10: set_drops table is created by createSchema(). Rename the rear-delt
    // machine fly so existing libraries pick up the clearer name. Rename is by
    // name; templates/sets reference the row by id, so they are unaffected.
    await db.runAsync(
      "UPDATE exercises SET name = ? WHERE name = ?",
      ["Reverse Machine Fly (Rear Delt)", "Reverse Pec Deck"]
    );
  }
  if (from < 11) {
    // v11: heavy/technique deadlift alternation removed. Clearing the rule
    // makes Deadlift a normal exercise (2 sets, standard progression).
    await db.runAsync(
      "UPDATE exercises SET special_rules = NULL WHERE special_rules = 'deadlift_ht'"
    );
  }
  if (from < 12) {
    // v12: A/B → A/B/C split. ADDITIVE — workouts and sets are never touched.
    // template_exercises holds plan structure only, so rebuilding it preserves
    // all logged history; progression reads last Set 1 by exercise_id, so the
    // carried exercises keep continuity automatically.

    // 1. Per-plan columns on template_exercises (createSchema's IF NOT EXISTS
    //    won't alter an existing table, so add them explicitly).
    await addColumnIfMissing(db, "template_exercises", "sets", "INTEGER");
    await addColumnIfMissing(
      db,
      "template_exercises",
      "is_drop_set",
      "INTEGER NOT NULL DEFAULT 0"
    );

    // 2. Ensure every exercise the new plans need exists, and refresh the
    //    prescription fields of carried exercises to the new plan values.
    //    default_sets is intentionally left untouched (per-plan set count now
    //    lives in template_exercises.sets).
    const seeds = mergedExerciseSeeds();
    const neededNames = new Set([
      ...PLANS.flatMap((p) => p.items.map((i) => i.name)),
      "Flat Bench (Machine)", // standalone catalog addition (not in any plan)
    ]);
    for (const name of neededNames) {
      const e = seeds.get(name);
      if (!e) continue;
      await db.runAsync(
        `INSERT OR IGNORE INTO exercises
          (name, category, movement_type, muscle_group, default_sets,
           default_rep_min, default_rep_max, default_rest_seconds,
           weight_increment, min_increment_kg, back_off_ratio,
           weight_display_mode, is_per_arm, special_rules)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.name, e.category, e.movement_type, e.muscle_group, e.default_sets,
          e.default_rep_min, e.default_rep_max, e.default_rest_seconds,
          e.weight_increment, e.min_increment_kg, e.back_off_ratio,
          e.weight_display_mode, e.is_per_arm ? 1 : 0, e.special_rules,
        ]
      );
      await db.runAsync(
        `UPDATE exercises SET
           default_rep_min = ?, default_rep_max = ?, default_rest_seconds = ?,
           weight_increment = ?, min_increment_kg = ?, back_off_ratio = ?,
           weight_display_mode = ?, is_per_arm = ?, special_rules = ?
         WHERE name = ?`,
        [
          e.default_rep_min, e.default_rep_max, e.default_rest_seconds,
          e.weight_increment, e.min_increment_kg, e.back_off_ratio,
          e.weight_display_mode, e.is_per_arm ? 1 : 0, e.special_rules, e.name,
        ]
      );
    }

    // 3. Rename the two old templates in place (keeps template_id, so finished
    //    workouts keep their linkage), then rebuild all three plans' contents.
    await db.runAsync("UPDATE templates SET name = ? WHERE name = ?", [
      "Chest & Quads",
      "Workout A",
    ]);
    await db.runAsync("UPDATE templates SET name = ? WHERE name = ?", [
      "Back & Hamstrings",
      "Workout B",
    ]);

    const exRows = await db.getAllAsync<{ id: number; name: string }>(
      "SELECT id, name FROM exercises"
    );
    const idsByName = new Map(exRows.map((r) => [r.name, r.id]));

    for (const plan of PLANS) {
      let t = await db.getFirstAsync<{ id: number }>(
        "SELECT id FROM templates WHERE name = ?",
        [plan.name]
      );
      if (!t) {
        const r = await db.runAsync("INSERT INTO templates (name) VALUES (?)", [
          plan.name,
        ]);
        t = { id: r.lastInsertRowId };
      }
      await db.runAsync(
        "DELETE FROM template_exercises WHERE template_id = ?",
        [t.id]
      );
      await seedTemplateItems(db, t.id, plan.items, idsByName);
    }
  }
}

// Add a column only if it doesn't already exist (SQLite ALTER TABLE ADD COLUMN
// throws on a duplicate). Used by additive migrations.
async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  decl: string
) {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`
  );
  if (cols.some((c) => c.name === column)) return;
  await db.runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
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
      -- Per-plan overrides (v12). 'sets' is the working-set count for THIS plan
      -- (NULL falls back to exercises.default_sets); the same exercise can be
      -- 2 sets in one plan and 3 in another. 'is_drop_set' flags the exercise
      -- to show the yellow DROP SET pill (a reminder; drops are not logged).
      sets INTEGER,
      is_drop_set INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workout_skipped_exercises (
      workout_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      PRIMARY KEY (workout_id, exercise_id),
      FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    );

    -- Drop-set stages hung off a parent set row. The parent row in sets
    -- remains THE set (drives progression + PRs); each set_drops row is one
    -- reduced-weight burnout stage performed with no rest, drop_seq 1..n.
    -- Volume rollups add these; PR/progression logic deliberately ignores them.
    CREATE TABLE IF NOT EXISTS set_drops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id INTEGER NOT NULL,
      drop_seq INTEGER NOT NULL,
      weight REAL NOT NULL,
      reps INTEGER NOT NULL,
      FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_set_drops_set ON set_drops(set_id);
  `);
}

async function seedExercisesAndPlans(db: SQLite.SQLiteDatabase) {
  const byName = mergedExerciseSeeds();

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

  for (const plan of PLANS) {
    const t = await db.runAsync("INSERT INTO templates (name) VALUES (?)", [
      plan.name,
    ]);
    await seedTemplateItems(db, t.lastInsertRowId, plan.items, idsByName);
  }
}

// Insert a plan's exercises into template_exercises with per-plan sets + drop
// flag. Shared by the fresh-install seed and the live-install v12 migration.
async function seedTemplateItems(
  db: SQLite.SQLiteDatabase,
  templateId: number,
  items: PlanItem[],
  idsByName: Map<string, number>
) {
  for (let i = 0; i < items.length; i++) {
    const exId = idsByName.get(items[i].name);
    if (exId === undefined) continue;
    await db.runAsync(
      `INSERT INTO template_exercises
         (template_id, exercise_id, sort_order, sets, is_drop_set)
       VALUES (?, ?, ?, ?, ?)`,
      [templateId, exId, i, items[i].sets, items[i].is_drop_set ? 1 : 0]
    );
  }
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
// The Apr 15 B deadlift keeps its historical 'heavy' tag (read-only legacy).
type HistoricalSession = {
  date: string;            // "YYYY-MM-DD HH:MM:SS" (UTC)
  duration_min: number;
  plan: "Chest & Quads" | "Back & Hamstrings";
  deadlift_mode?: "heavy" | "technique";
  sets: { exercise: string; weight: number; reps: number }[];
};

const HISTORY: HistoricalSession[] = [
  {
    date: "2026-04-18 18:00:00",
    duration_min: 49,
    plan: "Chest & Quads",
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
    plan: "Back & Hamstrings",
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
