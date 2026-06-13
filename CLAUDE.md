# IronCast — Project Blueprint

**Last updated:** 2026-06-11

IronCast (renamed from IronLog on 2026-04-20; `IronLog` was already on the App
Store) is a React Native / Expo app for guided strength training. It alternates
the user through a strict two-workout split (A/B), auto-suggests weights based
on last performance, runs rest timers in the background, and logs every set.

This file is the single source of truth for project state. Update it whenever
scope, schema, or design decisions change.

**Internal identifiers that kept the old name** (intentional — changing would
lose the EAS project link, Apple credentials, or user workout data):
- Expo project slug: `ironlog`
- iOS bundle identifier: `com.karolmarcu.ironlog`
- URL scheme: `ironlog://`
- SQLite filename: `ironlog.db`
- Local working directory: `/Users/karolmarcu/Documents/ironlog`
- GitHub repo: `github.com/karolrockenue/ironcast` (repo name follows the new brand)

---

## 1. Tech stack

| Layer            | Choice                                               |
| ---------------- | ---------------------------------------------------- |
| Runtime          | Expo SDK 54, React Native 0.81.5, React 19           |
| Routing          | `expo-router` v6 (file-based)                        |
| Storage          | `expo-sqlite` v16, single local DB `ironlog.db`      |
| Background timer | `expo-notifications` (local, scheduled at end time)  |
| Haptics          | `expo-haptics`                                       |
| Charts           | `react-native-chart-kit` (unused after dashboard rebuild; left as dep) |
| SVG              | `react-native-svg` for rest timer ring, tab icons, PR badge |
| TypeScript       | strict mode enabled                                  |
| Icons / fonts    | System fonts only (Impact / sans-serif-condensed for splash, PR badge, progress hero) |
| iOS support      | iPhone only. `ios.supportsTablet: false` (disabled so we don't owe iPad screenshots) |
| Build / ship     | EAS Build + EAS Submit. `eas.json` uses `appVersionSource: remote`, production has `autoIncrement`. `.npmrc` has `legacy-peer-deps=true` (required — npm ci otherwise rejects @expo/metro-runtime's react-dom peer) |

No cloud sync, no account system, no telemetry. All data lives on-device.

---

## 2. Training philosophy (locked, don't drift)

- Two workout plans: **A** (push + quads) and **B** (pull + shoulders + biceps, plus deadlift).
- **Strict alternation** based on the last *completed* session — not calendar based. A completed → B next. B completed → A next. Doesn't matter if you trained yesterday or three weeks ago.
- **2 working sets** per exercise (the only exception: deadlift — see §4).
- **Set 1 = top working set.** Set 2 = back-off set (a *separate* set after full rest, weight = Set 1 × back-off ratio). The progression engine reads Set 1; Set 2 is informational. **NB — not to be confused with true drop sets** (added in 1.04, §10): those are within-set burnout stages done with *no rest*, stored in `set_drops` and hung off a single parent set. "Back-off Set 2" and "drop set" are different mechanisms.
- **Automatic weight progression.** Hit top of rep range → increase by the exercise's equipment increment next time. In range (not at top) → same weight, push for more reps. Below range → drop one increment.
- **Back-off ratio** on Set 2 is per-exercise (0.80 for Lat Pulldown, 0.90 standard, 1.00 for single-arm lateral raise and hanging leg raises).
- **Deadlift heavy/technique alternation REMOVED (2026-06-11, schema v11).** Deadlift is now a normal 2 × 3–5 exercise with standard progression and 0.90 back-off. The "NOT TODAY" skip covers light weeks. See §4.
- **Rest timer** is mandatory, prescribed per exercise, runs in the background, notifies on completion.

---

## 3. Pre-seeded workout plans

Both are 7 exercises. Values from Addendum 3 + 4.

### Workout A — Push + Quads
| # | Exercise | Sets × Reps | Rest | Increment | Back-off |
|---|----------|-------------|------|-----------|----------|
| 1 | Hack Squat (Machine)              | 2 × 5–8    | 3:00 | 2.5 kg | 0.90 |
| 2 | Bench Press (Smith Machine)       | 2 × 5–8    | 2:30 | 2.5 kg | 0.90 |
| 3 | Incline Bench Press (Dumbbell)    | 2 × 6–10   | 2:30 | 1 kg (per hand) | 0.90 |
| 4 | Leg Extension (Machine)           | 2 × 8–12   | 1:30 | 2.5 kg | 0.90 |
| 5 | Single Arm Cable Tricep Pushdown  | 2 × 8–12   | 1:15 | 2.5 kg | 0.90 |
| 6 | Single Arm Lateral Raise (Cable)  | 2 × 10–15  | 1:00 | 2.5 kg | **1.00 (straight)** |
| 7 | Hanging Leg Raises                | 2 × 8–15   | 1:15 | 0 (BW) | 1.00 |

### Workout B — Pull + Shoulders + Biceps
| # | Exercise | Sets × Reps | Rest | Increment | Back-off |
|---|----------|-------------|------|-----------|----------|
| 1 | Deadlift (Barbell)                | 2 × 3–5    | 3:00 | 2.5 kg | 0.90 |
| 2 | Shoulder Press (Machine Plates)   | 2 × 5–8    | 2:30 | 2.5 kg | 0.90 |
| 3 | Lat Pulldown (Cable)              | 2 × 5–8    | 2:30 | **5 kg** | **0.80** |
| 4 | Seated Row (Machine)              | 2 × 6–10   | 2:00 | 5 kg | 0.90 |
| 5 | Bicep Curl (Dumbbell)             | 2 × 8–12   | 1:15 | 1 kg (per hand) | 0.90 |
| 6 | Single Arm Lateral Raise (Cable)  | 2 × 10–15  | 1:00 | 2.5 kg | 1.00 |
| 7 | Hanging Leg Raises                | 2 × 8–15   | 1:15 | 0 (BW) | 1.00 |

---

## 4. Deadlift day variants — REMOVED (2026-06-11)

The heavy/technique alternation (Addendum 4) was removed in schema v11.
Deadlift is now a normal exercise: 2 × 3–5, standard progression, 0.90
back-off. Rationale: the "NOT TODAY" per-session skip already covers light
weeks, and the mode machinery complicated every screen.

What remains for history: `workouts.deadlift_mode` column (read-only legacy,
still in the CSV export), and the Apr 15 seed session's `heavy` tag. The v11
migration clears `special_rules = 'deadlift_ht'` → NULL on live installs;
`getNextDeadliftMode` / `getLastHeavyDeadliftWeight` /
`getTechniqueDeadliftWeight` and the `technique` progression direction were
deleted from `queries.ts`.

⚠️ One-time progression quirk: the engine reads the most recent finished Set 1
regardless of historical mode — if the last logged B was a 70 kg technique day,
the next suggestion starts from 70 kg and self-corrects as you lift.

---

## 5. Auto-progression logic

Applied to Set 1 of each exercise, using the **top set** (`set_number = 1`) of
the most recent finished session of that exercise.

```
reps ≥ rep_max           → increase weight by weight_increment
reps in [rep_min, rep_max) → same weight, aim for more reps
reps < rep_min           → reduce weight by weight_increment
weight_increment === 0   → reps-only progression (Hanging Leg Raises)
```

Implemented in `src/db/queries.ts → decideProgression()`.

Example transitions based on historical data (as of 2026-04-19):

| Exercise | Last set 1 | Next suggestion |
|----------|------------|-----------------|
| Hack Squat          | 15 × 7  | 15 kg, push for 8 |
| Bench Press (Smith) | 55 × 8  | 57.5 kg (hit top, +2.5) |
| Incline Bench DB    | 22 × 4  | 21 kg (below range, -1) |
| Leg Extension       | 73 × 11 | 73 kg, push for 12 |
| Tricep Pushdown     | 7.5 × 9 | 7.5 kg, push for 12 |
| Lateral Raise       | 30 × 6  | 27.5 kg (below range, -2.5) |
| Deadlift            | 95 × 4  | 95 kg, push for 5 (modes removed — standard rules) |
| Shoulder Press      | 80 × 5  | 80 kg, push for 8 |
| Lat Pulldown        | 60 × 4  | 55 kg (below range, -5) |
| Seated Row          | 60 × 8  | 60 kg, push for 10 |
| Bicep Curl DB       | 12 × 8  | 12 kg, push for 12 |

---

## 6. File layout

```
app/
  _layout.tsx              Stack + splash overlay + DB provider
  (tabs)/
    _layout.tsx            Bottom tabs (Workout / History / Progress)
    index.tsx              Home — V02 Journal feed (next-up + past sessions)
    history.tsx            List of past finished workouts
    progress.tsx           Stats dashboard (rebuilt): stats grid + all-time PRs + current weights
  templates/
    index.tsx              Template list (read-mostly "View Plan")
    [id].tsx               Template editor: exercise rows with sets / reps / rest / per-arm labels
  workout/
    active.tsx             Guided session screen — V7 layout, active/done/pending cards
    pick-exercise.tsx      Modal exercise picker (used by template editor)
    summary.tsx            End-of-session summary with PR types + next-deadlift preview

src/
  components/
    RestTimerOverlay.tsx   Full-screen rest timer (SVG ring, ±30 s, skip)
    PrCelebration.tsx      Fade/scale trophy overlay on PR during active workout
  db/
    provider.tsx           DBContext + initDB bootstrap
    queries.ts             All SQL, progression engine, PR detection, stats
    schema.ts              Tables + seed + bulk-insert history (SCHEMA_VERSION = 6)
  store/
    restTimer.ts           useRestTimer() — wall-clock-based, schedules local notification
    workout.ts             In-memory pubsub for the exercise picker modal
  theme/
    colors.ts              Palette (bg #0D0D0D, accent #4A90D9, success, warn, danger)

mockups/
  rep-input.html           15 rep-input concepts (picked V3 slider, later replaced)
  layout.html              10 session-layout variants → settled on V1 minimal
  themes.html              5 theme treatments → picked Brutalist Lime (theme 1)
  active-styles.html       6 slight variations + V7 combined (picked V7)
  app.html                 V7 mockup iteration
  home.html                5 home-screen variants → picked V02 Journal
  start.html               15 title-screen / splash variants → picked 06 Stacked Brutalist
```

---

## 7. Data model (SQLite schema v6)

```
exercises
  id, name (unique), category, movement_type, muscle_group,
  default_sets, default_rep_min, default_rep_max, default_rest_seconds,
  weight_increment, min_increment_kg, back_off_ratio,
  weight_display_mode ('total' | 'per_hand'), is_per_arm (0/1),
  special_rules ('deadlift_ht' | 'reps_only' | null)

workouts
  id, started_at, finished_at, notes, template_id,
  deadlift_mode ('heavy' | 'technique' | null)

sets
  id, workout_id, exercise_id, set_number, reps, weight, completed_at

templates
  id, name, created_at

template_exercises
  id, template_id, exercise_id, sort_order
```

`PRAGMA user_version` drives migrations. Current version: **11** (v11 clears
`special_rules = 'deadlift_ht'` → NULL; deadlift modes removed, see §4).

**Migrations are no longer always destructive (changed 2026-06-08).** v9 shipped
to the App Store, so `initDB` now branches: a fresh install (`user_version 0`)
or a legacy pre-launch dev version (`< 9`) still nuke-and-reseeds, but any
install at **v9+** runs an **additive** `migrateForward()` that only adds tables
(`CREATE TABLE IF NOT EXISTS`) and transforms rows in place — it never drops a
table holding user data. Bumping `SCHEMA_VERSION` for a schema change now means
adding an additive step to `migrateForward`, NOT relying on the reseed.

```
set_drops
  id, set_id (→ sets.id), drop_seq (1..n), weight, reps
```
Drop-set burnout stages hung off a parent set row (v10). The parent `sets` row
stays THE set and alone drives progression + PR detection; each `set_drops` row
is one reduced-weight stage done with no rest. Volume rollups (summary hero,
Progress total, CSV) add these; PR/progression deliberately ignore them. No FK
cascade reliance — `deleteSet`/`deleteWorkout` clear drops explicitly. Helpers:
`addDrop`, `deleteDrop`, `getDropsForWorkout`.

```
workout_skipped_exercises
  workout_id INTEGER, exercise_id INTEGER, PRIMARY KEY(workout_id, exercise_id)
```
Per-workout explicit skip state. Exercise states in the active screen:
`not_started | in_progress | completed | skipped`. Skipping is orthogonal to
sets — it doesn't delete logged rows, it just marks the exercise as
intentionally out. Helpers: `skipExercise`, `unskipExercise`,
`getSkippedForWorkout`, `bulkSkipExercises`.

```
user_settings
  key TEXT PRIMARY KEY, value TEXT NOT NULL
```
Simple key/value store for app preferences. Accessors live in `queries.ts`:
`getSetting` / `setSetting` (string) and `getBoolSetting` / `setBoolSetting`
(bool via "1"/"0"). Keys typed as `SettingKey`.

The exercise library is split into two arrays in `schema.ts`:
- `WORKOUT_A` / `WORKOUT_B` — the 11 exercises used by the seeded plans, with user-specific rep ranges.
- `CATALOG` — ~130 additional exercises (chest / back / shoulders / arms / legs / core / forearms) so users can build their own templates from the exercise picker. Plans win on name collision so A/B rep ranges are preserved.

---

## 8. Historical data (seeded at v6)

Two authoritative sessions, everything else dropped as not authoritative.

**Apr 18, 2026 — Workout A, 49 min**
- Hack Squat (Machine): 15×7, 15×6, 12.5×5
- Bench Press (Smith): 55×8, 50×5
- Incline Bench (DB): 22×4, 18×8
- Leg Extension: 73×11, 73×11
- Single Arm Cable Tricep Pushdown: 7.5×9, 7.5×7
- Hanging Leg Raises (mapped from "Leg Raise Parallel Bars"): 0×12, 0×8, 0×8

**Apr 15, 2026 — Workout B HEAVY, 48 min**
- Deadlift: 95×4
- Lat Pulldown (Cable): 60×4, 55×6, 50×7
- Bicep Curl (DB): 12×8, 12×6
- Shoulder Press (Machine Plates): 80×5, 75×5
- Single Arm Lateral Raise (Cable): 30×6, 25×10
- Seated Row (Machine): 60×8, 60×5, 50×7

Skipped from source data: Plank (time-based, not in plan), older sessions
(March 2026 etc.), old two-handed tricep pushdown (different exercise).

Derived state on first launch:
- **Next workout:** B
- (Deadlift modes removed 2026-06-11 — the seed session's `heavy` tag is legacy.)

---

## 9. Design decisions that are locked

- **Theme:** Brutalist Lime dropped in favor of the **existing dark + blue accent** palette (`colors.ts`). Splash uses the *Stacked Brutalist* layout (IRON / CAST two-toned) in the app's blue.
- **Splash:** renders as an *overlay* in `_layout.tsx`, not as a route. **Tap to dismiss — no auto-dismiss** (changed from 1.6 s auto on 2026-04-20; auto-dismiss felt rushed and hid the wordmark).
- **Active workout layout:** V7 — column headers (`SET · WEIGHT · REPS`), strong current-set highlight (1 px accent border + tint), inline last-session values directly under each stepper column.
- **No slider for rep input.** Too fiddly at phone scale. Numeric stepper (typed + ± buttons) with placeholder = last session's reps at that set number.
- **Live tint on reps input:** green (in range), blue (at/above top), yellow (below range), **red (regression vs last session)**. Red wins.
- **KG stepper is fixed 108 px width.** REPS stepper takes flex remainder. Avoids the conflicting `flex: 1` + `width` bug that collapsed the KG stepper.
- **Home: V02 Journal feed.** Reverse-chronological entries — in-progress banner (if any) → today/next-up with Start → past sessions. Deadlift mode + weight shown inline on the next-up card.
- **No per-arm tracking.** "Single Arm" exercises log as 2 sets normally; user handles both arms mentally.
- **Footer actions removed** from active workout. Auto-advance handles the "next exercise" flow when the current card's sets are all logged.
- **PR celebration:** No emoji. Renders a brutalist "PR" wordmark in an accent-bordered frame with an accent divider bar, `NEW WEIGHT/REPS/VOLUME RECORD` meta line, exercise name, value (`src/components/PrCelebration.tsx`). Matches splash aesthetic.
- **Tab bar:** Custom SVG icons (dumbbell / clock-arrow / bar-chart) via `react-native-svg`; stroke thickens when focused. Tab labels all-caps 11px with letter-spacing; header titles stay sentence-case (`tabBarLabel` separate from `title`).
- **Progress tab:** Accent-bordered hero panel with total-volume as the single big number (Impact face, accent). Below: 3-cell strip (Sessions · Time · This Week) with vertical dividers. `30d` count demoted to footnote. PRs + Current Weights rendered as real tables with column headers, hairline row dividers, tabular-nums, explicit units.
- **Templates header:** Back-button labels explicit — `Back` on `templates/index`, `Templates` on `templates/[id]`. Prevents the default `tabs` fallback label from parent stack.
- **App icon:** Chosen concept **"Plate Edge" variant B** — solid dark disc with a blue bar-hole on the accent background. Previous iterations (concentric rings, bullseye) rejected for looking like a target at small sizes. Geometry: `assets/icon.png` (1024×1024, no alpha) generated from the SVG in `mockups/app-icon.html`. Same image copied to `adaptive-icon.png` and `splash-icon.png`.

---

## 10. Implemented features (so far)

### Core loop
- [x] Home screen (Journal feed) with next-up + deadlift mode preview + past sessions
- [x] Start workout → active session → per-exercise guided cards
- [x] Set 1 / Set 2 per exercise with auto-calculated Set 2 back-off weight
- [x] Numeric stepper logging (type or step ±, live tint)
- [x] Log button per set, disabled until reps > 0
- [x] Active / Pending / Done card states with auto-advance on completion
- [x] Rest timer (wall-clock, schedules local notification, survives lock screen)
- [x] Rest timer full-screen overlay: big countdown, SVG progress ring, ±30 s, skip
- [x] End-of-session summary: hero stats + PRs + progression recap + next-deadlift preview
- [x] History tab listing all finished workouts

### Smart behaviour
- [x] Strict A/B alternation from last *finished* session's template
- [x] **Override alternation for today** — `⇄ Do Workout X instead` switch on the home next-up card swaps A↔B for the current session only. Per-visit (resets on tab focus), shows a "normally Workout Y" note when overriding. No persistence — alternation self-corrects from the next *finished* session.
- ~~Deadlift heavy/technique alternation~~ — REMOVED 2026-06-11 (schema v11, see §4)
- [x] Back-off Set 2 weight auto-recalculates after Set 1 is logged
- [x] Progression engine using Set 1 (top set), not last numerical set
- [x] Per-set `last · X kg` / `last · R` reference under each working set row
- [x] PR detection (weight / rep / volume) — runs mid-workout on Set 1, and post-workout for summary
- [x] **Mid-workout PR celebration overlay** — trophy + "NEW X PR" with exercise name and value, 1.6 s, then rest starts
- [x] Reps placeholder = last session's matching set's reps (not just "reps")
- [x] Red tint on reps stepper when reps < last session's same-set reps

### Dashboard (Progress tab) — redesigned 2026-04-20
- [x] Accent-bordered hero panel — total volume as the hero number (Impact face)
- [x] 3-cell strip under hero: Sessions · Time · This Week with vertical dividers
- [x] `30d` count as footnote below the strip
- [x] All-time PRs rendered as a proper table: columns `EXERCISE / WEIGHT / REPS / VOL`, hairline dividers, explicit units, `fmtVolume` for `t` suffix on large totals
- [x] Current Weights as a proper table: columns `EXERCISE / LAST SET`
- [x] Empty state — centered on screen (not dangling at bottom of empty scroll)

### Template building
- [x] Exercise picker sections grouped by muscle group, alphabetically sorted
- [x] Muscle-group chip filter row (horizontal scroll, "All" + per-group counts) combined with text search
- [x] ~140-exercise library covering chest, back (vertical / horizontal / hinge), shoulders, traps, biceps, triceps, quads, hamstrings, glutes, calves, core, forearms
- [x] Edit prescription from the template editor — tap an exercise's `SETS × REPS · Rest` line → modal with steppers for sets, rep range (min/max), and rest (±15 s). Writes to the **shared `exercises` row** (`updateExercisePrescription`), so the change applies to every plan using that exercise and the rep range feeds the progression engine. No schema change. Deadlift's set count is locked (auto heavy 1 / technique 2); only its reps + rest are editable.

### Set management (active session)
- [x] Long-press a logged set row → edit modal with weight + reps steppers (editing Set 1 auto-recalcs Set 2 back-off via existing `useEffect`)
- [x] Tap × on a logged row → single-tap delete; `renumberSetsForExercise` keeps `set_number` contiguous so Set 1 = top-set invariant holds for progression
- [x] Not exposed in history view — editing a *past* session would shift "last session" lookups and is deferred

### Drop sets (1.04)
- [x] **`⇊ DROP SET` affordance** under the last logged set of an exercise — appears on both the active card (`DropLadder` under the last logged set) and the done card. Tap it to start a burnout stage.
- [x] **Auto-fill at 75%** — each new drop pre-fills weight = previous stage × 0.75 rounded to the exercise increment (`roundToIncrement`); reps are typed (placeholder = previous stage's reps). Add multiple via `＋ ADD DROP`.
- [x] **No rest between drops** — opening the drop editor cancels any running rest (`onBeginDrop` → `rest.skip()`); logging the drop restarts it (`handleAddDrop` → `rest.start`). Matches how a drop set is performed.
- [x] **Parent set still owns progression + PRs** — drops live in `set_drops`, hung off the parent `sets` row by `set_id`; `decideProgression` / PR detection read the parent only and are untouched. Drops are **volume-only**.
- [x] **Volume rollups include drops** — summary hero `total_volume` + `total_reps`, Progress-tab total volume, and CSV export all add drop volume. Per-exercise volume used for the volume-PR comparison stays parent-only (consistent with the historical query, so drops never trigger a false PR).
- [x] **Rendered after the fact** — History detail shows the `↳ 10 kg × 11   7.5 kg × 9` ladder + a `DROP` badge; Summary shows `· +N drops` on the exercise line. CSV export gains a `drop` column (0 = top set, 1..n = drop stage).
- [x] Delete a logged drop with its `×`; `deleteSet`/`deleteWorkout` clear drops explicitly (no FK-cascade reliance). Mockup: `mockups/dropset.html`.

### Mid-workout template editing (added 2026-06-11)
- [x] **`＋ ADD EXERCISE` button** at the bottom of the active session list → opens the existing `pick-exercise` modal (workoutStore context `"workout"`) → `addExerciseToTemplate` → prescription reloads in place with last-session data for the new exercise. **Persistent template edit** — applies to future sessions too.
- [x] **`Remove from plan` option** in the "Not today?" dialog (alongside Cancel / Skip it) → `removeExerciseFromTemplate`. Already-logged sets stay in the DB/history; the card disappears from the session. The header sets counter excludes sets of removed exercises.
- [x] `addExerciseToTemplate` is now a no-op if the exercise is already in the template (active screen keys state by `exercise_id`, duplicates would corrupt it).

### Exercise navigation & skip (active session)
- [x] Tap any pending card to jump — `manualActiveId` state
- [x] **"NOT TODAY" button** on the active card (e.g. skip deadlift on a light week) — low-emphasis amber button sat below the set rows so it isn't fat-fingered, routed through the same "Not today?" confirm dialog (deliberate two-tap). Long-press on a pending/active card still skips too.
- [x] Skipped state is **amber/yellow** (`colors.warning`) — yellow-tinted card + border, struck-through name, "NOT TODAY" pill (was red/grey "SKIPPED")
- [x] Tap on a skipped card → "Bring back" confirm → unskip
- [x] `activeId` / `isIncomplete` exclude skipped exercises so auto-advance routes around them
- [x] Partial pending cards show `N/M sets done · resume` instead of the target range
- [x] Finish-anyway confirm — if any exercises are neither done nor skipped, Finish shows a list + "Skip & Finish" option that bulk-marks them skipped before saving

### Settings & data
- [x] Settings tab (gear icon, 4th tab) with Data / Legal / About sections
- [x] Export workout log (CSV) — `getAllSetsForExport` → one row per logged set across all finished workouts (`date,workout,deadlift_mode,exercise,set,weight_kg,reps,volume_kg,muscle_group,session_duration_min`), written to cache as `ironcast-log-{ISO}.csv` and handed to `expo-sharing`. Readable format for spreadsheets / handing to an LLM for analysis (the `.db` backup below is binary and not analysable)
- [x] Export backup — copies `ironlog.db` to cache as `ironcast-backup-{ISO}.db`, hands to `expo-sharing` for save to Files/iCloud
- [x] Privacy policy link opens external URL
- [ ] Apple Health write — requires dev build, deferred to 1.0.2
- [ ] Rest sound / vibration toggles — need wiring into `restTimer.ts`, deferred

### Identity
- [x] Splash screen: Stacked Brutalist IRON/CAST wordmark, accent bar, tagline. **Tap to dismiss** (no auto-dismiss)
- [x] Dark theme: #0D0D0D bg, #4A90D9 accent, #F5F5F5 text
- [x] Tab bar: SVG icons (dumbbell / clock-arrow / bar-chart) + all-caps labels, focus-state stroke weight
- [x] PR celebration: framed "PR" wordmark lockup (no emoji)
- [x] App icon: Plate Edge variant B (solid disc + bar hole, dark on accent)

---

## 11. Outstanding / not yet built

Reality-ordered. Tier 1 = real users will miss it; Tier 2 = feels like a real
tool; Tier 3 = nice; Skip = don't build.

### Tier 1 — should land in 1.0.1 / 1.0.2
- [ ] **Apple Health write** — `HKWorkout` (traditionalStrengthTraining) on session finish. Bridge that feeds Whoop / Strava / Oura / Fitbit / etc. automatically. Requires a **dev build** (`eas build --profile development --platform ios`); not Expo Go compatible. Target 1.0.2.
- [ ] **Onboarding flow** (first launch) — welcome, rest sound, vibration, notifications prompt, data review, "start first workout". Only blocked on deciding if it's actually needed (current app is close-enough discoverable).
- [ ] **Rest sound / vibration toggles** in Settings — need wiring into `restTimer.ts` (notification sound on/off, haptic on rest end). `user_settings` table already exists.
- [ ] **Edit / delete logged sets in history view** — history is an inline accordion; same modal as active should work. Caveat: editing past sessions shifts "last session" progression lookups — spec the warning UX before building.

### Tier 2 — makes it feel like a real tool
- [ ] **Bodyweight log** — single number per date. New `body_weights(date, kg)` table. Enables pull-up/chin-up/dip "added weight" semantics + future strength-to-weight stats.
- [ ] **Warm-up set flag** — real sessions include warm-ups before the working sets. Current "Set 1 = top set" rule assumes no warm-ups. Options: (a) toggle on a set row to exclude from PR/progression; (b) add "warm-up" state distinct from set 1.
- [ ] **Swap exercise mid-session** — Hack Squat machine occupied → tap the card → "Swap for today" → picker → substitutes for this workout only (template unchanged).
- [ ] **Per-session note** — one line saved to `workouts.notes` (column already exists). "Shoulder felt off." Surfaced in history detail.
- [ ] **Session-level actions on home:**
  - "Mark last session as completed" (creates a ghost session, flips alternation, no set data)
  - [x] **DONE (1.03):** "Do different workout" — `⇄ Do Workout X instead` switch on the next-up card overrides A/B alternation for the current session only.
- [ ] **"N days ago" context** on home's next-up ("You completed A last — 3 days ago")
- [ ] **Partial session resume cutoff:** if active session is >12 h old, prompt "Continue or finish?"

### Tier 3 — nice, defer
- [ ] Plate calculator on barbell-lift active cards (`60 kg = 20 bar + 15 + 5`)
- [ ] 1RM estimate (Epley) on summary / PR badge
- [ ] Trend charts in Progress tab (weight over time per exercise, volume over time, sessions/week bar)
- [ ] PR trophy badges in history list
- [ ] Streak tracking (consecutive weeks with ≥2 sessions) — explicitly skipped for now in favor of "this week / last 30d" counts
- [ ] Share a session (PR celebration specifically)
- [ ] Google Fonts upgrade — splash currently uses Platform system fonts (Impact / sans-serif-condensed); could install `@expo-google-fonts/anton` for exact Anton glyph

### Skip (bells-and-whistles — not building)
- Whoop / Garmin / Oura direct API integrations. Apple Health is the universal bus; these platforms import from Health.
- Metric ↔ imperial toggle. Touches progression math; wait for actual US requests.
- Streaks, Siri shortcuts, widgets, light mode, Apple Watch companion.
- Supabase / cloud sync — blueprint §14 covers future plan; local-first + backup export is v1.

### Known issues / gotchas
- Schema version **9** = nuke + reseed. Bump this when changing schema OR seeded history.
- Rest-timer local notification requires user permission grant; permission prompt appears on first workout.
- "62.5 kg" rendering bug is fixed (was caused by `flex: 1` on the stepper wrap conflicting with `width: 108`). Use `flex: 0` or just omit flex to pass width through.
- No per-arm DB tracking — single-arm exercises log as 2 sets; user does both arms mentally.

---

## 12. Mockup history (what was explored vs kept)

| File | Explored | Outcome |
|------|----------|---------|
| `rep-input.html` | 15 rep-entry concepts (sliders, dials, number lines, wheels) | Picked V3 slider, later replaced with stepper |
| `layout.html`    | 10 session-layout variants | Picked V1 "Minimal stacked" |
| `themes.html`    | 5 theme identities | Picked **Brutalist Lime** for explore, later aligned back to the default dark+blue palette |
| `active-styles.html` | 6 slight variations of V1 + V7 "combined" | Picked **V7** (column headers + strong current + inline last-session) |
| `app.html` | V7 iteration | Kept as reference |
| `home.html` | 5 home-screen variants | Picked **V02 Journal** |
| `start.html` | 15 start/title screens | Picked **06 Stacked Brutalist** (IRON / CAST after rebrand) |
| `app-icon.html` | 5 app-icon directions (Stacked Brutalist wordmark / IL Monogram / Dumbbell / A/B Split / Plate Edge) | Picked **05 Plate Edge**; final rendering uses "variant B" (solid disc + hole) not the concentric rings |
| `logo.html` | 5 logo lockups (stacked / horizontal / plate+wordmark / stamp / IC monogram) | Stacked Brutalist is the primary lockup (splash) |
| `appstore-screens.html` | 6 App Store screens at 1242×2688 (splash / home / active / rest / summary / progress) | Exported PNGs at `screenshots/*.png` via headless Chrome and used directly in App Store Connect. Render script: `render` shown in §16 |
| `dropset.html` | 3 phone screens for the 1.04 drop-set UX (convert a set → log the ladder → logged/collapsed + history) + data-model spec | Approved; shipped as the `DropLadder` UI. Note: final impl adds drops *after* logging the top set (persist-per-stage, auto rest mgmt) rather than the pre-log ladder shown in the mockup — same visual result |

---

## 13. Running & verifying

```
# from project root
npm start              # Expo dev server
# press `r` in Metro to reload after code changes
# SCHEMA_VERSION bumps auto-nuke + reseed on next app launch
npx tsc --noEmit       # type-check; expected EXIT: 0
```

When you touch schema, bump `SCHEMA_VERSION` in `src/db/schema.ts` so the DB
nukes itself on next launch and picks up the new seed.

If something shows stale text (e.g. "65 %" instead of "75 %"), it's the Metro
bundle cache — `r` reloads, `expo start -c` clears the cache. Source has been
verified to match spec.

---

## 14. To Do

- **Supabase (future):** add a backend when users start needing cross-device sync or account recovery. Local-first SQLite is fine for v1, but a lost/replaced phone currently means lost history. Plan: Supabase auth (Apple/Google) + Postgres mirror of the local schema, sync on write. Until then, consider shipping an "Export backup" button that dumps the SQLite file to Files/Drive.

---

## 15. Distribution / App Store status

**Current state (as of 2026-06-08):**
- **1.04 (build 15)** — BUILT + SUBMITTED via EAS 2026-06-08 (binary uploaded to
  ASC, processing). Ships **drop sets** + the
  **Reverse Machine Fly (Rear Delt)** rename + the **first additive
  (non-destructive) DB migration** (schema v10, `set_drops` table). It ALSO
  carries the 1.03 `⇄ Do Workout X instead` override, because those changes were
  still uncommitted in the working tree when 1.04 was built — so 1.04 bundles
  and supersedes 1.03. Bumped to 1.04 (not a new 1.03 build) to avoid colliding
  with the already-uploaded 1.03 build 14 in ASC. **Remaining manual ASC steps:**
  create the 1.04 version → "What's New" → attach the processed **build 15** →
  **Add for Review** (manual release). The Build picker stays empty until Apple
  finishes processing the upload; the export-compliance prompt on the version
  page is ASC boilerplate shown only while no build is attached — it
  auto-resolves once build 15 is attached (`ITSAppUsesNonExemptEncryption:
  false` is already in the binary). No encryption docs needed.
  - Drop sets: tap `⇊ DROP SET` under the last logged set of an exercise (works
    on the active card and the done card) → chain reduced-weight burnout stages,
    each auto-filled at 75% of the stage above. Rest is suppressed while a drop
    is open and restarts when it's logged. Parent set still drives
    progression/PRs; drops are volume-only. Rendered as a ladder in
    history/summary + a `drop` count; CSV export gains a `drop` column.
- **1.03 (build 14)** — superseded by 1.04 before reaching the store (its one
  feature, the workout override, is folded into 1.04). BUILT + SUBMITTED via EAS
  2026-05-28 (binary uploaded to ASC) but the manual ASC version record / Add
  for Review steps were never completed. Do not finish 1.03 separately — ship
  1.04 instead.
- **1.02 (build 13)** — RELEASED 2026-05-28. Was "Pending Developer Release";
  Karol clicked **Release This Version**, so it's propagating to the store and
  supersedes 1.01 (build 9). Ships the prior sprint: Settings tab (CSV
  workout-log export + .db backup), editable prescription in the template editor,
  "NOT TODAY" skip button + amber skipped state.
- **1.03 (build 14)** — BUILT + SUBMITTED via EAS 2026-05-28 (binary uploaded to
  App Store Connect). Ships the **"pick today's workout"** override: a one-tap
  `⇄ Do Workout X instead` switch on the home next-up card that overrides the A/B
  alternation for the current session only. No schema change — the override is
  in-memory and resets on tab focus, and alternation reads the last *finished*
  workout so doing A again today self-corrects the next suggestion back to B.
  **Remaining manual ASC steps:** create the 1.03 version (+ Version or Platform)
  → add "What's New" → attach the processed build 14 → **Add for Review**
  (manual release).
- **1.01 (build 9)** — previous live version, superseded by 1.02.

**Version-numbering scheme (IMPORTANT):** the store uses a two-segment decimal
scheme `1.0` → `1.01` → `1.02`, NOT semantic `1.0.x`. Apple compares versions as
integers per dot-segment, so `1.01` = [1,1]. A "1.0.2" = [1,0,2] is **LOWER** than
`1.01` and App Store Connect rejects it. **Always bump the last decimal: next after
1.02 is 1.03.** Set `version` in `app.json` to the bare `1.0N` string. (1.03 was
skipped on the store — see above — so the live progression is `1.02` → `1.04`.)

**Gotchas learned this session (don't repeat):**
- **Build 11 (1.0.1)** — built + submitted, failed with generic "Something went
  wrong" because 1.0.1 was already live with build 9 (can't add a binary to a
  released/locked version). Dead end.
- **Build 12 (1.0.2)** — built before the version-scheme issue was caught; "1.0.2"
  is un-shippable (lower than live 1.01). Orphaned in TestFlight, do not use.
- Build 13 (1.02) is the real one.

History: version 1.0 build 8 submitted to App Review 2026-04-20 (submission ID
`8e53c25f-9699-4825-8c70-e25221482331`), approved + released; superseded by 1.01.

### Accounts & identifiers
- Apple Developer Team: `APVDU2G428` (K S Marcu, Individual)
- Apple ID for submission: `karol.marcu@gmail.com`
- App Store Connect App ID: `6762591817`
- App Store Connect API Key: managed by EAS (`[Expo] EAS Submit 5oq_0ShOIl`, ID `X6B28L4R6T`)
- EAS owner account: `rockenue-app` (logged in as `karol@rockenue.com`)
- EAS project: `@rockenue-app/ironlog`, project ID `54d3806f-c390-4684-8cc2-10d368d6f8c4`
- iOS bundle ID: `com.karolmarcu.ironlog` (do not change — Apple won't let you)
- GitHub Pages landing + privacy policy: `https://karolrockenue.github.io/ironcast/` and `.../privacy.html` served from `docs/` folder on `main` branch

### App Store listing (version 1.0)
- Name: `IronCast`
- Subtitle: `Low Volume, High Intensity`
- Primary category: Health & Fitness
- Age rating: 4+
- Release mode: **Manually release this version** — after approval, sits at "Pending Developer Release" until the user clicks *Release This Version*
- Screenshots: 6 uploaded (6.5" iPhone slot). Rendered from `mockups/appstore-screens.html` via headless Chrome; sources in `screenshots/`
- iPad: not supported. If you want iPad, flip `ios.supportsTablet` back on and upload 13" iPad screenshots (2064×2752 or 2752×2064)
- Sign-in required for review: No
- Data Collection (App Privacy): `No, we do not collect data from this app` → "Data Not Collected" labels
- Export Compliance: `ITSAppUsesNonExemptEncryption: false` in `app.json` → review questionnaire auto-skips

### Submit commands (reference)
```
npx eas-cli@latest build --platform ios --profile production   # ~20 min
npx eas-cli@latest submit --platform ios --latest              # ~10 min to process
```
Build number auto-increments server-side (`appVersionSource: remote`). For an
update, bump `version` in `app.json` first (e.g. 1.0.0 → 1.0.1). After submit,
open App Store Connect → "+ Version or Platform" → create the new version number
→ add "What's New" → attach the freshly-processed build → **Add for Review**.

### Known-gotchas checklist for future submissions
- `.npmrc` must contain `legacy-peer-deps=true` — otherwise EAS's `npm ci` rejects `@expo/metro-runtime`'s `react-dom` peer dep and the build fails in *Install dependencies*
- Icon must be **1024×1024, no alpha** — generate with headless Chrome (see §16)
- If adding new screens / updating the app shell, regenerate `screenshots/*.png` from `mockups/appstore-screens.html` before re-submitting (especially if UI copy diverges — reviewers flag mismatched screenshots)

---

## 16. Asset generation

### App Store screenshots (1242×2688)

`mockups/appstore-screens.html` renders 6 mock screens at exact pixel dimensions
(inside a `.mock` div that is `1242 × 2688`; content is designed at `414 × 896`
logical points then `transform: scale(3)`). To export PNGs, use headless Chrome:

```bash
python3 <<'PY'
# Split mockups/appstore-screens.html into 6 single-screen files with shared
# CSS, then let Chrome headless render each at 1242×2688.
import re, pathlib
src = pathlib.Path('mockups/appstore-screens.html').read_text()
style = re.search(r'<style>([\s\S]*?)</style>', src).group(1)

def extract(s):
    out, pos = [], 0
    while True:
        m = re.search(r'<div class="mock" id="(screen-[a-z]+)">', s[pos:])
        if not m: break
        start, sid, i, depth = pos + m.start(), m.group(1), pos + m.end(), 1
        while depth > 0 and i < len(s):
            o, c = s.find('<div', i), s.find('</div>', i)
            if c == -1: break
            if o != -1 and o < c: depth += 1; i = o + 4
            else: depth -= 1; i = c + 6
        out.append((sid, s[start:i])); pos = i
    return out

tmpl = """<!doctype html><html><head><meta charset="utf-8"><style>
{style}
html,body{{margin:0!important;padding:0!important;background:#0D0D0D!important;width:1242px;height:2688px;overflow:hidden}}
.mock{{box-shadow:none!important}}</style></head><body>{body}</body></html>"""

out = pathlib.Path('/tmp/ironcast-shots'); out.mkdir(exist_ok=True)
for sid, blk in extract(src):
    (out / f'{sid}.html').write_text(tmpl.format(style=style, body=blk))
PY

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for s in splash home active rest summary progress; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1242,2688 \
    --virtual-time-budget=2000 \
    --screenshot="screenshots/$s.png" \
    "file:///tmp/ironcast-shots/screen-$s.html"
done
```

Critical flags: `--force-device-scale-factor=1` stops Retina doubling (otherwise
the PNG lands at 2484×5376 and App Store Connect rejects it). The div-depth
balancer in the Python is required — a naive non-greedy regex for the mock
block stops at the first nested `</div></div>` pair, which gives you an empty
home screen.

### App icon (1024×1024, no alpha)

The Plate Edge variant B icon is a 1024×1024 PNG with no alpha channel. Source
SVG:

```svg
<svg viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#4A90D9"/>
  <circle cx="50" cy="50" r="40" fill="#0D0D0D"/>
  <circle cx="50" cy="50" r="11" fill="#4A90D9"/>
</svg>
```

Render with headless Chrome into `assets/icon.png` (and copy to
`adaptive-icon.png` + `splash-icon.png`). Verify with
`sips -g hasAlpha assets/icon.png` — must report `hasAlpha: no`.

---

## 17. Next session — pick up here

The 2026-06-11 session (uncommitted, not yet built) shipped two changes for the
next store version (**1.05**):
1. **Deadlift heavy/technique removed** — schema v11 (additive: clears
   `special_rules='deadlift_ht'`), deadlift is a normal 2 × 3–5 exercise. All
   mode UI (home preview, active banners, summary next-deadlift, template-editor
   sets lock) deleted.
2. **Mid-workout template editing** — `＋ ADD EXERCISE` button on the active
   screen + `Remove from plan` in the "Not today?" dialog. Persistent template
   edits, history untouched.

Status of 1.04 (build 15): built + submitted via EAS 2026-06-08; **ASC version
record + "Add for Review" remain manual** (see §15). Apple Health is still the
next meaningful gap and is blocked only on doing a one-time dev build.

Verify on-device after the 1.04 update installs: real workout history is
**preserved** (additive migration, not a reseed) and the rear-delt rename
appears in the exercise library.

Pick one (see §11 for full list):

1. **Apple Health write.** Install `@kingstinct/react-native-healthkit`, add
   its Expo config plugin + `NSHealthShareUsageDescription` / write usage
   string in `app.json`, run `eas build --profile development --platform ios`
   once (~15 min first time), install the dev build on the phone, then from
   here it's ~50 lines: request write permission for `workoutType`, save an
   `HKWorkout` on `finishWorkout`. Blocks on dev-build step so Expo Go devs
   can't test it — ship in a future build.
2. **Per-session note + bodyweight.** Both tiny. `workouts.notes` column is
   already there — add an input to the summary screen. Bodyweight needs a
   new 2-column table. Together maybe 90 min.
3. **Swap exercise mid-session.** Scoped to this workout only. Requires a
   thin join table `workout_exercise_overrides(workout_id, original_exercise_id,
   substituted_exercise_id)` so the rest of the app (progression, history)
   can still see the swap for this session.
4. **Warm-up flag.** Touches progression math — spec first.

Onboarding is still probably unnecessary. Current app is close to usable-on-
first-launch. Skip until a real user hits a wall.
