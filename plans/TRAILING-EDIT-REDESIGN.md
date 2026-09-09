# Trailing Edit Redesign + Re-parse Redemotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-food "edge-only" checkbox lock and the `floor_week`/`floor_day` position boundary — the mechanism behind four distinct bugs found across dogfooding rounds 1-5 — with a `cycle_start_date`-anchored editable boundary and a full-cycle recompute-on-save. Trailing Edit reaches the entire current food cycle with no day cap; New Food Cycle and Re-parse share underlying plumbing but stay separate entry points; a new manual foods/doses edit screen becomes the primary routine-correction path.

**Architecture:** One new pure function in `lib/schedule.ts` (`recomputeFoodProgressFromHistory`) replaces incremental edge-based advance/regress with a deterministic full replay of a food's `dose_log` history. `floor_week`/`floor_day` are retired; the editable/backfillable boundary becomes a direct date comparison against `dose_state.cycle_start_date`, which New Food Cycle's position stepper is fixed to keep in sync with the true (per-food) position — the actual root cause of round 5's bug. `DayEditor` drops its edge lock entirely except for a narrow, explicit carve-out for foods currently under an active Reaction Ramp. `app/new-cycle/page.tsx`'s flow is extracted into a shared component reused by a new `/re-parse` route.

**Tech Stack:** Next.js (App Router), Supabase (Postgres + `@supabase/supabase-js`), TypeScript, Vitest for pure-function unit tests.

## Global Constraints

- Only treatment-food state affects position; maintenance/medication checkbox state remains informational-only.
- No change to Reaction Ramp's own step-advancement logic (`advanceRampStepState`, `resolveRampAfterAdvance`) or Travel Day Buffer.
- "History is factual, never fabricated" — no day is ever auto-marked complete; the guided "fill in past days" idea is explicitly out of scope for this ticket (declining/not-filling-in stays the only path).
- Re-parsing an existing cycle (New Food Cycle or Re-parse) resets in-progress counters/checked-state only — `dose_log` history is never deleted.
- TypeScript strict, no `any`.
- Test command: `npm test` (runs `vitest run`). Type-check: `npx tsc --noEmit -p .`. Build: `npm run build`.
- No code comments unless a WHY is genuinely non-obvious — matches this codebase's existing style.
- Every client component/page file starts with `"use client"`.
- Colors via the existing `var(--color-*)` tokens from `globals.css`.

## Refinements made while grounding the approved design spec in actual code

1. **`fetchDoseState()` never reads the raw `current_week`/`current_day` columns back** (`lib/supabase.ts:64-89`) — they're a write-only cache per the original F0.1 design; `currentWeek`/`currentDay` are always recomputed live via `getCalendarPosition(cycleStartDate, skipCount)`. The spec's section 2a was corrected during its own self-review to target the real bug: New Food Cycle's position stepper (`handleConfirmPositions`) seeds `treatment_food_progress` without updating `cycle_start_date` to match, so the backfill's gate reads a completely different, disconnected position model. `app/onboarding/page.tsx`'s `saveAndRedirect` (lines 134-153) already does this sync correctly — it's the reference pattern Task 5 copies.
2. **The manual edit screen needs no new `lib/supabase.ts` function.** `saveSchedule(schedule: ParsedSchedule)` (`lib/supabase.ts:53-62`) already does exactly what's needed — a full `schedules.parsed_data` upsert, no archiving, no position touch. The spec's mention of a new `updateScheduleFoods`-style function is unnecessary; Task 9 reuses `saveSchedule` directly.
3. **New Food Cycle and Re-parse share one React component, not a route.** To satisfy "shared plumbing only, not a shared screen" while avoiding a 580-line copy-paste, Task 8 extracts `app/new-cycle/page.tsx`'s body into `components/NewCycleFlow.tsx`, parameterized by a `variant: "new-cycle" | "re-parse"` prop that changes only copy/framing (intro bullets, warning severity, page title). `app/new-cycle/page.tsx` and the new `app/re-parse/page.tsx` become two thin page files rendering the same component with different `variant` values — two distinct URLs and Settings entries, one shared implementation.
4. **`FoodItem`'s `lockedHint` prop (added in round 4) is kept, not removed** — it's still needed for the one remaining lock case (a ramp-controlled food outside its ramp's date range), just recomputed under the new narrower rule instead of the old edge-based one.
5. **`regressFoodProgress` and `getFoodEdgeState` become fully dead code** once `DayEditor` stops calling them (Task 7) — verified via `grep` that `DayEditor.tsx` is their only caller outside `lib/schedule.ts`/`lib/schedule.test.ts` itself. Removed in Task 2 alongside adding the new function, not left as unreferenced exports.

## File Structure

- `supabase/migrations/20260909_drop_navigation_floor.sql` — new. Drops `floor_week`/`floor_day` from `dose_state`.
- `lib/schedule.ts` — modify. Adds `recomputeFoodProgressFromHistory`. Removes `getFoodEdgeState`, `regressFoodProgress`.
- `lib/schedule.test.ts` — modify. Removes `getFoodEdgeState`/`regressFoodProgress` tests. Adds `recomputeFoodProgressFromHistory` tests.
- `lib/types.ts` — modify. Removes `floorWeek`/`floorDay` from `DoseState`.
- `lib/supabase.ts` — modify. Removes `floor_week`/`floor_day` from `fetchDoseState`, `saveDoseState`, `archiveAndStartNewCycle`.
- `app/daily/page.tsx` — modify. Backfill loop rewritten to iterate by real calendar date anchored on `cycle_start_date`, not position-index arithmetic.
- `app/new-cycle/page.tsx` — modify → thin wrapper around new `NewCycleFlow`.
- `components/NewCycleFlow.tsx` — new. Extracted flow (paste → diff review → position stepper → confirm → success), parameterized by `variant`. Includes Bug 1 (additive copy fix), Bug 2 (maintenance "Removed" badge), Bug 3 (`positionEntries` wired to success screen) from the New Food Cycle bug triage — folded in here per the approved spec, since both fixes touch the same extracted code.
- `app/re-parse/page.tsx` — new. Thin wrapper around `NewCycleFlow` with `variant="re-parse"`.
- `app/settings/page.tsx` — modify. "Re-parse schedule" now links to `/re-parse` instead of `/setup`. New "Edit foods & doses" row added above both, per decision 6's ordering.
- `app/edit-foods/page.tsx` — new. Manual foods/doses edit screen.
- `components/DailyView.tsx` — modify. `leftDisabled`/`handleNavigate`'s floor guard replaced with a `cycleStartDate` date check.
- `components/DayEditor.tsx` — modify. Edge lock removed except for the Reaction Ramp date-range carve-out; save flow runs the full-cycle recompute for non-ramp foods and the existing single-day ramp-step delta for ramp-controlled foods.

---

### Task 1: Drop `floor_week`/`floor_day` (migration)

**Files:**
- Create: `supabase/migrations/20260909_drop_navigation_floor.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the migration SQL file, committed but **not applied to production yet** — see the sequencing note before Step 2. `dose_state` keeps the columns physically until deploy time; Tasks 3, 4, 6 only need the *code* to stop reading/writing them, which doesn't require the columns to already be gone from the live table.

**Sequencing note (found during execution, not in the original plan text):** the live, currently-deployed app still reads/writes `floor_week`/`floor_day` on every `dose_state` save. Applying this migration to production now — before the corresponding code changes are deployed — would break the live app immediately for the real family using it, since a database migration isn't scoped to a git branch the way code is. **Do not apply this migration during Task 1.** Write and commit the file only. It gets applied as part of the actual deploy step, alongside the code changes from Tasks 3-9, not in isolation here.

- [ ] **Step 1: Write the migration**

```sql
-- Retires floor_week/floor_day (added 20260621_navigation_floor.sql). The
-- floor and cycle_start_date were only ever supposed to move together (on
-- an actual New Food Cycle reset or onboarding) — keeping them as two
-- separately-written fields is exactly the redundancy that caused four
-- distinct bugs across dogfooding rounds 1-5 (two things that must always
-- agree, written in different places, occasionally forgotten in one).
-- The editable/backfillable boundary is now a direct date comparison
-- against cycle_start_date, which already represents the same boundary
-- this migration's original comment describes ("the actual entered
-- starting position") without a second field to keep in sync.

ALTER TABLE dose_state
  DROP COLUMN IF EXISTS floor_week,
  DROP COLUMN IF EXISTS floor_day;
```

- [ ] **Step 2 (deferred — do not run yet):** Apply the migration to production via Supabase MCP (`mcp__claude_ai_Supabase__apply_migration`) and confirm via `mcp__claude_ai_Supabase__list_tables` (verbose) that `dose_state` no longer lists `floor_week`/`floor_day`. This step moves to the actual deploy step (after Task 10, when the code is ready to ship), not part of Task 1's execution.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260909_drop_navigation_floor.sql
git commit -m "chore(db): drop dose_state.floor_week/floor_day"
```

---

### Task 2: `recomputeFoodProgressFromHistory` (TDD) + remove dead edge-lock functions

**Files:**
- Modify: `lib/schedule.ts` (remove `getFoodEdgeState` lines 138-150 and `regressFoodProgress` lines 159-164; add the new function after `advanceFoodProgress`)
- Modify: `lib/schedule.test.ts` (remove `describe("getFoodEdgeState", ...)` block lines 530-556 and `describe("regressFoodProgress", ...)` block lines 572-598; remove `getFoodEdgeState, regressFoodProgress` from the top import; add new tests)

**Interfaces:**
- Consumes: `ParsedSchedule`, `DoseLogDay`, `FoodProgress` from `./types` (pre-existing); `advanceFoodProgress` (pre-existing, kept).
- Produces: `recomputeFoodProgressFromHistory(schedule: ParsedSchedule, doseLogDays: DoseLogDay[], currentProgress: Map<string, FoodProgress>, excludeFoodNames: Set<string>): Map<string, FoodProgress>`. Task 4 (backfill) and Task 7 (`DayEditor`) both call this.

- [ ] **Step 1: Remove the two dead functions from `lib/schedule.ts`**

Delete lines 138-150 (`getFoodEdgeState`) and lines 159-164 (`regressFoodProgress`). `advanceFoodProgress` (lines 152-157) stays.

- [ ] **Step 2: Remove their tests from `lib/schedule.test.ts`**

Delete the `describe("getFoodEdgeState", ...)` block (lines 530-556) and the `describe("regressFoodProgress", ...)` block (lines 572-598). Update the top import line to remove `getFoodEdgeState, ... regressFoodProgress,`:

```ts
import { applyCrossCategoryCredit, treatmentRampDone, treatmentRampActive, advanceRampStepState, getRampOverrides, advanceProgressForDay, resolveRampAfterAdvance, calculateBufferFromProgress, todayDateString, addDays, advanceFoodProgress, classifyDoseLogDay, recomputeFoodProgressFromHistory } from "./schedule"
```

Run `npm test` now to confirm the file still parses and existing tests pass with these two blocks gone (expect the same pass count minus 9 removed tests, 0 failures).

- [ ] **Step 3: Write the failing tests for the new function**

Append to `lib/schedule.test.ts` (reuses the existing `classifierSchedule`/`makeDoseLogDay` helpers already defined above `describe("classifyDoseLogDay", ...)`):

```ts
const replaySchedule: ParsedSchedule = {
  maintenanceFoods: [],
  weeklyFoods: [],
  treatmentFoods: [
    { name: "Walnut", weeks: [{ week: 1, dose: 30, unit: "mg", isFinal: false }, { week: 2, dose: 60, unit: "mg", isFinal: false }] },
    { name: "Peanut", weeks: [{ week: 1, dose: 64, unit: "mg", isFinal: false }] },
  ],
}

describe("recomputeFoodProgressFromHistory", () => {
  it("replays a food checked every day, rolling over at week 7", () => {
    const days = Array.from({ length: 8 }, (_, i) =>
      makeDoseLogDay({
        id: `d${i}`,
        completedAt: `2026-09-0${i + 1}T19:00:00.000Z`,
        checkedFoods: { "evening-Walnut": true },
      })
    )
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, new Map(), new Set())
    expect(result.get("Walnut")).toEqual({ foodName: "Walnut", week: 2, day: 2, completedDays: 1, lastCompletedAt: "2026-09-08T19:00:00.000Z" })
  })

  it("a food never checked stays at week 1, day 1", () => {
    const days = [makeDoseLogDay({ completedAt: "2026-09-01T19:00:00.000Z", checkedFoods: {} })]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, new Map(), new Set())
    expect(result.get("Peanut")).toEqual({ foodName: "Peanut", week: 1, day: 1, completedDays: 0, lastCompletedAt: null })
  })

  it("skips unchecked/absent days for that food while still advancing a different food checked the same days", () => {
    const days = [
      makeDoseLogDay({ id: "d1", completedAt: "2026-09-01T19:00:00.000Z", checkedFoods: { "evening-Walnut": true } }),
      makeDoseLogDay({ id: "d2", completedAt: "2026-09-02T19:00:00.000Z", checkedFoods: {} }),
      makeDoseLogDay({ id: "d3", completedAt: "2026-09-03T19:00:00.000Z", checkedFoods: { "evening-Walnut": true } }),
    ]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, new Map(), new Set())
    expect(result.get("Walnut")).toEqual({ foodName: "Walnut", week: 1, day: 3, completedDays: 2, lastCompletedAt: "2026-09-03T19:00:00.000Z" })
    expect(result.get("Peanut")).toEqual({ foodName: "Peanut", week: 1, day: 1, completedDays: 0, lastCompletedAt: null })
  })

  it("is order-independent of the input array — sorts by completedAt before replaying", () => {
    const days = [
      makeDoseLogDay({ id: "d2", completedAt: "2026-09-02T19:00:00.000Z", checkedFoods: { "evening-Peanut": true } }),
      makeDoseLogDay({ id: "d1", completedAt: "2026-09-01T19:00:00.000Z", checkedFoods: { "evening-Peanut": true } }),
    ]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, new Map(), new Set())
    expect(result.get("Peanut")).toEqual({ foodName: "Peanut", week: 1, day: 3, completedDays: 2, lastCompletedAt: "2026-09-02T19:00:00.000Z" })
  })

  it("excluded (ramp-controlled) foods pass through unchanged from currentProgress, not reset to week 1 day 1", () => {
    const currentProgress = new Map([["Walnut", { foodName: "Walnut", week: 3, day: 5, completedDays: 4, lastCompletedAt: "2026-08-20T00:00:00.000Z" }]])
    const days = [makeDoseLogDay({ completedAt: "2026-09-01T19:00:00.000Z", checkedFoods: { "evening-Walnut": true, "evening-Peanut": true } })]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, currentProgress, new Set(["Walnut"]))
    expect(result.get("Walnut")).toEqual(currentProgress.get("Walnut"))
    expect(result.get("Peanut")).toEqual({ foodName: "Peanut", week: 1, day: 2, completedDays: 1, lastCompletedAt: "2026-09-01T19:00:00.000Z" })
  })

  it("reproduces the round 4/5 production scenario: one food never checked pins nothing else back", () => {
    const days = Array.from({ length: 4 }, (_, i) =>
      makeDoseLogDay({
        id: `d${i}`,
        completedAt: `2026-09-0${i + 1}T19:00:00.000Z`,
        checkedFoods: { "evening-Walnut": true },
      })
    )
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, new Map(), new Set())
    expect(result.get("Walnut")?.day).toBe(5)
    expect(result.get("Peanut")).toEqual({ foodName: "Peanut", week: 1, day: 1, completedDays: 0, lastCompletedAt: null })
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `recomputeFoodProgressFromHistory is not defined` (or similar) for the 6 new tests; all other tests still pass.

- [ ] **Step 5: Implement the function**

Add to `lib/schedule.ts`, directly after `advanceFoodProgress` (former line 157, now wherever it lands after Step 1's deletions):

```ts
export function recomputeFoodProgressFromHistory(
  schedule: ParsedSchedule,
  doseLogDays: DoseLogDay[],
  currentProgress: Map<string, FoodProgress>,
  excludeFoodNames: Set<string>
): Map<string, FoodProgress> {
  const sorted = [...doseLogDays].sort((a, b) =>
    a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : 0
  )
  const result = new Map<string, FoodProgress>()
  for (const food of schedule.treatmentFoods) {
    if (excludeFoodNames.has(food.name)) {
      const existing = currentProgress.get(food.name)
      if (existing) result.set(food.name, existing)
      continue
    }
    let fp: FoodProgress = { foodName: food.name, week: 1, day: 1, completedDays: 0, lastCompletedAt: null }
    for (const entry of sorted) {
      if (entry.checkedFoods[`evening-${food.name}`]) {
        fp = advanceFoodProgress(fp, entry.completedAt)
      }
    }
    result.set(food.name, fp)
  }
  return result
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests, including the 6 new ones.

- [ ] **Step 7: Commit**

```bash
git add lib/schedule.ts lib/schedule.test.ts
git commit -m "feat(schedule): add recomputeFoodProgressFromHistory, remove edge-lock functions"
```

---

### Task 3: Remove `floorWeek`/`floorDay` from the type and all `lib/supabase.ts` sites

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/supabase.ts`

**Interfaces:**
- Consumes: Task 1's migration (columns already gone in production — this task removes the now-dead code paths that referenced them).
- Produces: `DoseState` without `floorWeek`/`floorDay`. Tasks 4, 5, 6 depend on this — they're what actually implement the new date-based boundary.

- [ ] **Step 1: Remove from `lib/types.ts`**

In the `DoseState` interface, delete:

```ts
  floorWeek: number
  floorDay: number
```

- [ ] **Step 2: Remove from `fetchDoseState` (`lib/supabase.ts:64-89`)**

Remove `floor_week, floor_day` from the `.select(...)` string, and remove these two lines from the returned object:

```ts
    floorWeek: (data.floor_week as number) ?? 1,
    floorDay: (data.floor_day as number) ?? 1,
```

- [ ] **Step 3: Remove from `saveDoseState` (`lib/supabase.ts:504-526`)**

Remove these two lines from the upsert payload:

```ts
        floor_week: state.floorWeek,
        floor_day: state.floorDay,
```

- [ ] **Step 4: Remove from `archiveAndStartNewCycle`'s dose_state reset (`lib/supabase.ts:603-625`)**

Remove these two lines from the upsert payload:

```ts
        floor_week: 1,
        floor_day: 1,
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: errors at every remaining `floorWeek`/`floorDay` reference in `app/setup/page.tsx`, `app/onboarding/page.tsx`, `app/settings/page.tsx`'s comment, `app/daily/page.tsx`, `components/DailyView.tsx` — these are fixed in Tasks 4-6. Confirm the error list matches exactly those files (no surprises elsewhere).

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/supabase.ts
git commit -m "refactor(dose-state): remove floorWeek/floorDay from type and read/write sites"
```

---

### Task 4: Rework the backfill loop to iterate by calendar date

**Files:**
- Modify: `app/daily/page.tsx` (lines 107-116 initial-state fallback, lines 150-287 the backfill block)

**Interfaces:**
- Consumes: `recomputeFoodProgressFromHistory` is NOT used here — the backfill still writes one `dose_log` row per missed day using `advanceProgressForDay` per-day exactly as today (unrelated to this task; that mechanism is correct and untouched). Consumes `positionFromIndex`, `todayDateString`, `addDays` from `lib/schedule.ts` (all pre-existing).
- Produces: every missed day between `cycle_start_date` (inclusive) and yesterday gets a `dose_log` row with the correct real-calendar-date-derived `(week, day)`, regardless of whether the cycle started at day 1 or was seeded ahead via the position stepper (once Task 5 lands).

- [ ] **Step 1: Remove the floor default from the initial-state fallback**

Change (around line 107-116):

```ts
        const initialState = ds ?? {
          currentWeek: 1,
          currentDay: 1,
          checkedFoods: {},
          cycleStartDate: todayDateString(),
          skipCount: 0,
          floorWeek: 1,
          floorDay: 1,
          recommendedFoodCounts: {},
        }
```

to:

```ts
        const initialState = ds ?? {
          currentWeek: 1,
          currentDay: 1,
          checkedFoods: {},
          cycleStartDate: todayDateString(),
          skipCount: 0,
          recommendedFoodCounts: {},
        }
```

- [ ] **Step 2: Replace the backfill block's gate and iteration**

Replace the entire block from the `const yesterday = ...` comment through the closing of the `if (existingDays !== null) { ... }` (originally lines 154-287) with a date-driven version. The day-by-day body (fetching existing checked state, computing `dUncheckedNames`/`dIsSkipped`, calling `advanceProgressForDay`/`saveDoseLog`/`saveFoodProgress`, updating `finalDayRecords`/`finalCompletedPositions`, building the banner) is **unchanged in substance** — only how `idx`/`dWeek`/`dDay`/`dDate` are derived changes, from position-index arithmetic to a direct date loop:

```ts
        const yesterday = addDays(todayDateString(), -1)
        if (initialState.cycleStartDate <= yesterday) {
          const MAX_BACKFILL_DAYS = 60
          const earliestBackfillDate = addDays(yesterday, -(MAX_BACKFILL_DAYS - 1))
          const rangeStart = initialState.cycleStartDate > earliestBackfillDate ? initialState.cycleStartDate : earliestBackfillDate

          const existingDays = await fetchDoseLogDaysInRange(rangeStart, yesterday).catch(() => null)
          if (existingDays !== null) {
          const existingDates = new Set(existingDays.map(d => formatDateOnly(new Date(d.completedAt))))

          let gapFirstDate: string | null = null
          let gapLastDate: string | null = null
          let gapUncheckedNames: string[] = []

          for (let dDate = rangeStart; dDate <= yesterday; dDate = addDays(dDate, 1)) {
            if (existingDates.has(dDate)) continue

            const dayIndex = Math.round(
              (new Date(dDate + "T00:00:00").getTime() - new Date(initialState.cycleStartDate + "T00:00:00").getTime())
                / MS_PER_DAY
            )
            const { week: dWeek, day: dDay } = positionFromIndex(Math.max(0, dayIndex - initialState.skipCount))
            const dPosKey = `${dWeek}-${dDay}`

            const dCheckedFoods = initialState.completedDays?.[dPosKey] ?? {}
            const dEveningItems = getTreatmentFoodsForWeek(s, dWeek)
            const dUncheckedNames = dEveningItems
              .filter(({ food }) => !dCheckedFoods[`evening-${food.name}`])
              .map(({ food }) => food.name)
            const dIsSkipped = dEveningItems.length > 0 && dUncheckedNames.length === dEveningItems.length

            const dDayDateObj = new Date(dDate + "T00:00:00")
            dDayDateObj.setHours(12, 0, 0, 0)
            const dDayDate = dDayDateObj.toISOString()
            const recordedAt = new Date().toISOString()

            const wasTreatmentRampActiveThatDay = treatmentRampActive(ramp)
            const { updatedProgress: advancedProgress, updatedRampTreatmentFoods, updatedRampMaintenanceFoods } =
              advanceProgressForDay(s, dCheckedFoods, progress, ramp, recordedAt)

            try {
              await saveDoseLog(dWeek, dDay, dCheckedFoods, dDayDate, s, dIsSkipped, ramp?.active ?? false)
              await saveFoodProgress(advancedProgress)
              progress = advancedProgress
              globalPos = getGlobalPosition(advancedProgress)
              stateWithGlobalPos.currentWeek = globalPos.week
              stateWithGlobalPos.currentDay = globalPos.day

              if (ramp && Object.values(dCheckedFoods).some(Boolean)) {
                const { nextRamp, justFinishedTreatment, fullyDone } = resolveRampAfterAdvance(
                  ramp, updatedRampTreatmentFoods, updatedRampMaintenanceFoods, wasTreatmentRampActiveThatDay
                )
                if (justFinishedTreatment) {
                  try {
                    await appendPreviousRamp({
                      startedAt: ramp.startedAt,
                      endedAt: recordedAt,
                      rampDayCount: nextRamp.rampDay,
                      treatmentFoods: nextRamp.treatmentFoods,
                      maintenanceFoods: nextRamp.maintenanceFoods,
                    })
                  } catch {
                    // History write failed — non-critical
                  }
                }
                ramp = fullyDone
                  ? { active: false, startedAt: "", rampDay: 0, startedAtWeek: 0, startedAtDay: 0, treatmentFoods: [], maintenanceFoods: [] }
                  : nextRamp
                try {
                  await saveReactionRamp(ramp)
                } catch {
                  // Save failed — non-critical, next load re-fetches truth
                }
              }

              const nextDayRecords = new Map(finalDayRecords)
              nextDayRecords.set(dPosKey, { date: dDayDate, skipped: dIsSkipped })
              finalDayRecords = nextDayRecords

              const nextCompletedPositions = new Set(finalCompletedPositions)
              nextCompletedPositions.add(dPosKey)
              finalCompletedPositions = nextCompletedPositions

              if (dUncheckedNames.length > 0) {
                if (!gapFirstDate) gapFirstDate = dDate
                gapLastDate = dDate
                gapUncheckedNames = dUncheckedNames
              }
            } catch {
              if (dUncheckedNames.length > 0 && !gapFirstDate) {
                gapFirstDate = dDate
                gapLastDate = dDate
                gapUncheckedNames = dUncheckedNames
              }
            }
          }

          if (gapFirstDate && gapLastDate) {
            banner = gapFirstDate === gapLastDate
              ? { kind: "single", date: gapFirstDate, foods: gapUncheckedNames }
              : {
                  kind: "multi",
                  count: Math.round(
                    (new Date(gapLastDate + "T00:00:00").getTime() - new Date(gapFirstDate + "T00:00:00").getTime())
                      / (1000 * 60 * 60 * 24)
                  ) + 1,
                  startDate: gapFirstDate,
                  endDate: gapLastDate,
                }
          }
          }
        }
```

Add `MS_PER_DAY` and `positionFromIndex` to the existing `lib/schedule` import at the top of the file (currently `import { todayDateString, addDays, formatDateOnly, getTreatmentFoodsForWeek, getGlobalPosition, treatmentRampActive, getRampOverrides, advanceProgressForDay, resolveRampAfterAdvance } from "@/lib/schedule"`):

```ts
import { todayDateString, addDays, formatDateOnly, getTreatmentFoodsForWeek, getGlobalPosition, treatmentRampActive, getRampOverrides, advanceProgressForDay, resolveRampAfterAdvance, positionFromIndex, MS_PER_DAY } from "@/lib/schedule"
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add app/daily/page.tsx
git commit -m "fix(dailypage): anchor backfill on cycle_start_date instead of position-index counting"
```

---

### Task 5: Fix New Food Cycle's position stepper to sync `cycle_start_date`/`skip_count`

**Files:**
- Modify: `app/new-cycle/page.tsx` (`handleConfirmPositions`, lines 158-166)

**Interfaces:**
- Consumes: `getGlobalPosition`, `cycleStartDateForPosition` from `lib/schedule.ts` (both pre-existing, both already imported by `app/onboarding/page.tsx` as the reference pattern); `fetchDoseState`, `saveDoseState` from `lib/supabase.ts` (pre-existing).
- Produces: after choosing a starting position via `FoodPositionStepper`, `dose_state.cycle_start_date` and `skip_count` correctly reflect that position — this is the actual fix for round 5's "backfill never runs" bug, since Task 4's date-anchored backfill depends on `cycle_start_date` being correct.

- [ ] **Step 1: Add the missing imports**

At the top of `app/new-cycle/page.tsx`, add to the existing `lib/supabase` import: `fetchDoseState, saveDoseState,` and to the existing `lib/schedule` import: `getGlobalPosition, cycleStartDateForPosition,`.

- [ ] **Step 2: Sync `cycle_start_date`/`skip_count` after seeding progress**

Change `handleConfirmPositions` from:

```ts
  async function handleConfirmPositions() {
    setPositionSaving(true)
    setPositionError(null)
    try {
      await seedFoodProgress(positionEntries)
      setView("success")
    } catch (err) {
      setPositionError(err instanceof Error ? err.message : "Save failed — please try again")
    } finally {
      setPositionSaving(false)
    }
  }
```

to:

```ts
  async function handleConfirmPositions() {
    setPositionSaving(true)
    setPositionError(null)
    try {
      const seededProgress = await seedFoodProgress(positionEntries)
      const globalPos = getGlobalPosition(seededProgress)
      const existing = await fetchDoseState()
      if (existing) {
        await saveDoseState({
          ...existing,
          currentWeek: globalPos.week,
          currentDay: globalPos.day,
          cycleStartDate: cycleStartDateForPosition(globalPos.week, globalPos.day),
          skipCount: 0,
        })
      }
      setView("success")
    } catch (err) {
      setPositionError(err instanceof Error ? err.message : "Save failed — please try again")
    } finally {
      setPositionSaving(false)
    }
  }
```

- [ ] **Step 3: Manual verification against production data**

This is the exact round-5 bug — verify against the real "Joshy" family via `mcp__claude_ai_Supabase__execute_sql` after this code is live and a family runs New Food Cycle with a non-day-1 starting position: confirm `dose_state.cycle_start_date` matches `cycleStartDateForPosition` of the slowest chosen food's position, not "today."

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/new-cycle/page.tsx
git commit -m "fix(new-cycle): sync cycle_start_date/skip_count when seeding a non-day-1 starting position"
```

---

### Task 6: `DailyView.tsx` — floor guard replaced with a date check

**Files:**
- Modify: `components/DailyView.tsx` (lines 101, 130-183)

**Interfaces:**
- Consumes: `doseState.cycleStartDate` (already on `DoseState`, unaffected by Task 3's removal — only `floorWeek`/`floorDay` were removed).
- Produces: `leftDisabled` and `handleNavigate`'s guard both stop referencing `floorWeek`/`floorDay`, fixing the type errors Task 3 introduced here.

- [ ] **Step 1: Update the destructure**

Change line 101 from:

```ts
  const { currentWeek, currentDay, checkedFoods, floorWeek, floorDay } = doseState
```

to:

```ts
  const { currentWeek, currentDay, checkedFoods, cycleStartDate } = doseState
```

- [ ] **Step 2: Replace `floorSeq`/`leftDisabled`**

Change (line 132, and the `leftDisabled` line 166):

```ts
  const floorSeq = (floorWeek - 1) * 7 + floorDay
```

Remove this line entirely. Change:

```ts
  const leftDisabled = viewSeq <= floorSeq || targetDate < tenDaysAgo
```

to:

```ts
  const leftDisabled = targetDate < cycleStartDate || targetDate < tenDaysAgo
```

- [ ] **Step 3: Replace `handleNavigate`'s floor guard**

Change (inside `handleNavigate`, around line 177):

```ts
      const fSeq = (prev.floorWeek - 1) * 7 + prev.floorDay
      if (nextSeq < fSeq) return prev
```

to:

```ts
      const nextTargetDate = addDays(todayDateString(), nextSeq - anchorSeq)
      if (nextTargetDate < prev.cycleStartDate) return prev
```

`anchorSeq` is already in scope (defined earlier in the component, line 131, from `treatmentAnchor`); `addDays`/`todayDateString` are already imported at the top of this file.

Note this deliberately does **not** copy the `-1` from `targetDate`'s formula above (`addDays(todayDateString(), (viewSeq - 1) - anchorSeq)`) — that `-1` exists because `targetDate` represents the calendar date of *one step before* the currently-viewed `viewSeq`. Here, `nextSeq` already *is* the destination position being navigated to, so its calendar date is `today + (nextSeq - anchorSeq)` directly, with no additional offset. Applying the `-1` here would incorrectly block navigation to the cycle's actual start date (the exact boundary this check exists to allow) — verified by hand-tracing both formulas against a cycle that started 3 days ago: the correct formula places the cycle-start day exactly at `cycleStartDate` (not less than it, so not blocked); the `-1` variant places it one day earlier than `cycleStartDate` (incorrectly blocked).

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both clean — this should also resolve the remaining `floorWeek`/`floorDay` type errors from Task 3's step 5.

- [ ] **Step 5: Commit**

```bash
git add components/DailyView.tsx
git commit -m "fix(dailyview): replace floor position guard with cycle_start_date date check"
```

---

### Task 7: `DayEditor.tsx` — remove edge lock, add recompute-on-save with the Reaction Ramp carve-out

**Files:**
- Modify: `components/DayEditor.tsx` (near-total rewrite of the editability and save logic; JSX rendering structure unchanged)

**Interfaces:**
- Consumes: `recomputeFoodProgressFromHistory` (Task 2), `fetchDoseLogDaysInRange` (pre-existing, `lib/supabase.ts:333`), `fetchDoseState` (pre-existing), `advanceRampStepState` (pre-existing, `lib/schedule.ts:291`), `saveReactionRamp` (pre-existing), `todayDateString` (pre-existing).
- Produces: any treatment-food checkbox on any day within the current cycle is freely toggleable, except a currently ramp-controlled food is locked outside `[ramp start date, today]`. Save persists checked state, then either (a) applies the existing single-day ramp-step delta for ramp-controlled foods toggled that day, or (b) runs the full-cycle recompute for every other treatment food.

- [ ] **Step 1: Replace the editability functions**

Remove `isRampFrozen`, `isTreatmentRowEditable`, `treatmentLockedHint`, `simulateProgressChange`, and `willChangePosition` (lines 113-165 and 158-165 of the current file — these are being replaced, not patched incrementally, since the underlying editability rule changed shape). Replace with:

```ts
  function rampStartDate(): string | null {
    if (!treatmentRampActive(activeRamp) || !activeRamp) return null
    return formatDateOnly(new Date(activeRamp.startedAt))
  }

  function isRampControlled(foodName: string): boolean {
    if (!treatmentRampActive(activeRamp)) return false
    return !!activeRamp?.treatmentFoods.some(f => f.name === foodName)
  }

  function isTreatmentRowEditable(foodName: string): boolean {
    if (!isRampControlled(foodName)) return true
    const start = rampStartDate()
    const entryDate = formatDateOnly(new Date(entry.completedAt))
    return start !== null && entryDate >= start && entryDate <= todayDateString()
  }

  function treatmentLockedHint(foodName: string): string | undefined {
    if (!editing) return undefined
    if (isTreatmentRowEditable(foodName)) return undefined
    return "Locked — outside this Reaction Ramp's date range"
  }
```

Replace the two import blocks at the top of the file. Change:

```ts
import {
  getFoodEdgeState,
  advanceFoodProgress,
  regressFoodProgress,
  getTreatmentFoodsForWeek,
  getMedicationSessions,
  getGlobalPosition,
  cycleStartDateForPosition,
  treatmentRampActive,
  applyCrossCategoryCredit,
} from "@/lib/schedule"
import {
  updateDoseLogCheckedFoods,
  fetchFoodProgress,
  saveFoodProgress,
  fetchDoseState,
  saveDoseState,
  fetchReactionRamp,
  saveRecommendedGiven,
} from "@/lib/supabase"
```

to:

```ts
import {
  getTreatmentFoodsForWeek,
  getMedicationSessions,
  getGlobalPosition,
  cycleStartDateForPosition,
  treatmentRampActive,
  applyCrossCategoryCredit,
  recomputeFoodProgressFromHistory,
  advanceRampStepState,
  formatDateOnly,
  todayDateString,
} from "@/lib/schedule"
import {
  updateDoseLogCheckedFoods,
  fetchFoodProgress,
  saveFoodProgress,
  fetchDoseState,
  saveDoseState,
  fetchReactionRamp,
  saveRecommendedGiven,
  fetchDoseLogDaysInRange,
  saveReactionRamp,
} from "@/lib/supabase"
```

`getFoodEdgeState`/`regressFoodProgress` no longer exist after Task 2 — this file is their only external caller, so leaving the old import would fail to compile. `advanceFoodProgress` is dropped too: `DayEditor` no longer calls it directly once recompute happens via `recomputeFoodProgressFromHistory`.

- [ ] **Step 2: Replace `handleSaveTap`/`commitSave`**

The confirmation-before-position-change screen (`confirming` state, `willChangePosition`) is removed — full-cycle recompute means position can change on any save, and pre-computing "will it change" would require running the same recompute twice. Instead, `handleSaveTap` calls `commitSave` directly (no more `confirming` gate), and the existing confirmation-sheet JSX (lines 332-358) and `confirming`/`setConfirming` state are removed. Replace:

```ts
  function handleSaveTap() {
    if (willChangePosition()) {
      setConfirming(true)
    } else {
      commitSave()
    }
  }
```

with:

```ts
  function handleSaveTap() {
    commitSave()
  }
```

Replace `commitSave` entirely:

```ts
  async function commitSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await updateDoseLogCheckedFoods(entry.id, draft)

      const allRows = [...maintenanceRows, ...treatmentRows, ...medicationRows]
      let runningCounts = recommendedFoodCounts
      for (const row of allRows) {
        const wasChecked = !!entry.checkedFoods[row.key]
        const nowChecked = !!draft[row.key]
        if (nowChecked === wasChecked) continue
        const updated = applyCrossCategoryCredit(
          s.recommendedFoods ?? [],
          runningCounts,
          String(entry.week),
          row.key,
          nowChecked,
          wasChecked
        )
        if (updated) runningCounts = updated
      }
      if (runningCounts !== recommendedFoodCounts) {
        saveRecommendedGiven(runningCounts).catch(() => {})
      }

      const rampControlledNames = new Set(
        treatmentRows.filter(row => isRampControlled(row.name)).map(row => row.name)
      )
      if (activeRamp && rampControlledNames.size > 0) {
        const nextTreatmentFoods = activeRamp.treatmentFoods.map(rf => {
          if (!rampControlledNames.has(rf.name)) return rf
          const row = treatmentRows.find(r => r.name === rf.name)
          if (!row) return rf
          const wasChecked = !!entry.checkedFoods[row.key]
          const nowChecked = !!draft[row.key]
          if (!nowChecked || wasChecked === nowChecked) return rf
          return { ...rf, ...advanceRampStepState(rf) }
        })
        try {
          await saveReactionRamp({ ...activeRamp, treatmentFoods: nextTreatmentFoods })
        } catch {
          // Save failed — non-critical, next load re-fetches truth
        }
      }

      if (foodProgress) {
        const existing = await fetchDoseState()
        const cycleStartDate = existing?.cycleStartDate ?? formatDateOnly(new Date(entry.completedAt))
        const cycleDays = await fetchDoseLogDaysInRange(cycleStartDate, todayDateString())
        const recomputed = recomputeFoodProgressFromHistory(s, cycleDays, foodProgress, rampControlledNames)
        await saveFoodProgress(recomputed)

        const oldGlobal = getGlobalPosition(foodProgress)
        const newGlobal = getGlobalPosition(recomputed)
        if (existing && (newGlobal.week !== oldGlobal.week || newGlobal.day !== oldGlobal.day)) {
          await saveDoseState({
            ...existing,
            currentWeek: newGlobal.week,
            currentDay: newGlobal.day,
            cycleStartDate: cycleStartDateForPosition(newGlobal.week, newGlobal.day),
            skipCount: 0,
          })
        }
      }

      onSaved({ ...entry, checkedFoods: draft })
      onClose()
    } catch {
      setSaveError("Save failed — please try again")
    } finally {
      setSaving(false)
    }
  }
```

Note: `advanceRampStepState` (`lib/schedule.ts:291`) operates on a ramp food's own shape (`currentStep`/`daysInStep`/`steps`), not on `FoodProgress` — the code above advances the matching entry in `activeRamp.treatmentFoods` directly and persists it via `saveReactionRamp`, mirroring the exact pattern `advanceProgressForDay` (`lib/schedule.ts:360-401`) already uses for the live/backfill case. `treatment_food_progress` for a ramp-controlled food is never written by this path — `recomputeFoodProgressFromHistory`'s `excludeFoodNames` set (passed as `rampControlledNames` below) leaves it untouched, exactly matching "ramp-controlled foods advance via ramp steps, not the replay."

Add `saveReactionRamp` to the existing `@/lib/supabase` import, and `advanceRampStepState` to the existing `@/lib/schedule` import (both pre-existing exports — `saveReactionRamp` is already used by `app/settings/page.tsx` and `app/daily/page.tsx`).

- [ ] **Step 3: Update `renderRow`**

`renderRow` currently computes `wasChecked` only to pass it to the two functions below — it becomes unused once neither takes it. Change:

```ts
  function renderRow(row: Row) {
    const checked = !!draft[row.key]
    const wasChecked = !!entry.checkedFoods[row.key]
    const editable = editing && (row.session !== "evening" || isTreatmentRowEditable(row.name, wasChecked))
```

to:

```ts
  function renderRow(row: Row) {
    const checked = !!draft[row.key]
    const editable = editing && (row.session !== "evening" || isTreatmentRowEditable(row.name))
```

and:

```ts
        lockedHint={row.session === "evening" ? treatmentLockedHint(row.name, wasChecked) : undefined}
```

to:

```ts
        lockedHint={row.session === "evening" ? treatmentLockedHint(row.name) : undefined}
```

- [ ] **Step 4: Remove the now-dead `confirming` UI block and state**

Delete the `confirming`/`setConfirming` `useState` declaration and the entire confirmation-sheet JSX block (the `{confirming && (...)}` section near the end of the file).

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both clean.

- [ ] **Step 6: Manual QA**

- Open a day mid-cycle with no active ramp: every treatment food editable, save recomputes position from full history.
- Open a day while a ramp is active: the ramp-controlled food is editable only if the day's date is within `[ramp start, today]`; a non-ramp treatment food on the same day is editable regardless and feeds the normal recompute.
- Toggle a ramp-controlled food's checkbox (unchecked → checked) on an editable ramp day, save, confirm (via direct query) the ramp's `treatmentFoods` entry advanced a step and `treatment_food_progress` for that food is unchanged; confirm no other food's position was disturbed.

- [ ] **Step 7: Commit**

```bash
git add components/DayEditor.tsx
git commit -m "feat(dayeditor): replace edge lock with full-cycle recompute-on-save, ramp date-range carve-out"
```

---

### Task 8: Extract `NewCycleFlow`, add `/re-parse`, fix Bugs 1-3

**Files:**
- Create: `components/NewCycleFlow.tsx`
- Modify: `app/new-cycle/page.tsx` (reduced to a thin wrapper)
- Create: `app/re-parse/page.tsx`
- Modify: `app/settings/page.tsx` (line 536-538, the "Re-parse schedule" link)

**Interfaces:**
- Consumes: everything `app/new-cycle/page.tsx` currently imports and uses (`archiveAndStartNewCycle`, `seedFoodProgress`, `clearFoodProgress`, `FoodPositionStepper`, Task 5's `cycle_start_date` sync).
- Produces: `NewCycleFlow({ variant }: { variant: "new-cycle" | "re-parse" })` — a default export consumed by two thin page files.

- [ ] **Step 1: Create `components/NewCycleFlow.tsx` from the current `app/new-cycle/page.tsx`**

Copy the entire current body of `app/new-cycle/page.tsx` (all state, effects, handlers, and JSX — lines 1-582) into `components/NewCycleFlow.tsx`. Rename the component from `NewCyclePage` to `NewCycleFlow`, and change its signature to accept the variant prop:

```tsx
export default function NewCycleFlow({ variant }: { variant: "new-cycle" | "re-parse" }) {
```

Make these copy/content changes within the copied body:

1. **Bug 1 fix — the intro "what happens" list** (originally lines 248-254):

```tsx
              {[
                "All foods (treatment, maintenance, weekly) are replaced with the new plan of care",
                "Position resets to Week 1, Day 1",
                "Your full dosing history is preserved",
                "Visit number updates to the new plan",
              ].map((item, i) => (
```

2. **Bug 1 fix — the maintenance diff logic** (originally lines 380-403): give maintenance foods the same `removed` computation treatment foods already have. Add, alongside the existing `removedTreatment` (originally lines 322-324):

```tsx
        const removedMaint = allCurMaint.filter(
          f => !allNewMaint.some(nf => foodNamesMatch(nf.name, f.name))
        )
```

(`allNewMaint`/`allCurMaint` are already defined just above this, unchanged.) Then replace the entire maintenance-foods JSX block (originally lines 380-403) with:

```tsx
            {/* Maintenance foods */}
            {(allNewMaint.length > 0 || removedMaint.length > 0) && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>
                  Maintenance foods
                </p>
                <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
                  {allNewMaint.map((food, i) => {
                    const inCurrent = allCurMaint.some(f => foodNamesMatch(f.name, food.name))
                    const kind = inCurrent ? "kept" : "new"
                    return (
                      <div
                        key={food.name + i}
                        className="flex items-center justify-between px-4 py-3"
                        style={{ borderBottom: i < allNewMaint.length - 1 || removedMaint.length > 0 ? "0.5px solid var(--color-primary-border)" : undefined }}
                      >
                        <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{food.name}</span>
                        <DiffBadge kind={kind} />
                      </div>
                    )
                  })}
                  {removedMaint.map((food, i) => (
                    <div
                      key={food.name + "-removed"}
                      className="flex items-center justify-between px-4 py-3"
                      style={{ borderBottom: i < removedMaint.length - 1 ? "0.5px solid var(--color-primary-border)" : undefined }}
                    >
                      <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{food.name}</span>
                      <DiffBadge kind="removed" detail="Not in new plan" />
                    </div>
                  ))}
                </div>
              </div>
            )}
```

3. **Bug 3 fix — the success screen's "Starting position" row** (originally line 536): the actual chosen positions live in `positionEntries` at this point (set during the `"position"` view step). Change:

```tsx
              { label: "Starting position", value: "Week 1, Day 1" },
```

to a value computed from `positionEntries` just above the summary card's `.map(...)` call:

```tsx
            const startingPositionLabel = positionEntries.length > 0
              ? positionEntries.every(e => e.week === positionEntries[0].week && e.day === positionEntries[0].day)
                ? `Week ${positionEntries[0].week}, Day ${positionEntries[0].day}`
                : "Varies by food (see Settings)"
              : "Week 1, Day 1"
```

then use `{ label: "Starting position", value: startingPositionLabel }` in the summary rows array.

4. **Variant-driven copy.** `headerTitle`'s fallback values (originally lines 180-184) hardcode `"New food cycle"` for the `confirm`/default and `success` cases — change:

```tsx
  const headerTitle =
    view === "review" || view === "confirming" ? "Review changes"
    : view === "position" ? "Starting positions"
    : view === "success" ? "New food cycle"
    : "New food cycle"
```

to:

```tsx
  const introTitle = variant === "re-parse" ? "Re-parse schedule" : "New food cycle"
  const headerTitle =
    view === "review" || view === "confirming" ? "Review changes"
    : view === "position" ? "Starting positions"
    : view === "success" ? introTitle
    : introTitle
```

Then, inside the "what happens" card in the `confirm` view (originally lines 240-261, directly above the `<ul>` of bullet points), add a warning line for the `re-parse` variant:

```tsx
          <div
            className="bg-white rounded-xl p-4"
            style={{ border: "0.5px solid var(--color-primary-border)" }}
          >
            {variant === "re-parse" && (
              <p className="text-sm font-medium mb-3" style={{ color: "#dc2626" }}>
                Only use this if the original parse was wrong and you need to start over. For correcting individual doses or foods, use Settings → Edit foods &amp; doses instead.
              </p>
            )}
            <p className="text-sm font-semibold mb-3" style={{ color: "var(--color-text-primary)" }}>
              What happens when you start a new cycle:
            </p>
```

(This replaces just the opening `<div>`/first `<p>` of that card — the rest of the card, the bulleted `<ul>` and the "Continue" button below it, is unchanged.)

- [ ] **Step 2: Reduce `app/new-cycle/page.tsx` to a thin wrapper**

Replace the entire file with:

```tsx
"use client"

import NewCycleFlow from "@/components/NewCycleFlow"

export default function NewCyclePage() {
  return <NewCycleFlow variant="new-cycle" />
}
```

- [ ] **Step 3: Create `app/re-parse/page.tsx`**

```tsx
"use client"

import NewCycleFlow from "@/components/NewCycleFlow"

export default function ReParsePage() {
  return <NewCycleFlow variant="re-parse" />
}
```

- [ ] **Step 4: Repoint Settings' "Re-parse schedule" link**

In `app/settings/page.tsx`, change (lines 535-539):

```tsx
            {/* Re-parse schedule */}
            <Link href="/setup" className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Re-parse schedule</span>
              <span style={{ color: "var(--color-text-muted)" }}>›</span>
            </Link>
```

to:

```tsx
            {/* Re-parse schedule */}
            <Link href="/re-parse" className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Re-parse schedule</span>
              <span style={{ color: "var(--color-text-muted)" }}>›</span>
            </Link>
```

This is the fix for `/setup`'s live no-archiving bug (`app/setup/page.tsx:49-62`) — Settings no longer routes an existing-schedule family through it. `/setup` itself is untouched; it's still reachable directly for genuine first-time setup (no existing schedule to archive).

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both clean. Confirm the build output lists both `/new-cycle` and `/re-parse` as routes.

- [ ] **Step 6: Manual QA**

- `/new-cycle`: full flow unchanged in behavior, intro copy now says "replaced" not "additive," maintenance review shows a "Removed" badge for a dropped food, success screen shows the actually-chosen starting position.
- `/re-parse`: same flow, different intro copy/warning, reachable only via Settings' relocated link.
- Settings → "Re-parse schedule" no longer reaches `/setup`.

- [ ] **Step 7: Commit**

```bash
git add components/NewCycleFlow.tsx app/new-cycle/page.tsx app/re-parse/page.tsx app/settings/page.tsx
git commit -m "feat(new-cycle): extract NewCycleFlow, add /re-parse, fix maintenance-additive copy/diff and starting-position display"
```

---

### Task 9: Manual foods/doses edit screen

**Files:**
- Create: `app/edit-foods/page.tsx`
- Modify: `app/settings/page.tsx` (add the new Settings row, above "New food cycle")

**Interfaces:**
- Consumes: `fetchSchedule`, `saveSchedule` (both pre-existing, `lib/supabase.ts:41-62`).
- Produces: a Settings-reachable screen that edits `maintenanceFoods`, `weeklyFoods`, `treatmentFoods[].weeks`, `recommendedFoods`, `medications` in place via a single `saveSchedule` call — never touches `dose_state`, `treatment_food_progress`, or `dose_log`.

- [ ] **Step 1: Create `app/edit-foods/page.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, MaintenanceFood, WeeklyFood, TreatmentFood, TreatmentWeek, RecommendedFood, Medication } from "@/lib/types"
import { getSession, fetchSchedule, saveSchedule } from "@/lib/supabase"

function RowDivider() {
  return <div style={{ height: "0.5px", background: "var(--color-primary-border)", marginLeft: 16 }} />
}

function NumberField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="text-sm bg-transparent outline-none border-none text-right w-16"
      style={{ color: "var(--color-text-secondary)" }}
    />
  )
}

function TextField({ value, onChange, width = 60 }: { value: string; onChange: (v: string) => void; width?: number }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-sm bg-transparent outline-none border-none text-right"
      style={{ color: "var(--color-text-secondary)", width }}
    />
  )
}

export default function EditFoodsPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const session = await getSession().catch(() => null)
      if (!session) { router.replace("/login"); return }
      const s = await fetchSchedule().catch(() => null)
      if (!s) { router.replace("/setup"); return }
      setSchedule(s)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateMaintenance(index: number, patch: Partial<MaintenanceFood>) {
    setSchedule(prev => {
      if (!prev) return prev
      const next = [...prev.maintenanceFoods]
      next[index] = { ...next[index], ...patch }
      return { ...prev, maintenanceFoods: next }
    })
  }

  function updateWeekly(index: number, patch: Partial<WeeklyFood>) {
    setSchedule(prev => {
      if (!prev) return prev
      const next = [...prev.weeklyFoods]
      next[index] = { ...next[index], ...patch }
      return { ...prev, weeklyFoods: next }
    })
  }

  function updateTreatmentWeek(foodIndex: number, weekIndex: number, patch: Partial<TreatmentWeek>) {
    setSchedule(prev => {
      if (!prev) return prev
      const foods = [...prev.treatmentFoods]
      const weeks = [...foods[foodIndex].weeks]
      weeks[weekIndex] = { ...weeks[weekIndex], ...patch }
      foods[foodIndex] = { ...foods[foodIndex], weeks }
      return { ...prev, treatmentFoods: foods }
    })
  }

  function addTreatmentWeek(foodIndex: number) {
    setSchedule(prev => {
      if (!prev) return prev
      const foods = [...prev.treatmentFoods]
      const weeks = foods[foodIndex].weeks
      const lastWeek = weeks.length > 0 ? weeks[weeks.length - 1] : { week: 0, dose: 0, unit: "mg", isFinal: false }
      foods[foodIndex] = { ...foods[foodIndex], weeks: [...weeks, { ...lastWeek, week: lastWeek.week + 1 }] }
      return { ...prev, treatmentFoods: foods }
    })
  }

  function removeTreatmentWeek(foodIndex: number, weekIndex: number) {
    setSchedule(prev => {
      if (!prev) return prev
      const foods = [...prev.treatmentFoods]
      foods[foodIndex] = { ...foods[foodIndex], weeks: foods[foodIndex].weeks.filter((_, i) => i !== weekIndex) }
      return { ...prev, treatmentFoods: foods }
    })
  }

  function updateRecommended(index: number, patch: Partial<RecommendedFood>) {
    setSchedule(prev => {
      if (!prev) return prev
      const next = [...(prev.recommendedFoods ?? [])]
      next[index] = { ...next[index], ...patch }
      return { ...prev, recommendedFoods: next }
    })
  }

  function updateMedication(index: number, patch: Partial<Medication>) {
    setSchedule(prev => {
      if (!prev) return prev
      const next = [...(prev.medications ?? [])]
      next[index] = { ...next[index], ...patch }
      return { ...prev, medications: next }
    })
  }

  async function handleSave() {
    if (!schedule) return
    setSaving(true)
    setSaveError(null)
    try {
      await saveSchedule(schedule)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
    } finally {
      setSaving(false)
    }
  }

  if (!schedule) return null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      <header
        className="px-4 pb-4 flex items-center justify-between"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <button onClick={() => router.back()} className="text-white" aria-label="Back">‹ Settings</button>
        <h1 className="text-base font-semibold text-white">Edit foods &amp; doses</h1>
        <button onClick={handleSave} disabled={saving} className="text-white font-semibold disabled:opacity-50">
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </header>

      <div className="flex-1 px-4 pt-4 pb-24 flex flex-col gap-5">
        {saveError && <p className="text-sm" style={{ color: "#dc2626" }}>{saveError}</p>}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Maintenance foods</p>
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
            {schedule.maintenanceFoods.map((food, i) => (
              <div key={food.name}>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{food.name}</span>
                  <div className="flex items-center gap-1">
                    <NumberField value={food.dose} onChange={v => updateMaintenance(i, { dose: v })} />
                    <TextField value={food.unit} onChange={v => updateMaintenance(i, { unit: v })} width={44} />
                  </div>
                </div>
                {i < schedule.maintenanceFoods.length - 1 && <RowDivider />}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Weekly foods (Day 7)</p>
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
            {schedule.weeklyFoods.map((food, i) => (
              <div key={food.name}>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{food.name}</span>
                  <div className="flex items-center gap-1">
                    <NumberField value={food.dose} onChange={v => updateWeekly(i, { dose: v })} />
                    <TextField value={food.unit} onChange={v => updateWeekly(i, { unit: v })} width={44} />
                  </div>
                </div>
                {i < schedule.weeklyFoods.length - 1 && <RowDivider />}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Treatment foods</p>
          <div className="flex flex-col gap-3">
            {schedule.treatmentFoods.map((food, fi) => (
              <div key={food.name} className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
                <div className="px-4 py-2">
                  <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{food.name}</span>
                </div>
                {food.weeks.map((week, wi) => (
                  <div key={week.week}>
                    <RowDivider />
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Week {week.week}</span>
                      <div className="flex items-center gap-1">
                        <NumberField value={week.dose} onChange={v => updateTreatmentWeek(fi, wi, { dose: v })} />
                        <TextField value={week.unit} onChange={v => updateTreatmentWeek(fi, wi, { unit: v })} width={44} />
                        <button onClick={() => removeTreatmentWeek(fi, wi)} className="text-sm ml-2" style={{ color: "#dc2626" }}>✕</button>
                      </div>
                    </div>
                  </div>
                ))}
                <RowDivider />
                <button onClick={() => addTreatmentWeek(fi)} className="w-full text-sm py-3" style={{ color: "var(--color-primary-mid)" }}>
                  + Add week
                </button>
              </div>
            ))}
          </div>
        </div>

        {(schedule.recommendedFoods?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Recommended foods</p>
            <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
              {(schedule.recommendedFoods ?? []).map((food, i) => (
                <div key={food.name}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{food.name}</span>
                    <div className="flex items-center gap-1">
                      <NumberField value={food.dose} onChange={v => updateRecommended(i, { dose: v })} />
                      <TextField value={food.unit} onChange={v => updateRecommended(i, { unit: v })} width={44} />
                      <TextField value={food.frequencyPerWeek} onChange={v => updateRecommended(i, { frequencyPerWeek: v })} width={44} />
                    </div>
                  </div>
                  {i < (schedule.recommendedFoods ?? []).length - 1 && <RowDivider />}
                </div>
              ))}
            </div>
          </div>
        )}

        {(schedule.medications?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Medications</p>
            <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
              {(schedule.medications ?? []).map((med, i) => (
                <div key={med.name}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{med.name}</span>
                    <div className="flex items-center gap-1">
                      <TextField value={med.dose} onChange={v => updateMedication(i, { dose: v })} />
                      <TextField value={med.unit} onChange={v => updateMedication(i, { unit: v })} width={44} />
                    </div>
                  </div>
                  {i < (schedule.medications ?? []).length - 1 && <RowDivider />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the Settings entry**

In `app/settings/page.tsx`, add above the existing "New food cycle" link (before line 529's `{/* New food cycle */}` comment):

```tsx
            {/* Edit foods & doses */}
            <Link href="/edit-foods" className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Edit foods &amp; doses</span>
              <span style={{ color: "var(--color-text-muted)" }}>›</span>
            </Link>
            <RowDivider />
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both clean.

- [ ] **Step 4: Manual QA**

- Edit a maintenance food's dose, Save, reload `/daily` — confirm the new dose shows and no position/History data changed.
- Add a treatment week to a food, Save, confirm it appears when that week is reached.
- Confirm `dose_state`, `treatment_food_progress`, and `dose_log` are unchanged after any save from this screen (direct query).

- [ ] **Step 5: Commit**

```bash
git add app/edit-foods/page.tsx app/settings/page.tsx
git commit -m "feat(settings): add manual foods/doses edit screen"
```

---

### Task 10: Full regression pass and BRIEF.md update

**Files:**
- Modify: `BRIEF.md`

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including Task 2's new tests and everything unaffected by this plan.

- [ ] **Step 2: Full type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both clean, zero remaining references to `floorWeek`/`floorDay`/`floor_week`/`floor_day` anywhere:

```bash
grep -rn "floorWeek\|floorDay\|floor_week\|floor_day" --include="*.ts" --include="*.tsx" . | grep -v node_modules
```

Expected: no output.

- [ ] **Step 3: Update `BRIEF.md`**

Mark the "Trailing Edit Redesign + Re-parse Redemotion" ticket's status line (currently "📋 Ticketed (2026-09-08) — supersedes Phase 2 F6" / "**Status: not yet started**") to reflect implementation completion, and mark the three New Food Cycle bugs (Phase 3.5 F8 section) as resolved, since Task 8 folds their fixes in here per the approved spec. Update `## Current Status` per the project's standard rule (Phase, Mode, Last Updated, Blocker, Next Action).

- [ ] **Step 4: Commit**

```bash
git add BRIEF.md
git commit -m "docs: mark Trailing Edit Redesign + New Food Cycle bugs 1-3 complete"
```

- [ ] **Step 5 (deploy time, not part of this task — controller/human action, not a subagent):** After this branch is merged and deployed (Vercel auto-deploy from `main`, per this project's convention), apply Task 1's deferred migration to production: `mcp__claude_ai_Supabase__apply_migration` with the SQL from `supabase/migrations/20260909_drop_navigation_floor.sql`, then confirm via `mcp__claude_ai_Supabase__list_tables` (verbose) that `dose_state` no longer lists `floor_week`/`floor_day`. Only do this once the new code is live — applying it any earlier breaks the still-deployed old code for the real family using this app.
