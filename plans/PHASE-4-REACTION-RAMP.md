# Reaction Ramp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a parent start, edit, and cancel a manual mid-cycle reaction ramp from Settings; while active it overrides doses on the daily view, freezes the global week/day counter, and resumes the counter once every treatment food's ramp steps complete.

**Architecture:** `reaction_ramp` + `previous_ramps` JSONB columns on `families`, `ramp_active` boolean on `dose_log`. Pure step-advancement/override logic lives in `lib/schedule.ts` (testable, no I/O). A single `saveReactionRamp` write replaces the whole ramp blob, matching the existing `food_groups`/`previous_cycles` convention. `treatment_food_progress` (per-food permanent position) is never written to for a food while it's actively ramping — this is *why* the counter freezes, with zero special-casing in `getGlobalPosition`.

**Tech Stack:** Next.js (App Router), Supabase (Postgres + `@supabase/supabase-js`), TypeScript, Vitest for pure-function unit tests.

## Global Constraints

- No new food cycle is created — this is a temporary deviation within the current cycle.
- The parser is never involved — ramp data is entered manually only, never touched by `/api/parse-schedule`.
- No Supabase Realtime — ramp state is read via the existing fetch-on-load pattern, same as every other piece of shared state in this app.
- No layout, component, or logic changes outside what this plan specifies — this project's ground rules forbid scope beyond the ticket.
- TypeScript strict, no `any`.
- Test command: `npm test` (runs `vitest run`).
- No code comments unless a WHY is genuinely non-obvious — matches this codebase's existing style (see `lib/schedule.ts`).
- Every client component/page file starts with `"use client"`.
- Colors via the existing `var(--color-*)` tokens from `globals.css` (Phase 3.6 palette) — do not introduce new tokens or hardcoded hex values except where the codebase itself already uses a literal hex for a specific pattern (noted per-task below).

## Refinements made while grounding the approved design spec in actual code

The design spec (`docs/superpowers/specs/2026-08-13-reaction-ramp-design.md`) was approved at the architecture level. Turning it into buildable tasks surfaced five implementation-level corrections, all consistent with the approved design's intent — none are product/architecture reversals:

1. **Dose override delivery:** the spec says `applyRampOverrides` returns "a schedule-shaped object" consumed with "zero changes" to render components. In the real code, a treatment food's displayed dose comes from `getTreatmentFoodEntry(food, fp.week)` — a lookup keyed by that food's own frozen `treatment_food_progress.week`, not a flat index into `schedule`. Mutating a `ParsedSchedule` copy can't cleanly express this. Instead, `getRampOverrides(ramp)` returns two `Map<string, RampDoseOverride>` lookups (treatment, maintenance) that `EveningSection`/`MorningSection` consult directly. Small, additive prop changes to those two components are required — not zero.
2. **`wasCapped` is a manual toggle, not auto-derived.** The v2 parser schema's `TreatmentWeek` type has no `capped` field at all (only `MaintenanceFood` does) — there is nothing in the schedule to "capture automatically" for a treatment food. The Settings wizard's Screen 1 gets an explicit CAPPED checkbox per included treatment food, defaulting unchecked. This matches reality: the ramp is entered manually from a clinic conversation, same as everything else about it.
3. **`ReactionRamp` needs a `startedAt: string` timestamp field.** The design's `PreviousRamp.startedAt` has to come from somewhere, and `ReactionRamp` as originally sketched only stored `startedAtWeek`/`startedAtDay` (a *position*, not a *time*). Added `startedAt: string` (ISO timestamp), set once at ramp creation, preserved across Edit (same rationale as preserving `rampDay`/`startedAtWeek`/`startedAtDay` — an edit is a correction, not a new ramp).
4. **Maintenance ramp step advancement is gated on that food being checked that day.** The backlog spec's Complete Day description doesn't explicitly say whether an unchecked maintenance food should still silently advance its ramp step. Every other piece of progress-tracking in this codebase (`treatment_food_progress`, Cross-Category Logging) only advances on an actual checked transition. Given the medical stakes (BRIEF.md: "wrong doses or wrong week progression can set back treatment"), silently advancing a step for a dose that wasn't actually given would be a real correctness risk. Gated on `checkedFoods['morning-' + food.name]` for consistency and safety — flagged here explicitly for Reviewer/QA attention since it's inferred, not the literal spec text.
5. Confirmed no code change needed for the "7-day minimum resets" constraint — it's informational-only copy today, no stateful clock exists anywhere in the codebase to reset.

## File Structure

- `supabase/migrations/20260813_reaction_ramp.sql` — new. Adds `reaction_ramp`, `previous_ramps` to `families`; `ramp_active` to `dose_log`.
- `lib/types.ts` — modify. Adds `RampStep`, `RampTreatmentFood`, `RampMaintenanceFood`, `ReactionRamp`, `PreviousRamp`, `RampDoseOverride`.
- `lib/schedule.ts` — modify. Adds `treatmentRampDone`, `treatmentRampActive`, `advanceRampStepState`, `getRampOverrides` — all pure, all unit-tested.
- `lib/schedule.test.ts` — modify. Tests for the four functions above.
- `lib/supabase.ts` — modify. Adds `fetchReactionRamp`, `saveReactionRamp`, `appendPreviousRamp`; extends `saveDoseLog`'s signature with `rampActive: boolean`.
- `components/RampStepEditor.tsx` — new. Reusable dose/unit/days step-list editor (add/remove rows), used by both the treatment and maintenance screens of the setup wizard.
- `app/reaction-ramp/page.tsx` — new. The setup/edit wizard (Settings → Start/Edit Reaction Ramp), following the `app/new-cycle/page.tsx` convention: one route, a `View` union, no sub-routes.
- `app/settings/page.tsx` — modify. Adds the Start/Edit Reaction Ramp entry and an inline Cancel confirm, placed below "New food cycle".
- `components/EveningSection.tsx` — modify. Accepts `treatmentRampOverrides`, applies to treatment food dose/unit/capped.
- `components/MorningSection.tsx` — modify. Accepts `maintenanceRampOverrides`, applies to standalone (non-grouped) maintenance food dose/unit.
- `components/DailyView.tsx` — modify. Accepts `reactionRamp` + both override maps, renders the ramp banner, threads overrides down.
- `app/daily/page.tsx` — modify. Fetches the ramp on load, computes overrides for render, and rewrites `handleCompleteDay`'s treatment-food loop to branch on ramp state.

---

### Task 1: Migration — `reaction_ramp`, `previous_ramps`, `ramp_active`

**Files:**
- Create: `supabase/migrations/20260813_reaction_ramp.sql`

**Interfaces:**
- Produces: `families.reaction_ramp` (jsonb, default `{"active": false}`), `families.previous_ramps` (jsonb, default `[]`), `dose_log.ramp_active` (boolean, default `false`) — every later task depends on these three columns existing.

- [ ] **Step 1: Write the migration**

```sql
-- Phase 4: manual mid-cycle reaction ramp. Stored as JSONB on families —
-- one active ramp per household at a time, replaced wholesale on Edit,
-- read alongside the rest of the family row. previous_ramps is an append-only
-- history log, same pattern as previous_cycles (20260625_new_cycle.sql).
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS reaction_ramp JSONB NOT NULL DEFAULT '{"active": false}'::jsonb,
  ADD COLUMN IF NOT EXISTS previous_ramps JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE dose_log
  ADD COLUMN IF NOT EXISTS ramp_active BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tool to apply it directly to the linked project (id `hrzpiezzviwgxgnpqqvz`, name "Tip Pal"): call the migration-apply tool with the file's contents as the query and `reaction_ramp` as the migration name. Confirm success by listing the project's tables/columns and verifying `families.reaction_ramp`, `families.previous_ramps`, and `dose_log.ramp_active` are present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260813_reaction_ramp.sql
git commit -m "feat: add reaction_ramp/previous_ramps/ramp_active columns"
```

---

### Task 2: Types

**Files:**
- Modify: `lib/types.ts` (append after `FoodProgress`, the last interface in the file, currently ending at line 96)

**Interfaces:**
- Consumes: nothing.
- Produces: `RampStep`, `RampTreatmentFood`, `RampMaintenanceFood`, `ReactionRamp`, `PreviousRamp`, `RampDoseOverride` — every subsequent task imports from this set.

- [ ] **Step 1: Append the new types**

```ts
export interface RampStep {
  dose: number
  unit: string
  days: number
}

export interface RampTreatmentFood {
  name: string
  steps: RampStep[]
  returnDose: number
  returnUnit: string
  wasCapped: boolean
  currentStep: number
  daysInStep: number
  complete: boolean
}

export interface RampMaintenanceFood {
  name: string
  steps: RampStep[]
  currentStep: number
  daysInStep: number
  complete: boolean
}

export interface ReactionRamp {
  active: boolean
  startedAt: string
  rampDay: number
  startedAtWeek: number
  startedAtDay: number
  treatmentFoods: RampTreatmentFood[]
  maintenanceFoods: RampMaintenanceFood[]
}

export interface PreviousRamp {
  startedAt: string
  endedAt: string
  rampDayCount: number
  treatmentFoods: RampTreatmentFood[]
  maintenanceFoods: RampMaintenanceFood[]
}

export interface RampDoseOverride {
  dose: number
  unit: string
  capped?: boolean
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors (these are additive-only interfaces, nothing consumes them yet).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add Reaction Ramp types"
```

---

### Task 3: Pure ramp logic in `lib/schedule.ts` (TDD)

**Files:**
- Modify: `lib/schedule.ts` (append after `applyCrossCategoryCredit`, the last function in the file)
- Modify: `lib/schedule.test.ts` (append new `describe` blocks; add the new imports)

**Interfaces:**
- Consumes: `ReactionRamp`, `RampTreatmentFood`, `RampMaintenanceFood`, `RampDoseOverride` from `./types` (Task 2).
- Produces:
  - `treatmentRampDone(ramp: ReactionRamp): boolean`
  - `treatmentRampActive(ramp: ReactionRamp | null): boolean`
  - `advanceRampStepState(state: { steps: RampStep[]; currentStep: number; daysInStep: number; complete: boolean }): { currentStep: number; daysInStep: number; complete: boolean }`
  - `getRampOverrides(ramp: ReactionRamp | null): { treatment: Map<string, RampDoseOverride>; maintenance: Map<string, RampDoseOverride> }`

  Task 9 (`app/daily/page.tsx`) calls all four. Task 8 (`EveningSection`/`MorningSection`/`DailyView`) calls `getRampOverrides` and `treatmentRampDone`.

- [ ] **Step 1: Write the failing tests**

Update the top of `lib/schedule.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { applyCrossCategoryCredit, treatmentRampDone, treatmentRampActive, advanceRampStepState, getRampOverrides } from "./schedule"
import { RecommendedFood, ReactionRamp, RampTreatmentFood, RampMaintenanceFood } from "./types"
```

Append to the end of the file (after the existing `applyCrossCategoryCredit` describe block):

```ts
function makeTreatmentFood(overrides: Partial<RampTreatmentFood> = {}): RampTreatmentFood {
  return {
    name: "Peanut Gelatin",
    steps: [{ dose: 10, unit: "ml", days: 3 }, { dose: 20, unit: "ml", days: 3 }],
    returnDose: 30,
    returnUnit: "ml",
    wasCapped: false,
    currentStep: 0,
    daysInStep: 0,
    complete: false,
    ...overrides,
  }
}

function makeMaintenanceFood(overrides: Partial<RampMaintenanceFood> = {}): RampMaintenanceFood {
  return {
    name: "Denatured Donkey Milk",
    steps: [{ dose: 60, unit: "ml", days: 5 }],
    currentStep: 0,
    daysInStep: 0,
    complete: false,
    ...overrides,
  }
}

function makeRamp(overrides: Partial<ReactionRamp> = {}): ReactionRamp {
  return {
    active: true,
    startedAt: "2026-08-01T00:00:00.000Z",
    rampDay: 0,
    startedAtWeek: 3,
    startedAtDay: 2,
    treatmentFoods: [makeTreatmentFood()],
    maintenanceFoods: [],
    ...overrides,
  }
}

describe("treatmentRampDone", () => {
  it("is false when at least one treatment food is incomplete", () => {
    expect(treatmentRampDone(makeRamp())).toBe(false)
  })

  it("is true when every treatment food is complete", () => {
    const ramp = makeRamp({ treatmentFoods: [makeTreatmentFood({ complete: true })] })
    expect(treatmentRampDone(ramp)).toBe(true)
  })

  it("is true when there are no treatment foods in the ramp", () => {
    expect(treatmentRampDone(makeRamp({ treatmentFoods: [] }))).toBe(true)
  })
})

describe("treatmentRampActive", () => {
  it("is false for a null ramp", () => {
    expect(treatmentRampActive(null)).toBe(false)
  })

  it("is true when ramp is active and treatment side isn't done", () => {
    expect(treatmentRampActive(makeRamp())).toBe(true)
  })

  it("is false once treatment side is done, even if ramp.active is still true (maintenance tail)", () => {
    const ramp = makeRamp({ treatmentFoods: [makeTreatmentFood({ complete: true })] })
    expect(treatmentRampActive(ramp)).toBe(false)
  })

  it("is false when ramp.active is false", () => {
    expect(treatmentRampActive(makeRamp({ active: false }))).toBe(false)
  })
})

describe("advanceRampStepState", () => {
  it("increments daysInStep without rolling when below the step's day count", () => {
    const result = advanceRampStepState(makeTreatmentFood({ daysInStep: 0 }))
    expect(result).toEqual({ currentStep: 0, daysInStep: 1, complete: false })
  })

  it("rolls to the next step and resets daysInStep when the step's day count is reached", () => {
    const result = advanceRampStepState(makeTreatmentFood({ currentStep: 0, daysInStep: 2 }))
    expect(result).toEqual({ currentStep: 1, daysInStep: 0, complete: false })
  })

  it("marks complete when the last step's day count is reached", () => {
    const result = advanceRampStepState(makeTreatmentFood({ currentStep: 1, daysInStep: 2 }))
    expect(result).toEqual({ currentStep: 1, daysInStep: 3, complete: true })
  })

  it("is a no-op once already complete", () => {
    const result = advanceRampStepState(makeTreatmentFood({ complete: true, currentStep: 1, daysInStep: 3 }))
    expect(result).toEqual({ currentStep: 1, daysInStep: 3, complete: true })
  })

  it("works identically for a maintenance food (shared shape)", () => {
    const result = advanceRampStepState(makeMaintenanceFood({ daysInStep: 4 }))
    expect(result).toEqual({ currentStep: 0, daysInStep: 5, complete: true })
  })
})

describe("getRampOverrides", () => {
  it("returns empty maps for a null ramp", () => {
    const { treatment, maintenance } = getRampOverrides(null)
    expect(treatment.size).toBe(0)
    expect(maintenance.size).toBe(0)
  })

  it("returns empty maps for an inactive ramp", () => {
    const { treatment, maintenance } = getRampOverrides(makeRamp({ active: false }))
    expect(treatment.size).toBe(0)
    expect(maintenance.size).toBe(0)
  })

  it("overrides a stepping treatment food with its current step's dose, unit, and wasCapped", () => {
    const ramp = makeRamp({ treatmentFoods: [makeTreatmentFood({ wasCapped: true })] })
    const { treatment } = getRampOverrides(ramp)
    expect(treatment.get("Peanut Gelatin")).toEqual({ dose: 10, unit: "ml", capped: true })
  })

  it("holds a completed treatment food at returnDose while siblings are still stepping", () => {
    const ramp = makeRamp({
      treatmentFoods: [
        makeTreatmentFood({ name: "Peanut Gelatin", complete: true, wasCapped: true }),
        makeTreatmentFood({ name: "Cashew", complete: false }),
      ],
    })
    const { treatment } = getRampOverrides(ramp)
    expect(treatment.get("Peanut Gelatin")).toEqual({ dose: 30, unit: "ml", capped: true })
    expect(treatment.get("Cashew")).toEqual({ dose: 10, unit: "ml", capped: false })
  })

  it("removes all treatment overrides once every treatment food is complete, even for foods still holding at returnDose", () => {
    const ramp = makeRamp({ treatmentFoods: [makeTreatmentFood({ complete: true })] })
    const { treatment } = getRampOverrides(ramp)
    expect(treatment.size).toBe(0)
  })

  it("overrides a stepping maintenance food with its current step's dose and unit, no capped field", () => {
    const ramp = makeRamp({ maintenanceFoods: [makeMaintenanceFood()] })
    const { maintenance } = getRampOverrides(ramp)
    expect(maintenance.get("Denatured Donkey Milk")).toEqual({ dose: 60, unit: "ml" })
  })

  it("excludes a completed maintenance food from overrides", () => {
    const ramp = makeRamp({ maintenanceFoods: [makeMaintenanceFood({ complete: true })] })
    const { maintenance } = getRampOverrides(ramp)
    expect(maintenance.has("Denatured Donkey Milk")).toBe(false)
  })

  it("keeps maintenance overrides active even after the treatment side is fully done", () => {
    const ramp = makeRamp({
      treatmentFoods: [makeTreatmentFood({ complete: true })],
      maintenanceFoods: [makeMaintenanceFood()],
    })
    const { treatment, maintenance } = getRampOverrides(ramp)
    expect(treatment.size).toBe(0)
    expect(maintenance.get("Denatured Donkey Milk")).toEqual({ dose: 60, unit: "ml" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `treatmentRampDone`, `treatmentRampActive`, `advanceRampStepState`, `getRampOverrides` are not exported from `./schedule`.

- [ ] **Step 3: Implement the four functions**

Append to `lib/schedule.ts`, after `applyCrossCategoryCredit`:

```ts
export function treatmentRampDone(ramp: ReactionRamp): boolean {
  return ramp.treatmentFoods.length === 0 || ramp.treatmentFoods.every(f => f.complete)
}

export function treatmentRampActive(ramp: ReactionRamp | null): boolean {
  if (!ramp) return false
  return ramp.active && !treatmentRampDone(ramp)
}

interface RampStepState {
  steps: RampStep[]
  currentStep: number
  daysInStep: number
  complete: boolean
}

export function advanceRampStepState(
  state: RampStepState
): { currentStep: number; daysInStep: number; complete: boolean } {
  if (state.complete) {
    return { currentStep: state.currentStep, daysInStep: state.daysInStep, complete: true }
  }
  const step = state.steps[state.currentStep]
  if (!step) {
    return { currentStep: state.currentStep, daysInStep: state.daysInStep, complete: true }
  }
  const daysInStep = state.daysInStep + 1
  if (daysInStep >= step.days) {
    const nextStep = state.currentStep + 1
    if (nextStep >= state.steps.length) {
      return { currentStep: state.currentStep, daysInStep, complete: true }
    }
    return { currentStep: nextStep, daysInStep: 0, complete: false }
  }
  return { currentStep: state.currentStep, daysInStep, complete: false }
}

export function getRampOverrides(
  ramp: ReactionRamp | null
): { treatment: Map<string, RampDoseOverride>; maintenance: Map<string, RampDoseOverride> } {
  const treatment = new Map<string, RampDoseOverride>()
  const maintenance = new Map<string, RampDoseOverride>()
  if (!ramp) return { treatment, maintenance }

  if (treatmentRampActive(ramp)) {
    for (const food of ramp.treatmentFoods) {
      if (food.complete) {
        treatment.set(food.name, { dose: food.returnDose, unit: food.returnUnit, capped: food.wasCapped })
        continue
      }
      const step = food.steps[food.currentStep]
      if (step) {
        treatment.set(food.name, { dose: step.dose, unit: step.unit, capped: food.wasCapped })
      }
    }
  }

  for (const food of ramp.maintenanceFoods) {
    if (food.complete) continue
    const step = food.steps[food.currentStep]
    if (step) {
      maintenance.set(food.name, { dose: step.dose, unit: step.unit })
    }
  }

  return { treatment, maintenance }
}
```

Add `RampStep, RampTreatmentFood, RampMaintenanceFood, ReactionRamp, RampDoseOverride` to the existing `import { ... } from "./types"` line at the top of `lib/schedule.ts` (currently `import { ParsedSchedule, TreatmentFood, TreatmentWeek, FoodProgress, RecommendedFood } from "./types"`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `lib/schedule.test.ts`, including the pre-existing `applyCrossCategoryCredit` suite.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule.ts lib/schedule.test.ts
git commit -m "feat: add Reaction Ramp step-advancement and dose-override logic"
```

---

### Task 4: Data access layer (`lib/supabase.ts`)

**Files:**
- Modify: `lib/supabase.ts`

**Interfaces:**
- Consumes: `ReactionRamp`, `PreviousRamp` from `./types` (Task 2).
- Produces:
  - `fetchReactionRamp(): Promise<ReactionRamp | null>`
  - `saveReactionRamp(ramp: ReactionRamp): Promise<void>`
  - `appendPreviousRamp(entry: PreviousRamp): Promise<void>`
  - `saveDoseLog(week, day, checkedFoods, completedAt, scheduleSnapshot, isSkipped, rampActive: boolean): Promise<void>` — signature changed, one new required parameter.

  Tasks 6, 7, and 9 all call into this file.

- [ ] **Step 1: Add the import**

Change the top-of-file import:

```ts
import { ParsedSchedule, DoseState, DoseLogDay, DayRecord, FoodGroup, FoodProgress, ReactionRamp, PreviousRamp } from "./types"
```

- [ ] **Step 2: Add the three new functions**

Append after `resetFoodProgress` (the last function in the file):

```ts
export async function fetchReactionRamp(): Promise<ReactionRamp | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("reaction_ramp")
    .eq("id", familyId)
    .single()
  if (error) throw error
  const ramp = data.reaction_ramp as ReactionRamp | { active: false }
  if (!ramp || !ramp.active) return null
  return ramp as ReactionRamp
}

export async function saveReactionRamp(ramp: ReactionRamp): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ reaction_ramp: ramp })
    .eq("id", familyId)
  if (error) throw error
}

export async function appendPreviousRamp(entry: PreviousRamp): Promise<void> {
  const familyId = await getFamilyId()
  const { data: familyData, error: readError } = await getClient()
    .from("families")
    .select("previous_ramps")
    .eq("id", familyId)
    .single()
  if (readError) throw readError
  const existing = (familyData.previous_ramps ?? []) as PreviousRamp[]
  const { error: writeError } = await getClient()
    .from("families")
    .update({ previous_ramps: [...existing, entry] })
    .eq("id", familyId)
  if (writeError) throw writeError
}
```

- [ ] **Step 3: Extend `saveDoseLog`'s signature**

Replace the existing `saveDoseLog` function:

```ts
export async function saveDoseLog(
  week: number,
  day: number,
  checkedFoods: Record<string, boolean>,
  completedAt: string,
  scheduleSnapshot: object,
  isSkipped: boolean,
  rampActive: boolean
): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_log")
    .insert({
      family_id: familyId,
      week,
      day,
      session: "day",
      checked_foods: checkedFoods,
      completed_at: completedAt,
      is_skipped: isSkipped,
      schedule_snapshot: scheduleSnapshot,
      ramp_active: rampActive,
    })
  if (error) throw error
}
```

- [ ] **Step 4: Fix the two existing call sites so the project still compiles**

In `app/daily/page.tsx`, both current calls to `saveDoseLog` are missing the 7th argument. Add a literal `false` to each — this is accurate for the current state of the build (Reaction Ramp isn't wired into either call site yet; Task 9 will replace the `handleCompleteDay` one with the real computed value):

- Line ~189 (inside the lazy auto-rollover reconciliation block): change
  ```ts
  await saveDoseLog(yWeek, yDay, yCheckedFoods, dayDate, s, yIsSkipped)
  ```
  to
  ```ts
  await saveDoseLog(yWeek, yDay, yCheckedFoods, dayDate, s, yIsSkipped, false)
  ```
  This one stays `false` permanently, even after Task 9 — the auto-rollover path reconciles a missed day and never touches ramp state, so tagging it `ramp_active: true` would be inaccurate regardless of whether a ramp happens to be active at today's load time.

- Line ~319 (inside `handleCompleteDay`): change
  ```ts
  await saveDoseLog(globalBefore.week, globalBefore.day, checkedFoods, completedAt, currentSchedule, isSkipped)
  ```
  to
  ```ts
  await saveDoseLog(globalBefore.week, globalBefore.day, checkedFoods, completedAt, currentSchedule, isSkipped, false)
  ```
  Task 9 replaces this `false` with the real ramp-aware value.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase.ts app/daily/page.tsx
git commit -m "feat: add Reaction Ramp data access functions, extend saveDoseLog with ramp_active"
```

---

### Task 5: `RampStepEditor` component

**Files:**
- Create: `components/RampStepEditor.tsx`

**Interfaces:**
- Consumes: `RampStep` from `@/lib/types` (Task 2).
- Produces: default export `RampStepEditor({ steps, onChange, disabled }: { steps: RampStep[]; onChange: (steps: RampStep[]) => void; disabled?: boolean })`. Used by Task 6's wizard (both the treatment-food step editor and the maintenance "same for all"/per-food editors).

- [ ] **Step 1: Write the component**

```tsx
"use client"

import { RampStep } from "@/lib/types"

interface RampStepEditorProps {
  steps: RampStep[]
  onChange: (steps: RampStep[]) => void
  disabled?: boolean
}

function emptyStep(): RampStep {
  return { dose: 0, unit: "ml", days: 7 }
}

export default function RampStepEditor({ steps, onChange, disabled = false }: RampStepEditorProps) {
  function updateStep(index: number, patch: Partial<RampStep>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function addStep() {
    onChange([...steps, emptyStep()])
  }

  function removeStep(index: number) {
    onChange(steps.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: "var(--color-bg-secondary)" }}
        >
          <span className="text-xs w-12" style={{ color: "var(--color-text-muted)" }}>Step {i + 1}</span>
          <input
            type="number"
            value={step.dose}
            onChange={e => updateStep(i, { dose: parseFloat(e.target.value) || 0 })}
            disabled={disabled}
            className="text-sm bg-white rounded px-2 py-1 w-16 outline-none"
            style={{ border: "0.5px solid var(--color-primary-border)", color: "var(--color-text-primary)" }}
            aria-label={`Step ${i + 1} dose`}
          />
          <input
            type="text"
            value={step.unit}
            onChange={e => updateStep(i, { unit: e.target.value })}
            disabled={disabled}
            className="text-sm bg-white rounded px-2 py-1 w-14 outline-none"
            style={{ border: "0.5px solid var(--color-primary-border)", color: "var(--color-text-primary)" }}
            aria-label={`Step ${i + 1} unit`}
          />
          <input
            type="number"
            value={step.days}
            onChange={e => updateStep(i, { days: parseInt(e.target.value, 10) || 1 })}
            disabled={disabled}
            className="text-sm bg-white rounded px-2 py-1 w-14 outline-none"
            style={{ border: "0.5px solid var(--color-primary-border)", color: "var(--color-text-primary)" }}
            aria-label={`Step ${i + 1} days`}
          />
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>days</span>
          <button
            type="button"
            onClick={() => removeStep(i)}
            disabled={disabled || steps.length <= 1}
            className="ml-auto text-xs disabled:opacity-30"
            style={{ color: "#dc2626" }}
            aria-label={`Remove step ${i + 1}`}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addStep}
        disabled={disabled}
        className="text-sm text-left px-1"
        style={{ color: "var(--color-primary-mid)" }}
      >
        + Add step
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (No consumer exists yet — this only checks the file itself is well-typed.)

- [ ] **Step 3: Commit**

```bash
git add components/RampStepEditor.tsx
git commit -m "feat: add RampStepEditor component"
```

---

### Task 6: Reaction Ramp Settings wizard (`app/reaction-ramp/page.tsx`)

**Files:**
- Create: `app/reaction-ramp/page.tsx`

**Interfaces:**
- Consumes: `fetchSchedule`, `fetchFoodProgress`, `fetchReactionRamp`, `saveReactionRamp`, `getSession` from `@/lib/supabase` (Task 4); `getTreatmentFoodEntry`, `getGlobalPosition` from `@/lib/schedule` (pre-existing); `RampStepEditor` from `@/components/RampStepEditor` (Task 5); `ReactionRamp`, `RampStep`, `RampTreatmentFood`, `RampMaintenanceFood` from `@/lib/types` (Task 2).
- Produces: the `/reaction-ramp` route, linked from Task 7's Settings page for both "Start Reaction Ramp" and "Edit Reaction Ramp".

This route is dual-purpose (create vs. edit) based on whether `fetchReactionRamp()` returns a ramp on load — no query param needed, matching how `/new-cycle` needs none either.

- [ ] **Step 1: Write the wizard**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { FoodProgress, ReactionRamp, RampStep, RampTreatmentFood, RampMaintenanceFood } from "@/lib/types"
import { fetchSchedule, fetchFoodProgress, fetchReactionRamp, saveReactionRamp, getSession } from "@/lib/supabase"
import { getTreatmentFoodEntry, getGlobalPosition } from "@/lib/schedule"
import RampStepEditor from "@/components/RampStepEditor"
import CTAButton from "@/components/ui/CTAButton"

type RampView = "loading" | "treatment" | "maintenance" | "review" | "success"

interface TreatmentDraft {
  name: string
  included: boolean
  steps: RampStep[]
  returnDose: number
  returnUnit: string
  wasCapped: boolean
  referenceDose: number
  referenceUnit: string
}

interface MaintenanceDraft {
  name: string
  included: boolean
  steps: RampStep[]
  referenceDose: number
  referenceUnit: string
}

function defaultStep(dose: number, unit: string): RampStep {
  return { dose, unit, days: 7 }
}

export default function ReactionRampPage() {
  const router = useRouter()
  const [view, setView] = useState<RampView>("loading")
  const [isEditMode, setIsEditMode] = useState(false)
  const [existingRamp, setExistingRamp] = useState<ReactionRamp | null>(null)
  const [treatmentDrafts, setTreatmentDrafts] = useState<TreatmentDraft[]>([])
  const [maintenanceDrafts, setMaintenanceDrafts] = useState<MaintenanceDraft[]>([])
  const [adjustMaintenance, setAdjustMaintenance] = useState(false)
  const [maintenanceMode, setMaintenanceMode] = useState<"same" | "different">("different")
  const [sharedMaintenanceSteps, setSharedMaintenanceSteps] = useState<RampStep[]>([defaultStep(0, "ml")])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      let session
      try { session = await getSession() } catch { router.replace("/login"); return }
      if (!session) { router.replace("/login"); return }

      const [schedule, progress, ramp] = await Promise.all([
        fetchSchedule().catch(() => null),
        fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
        fetchReactionRamp().catch(() => null),
      ])
      if (!schedule) { router.replace("/setup"); return }

      const rampTreatmentByName = new Map((ramp?.treatmentFoods ?? []).map(f => [f.name, f]))
      const treatmentInit: TreatmentDraft[] = schedule.treatmentFoods.map(food => {
        const fp = progress.get(food.name)
        const { weekEntry } = getTreatmentFoodEntry(food, fp?.week ?? 1)
        const existing = rampTreatmentByName.get(food.name)
        return {
          name: food.name,
          included: !!existing,
          steps: existing ? existing.steps.map(s => ({ ...s })) : [defaultStep(weekEntry.dose, weekEntry.unit)],
          returnDose: existing ? existing.returnDose : weekEntry.dose,
          returnUnit: existing ? existing.returnUnit : weekEntry.unit,
          wasCapped: existing ? existing.wasCapped : false,
          referenceDose: weekEntry.dose,
          referenceUnit: weekEntry.unit,
        }
      })

      const rampMaintenanceByName = new Map((ramp?.maintenanceFoods ?? []).map(f => [f.name, f]))
      const maintenanceInit: MaintenanceDraft[] = schedule.maintenanceFoods.map(food => {
        const existing = rampMaintenanceByName.get(food.name)
        return {
          name: food.name,
          included: !!existing,
          steps: existing ? existing.steps.map(s => ({ ...s })) : [defaultStep(food.dose, food.unit)],
          referenceDose: food.dose,
          referenceUnit: food.unit,
        }
      })

      setTreatmentDrafts(treatmentInit)
      setMaintenanceDrafts(maintenanceInit)
      setAdjustMaintenance(maintenanceInit.some(d => d.included))
      setIsEditMode(!!ramp)
      setExistingRamp(ramp)
      setView("treatment")
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateTreatmentDraft(index: number, patch: Partial<TreatmentDraft>) {
    setTreatmentDrafts(prev => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  function updateMaintenanceDraft(index: number, patch: Partial<MaintenanceDraft>) {
    setMaintenanceDrafts(prev => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  async function handleConfirm() {
    setSaving(true)
    setSaveError(null)
    try {
      const progress = await fetchFoodProgress()
      const globalPos = getGlobalPosition(progress)

      const treatmentFoods: RampTreatmentFood[] = treatmentDrafts
        .filter(d => d.included)
        .map(d => ({
          name: d.name,
          steps: d.steps,
          returnDose: d.returnDose,
          returnUnit: d.returnUnit,
          wasCapped: d.wasCapped,
          currentStep: 0,
          daysInStep: 0,
          complete: false,
        }))

      const maintenanceFoods: RampMaintenanceFood[] = adjustMaintenance
        ? maintenanceDrafts
            .filter(d => d.included)
            .map(d => ({
              name: d.name,
              steps: (maintenanceMode === "same" ? sharedMaintenanceSteps : d.steps).map(s => ({ ...s })),
              currentStep: 0,
              daysInStep: 0,
              complete: false,
            }))
        : []

      const ramp: ReactionRamp = isEditMode && existingRamp
        ? {
            active: true,
            startedAt: existingRamp.startedAt,
            rampDay: existingRamp.rampDay,
            startedAtWeek: existingRamp.startedAtWeek,
            startedAtDay: existingRamp.startedAtDay,
            treatmentFoods,
            maintenanceFoods,
          }
        : {
            active: true,
            startedAt: new Date().toISOString(),
            rampDay: 0,
            startedAtWeek: globalPos.week,
            startedAtDay: globalPos.day,
            treatmentFoods,
            maintenanceFoods,
          }

      await saveReactionRamp(ramp)
      setView("success")
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
    } finally {
      setSaving(false)
    }
  }

  if (view === "loading") return null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      <header
        className="px-4 pb-4 flex items-center gap-3"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <Link href="/settings" className="text-white" aria-label="Back to Settings">‹</Link>
        <h1 className="text-xl font-semibold text-white">
          {isEditMode ? "Edit Reaction Ramp" : "Start Reaction Ramp"}
        </h1>
      </header>

      <div className="px-4 pt-6 pb-24 flex flex-col gap-4">
        {view === "treatment" && (
          <>
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              Select the treatment foods affected by the reaction and enter the clinic&apos;s ramp-back plan.
            </p>
            {treatmentDrafts.map((draft, i) => (
              <div key={draft.name} className="bg-white rounded-xl p-4" style={{ border: "0.5px solid var(--color-primary-border)" }}>
                <label className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={draft.included}
                    onChange={e => updateTreatmentDraft(i, { included: e.target.checked })}
                  />
                  <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{draft.name}</span>
                  <span className="text-xs ml-auto" style={{ color: "var(--color-text-muted)" }}>
                    Currently {draft.referenceDose} {draft.referenceUnit}
                  </span>
                </label>
                {draft.included && (
                  <div className="flex flex-col gap-3 mt-2">
                    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={draft.wasCapped}
                        onChange={e => updateTreatmentDraft(i, { wasCapped: e.target.checked })}
                      />
                      CAPPED — exact dose, no more no less
                    </label>
                    <RampStepEditor
                      steps={draft.steps}
                      onChange={steps => updateTreatmentDraft(i, { steps })}
                      disabled={saving}
                    />
                  </div>
                )}
              </div>
            ))}
            <CTAButton onClick={() => setView("maintenance")} disabled={!treatmentDrafts.some(d => d.included)}>
              Next: Maintenance foods
            </CTAButton>
          </>
        )}

        {view === "maintenance" && (
          <>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={adjustMaintenance}
                onChange={e => setAdjustMaintenance(e.target.checked)}
              />
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Also adjusting maintenance foods?</span>
            </label>

            {adjustMaintenance && (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMaintenanceMode("same")}
                    className="text-sm px-3 py-2 rounded-lg"
                    style={{
                      background: maintenanceMode === "same" ? "var(--color-primary-mid)" : "var(--color-bg-secondary)",
                      color: maintenanceMode === "same" ? "#fff" : "var(--color-text-primary)",
                    }}
                  >
                    Same ramp for all
                  </button>
                  <button
                    type="button"
                    onClick={() => setMaintenanceMode("different")}
                    className="text-sm px-3 py-2 rounded-lg"
                    style={{
                      background: maintenanceMode === "different" ? "var(--color-primary-mid)" : "var(--color-bg-secondary)",
                      color: maintenanceMode === "different" ? "#fff" : "var(--color-text-primary)",
                    }}
                  >
                    Different per food
                  </button>
                </div>

                {maintenanceMode === "same" && (
                  <div className="bg-white rounded-xl p-4" style={{ border: "0.5px solid var(--color-primary-border)" }}>
                    <RampStepEditor steps={sharedMaintenanceSteps} onChange={setSharedMaintenanceSteps} disabled={saving} />
                  </div>
                )}

                {maintenanceDrafts.map((draft, i) => (
                  <div key={draft.name} className="bg-white rounded-xl p-4" style={{ border: "0.5px solid var(--color-primary-border)" }}>
                    <label className="flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        checked={draft.included}
                        onChange={e => updateMaintenanceDraft(i, { included: e.target.checked })}
                      />
                      <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{draft.name}</span>
                      <span className="text-xs ml-auto" style={{ color: "var(--color-text-muted)" }}>
                        Currently {draft.referenceDose} {draft.referenceUnit}
                      </span>
                    </label>
                    {draft.included && maintenanceMode === "different" && (
                      <RampStepEditor
                        steps={draft.steps}
                        onChange={steps => updateMaintenanceDraft(i, { steps })}
                        disabled={saving}
                      />
                    )}
                  </div>
                ))}
              </>
            )}

            <div className="flex gap-3">
              <CTAButton variant="secondary" onClick={() => setView("treatment")}>Back</CTAButton>
              <CTAButton onClick={() => setView("review")}>Review</CTAButton>
            </div>
          </>
        )}

        {view === "review" && (
          <>
            <div className="bg-white rounded-xl p-4 flex flex-col gap-3" style={{ border: "0.5px solid var(--color-primary-border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-secondary)" }}>
                Treatment foods
              </p>
              {treatmentDrafts.filter(d => d.included).map(d => (
                <div key={d.name} className="text-sm" style={{ color: "var(--color-text-primary)" }}>
                  <p className="font-medium">{d.name}{d.wasCapped ? " · CAPPED" : ""}</p>
                  {d.steps.map((s, i) => (
                    <p key={i} className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      Step {i + 1}: {s.dose} {s.unit} for {s.days} days
                    </p>
                  ))}
                </div>
              ))}
              {adjustMaintenance && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide mt-2" style={{ color: "var(--color-text-secondary)" }}>
                    Maintenance foods
                  </p>
                  {maintenanceDrafts.filter(d => d.included).map(d => (
                    <div key={d.name} className="text-sm" style={{ color: "var(--color-text-primary)" }}>
                      <p className="font-medium">{d.name}</p>
                      {(maintenanceMode === "same" ? sharedMaintenanceSteps : d.steps).map((s, i) => (
                        <p key={i} className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                          Step {i + 1}: {s.dose} {s.unit} for {s.days} days
                        </p>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
            {saveError && <p className="text-sm" style={{ color: "#dc2626" }}>{saveError}</p>}
            <div className="flex gap-3">
              <CTAButton variant="secondary" onClick={() => setView("maintenance")} disabled={saving}>Back</CTAButton>
              <CTAButton onClick={handleConfirm} disabled={saving}>
                {saving ? "Saving…" : isEditMode ? "Save changes" : "Start ramp"}
              </CTAButton>
            </div>
          </>
        )}

        {view === "success" && (
          <div className="flex flex-col items-center gap-4 pt-10">
            <p className="text-base font-semibold" style={{ color: "var(--color-text-primary)" }}>
              {isEditMode ? "Ramp updated" : "Reaction Ramp started"}
            </p>
            <Link
              href="/daily"
              className="block text-center w-full py-3 text-white text-sm font-semibold rounded-[16px]"
              style={{ background: "var(--color-primary-mid)" }}
            >
              Back to Daily View
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/reaction-ramp/page.tsx
git commit -m "feat: add Reaction Ramp Settings wizard"
```

---

### Task 7: Settings page entry (Start / Edit / Cancel)

**Files:**
- Modify: `app/settings/page.tsx`

**Interfaces:**
- Consumes: `fetchReactionRamp`, `saveReactionRamp` from `@/lib/supabase` (Task 4); `ReactionRamp` from `@/lib/types` (Task 2); links to `/reaction-ramp` (Task 6).
- Produces: nothing consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Add imports and state**

Add to the existing import from `@/lib/supabase` (currently starting at line 6):

```ts
  fetchReactionRamp,
  saveReactionRamp,
```

Add to the existing import from `@/lib/types` (line 31):

```ts
import { DoseState, ParsedSchedule, FoodGroup, FoodProgress, ReactionRamp } from "@/lib/types"
```

Add two new state variables alongside the other `useState` declarations (after `groupsSavedTimerRef`, line 79):

```ts
  const [activeRamp, setActiveRamp] = useState<ReactionRamp | null>(null)
  const [confirmingCancelRamp, setConfirmingCancelRamp] = useState(false)
  const [rampCancelError, setRampCancelError] = useState<string | null>(null)
```

- [ ] **Step 2: Fetch the ramp on load**

In the `load()` function's `Promise.all` (currently 8 entries, lines 90–99), add a 9th:

```ts
        const [name, ds, notifSettings, groups, sched, photoUrl, vNum, progress, ramp] = await Promise.all([
          fetchFamilyName().catch(() => null),
          fetchDoseState().catch(() => null),
          fetchNotificationSettings().catch(() => null),
          fetchFoodGroups().catch(() => []),
          fetchSchedule().catch(() => null),
          fetchChildPhotoUrl().catch(() => null),
          fetchVisitNumber().catch(() => null),
          fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
          fetchReactionRamp().catch(() => null),
        ])
```

And after the existing `setFoodProgress(progress)` line, add:

```ts
        setActiveRamp(ramp)
```

- [ ] **Step 3: Add the cancel handler**

Add near `handleGroupsChange` (after it, before `handlePhotoChange`):

```ts
  async function handleCancelRamp() {
    setRampCancelError(null)
    try {
      await saveReactionRamp({
        active: false,
        startedAt: "",
        rampDay: 0,
        startedAtWeek: 0,
        startedAtDay: 0,
        treatmentFoods: [],
        maintenanceFoods: [],
      })
      setActiveRamp(null)
      setConfirmingCancelRamp(false)
    } catch {
      setRampCancelError("Cancel failed — please try again")
    }
  }
```

- [ ] **Step 4: Add the UI section**

In the JSX, immediately after the "New food cycle" `<Link>` block and its following `<RowDivider />` (currently lines 428–432), and before the "Re-parse schedule" `<Link>`, insert:

```tsx
            <RowDivider />
            {/* Reaction Ramp */}
            {activeRamp ? (
              <>
                <Link href="/reaction-ramp" className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Edit Reaction Ramp</span>
                  <span style={{ color: "var(--color-text-muted)" }}>›</span>
                </Link>
                <RowDivider />
                {confirmingCancelRamp ? (
                  <div className="px-4 py-3 flex items-center gap-3">
                    <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Cancel ramp?</span>
                    <button className="text-sm font-medium ml-auto" style={{ color: "#dc2626" }} onClick={handleCancelRamp}>
                      Yes, cancel
                    </button>
                    <button className="text-sm" style={{ color: "var(--color-text-muted)" }} onClick={() => setConfirmingCancelRamp(false)}>
                      Never mind
                    </button>
                  </div>
                ) : (
                  <button className="w-full flex items-center px-4 py-3 text-left" onClick={() => setConfirmingCancelRamp(true)}>
                    <span className="text-sm" style={{ color: "#dc2626" }}>Cancel Reaction Ramp</span>
                  </button>
                )}
                {rampCancelError && (
                  <p className="px-4 pb-3 text-xs" style={{ color: "#dc2626" }}>{rampCancelError}</p>
                )}
              </>
            ) : (
              <Link href="/reaction-ramp" className="flex items-center justify-between px-4 py-3">
                <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Start Reaction Ramp</span>
                <span style={{ color: "var(--color-text-muted)" }}>›</span>
              </Link>
            )}
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`, sign in, open `/settings`. Confirm: "Start Reaction Ramp" row appears below "New food cycle" and above "Re-parse schedule"; tapping it navigates to `/reaction-ramp`.

- [ ] **Step 7: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat: add Reaction Ramp entry to Settings"
```

---

### Task 8: Daily view dose override wiring

**Files:**
- Modify: `components/EveningSection.tsx`
- Modify: `components/MorningSection.tsx`
- Modify: `components/DailyView.tsx`

**Interfaces:**
- Consumes: `RampDoseOverride`, `ReactionRamp` from `@/lib/types` (Task 2); `treatmentRampDone` from `@/lib/schedule` (Task 3).
- Produces: `EveningSectionProps.treatmentRampOverrides?: Map<string, RampDoseOverride>`, `MorningSectionProps.maintenanceRampOverrides?: Map<string, RampDoseOverride>`, `DailyViewProps.reactionRamp: ReactionRamp | null`, `DailyViewProps.treatmentRampOverrides: Map<string, RampDoseOverride>`, `DailyViewProps.maintenanceRampOverrides: Map<string, RampDoseOverride>`. Task 9 (`app/daily/page.tsx`) computes and passes these three new `DailyView` props.

- [ ] **Step 1: `EveningSection.tsx` — accept and apply treatment overrides**

Add to the import line: `import { ParsedSchedule, FoodProgress, Medication, RampDoseOverride } from "@/lib/types"`

Add to `EveningSectionProps` (after `foodProgress: Map<string, FoodProgress>`):

```ts
  treatmentRampOverrides?: Map<string, RampDoseOverride>
```

Add to the destructured props (after `foodProgress,`):

```ts
  treatmentRampOverrides = new Map(),
```

Replace the treatment-foods `.map` block:

```tsx
          {treatmentFoods.map(food => {
            const fp = foodProgress.get(food.name)
            const foodWeek = fp?.week ?? currentWeek
            const { weekEntry, isContinuing } = getTreatmentFoodEntry(food, foodWeek)
            const weekBadge = !inSync && fp ? `Wk ${fp.week} · Day ${fp.day}` : undefined
            const key = `evening-${food.name}`
            const rampOverride = treatmentRampOverrides.get(food.name)
            return (
              <FoodItem
                key={key}
                name={food.name}
                dose={rampOverride?.dose ?? weekEntry.dose}
                unit={rampOverride?.unit ?? weekEntry.unit}
                prepNote={null}
                capped={rampOverride?.capped ?? false}
                session="evening"
                isContinuing={isContinuing}
                checked={!!checkedFoods[key]}
                onChange={val => onCheck(key, val)}
                weekBadge={weekBadge}
              />
            )
          })}
```

- [ ] **Step 2: `MorningSection.tsx` — accept and apply maintenance overrides**

Add to the import line: `import { ParsedSchedule, FoodGroup, MaintenanceFood, WeeklyFood, Medication, RampDoseOverride } from "@/lib/types"`

Add to `MorningSectionProps` (after `foodGroups: FoodGroup[]`):

```ts
  maintenanceRampOverrides?: Map<string, RampDoseOverride>
```

Add to the function's destructured params (after `foodGroups,`):

```ts
  maintenanceRampOverrides = new Map(),
```

Replace the standalone/weekly item render block inside `items.map`:

```tsx
          const isWeekly = item.type === "weekly"
          const key = `${item.prefix}-${item.food.name}`
          const rampOverride = item.type === "standalone" ? maintenanceRampOverrides.get(item.food.name) : undefined
          return (
            <FoodItem
              key={key}
              name={item.food.name}
              dose={rampOverride?.dose ?? item.food.dose}
              unit={rampOverride?.unit ?? item.food.unit}
              prepNote={item.food.prepNote ?? null}
              capped={"capped" in item.food ? item.food.capped : false}
              session="morning"
              isWeekly={isWeekly}
              isContinuing={false}
              checked={!!checkedFoods[key]}
              disabled={isFutureDay}
              onChange={val => onCheck(key, val)}
            />
          )
```

(Ramp overrides deliberately do not apply to food-group members — Reaction Ramp's spec only covers standalone treatment/maintenance foods, and `FoodGroupRow`'s interface is untouched here, same boundary Cross-Category Logging drew around Food Grouping.)

- [ ] **Step 3: `DailyView.tsx` — accept ramp props, render banner, thread overrides down**

Add to the import line: `import { ParsedSchedule, DoseState, DayRecord, FoodGroup, FoodProgress, ReactionRamp, RampDoseOverride } from "@/lib/types"`
Add `treatmentRampDone` to the existing `@/lib/schedule` import (currently `import { getTotalTreatmentWeeks, calculateBufferFromProgress, getVisitIndex, applyCrossCategoryCredit } from "@/lib/schedule"`).

Add to `DailyViewProps` (after `onCrossCategoryCredit: (updated: Record<string, Record<string, number>>) => void`):

```ts
  reactionRamp: ReactionRamp | null
  treatmentRampOverrides: Map<string, RampDoseOverride>
  maintenanceRampOverrides: Map<string, RampDoseOverride>
```

Add to the destructured function params (after `onCrossCategoryCredit,`):

```ts
  reactionRamp,
  treatmentRampOverrides,
  maintenanceRampOverrides,
```

Insert the ramp banner as the first child of the `{/* Body */}` div, before the existing `{bannerInfo && isCurrentTreatmentDay && (...)}` block:

```tsx
        {reactionRamp?.active && !treatmentRampDone(reactionRamp) && (
          <div
            className="mb-4 px-4 py-3 rounded-xl flex items-center justify-between"
            style={{ background: "#fff8e1", border: "0.5px solid #ffe082" }}
          >
            <p className="text-sm font-medium" style={{ color: "#795548" }}>
              Reaction Ramp · Day {reactionRamp.rampDay}
            </p>
            <Link href="/reaction-ramp" className="text-sm font-semibold underline" style={{ color: "#795548" }}>
              Edit
            </Link>
          </div>
        )}
```

Pass the overrides down to the two sections:

```tsx
            <MorningSection
              schedule={schedule}
              currentDay={currentDay}
              checkedFoods={checkedFoods}
              onCheck={handleCheck}
              isFutureDay={isFutureDay}
              foodGroups={foodGroups}
              maintenanceRampOverrides={maintenanceRampOverrides}
            />
            <EveningSection
              schedule={schedule}
              currentWeek={currentWeek}
              checkedFoods={checkedFoods}
              onCheck={handleCheck}
              onSkipMorning={onSkipMorning}
              onCompleteDayTap={onCompleteDay}
              isFutureDay={isFutureDay}
              isCurrentTreatmentDay={isCurrentTreatmentDay}
              isSkipped={isSkipped}
              foodProgress={foodProgress}
              treatmentRampOverrides={treatmentRampOverrides}
            />
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors — `app/daily/page.tsx` (the only caller of `<DailyView>`) is now missing the three new required props. This is expected; Task 9 fixes it. Confirm the errors are exactly the three missing props on `DailyView` usage in `app/daily/page.tsx`, and nothing else.

- [ ] **Step 5: Commit**

```bash
git add components/EveningSection.tsx components/MorningSection.tsx components/DailyView.tsx
git commit -m "feat: wire Reaction Ramp dose overrides and banner into daily view components"
```

---

### Task 9: Complete Day ramp integration (`app/daily/page.tsx`)

**Files:**
- Modify: `app/daily/page.tsx`

**Interfaces:**
- Consumes: `fetchReactionRamp`, `saveReactionRamp`, `appendPreviousRamp` from `@/lib/supabase` (Task 4); `treatmentRampActive`, `treatmentRampDone`, `advanceRampStepState`, `getRampOverrides` from `@/lib/schedule` (Task 3); `ReactionRamp` from `@/lib/types` (Task 2); the three new `DailyView` props from Task 8.
- Produces: nothing consumed elsewhere — this is the final integration point. After this task the project compiles clean and the feature is complete end-to-end.

- [ ] **Step 1: Update imports**

Change the `@/lib/types` import:

```ts
import { ParsedSchedule, DoseState, DayRecord, FoodGroup, FoodProgress, ReactionRamp } from "@/lib/types"
```

Change the `@/lib/supabase` import to add three functions (append to the existing list):

```ts
  fetchReactionRamp,
  saveReactionRamp,
  appendPreviousRamp,
```

Change the `@/lib/schedule` import:

```ts
import { todayDateString, addDays, getTreatmentFoodsForWeek, getGlobalPosition, treatmentRampActive, treatmentRampDone, advanceRampStepState, getRampOverrides } from "@/lib/schedule"
```

- [ ] **Step 2: Add ramp state and ref**

After the existing `recommendedFoodCountsRef` declaration (line 57), add:

```ts
  const [reactionRamp, setReactionRamp] = useState<ReactionRamp | null>(null)
  const reactionRampRef = useRef<ReactionRamp | null>(null)
```

- [ ] **Step 3: Fetch the ramp on load**

In `load()`'s `Promise.all` (the 9-entry array starting `const [ds, apptDate, name, positions, records, groups, vNum, rawProgress, photoUrl] = ...`), add a 10th fetch and destructured value:

```ts
        const [ds, apptDate, name, positions, records, groups, vNum, rawProgress, photoUrl, ramp] = await Promise.all([
          fetchDoseState(),
          fetchAppointmentDate().catch(() => null),
          fetchFamilyName().catch(() => null),
          fetchCompletedPositions().catch(() => new Set<string>()),
          fetchDayRecords().catch(() => new Map<string, DayRecord>()),
          fetchFoodGroups().catch(() => []),
          fetchVisitNumber().catch(() => null),
          fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
          fetchChildPhotoUrl().catch(() => null),
          fetchReactionRamp().catch(() => null),
        ])
```

After the existing `setChildPhotoUrl(photoUrl)` line, add:

```ts
        setReactionRamp(ramp)
        reactionRampRef.current = ramp
```

- [ ] **Step 4: Fix the auto-rollover `saveDoseLog` call**

This call site was already given a literal `false` 7th argument in Task 4 Step 4 and stays that way permanently (see Task 4's note) — no change needed here.

- [ ] **Step 5: Rewrite `handleCompleteDay`**

Replace the entire function:

```ts
  async function handleCompleteDay() {
    const current = doseStateRef.current
    if (!current || !hydrated) return

    const { checkedFoods } = current
    const foodProgress = foodProgressRef.current
    const completedAt = new Date().toISOString()
    const currentSchedule = schedule!

    if (foodProgress.size === 0 && currentSchedule.treatmentFoods.length > 0) return

    const ramp = reactionRampRef.current
    const wasTreatmentRampActive = treatmentRampActive(ramp)

    // Advance per-food progress for every checked evening treatment food.
    // A food that's actively ramping (and not yet done with its own steps)
    // is frozen here — its ramp entry advances instead, see below.
    const updatedProgress = new Map(foodProgress)
    const updatedRampTreatmentFoods = ramp ? ramp.treatmentFoods.map(f => ({ ...f })) : []
    for (const food of currentSchedule.treatmentFoods) {
      const key = `evening-${food.name}`
      if (!checkedFoods[key]) continue

      const rampIndex = updatedRampTreatmentFoods.findIndex(f => f.name === food.name)
      if (wasTreatmentRampActive && rampIndex !== -1) {
        const rampFood = updatedRampTreatmentFoods[rampIndex]
        updatedRampTreatmentFoods[rampIndex] = { ...rampFood, ...advanceRampStepState(rampFood) }
        continue
      }

      const fp = updatedProgress.get(food.name)
      if (!fp) continue
      const newCompletedDays = fp.completedDays + 1
      if (newCompletedDays >= 7) {
        updatedProgress.set(food.name, { ...fp, week: fp.week + 1, day: 1, completedDays: 0, lastCompletedAt: completedAt })
      } else {
        updatedProgress.set(food.name, { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: completedAt })
      }
    }

    // Maintenance ramp foods advance independently of the treatment side,
    // gated on that specific food having been checked this morning.
    const updatedRampMaintenanceFoods = ramp
      ? ramp.maintenanceFoods.map(f => {
          if (f.complete) return { ...f }
          if (!checkedFoods[`morning-${f.name}`]) return { ...f }
          return { ...f, ...advanceRampStepState(f) }
        })
      : []

    // Log uses the global position BEFORE advancement (the position just completed)
    const globalBefore = getGlobalPosition(foodProgress)

    try {
      await saveFoodProgress(updatedProgress)
    } catch {
      // Save failed — continue; local state still reflects progress
    }

    const isSkipped =
      currentSchedule.treatmentFoods.length > 0 &&
      !currentSchedule.treatmentFoods.some(food => !!checkedFoods[`evening-${food.name}`])

    try {
      await saveDoseLog(
        globalBefore.week,
        globalBefore.day,
        checkedFoods,
        completedAt,
        currentSchedule,
        isSkipped,
        ramp?.active ?? false
      )
    } catch {
      // Log failed — local state still reflects the checked foods either way
    }

    let updatedRamp: ReactionRamp | null = null
    if (ramp) {
      const nextRamp: ReactionRamp = {
        ...ramp,
        rampDay: ramp.active ? ramp.rampDay + 1 : ramp.rampDay,
        treatmentFoods: updatedRampTreatmentFoods,
        maintenanceFoods: updatedRampMaintenanceFoods,
      }

      const justFinishedTreatment = wasTreatmentRampActive && treatmentRampDone(nextRamp)
      if (justFinishedTreatment) {
        try {
          await appendPreviousRamp({
            startedAt: ramp.startedAt,
            endedAt: completedAt,
            rampDayCount: nextRamp.rampDay,
            treatmentFoods: nextRamp.treatmentFoods,
            maintenanceFoods: nextRamp.maintenanceFoods,
          })
        } catch {
          // History write failed — non-critical, ramp state itself still updates below
        }
      }

      const maintenanceDone = nextRamp.maintenanceFoods.every(f => f.complete)
      updatedRamp = justFinishedTreatment && maintenanceDone
        ? { active: false, startedAt: "", rampDay: 0, startedAtWeek: 0, startedAtDay: 0, treatmentFoods: [], maintenanceFoods: [] }
        : nextRamp

      try {
        await saveReactionRamp(updatedRamp)
      } catch {
        // Save failed — local state still reflects today's advancement
      }
    }

    const newGlobal = getGlobalPosition(updatedProgress)

    setFoodProgress(updatedProgress)
    foodProgressRef.current = updatedProgress
    if (ramp) {
      setReactionRamp(updatedRamp)
      reactionRampRef.current = updatedRamp
    }
    setDoseState(prev => {
      if (!prev) return prev
      return { ...prev, currentWeek: newGlobal.week, currentDay: newGlobal.day }
    })
    setTreatmentAnchor(newGlobal)

    setCompletedPositions(prev => {
      const next = new Set(prev)
      next.add(`${globalBefore.week}-${globalBefore.day}`)
      return next
    })

    setDayRecords(prev => {
      const next = new Map(prev)
      next.set(`${globalBefore.week}-${globalBefore.day}`, { date: completedAt, skipped: false })
      return next
    })
  }
```

- [ ] **Step 6: Compute overrides and pass the three new props to `DailyView`**

Immediately before the `return (` at the end of the component, add:

```ts
  const { treatment: treatmentRampOverrides, maintenance: maintenanceRampOverrides } = getRampOverrides(reactionRamp)
```

Update the `<DailyView>` JSX to add three props (after `onCrossCategoryCredit={handleCrossCategoryCredit}`):

```tsx
      onCrossCategoryCredit={handleCrossCategoryCredit}
      reactionRamp={reactionRamp}
      treatmentRampOverrides={treatmentRampOverrides}
      maintenanceRampOverrides={maintenanceRampOverrides}
    />
```

- [ ] **Step 7: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors — this resolves the three missing-prop errors introduced at the end of Task 8.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS — all `lib/schedule.test.ts` tests (Cross-Category Logging's pre-existing suite plus Task 3's new Reaction Ramp suite).

- [ ] **Step 9: Manual smoke test against a live dev server**

Run: `npm run dev`. Sign in with the test account (`daniel.behrman+test1@gmail.com` per BRIEF.md). Walk through:
1. Settings → Start Reaction Ramp → include one treatment food with a 2-step plan (e.g. step 1: current dose ÷ 2 for 2 days, step 2: current dose for 2 days) → Review → Start ramp.
2. Daily view shows the "Reaction Ramp · Day 0" banner and the included food's card shows the step-1 dose.
3. Tap Complete Day with that food checked. Confirm: banner now reads "Day 1", the food's card still shows step-1 dose (only 1 of 2 days elapsed), week/day header is unchanged from before Complete Day.
4. Tap Complete Day a second time. Confirm: food's card now shows step-2 dose, banner reads "Day 2".
5. Tap Complete Day two more times (completing step 2's 2 days). Confirm: banner disappears, week/day header advances by one day (counter resumed), food's card shows its normal schedule-derived dose (not `returnDose` held forever).
6. Settings confirms no active ramp remains (row reverts to "Start Reaction Ramp").

- [ ] **Step 10: Commit**

```bash
git add app/daily/page.tsx
git commit -m "feat: integrate Reaction Ramp into Complete Day and daily view render"
```
