# IronLog — Project Blueprint

**Last updated:** 2026-04-19

IronLog is a React Native / Expo app for guided strength training. It alternates
the user through a strict two-workout split (A/B), auto-suggests weights based
on last performance, runs rest timers in the background, and logs every set.

This file is the single source of truth for project state. Update it whenever
scope, schema, or design decisions change.

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
| SVG              | `react-native-svg` for rest timer ring               |
| TypeScript       | strict mode enabled                                  |
| Icons / fonts    | System fonts only (Impact / sans-serif-condensed for splash) |

No cloud sync, no account system, no telemetry. All data lives on-device.

---

## 2. Training philosophy (locked, don't drift)

- Two workout plans: **A** (push + quads) and **B** (pull + shoulders + biceps, plus deadlift).
- **Strict alternation** based on the last *completed* session — not calendar based. A completed → B next. B completed → A next. Doesn't matter if you trained yesterday or three weeks ago.
- **2 working sets** per exercise (the only exception: deadlift — see §4).
- **Set 1 = top working set.** Set 2 = back-off drop set. The progression engine reads Set 1; Set 2 is informational.
- **Automatic weight progression.** Hit top of rep range → increase by the exercise's equipment increment next time. In range (not at top) → same weight, push for more reps. Below range → drop one increment.
- **Back-off ratio** on Set 2 is per-exercise (0.80 for Lat Pulldown, 0.90 standard, 1.00 for single-arm lateral raise and hanging leg raises).
- **Deadlift alternates heavy ↔ technique** across successive B sessions (see §4).
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
| 1 | Deadlift (Barbell) — **day variant** | Heavy: 1×3–5  /  Technique: 2×3–5 | 3:00 | 2.5 kg | 0.90 heavy / 1.00 tech |
| 2 | Shoulder Press (Machine Plates)   | 2 × 5–8    | 2:30 | 2.5 kg | 0.90 |
| 3 | Lat Pulldown (Cable)              | 2 × 5–8    | 2:30 | **5 kg** | **0.80** |
| 4 | Seated Row (Machine)              | 2 × 6–10   | 2:00 | 5 kg | 0.90 |
| 5 | Bicep Curl (Dumbbell)             | 2 × 8–12   | 1:15 | 1 kg (per hand) | 0.90 |
| 6 | Single Arm Lateral Raise (Cable)  | 2 × 10–15  | 1:00 | 2.5 kg | 1.00 |
| 7 | Hanging Leg Raises                | 2 × 8–15   | 1:15 | 0 (BW) | 1.00 |

---

## 4. Deadlift day variants (Addendum 4)

Deadlift is the only exercise with day-dependent set structure.

| Mode        | Sets | Reps  | Weight source                        | Progression          |
|-------------|------|-------|--------------------------------------|----------------------|
| Heavy Day   | 1    | 3–5   | Standard progression from last heavy | Normal rules apply   |
| Technique Day | 2  | 3–5   | **75 % of last heavy**, rounded to 2.5 kg (ties go down), both sets same | **None** — technique doesn't progress |

Alternation: every B session flips the mode. Historical B sessions are all
flagged `heavy`, so the next B = **technique**.

Current technique weight on first launch: 95 × 0.75 = 71.25 → **70 kg**.

---

## 5. Auto-progression logic

Applied to Set 1 of each exercise, using the **top set** (`set_number = 1`) of
the most recent finished session of that exercise.

```
reps ≥ rep_max           → increase weight by weight_increment
reps in [rep_min, rep_max) → same weight, aim for more reps
reps < rep_min           → reduce weight by weight_increment
weight_increment === 0   → reps-only progression (Hanging Leg Raises)
deadlift technique day   → override to 75 % of last heavy, no progression
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
| Deadlift            | 95 × 4 (heavy) | **70 kg × 2 sets (technique)** |
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

`PRAGMA user_version` drives nuke-and-reseed migrations. Current version: **6**.

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
- **Next deadlift mode:** technique (last was heavy)
- **Technique weight:** 70 kg (95 × 0.75, ties go down)

---

## 9. Design decisions that are locked

- **Theme:** Brutalist Lime dropped in favor of the **existing dark + blue accent** palette (`colors.ts`). Splash uses the *Stacked Brutalist* layout (IRON / LOG two-toned) but in the app's blue, not lime.
- **Splash:** renders as an *overlay* in `_layout.tsx`, not as a route. Auto-dismisses after 1.6 s, tap to skip. Works regardless of which route the app opens on.
- **Active workout layout:** V7 — column headers (`SET · WEIGHT · REPS`), strong current-set highlight (1 px accent border + tint), inline last-session values directly under each stepper column.
- **No slider for rep input.** Too fiddly at phone scale. Numeric stepper (typed + ± buttons) with placeholder = last session's reps at that set number.
- **Live tint on reps input:** green (in range), blue (at/above top), yellow (below range), **red (regression vs last session)**. Red wins.
- **KG stepper is fixed 108 px width.** REPS stepper takes flex remainder. Avoids the conflicting `flex: 1` + `width` bug that collapsed the KG stepper.
- **Home: V02 Journal feed.** Reverse-chronological entries — in-progress banner (if any) → today/next-up with Start → past sessions. Deadlift mode + weight shown inline on the next-up card.
- **No per-arm tracking.** "Single Arm" exercises log as 2 sets normally; user handles both arms mentally.
- **Footer actions removed** from active workout. Auto-advance handles the "next exercise" flow when the current card's sets are all logged.

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
- [x] Deadlift heavy/technique alternation (last heavy → next technique)
- [x] Deadlift heavy = 1 set, technique = 2 sets
- [x] Technique weight = 75 % of last heavy's top set, rounded to 2.5 kg (ties down)
- [x] Back-off Set 2 weight auto-recalculates after Set 1 is logged
- [x] Progression engine using Set 1 (top set), not last numerical set
- [x] Per-set `last · X kg` / `last · R` reference under each working set row
- [x] PR detection (weight / rep / volume) — runs mid-workout on Set 1, and post-workout for summary
- [x] **Mid-workout PR celebration overlay** — trophy + "NEW X PR" with exercise name and value, 1.6 s, then rest starts
- [x] Reps placeholder = last session's matching set's reps (not just "reps")
- [x] Red tint on reps stepper when reps < last session's same-set reps

### Dashboard (Progress tab)
- [x] 2×2 stats grid: total sessions, total volume, time lifted, this week (+ 30d subcount)
- [x] All-time PRs table (W / R / V per exercise)
- [x] Current working weights list (most recent Set 1 per exercise, alphabetical)
- [x] Empty state when no sessions logged

### Identity
- [x] Splash screen: Stacked Brutalist IRON/LOG wordmark, accent bar, tagline, 1.6 s auto-dismiss
- [x] Dark theme: #0D0D0D bg, #4A90D9 accent, #F5F5F5 text
- [x] Tab bar: text-only (Workout / History / Progress), safe-area respected

---

## 11. Outstanding / not yet built

From Addendum 5, ordered by my recommended attack order. Nothing here is started.

### Must ship in v1
- [ ] **Edit / delete logged sets** in active + history (with cascading recalc of downstream Set 2 weight; tiny "edited" indicator in history)
- [ ] **Exercise navigation within session** — tap any pending card to jump; explicit Skip vs undone; exercise states `not_started | in_progress | completed | skipped`
- [ ] **Finish-anyway confirm** — when finishing with undone exercises, list them + "Mark remaining as skipped" option
- [ ] **Onboarding flow** (first launch) — welcome, dominant arm, rest sound, vibration, notifications, data review, "start first workout"
- [ ] **UserSettings table** — dominant_arm, rest_timer_sound, vibration_enabled, background_notifications_enabled

### Should ship in v1
- [ ] **Session-level actions on home:**
  - "Mark last session as completed" (creates a ghost session, flips alternation, no set data)
  - "Do different workout" (override alternation for this session only)
- [ ] **"N days ago" context** on home's next-up ("You completed A last — 3 days ago")
- [ ] **Partial session resume cutoff:** if active session is >12 h old, prompt "Continue or finish?"

### Can defer to v1.1
- [ ] Trend charts in Progress tab (weight over time per exercise, volume over time, sessions/week bar)
- [ ] PR trophy badges in history list
- [ ] Streak tracking (consecutive weeks with ≥2 sessions) — explicitly skipped for now in favor of "this week / last 30d" counts
- [ ] Session note field
- [ ] Share a session (PR celebration specifically)
- [ ] Google Fonts upgrade — currently splash uses Platform system fonts (Impact / sans-serif-condensed); could install `@expo-google-fonts/anton` for exact Anton glyph

### Known issues / gotchas
- Schema version **6** = nuke + reseed. Bump this when changing schema OR seeded history.
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
| `start.html` | 15 start/title screens | Picked **06 Stacked Brutalist** (IRON / LOG) |

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

## 15. Next session — pick up here

1. **Edit / delete logged sets** is probably the most user-facing missing
   feature. Tap a logged row → edit; swipe/long-press → delete. Editing Set 1
   should re-trigger the Set 2 back-off recalc.
2. **Exercise navigation** is the second highest. The V7 active layout already
   shows pending cards; make them tappable to jump, add a "Skip" long-press,
   and update `onFinish` to list undone exercises.
3. After those two, revisit whether onboarding is actually needed or if the
   app is usable without one (current state is very close — only thing
   missing is a settings UI for rest sound / vibration preferences).
