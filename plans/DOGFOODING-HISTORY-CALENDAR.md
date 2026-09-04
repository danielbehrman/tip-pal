# History Calendar + Unified Day Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace two disconnected day-editing surfaces (the Today tab's cosmetic-only back-arrow, and the 3-day forward-only `/history/edit` page) with one shared, correct mechanism: `dose_log` as the single source of truth, a symmetric per-food edge-only advance/regress position function, and a confirmation step whenever an edit would change the current position. History becomes a month-by-month calendar with day-status icons; the Today tab keeps a 10-calendar-day shortcut into the same mechanism.

**Architecture:** Two new pure, tested functions in `lib/schedule.ts` (`getFoodEdgeState`, `advanceFoodProgress`/`regressFoodProgress`, and `classifyDoseLogDay`) are the correctness core. One new shared component, `components/DayEditor.tsx`, owns the entire view→edit→save→confirm flow and all its I/O orchestration; both `DailyView.tsx` (10-day shortcut) and the new `HistoryCalendar.tsx` (unlimited reach) render it identically — there is exactly one implementation of "edit a past day." `/history/edit`, `RecentDaysEditor.tsx`, `DoseHistoryLog.tsx`, and `fetchRecentCompletedDays`/`fetchAllDoseLogDays` are removed, superseded by a single date-range-bounded fetch.

**Tech Stack:** Next.js (App Router), Supabase (Postgres + `@supabase/supabase-js`), TypeScript, Vitest for pure-function unit tests.

## Global Constraints

- Only treatment-food state affects position; maintenance/medication checkbox state remains informational-only — matches the existing Complete Day rule.
- No change to how Complete Day works for the live current day — this plan only concerns days strictly before today.
- No change to the lazy auto-rollover reconciliation mechanism itself (`app/daily/page.tsx`) — it continues to write the initial `dose_log` row for a missed day exactly as today; this plan only changes how that row is later viewed and corrected.
- A food's checkbox is only ever interactive on the one day that is exactly its current edge (the next day it's waiting on, or the single most recently completed day) — every other day for that food is locked/historical, in edit mode or not.
- Saving a day always persists that day's `checked_foods`, regardless of whether any food was at its edge; only the *position* recompute (FoodProgress/dose_state) is gated to edge foods.
- Whenever a save would change the current week/day position, show a confirmation screen stating that plainly and requiring explicit confirmation before committing.
- Today tab back-arrow reach: trailing 10 real calendar days from today (not a dosing-week or floor-position bound).
- History calendar: continuous month-by-month, reachable back to the family's onboarding/account-creation date (nothing earlier exists to show), forward-blocked at today.
- Calendar day-status icon rules (visually approved, see `.superpowers/brainstorm/91361-1788554608/content/calendar-icons.html`): green circle+check = every maintenance food, every treatment food, and every medication checked; green check alone = all treatment foods checked but something else missed; green line = at least one but not all treatment foods checked; red X = zero treatment foods checked; no icon = zero treatment foods were scheduled that day at all.
- Today and future calendar days show no status icon. Clicking today's cell navigates to the Today tab instead of opening the day editor.
- TypeScript strict, no `any`.
- Test command: `npm test` (runs `vitest run`).
- No code comments unless a WHY is genuinely non-obvious — matches this codebase's existing style.
- Every client component/page file starts with `"use client"`.
- Colors via the existing `var(--color-*)` tokens from `globals.css`, except where the codebase already uses a literal hex for a specific pattern (`#dc2626` destructive/error, `#22c55e` success/complete — both already used throughout this codebase).

## Refinements made while grounding the approved design spec in actual code

1. **A real correctness gap in the code being replaced, not just a design preference.** `/history/edit`'s `handleToggle` (`app/history/edit/page.tsx:69-138`) advances a food's `FoodProgress` on any unchecked→checked treatment-food toggle **without ever checking that the day being edited actually matches that food's current edge** (`entry.week`/`entry.day` vs. `fp.week`/`fp.day`). With only the 3 most-recently-logged days shown and foods usually roughly in sync, this was mostly harmless in practice. Once the calendar reaches any date ever logged, the same blind-increment logic could silently corrupt position by advancing a food from a stale day months old. `getFoodEdgeState` (Task 1) is not just new functionality — it closes a latent bug in the code it replaces.
2. **`getMedicationSessions(frequency)` already exists** (`lib/schedule.ts:190-202`) and must be used to build medication keys for the day-status classifier — a medication only has a `morning-med-`/`evening-med-` key for the session(s) its frequency text actually implies (e.g., a once-daily med never gets an evening key). Building both keys unconditionally for every medication would make "fully complete" nearly unreachable for once-daily meds.
3. **The bulk select/delete-days feature is being adapted, not dropped** (Project Owner explicit decision, mid-brainstorm) — `app/history/page.tsx`'s existing `selectMode`/`selectedIds`/`confirmTarget` state and `deleteDoseLogDays`/`deleteAllDoseLogDays` calls carry forward, re-scoped to the calendar's currently-visible month instead of a flat list. `fetchAllDoseLogDays` (previously used to render that flat list) becomes unused once the calendar fetches month-by-month, and is removed in Task 8.
4. **`FoodItem` (`components/FoodItem.tsx`) already supports `session: "med"` and a `disabled` prop** — the new `DayEditor` reuses this component directly for maintenance, treatment, and medication rows (read-only via `disabled`, or live per the edge-gating rule), rather than inventing new checkbox UI. `RecentDaysEditor.tsx` (being removed) never rendered medications at all — this is new coverage, not a port of existing behavior.
5. **"Earliest navigable month" is approximated as the month of the family's earliest `dose_log` row, not a literal account-creation-date field** — no such field is fetched anywhere in this codebase today, and adding one would be a larger change than this plan's scope. The earliest logged day is the practical bound anyway: there's nothing to show before it regardless of when the account was technically created.
6. **`fetchDoseState` recomputes `currentWeek`/`currentDay` live from `cycle_start_date`/`skip_count`** (`lib/supabase.ts:64-89`) and ignores the raw stored `current_week`/`current_day` columns entirely. Any position-changing save must go through `cycle_start_date` (via `cycleStartDateForPosition`) and `floor_week`/`floor_day`, exactly matching `/history/edit`'s existing write shape — writing only `current_week`/`current_day` would have no visible effect on the next load.

## File Structure

- `lib/schedule.ts` — modify. Adds `getFoodEdgeState`, `advanceFoodProgress`, `regressFoodProgress`, `classifyDoseLogDay`, `DayStatus` type.
- `lib/schedule.test.ts` — modify. Tests for the four functions above.
- `lib/supabase.ts` — modify. Adds `fetchDoseLogDaysInRange`. Removes `fetchRecentCompletedDays` and `fetchAllDoseLogDays` (Task 8, after their last callers are gone).
- `components/DayEditor.tsx` — new. The shared view→edit→save→confirm modal, consumed by both `DailyView.tsx` and `HistoryCalendar`'s host page. Owns all I/O orchestration for editing a day.
- `components/HistoryCalendar.tsx` — new. Month grid, day-status icons, month navigation, select-mode cell rendering.
- `components/DailyView.tsx` — modify. Real-calendar-date-bounded 10-day back-arrow reach; day label becomes a tap target opening `DayEditor` for past days; banner's dead `/history/edit` link removed (editing is now inline).
- `app/history/page.tsx` — modify. Renders `HistoryCalendar` instead of `DoseHistoryLog`; select-mode adapted to the visible month; "Edit" header link removed; wires `DayEditor`.
- `app/history/edit/page.tsx` — deleted (Task 8).
- `components/RecentDaysEditor.tsx` — deleted (Task 8).
- `components/DoseHistoryLog.tsx` — deleted (Task 8).

---

### Task 1: Pure position edge/advance/regress functions (TDD)

**Files:**
- Modify: `lib/schedule.ts` (append after `getFurthestAheadPosition`, lines 122-136)
- Modify: `lib/schedule.test.ts` (append new `describe` blocks; extend the top import)

**Interfaces:**
- Consumes: `FoodProgress` from `./types` (pre-existing); `positionIndexOf`, `positionFromIndex` from `./schedule` (pre-existing, lines 27-33).
- Produces:
  - `getFoodEdgeState(fp: FoodProgress, week: number, day: number): { canAdvance: boolean; canRegress: boolean }`
  - `advanceFoodProgress(fp: FoodProgress, completedAt: string): FoodProgress`
  - `regressFoodProgress(fp: FoodProgress): FoodProgress`

  Task 4 (`DayEditor.tsx`) calls all three.

- [ ] **Step 1: Write the failing tests**

Extend the top import in `lib/schedule.test.ts` (add `getFoodEdgeState, advanceFoodProgress, regressFoodProgress` to the existing `./schedule` import, and `FoodProgress` to the existing `./types` import if not already present):

```ts
import { /* ...existing names..., */ getFoodEdgeState, advanceFoodProgress, regressFoodProgress } from "./schedule"
```

Append to the end of the file:

```ts
function makeFoodProgress(overrides: Partial<FoodProgress> = {}): FoodProgress {
  return {
    foodName: "Peanut Gelatin",
    week: 2,
    day: 3,
    completedDays: 2,
    lastCompletedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("getFoodEdgeState", () => {
  it("canAdvance is true when the day matches the food's current (waiting-on) position exactly", () => {
    const fp = makeFoodProgress({ week: 2, day: 3 })
    expect(getFoodEdgeState(fp, 2, 3)).toEqual({ canAdvance: true, canRegress: false })
  })

  it("canRegress is true when the day matches the day immediately before the food's current position", () => {
    const fp = makeFoodProgress({ week: 2, day: 3 })
    expect(getFoodEdgeState(fp, 2, 2)).toEqual({ canAdvance: false, canRegress: true })
  })

  it("canRegress correctly crosses a week boundary backward", () => {
    const fp = makeFoodProgress({ week: 2, day: 1, completedDays: 0 })
    expect(getFoodEdgeState(fp, 1, 7)).toEqual({ canAdvance: false, canRegress: true })
  })

  it("neither is true for a day two or more steps away from the edge", () => {
    const fp = makeFoodProgress({ week: 2, day: 3 })
    expect(getFoodEdgeState(fp, 2, 1)).toEqual({ canAdvance: false, canRegress: false })
    expect(getFoodEdgeState(fp, 3, 1)).toEqual({ canAdvance: false, canRegress: false })
  })

  it("a brand-new food (week 1, day 1, completedDays 0) can advance but never regress", () => {
    const fp = makeFoodProgress({ week: 1, day: 1, completedDays: 0 })
    expect(getFoodEdgeState(fp, 1, 1)).toEqual({ canAdvance: true, canRegress: false })
  })
})

describe("advanceFoodProgress", () => {
  it("increments completedDays and day together mid-week", () => {
    const fp = makeFoodProgress({ week: 2, day: 3, completedDays: 2 })
    const result = advanceFoodProgress(fp, "2026-09-01T00:00:00.000Z")
    expect(result).toEqual({ ...fp, day: 4, completedDays: 3, lastCompletedAt: "2026-09-01T00:00:00.000Z" })
  })

  it("rolls into the next week when completedDays reaches 7", () => {
    const fp = makeFoodProgress({ week: 2, day: 7, completedDays: 6 })
    const result = advanceFoodProgress(fp, "2026-09-01T00:00:00.000Z")
    expect(result).toEqual({ ...fp, week: 3, day: 1, completedDays: 0, lastCompletedAt: "2026-09-01T00:00:00.000Z" })
  })
})

describe("regressFoodProgress", () => {
  it("decrements completedDays and day together mid-week", () => {
    const fp = makeFoodProgress({ week: 2, day: 4, completedDays: 3 })
    const result = regressFoodProgress(fp)
    expect(result).toEqual({ ...fp, day: 3, completedDays: 2, lastCompletedAt: null })
  })

  it("rolls back into the previous week when completedDays would go below 0", () => {
    const fp = makeFoodProgress({ week: 3, day: 1, completedDays: 0 })
    const result = regressFoodProgress(fp)
    expect(result).toEqual({ ...fp, week: 2, day: 7, completedDays: 6, lastCompletedAt: null })
  })

  it("is the exact inverse of advanceFoodProgress at a week boundary", () => {
    const fp = makeFoodProgress({ week: 2, day: 7, completedDays: 6 })
    const advanced = advanceFoodProgress(fp, "2026-09-01T00:00:00.000Z")
    const regressed = regressFoodProgress(advanced)
    expect(regressed).toEqual({ ...fp, lastCompletedAt: null })
  })

  it("is the exact inverse of advanceFoodProgress mid-week", () => {
    const fp = makeFoodProgress({ week: 2, day: 3, completedDays: 2 })
    const advanced = advanceFoodProgress(fp, "2026-09-01T00:00:00.000Z")
    const regressed = regressFoodProgress(advanced)
    expect(regressed).toEqual({ ...fp, lastCompletedAt: null })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `getFoodEdgeState`, `advanceFoodProgress`, `regressFoodProgress` are not exported from `./schedule`.

- [ ] **Step 3: Implement the three functions**

Append to `lib/schedule.ts`, after `getFurthestAheadPosition` (line 136):

```ts
export function getFoodEdgeState(
  fp: FoodProgress,
  week: number,
  day: number
): { canAdvance: boolean; canRegress: boolean } {
  const canAdvance = fp.week === week && fp.day === day
  const prevIndex = positionIndexOf(fp.week, fp.day) - 1
  const canRegress = prevIndex >= 0 && (() => {
    const prev = positionFromIndex(prevIndex)
    return prev.week === week && prev.day === day
  })()
  return { canAdvance, canRegress }
}

export function advanceFoodProgress(fp: FoodProgress, completedAt: string): FoodProgress {
  const newCompletedDays = fp.completedDays + 1
  return newCompletedDays >= 7
    ? { ...fp, week: fp.week + 1, day: 1, completedDays: 0, lastCompletedAt: completedAt }
    : { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: completedAt }
}

export function regressFoodProgress(fp: FoodProgress): FoodProgress {
  const newCompletedDays = fp.completedDays - 1
  return newCompletedDays < 0
    ? { ...fp, week: fp.week - 1, day: 7, completedDays: 6, lastCompletedAt: null }
    : { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: null }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `lib/schedule.test.ts`, including every pre-existing suite.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule.ts lib/schedule.test.ts
git commit -m "feat: add symmetric per-food edge/advance/regress position functions"
```

---

### Task 2: Pure day-status classifier (TDD)

**Files:**
- Modify: `lib/schedule.ts` (append after Task 1's functions)
- Modify: `lib/schedule.test.ts` (append new `describe` block; extend imports)

**Interfaces:**
- Consumes: `DoseLogDay`, `ParsedSchedule` from `./types` (pre-existing); `getTreatmentFoodsForWeek`, `getMedicationSessions` from `./schedule` (pre-existing, lines 79-93 and 190-202).
- Produces:
  - `export type DayStatus = "complete" | "treatment-complete" | "treatment-partial" | "treatment-missed" | "none-scheduled"`
  - `classifyDoseLogDay(entry: DoseLogDay, fallbackSchedule: ParsedSchedule): DayStatus`

  Task 6 (`HistoryCalendar.tsx`) calls this for every visible day cell.

- [ ] **Step 1: Write the failing tests**

Extend the top import in `lib/schedule.test.ts` (add `classifyDoseLogDay` to the `./schedule` import; add `DoseLogDay` to the `./types` import if not already present):

```ts
import { /* ...existing names..., */ classifyDoseLogDay } from "./schedule"
```

Append to the end of the file:

```ts
const classifierSchedule: ParsedSchedule = {
  maintenanceFoods: [{ name: "Denatured Donkey Milk", dose: 60, unit: "ml", capped: false, prepNote: "" }],
  weeklyFoods: [],
  treatmentFoods: [{ name: "Peanut Gelatin", weeks: [{ week: 1, dose: 10, unit: "ml", isFinal: false }] }],
  medications: [
    { name: "Zyrtec", dose: "5", unit: "ml", frequency: "once daily" },
    { name: "Flovent", dose: "2", unit: "puffs", frequency: "twice daily" },
  ],
}

function makeDoseLogDay(overrides: Partial<DoseLogDay> = {}): DoseLogDay {
  return {
    id: "day-1",
    week: 1,
    day: 3,
    completedAt: "2026-09-01T12:00:00.000Z",
    checkedFoods: {},
    scheduleSnapshot: classifierSchedule,
    morningSkipped: false,
    eveningSkipped: false,
    ...overrides,
  }
}

describe("classifyDoseLogDay", () => {
  it("is 'complete' when every maintenance food, treatment food, and medication is checked", () => {
    const entry = makeDoseLogDay({
      checkedFoods: {
        "evening-Peanut Gelatin": true,
        "morning-Denatured Donkey Milk": true,
        "morning-med-Zyrtec": true,
        "morning-med-Flovent": true,
        "evening-med-Flovent": true,
      },
    })
    expect(classifyDoseLogDay(entry, classifierSchedule)).toBe("complete")
  })

  it("is 'treatment-complete' when all treatment foods are checked but a medication is missed", () => {
    const entry = makeDoseLogDay({
      checkedFoods: {
        "evening-Peanut Gelatin": true,
        "morning-Denatured Donkey Milk": true,
        "morning-med-Zyrtec": true,
        // evening-med-Flovent and morning-med-Flovent both missing
      },
    })
    expect(classifyDoseLogDay(entry, classifierSchedule)).toBe("treatment-complete")
  })

  it("is 'treatment-partial' when at least one but not all treatment foods are checked", () => {
    const twoFoodSchedule: ParsedSchedule = {
      ...classifierSchedule,
      treatmentFoods: [
        { name: "Peanut Gelatin", weeks: [{ week: 1, dose: 10, unit: "ml", isFinal: false }] },
        { name: "Cashew", weeks: [{ week: 1, dose: 5, unit: "ml", isFinal: false }] },
      ],
    }
    const entry = makeDoseLogDay({
      scheduleSnapshot: twoFoodSchedule,
      checkedFoods: { "evening-Peanut Gelatin": true },
    })
    expect(classifyDoseLogDay(entry, twoFoodSchedule)).toBe("treatment-partial")
  })

  it("is 'treatment-missed' when zero treatment foods are checked", () => {
    const entry = makeDoseLogDay({ checkedFoods: {} })
    expect(classifyDoseLogDay(entry, classifierSchedule)).toBe("treatment-missed")
  })

  it("is 'none-scheduled' when the day's schedule snapshot has zero treatment foods", () => {
    const noTreatmentSchedule: ParsedSchedule = { ...classifierSchedule, treatmentFoods: [] }
    const entry = makeDoseLogDay({ scheduleSnapshot: noTreatmentSchedule })
    expect(classifyDoseLogDay(entry, noTreatmentSchedule)).toBe("none-scheduled")
  })

  it("falls back to the passed-in schedule when scheduleSnapshot is null", () => {
    const entry = makeDoseLogDay({
      scheduleSnapshot: null,
      checkedFoods: {
        "evening-Peanut Gelatin": true,
        "morning-Denatured Donkey Milk": true,
        "morning-med-Zyrtec": true,
        "morning-med-Flovent": true,
        "evening-med-Flovent": true,
      },
    })
    expect(classifyDoseLogDay(entry, classifierSchedule)).toBe("complete")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `classifyDoseLogDay` is not exported from `./schedule`.

- [ ] **Step 3: Implement the classifier**

Append to `lib/schedule.ts`:

```ts
export type DayStatus = "complete" | "treatment-complete" | "treatment-partial" | "treatment-missed" | "none-scheduled"

export function classifyDoseLogDay(entry: DoseLogDay, fallbackSchedule: ParsedSchedule): DayStatus {
  const s = entry.scheduleSnapshot ?? fallbackSchedule

  const treatmentKeys = getTreatmentFoodsForWeek(s, entry.week).map(({ food }) => `evening-${food.name}`)
  if (treatmentKeys.length === 0) return "none-scheduled"

  const treatmentCheckedCount = treatmentKeys.filter(k => entry.checkedFoods[k]).length
  if (treatmentCheckedCount === 0) return "treatment-missed"
  if (treatmentCheckedCount < treatmentKeys.length) return "treatment-partial"

  const maintenanceKeys = [
    ...s.maintenanceFoods.map(f => `morning-${f.name}`),
    ...(entry.day === 7 ? s.weeklyFoods.map(f => `morning-weekly-${f.name}`) : []),
  ]
  const medicationKeys = (s.medications ?? []).flatMap(med =>
    getMedicationSessions(med.frequency).map(session => `${session}-med-${med.name}`)
  )
  const allMaintenanceChecked = maintenanceKeys.every(k => entry.checkedFoods[k])
  const allMedsChecked = medicationKeys.every(k => entry.checkedFoods[k])

  return allMaintenanceChecked && allMedsChecked ? "complete" : "treatment-complete"
}
```

Add `DoseLogDay` to the existing `import { ... } from "./types"` line at the top of `lib/schedule.ts` if not already present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests including the new `classifyDoseLogDay` suite.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule.ts lib/schedule.test.ts
git commit -m "feat: add day-status classifier for the History calendar"
```

---

### Task 3: Data access — bounded date-range fetch

**Files:**
- Modify: `lib/supabase.ts` (insert after `fetchAllDoseLogDays`, lines 388-413)

**Interfaces:**
- Consumes: nothing new.
- Produces: `fetchDoseLogDaysInRange(startDate: string, endDate: string): Promise<DoseLogDay[]>` — `startDate`/`endDate` are `YYYY-MM-DD` strings (inclusive on both ends). Tasks 5, 6, and 7 all call this.

- [ ] **Step 1: Add the function**

Insert directly after `fetchAllDoseLogDays` (ends at line 413):

```ts
export async function fetchDoseLogDaysInRange(startDate: string, endDate: string): Promise<DoseLogDay[]> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("id, week, day, session, checked_foods, completed_at, is_skipped, schedule_snapshot")
    .eq("family_id", familyId)
    .gte("completed_at", `${startDate}T00:00:00.000Z`)
    .lte("completed_at", `${endDate}T23:59:59.999Z`)
    .order("completed_at", { ascending: false })
  if (error) throw error
  if (!data) return []
  const dayRows = data.filter(r => r.session === "day")
  return dayRows.map(dayRow => ({
    id: dayRow.id as string,
    week: dayRow.week as number,
    day: dayRow.day as number,
    completedAt: dayRow.completed_at as string,
    checkedFoods: (dayRow.checked_foods ?? {}) as Record<string, boolean>,
    scheduleSnapshot: (dayRow.schedule_snapshot ?? null) as ParsedSchedule | null,
    morningSkipped: data.some(
      r => r.week === dayRow.week && r.day === dayRow.day && r.session === "morning" && r.is_skipped
    ),
    eveningSkipped: data.some(
      r => r.week === dayRow.week && r.day === dayRow.day && r.session === "evening" && r.is_skipped
    ),
  }))
}
```

This mirrors `fetchAllDoseLogDays`/`fetchRecentCompletedDays`'s exact row-shaping logic (both of which this function supersedes), replacing their row-count caps with a real date range.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (additive-only, nothing consumes it yet).

- [ ] **Step 3: Commit**

```bash
git add lib/supabase.ts
git commit -m "feat: add fetchDoseLogDaysInRange for calendar and 10-day shortcut"
```

---

### Task 4: `DayEditor` — the shared view/edit/save/confirm component

**Files:**
- Create: `components/DayEditor.tsx`

**Interfaces:**
- Consumes: `getFoodEdgeState`, `advanceFoodProgress`, `regressFoodProgress`, `getTreatmentFoodsForWeek`, `getMedicationSessions`, `getGlobalPosition`, `cycleStartDateForPosition` from `@/lib/schedule` (Tasks 1-2, pre-existing); `updateDoseLogCheckedFoods`, `fetchFoodProgress`, `saveFoodProgress`, `fetchDoseState`, `saveDoseState` from `@/lib/supabase` (pre-existing); `DoseLogDay`, `ParsedSchedule`, `FoodProgress`, `DoseState` from `@/lib/types`; `FoodItem` from `@/components/FoodItem`.
- Produces: default export `DayEditor({ entry, fallbackSchedule, onClose, onSaved }: DayEditorProps)`, a full-screen modal. `onSaved` is called with the updated `DoseLogDay` after a successful save (so the caller can refresh its own list/calendar without a full refetch). Tasks 5 and 7 both render this component.

- [ ] **Step 1: Write the component**

```tsx
"use client"

import { useState } from "react"
import { DoseLogDay, ParsedSchedule, FoodProgress } from "@/lib/types"
import {
  getFoodEdgeState,
  advanceFoodProgress,
  regressFoodProgress,
  getTreatmentFoodsForWeek,
  getMedicationSessions,
  getGlobalPosition,
  cycleStartDateForPosition,
} from "@/lib/schedule"
import {
  updateDoseLogCheckedFoods,
  fetchFoodProgress,
  saveFoodProgress,
  fetchDoseState,
  saveDoseState,
} from "@/lib/supabase"
import FoodItem from "@/components/FoodItem"

interface DayEditorProps {
  entry: DoseLogDay
  fallbackSchedule: ParsedSchedule
  onClose: () => void
  onSaved: (updated: DoseLogDay) => void
}

interface Row {
  key: string
  name: string
  dose: number | string
  unit: string
  session: "morning" | "evening" | "med"
  isEdgeFood: boolean
}

export default function DayEditor({ entry, fallbackSchedule, onClose, onSaved }: DayEditorProps) {
  const s = entry.scheduleSnapshot ?? fallbackSchedule
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, boolean>>(entry.checkedFoods)
  const [foodProgress, setFoodProgress] = useState<Map<string, FoodProgress> | null>(null)
  const [loadingProgress, setLoadingProgress] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const treatmentEntries = getTreatmentFoodsForWeek(s, entry.week)
  const maintenanceRows: Row[] = [
    ...s.maintenanceFoods.map(f => ({
      key: `morning-${f.name}`, name: f.name, dose: f.dose, unit: f.unit, session: "morning" as const, isEdgeFood: false,
    })),
    ...(entry.day === 7
      ? s.weeklyFoods.map(f => ({
          key: `morning-weekly-${f.name}`, name: f.name, dose: f.dose, unit: f.unit, session: "morning" as const, isEdgeFood: false,
        }))
      : []),
  ]
  const medicationRows: Row[] = (s.medications ?? []).flatMap(med =>
    getMedicationSessions(med.frequency).map(session => ({
      key: `${session}-med-${med.name}`, name: med.name, dose: med.dose, unit: med.unit, session: "med" as const, isEdgeFood: false,
    }))
  )
  const treatmentRows: Row[] = treatmentEntries.map(({ food, weekEntry }) => ({
    key: `evening-${food.name}`, name: food.name, dose: weekEntry.dose, unit: weekEntry.unit, session: "evening" as const, isEdgeFood: true,
  }))

  async function startEditing() {
    setLoadingProgress(true)
    try {
      const progress = await fetchFoodProgress()
      setFoodProgress(progress)
      setEditing(true)
    } catch {
      setSaveError("Couldn't load current progress — please try again")
    } finally {
      setLoadingProgress(false)
    }
  }

  function isTreatmentRowEditable(foodName: string, wasChecked: boolean): boolean {
    if (!foodProgress) return false
    const fp = foodProgress.get(foodName)
    if (!fp) return false
    const { canAdvance, canRegress } = getFoodEdgeState(fp, entry.week, entry.day)
    return wasChecked ? canRegress : canAdvance
  }

  function toggle(key: string, val: boolean) {
    setDraft(prev => ({ ...prev, [key]: val }))
  }

  function willChangePosition(): boolean {
    if (!foodProgress) return false
    return treatmentRows.some(row => {
      const wasChecked = !!entry.checkedFoods[row.key]
      const nowChecked = !!draft[row.key]
      if (wasChecked === nowChecked) return false
      return isTreatmentRowEditable(row.name, wasChecked)
    })
  }

  async function commitSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await updateDoseLogCheckedFoods(entry.id, draft)

      if (foodProgress) {
        let nextProgress = foodProgress
        let changed = false
        for (const row of treatmentRows) {
          const wasChecked = !!entry.checkedFoods[row.key]
          const nowChecked = !!draft[row.key]
          if (wasChecked === nowChecked) continue
          const fp = nextProgress.get(row.name)
          if (!fp) continue
          const { canAdvance, canRegress } = getFoodEdgeState(fp, entry.week, entry.day)
          if (nowChecked && canAdvance) {
            const updated = new Map(nextProgress)
            updated.set(row.name, advanceFoodProgress(fp, new Date().toISOString()))
            nextProgress = updated
            changed = true
          } else if (!nowChecked && canRegress) {
            const updated = new Map(nextProgress)
            updated.set(row.name, regressFoodProgress(fp))
            nextProgress = updated
            changed = true
          }
        }
        if (changed) {
          await saveFoodProgress(nextProgress)
          const newGlobal = getGlobalPosition(nextProgress)
          const existing = await fetchDoseState().catch(() => null)
          if (existing) {
            await saveDoseState({
              ...existing,
              currentWeek: newGlobal.week,
              currentDay: newGlobal.day,
              cycleStartDate: cycleStartDateForPosition(newGlobal.week, newGlobal.day),
              floorWeek: newGlobal.week,
              floorDay: newGlobal.day,
            })
          }
        }
      }

      onSaved({ ...entry, checkedFoods: draft })
      onClose()
    } catch {
      setSaveError("Save failed — please try again")
    } finally {
      setSaving(false)
      setConfirming(false)
    }
  }

  function handleSaveTap() {
    if (willChangePosition()) {
      setConfirming(true)
    } else {
      commitSave()
    }
  }

  function renderRow(row: Row) {
    const checked = !!draft[row.key]
    const editable = editing && (row.session !== "evening" || isTreatmentRowEditable(row.name, !!entry.checkedFoods[row.key]))
    return (
      <FoodItem
        key={row.key}
        name={row.name}
        dose={row.dose}
        unit={row.unit}
        prepNote={null}
        capped={false}
        session={row.session}
        checked={checked}
        onChange={val => toggle(row.key, val)}
        disabled={!editable}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col" style={{ background: "var(--color-bg)" }}>
      <header
        className="px-4 pb-4 flex items-center justify-between"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <button onClick={onClose} className="text-white" aria-label="Close">‹ Close</button>
        <h1 className="text-base font-semibold text-white">Week {entry.week}, Day {entry.day}</h1>
        {editing ? (
          <button onClick={handleSaveTap} disabled={saving} className="text-white font-semibold disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        ) : (
          <button onClick={startEditing} disabled={loadingProgress} className="text-white font-semibold disabled:opacity-50">
            {loadingProgress ? "Loading…" : "Edit"}
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24 flex flex-col gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Maintenance</p>
          <div className="flex flex-col gap-2">{maintenanceRows.map(renderRow)}</div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Treatment</p>
          <div className="flex flex-col gap-2">{treatmentRows.map(renderRow)}</div>
        </div>
        {medicationRows.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-secondary)" }}>Medications</p>
            <div className="flex flex-col gap-2">{medicationRows.map(renderRow)}</div>
          </div>
        )}
        {saveError && <p className="text-sm" style={{ color: "#dc2626" }}>{saveError}</p>}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[80] flex items-end" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white w-full rounded-t-2xl px-6 pt-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <p className="text-base font-semibold mb-5" style={{ color: "var(--color-text-primary)" }}>
              This will change your current week/day position. Are you sure?
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--color-primary-mid)", color: "#fff" }}
                onClick={commitSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Yes, save"}
              </button>
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "var(--color-primary-border)", color: "var(--color-text-primary)" }}
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (No consumer exists yet — this only checks the file itself is well-typed.)

- [ ] **Step 3: Commit**

```bash
git add components/DayEditor.tsx
git commit -m "feat: add shared DayEditor view/edit/save/confirm component"
```

---

### Task 5: Today tab — 10-calendar-day shortcut

**Files:**
- Modify: `components/DailyView.tsx`

**Interfaces:**
- Consumes: `DayEditor` from `@/components/DayEditor` (Task 4); `fetchDoseLogDaysInRange` from `@/lib/supabase` (Task 3); `todayDateString`, `addDays`, `cycleStartDateForPosition` from `@/lib/schedule` (pre-existing).
- Produces: nothing consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Add imports**

Add to the existing import from `./schedule`:

```ts
import { getTotalTreatmentWeeks, calculateBufferFromProgress, getVisitIndex, applyCrossCategoryCredit, treatmentRampDone, todayDateString, addDays, cycleStartDateForPosition, positionFromIndex } from "@/lib/schedule"
```

Add two new imports:

```ts
import { fetchDoseLogDaysInRange } from "@/lib/supabase"
import DayEditor from "./DayEditor"
import { DoseLogDay } from "@/lib/types"
```

- [ ] **Step 2: Add state for the day-editor modal and a real-calendar-date past-day flag**

Add near the top of the component body, alongside the existing `infoSheetOpen` state:

```ts
  const [editingEntry, setEditingEntry] = useState<DoseLogDay | null>(null)
  const [editorLoading, setEditorLoading] = useState(false)
```

Add an explicit `isPastDay` boolean alongside the existing `isFutureDay`/`isCurrentTreatmentDay` (after line 128, `const isCurrentTreatmentDay = viewSeq === anchorSeq`):

```ts
  const isPastDay = viewSeq < anchorSeq
```

- [ ] **Step 3: Bound the back-arrow to a real trailing 10 calendar days**

Replace the existing `leftDisabled` (line 147):

```ts
const leftDisabled = viewSeq <= floorSeq
```

with a real-date-based bound, computed from the position being navigated *to* rather than the treatment-position floor:

```ts
  const tenDaysAgo = addDays(todayDateString(), -10)
  // viewSeq is 1-based ((week-1)*7+day); positionFromIndex expects a 0-based
  // index, and we want the position one step before the current view — so
  // the index is (viewSeq - 1) - 1 = viewSeq - 2.
  const target = positionFromIndex(viewSeq - 2)
  const targetDate = cycleStartDateForPosition(target.week, target.day)
  const leftDisabled = viewSeq <= floorSeq || targetDate < tenDaysAgo
```

This disables the left arrow once navigating one more day back would land before 10 real calendar days ago, in addition to the existing floor-position guard (which still prevents navigating before the last reset/onboarding).

- [ ] **Step 4: Make the day label a tap target that opens the editor for past days**

Replace the existing day-label block (the `<div className="text-center">` showing `dateLabel`/"Today"):

```tsx
<div className="text-center">
  <p className="font-medium" style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
    {isSkipped ? "Skipped" : dateLabel}
  </p>
  {isToday && (
    <p style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Today</p>
  )}
</div>
```

with:

```tsx
<button
  type="button"
  className="text-center"
  disabled={!isPastDay || editorLoading}
  onClick={async () => {
    setEditorLoading(true)
    try {
      const dateStr = cycleStartDateForPosition(currentWeek, currentDay)
      const [day] = await fetchDoseLogDaysInRange(dateStr, dateStr)
      if (day) setEditingEntry(day)
    } finally {
      setEditorLoading(false)
    }
  }}
>
  <p className="font-medium" style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
    {isSkipped ? "Skipped" : dateLabel}
  </p>
  {isToday && (
    <p style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Today</p>
  )}
  {isPastDay && (
    <p style={{ fontSize: 10, color: "var(--color-primary-mid)" }}>{editorLoading ? "Loading…" : "Tap to edit"}</p>
  )}
</button>
```

- [ ] **Step 5: Render `DayEditor` when a past day is opened**

Add immediately before the component's closing `</div>` (the outermost wrapper's end):

```tsx
{editingEntry && (
  <DayEditor
    entry={editingEntry}
    fallbackSchedule={schedule}
    onClose={() => setEditingEntry(null)}
    onSaved={() => setEditingEntry(null)}
  />
)}
```

`onSaved` simply closes the modal here — the Today tab doesn't hold a list of past days that needs in-place updating; the position/dose_log changes take effect from the next data load (Complete Day / next app open already reload from Supabase, matching the existing pattern used throughout this codebase after a write with local-state consequences deferred to reload).

- [ ] **Step 6: Remove the now-dead `/history/edit` banner link**

Replace the missed-day banner's link-out (added in commit `ff653fb`):

```tsx
{" "}If that's wrong,{" "}
<Link href="/history/edit" className="underline font-semibold">
  fix it here
</Link>
.
```

with plain text, since editing is now inline via the day label itself:

```tsx
{" "}If that's wrong, tap the date above to fix it.
```

- [ ] **Step 7: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Manual smoke test**

Run: `npm run dev`, sign in with the test account. Navigate back a day, tap the date label, confirm `DayEditor` opens read-only; tap Edit, confirm only the treatment food(s) at their true edge are interactive (others show disabled); check one, tap Save, confirm the position-change confirmation appears, confirm it, and confirm the app's header position updates on next reload. Confirm the left arrow becomes disabled once you'd cross 10 real calendar days back.

- [ ] **Step 9: Commit**

```bash
git add components/DailyView.tsx
git commit -m "feat: wire Today tab's back-arrow to real day editing within 10 days"
```

---

### Task 6: `HistoryCalendar` component

**Files:**
- Create: `components/HistoryCalendar.tsx`

**Interfaces:**
- Consumes: `classifyDoseLogDay`, `DayStatus` from `@/lib/schedule` (Task 2); `DoseLogDay`, `ParsedSchedule` from `@/lib/types`.
- Produces: default export `HistoryCalendar({ schedule, monthDays, month, onMonthChange, onDayClick, selectMode, selectedIds, onToggleSelect, earliestMonth }: HistoryCalendarProps)`. `month` is a `{ year: number; month: number }` (1-indexed month) for the currently displayed month; `monthDays` is the `DoseLogDay[]` already fetched for that month (fetching itself is the host page's job, Task 7). Used by `app/history/page.tsx` (Task 7).

- [ ] **Step 1: Write the component**

```tsx
"use client"

import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import { classifyDoseLogDay, DayStatus } from "@/lib/schedule"

interface HistoryCalendarProps {
  schedule: ParsedSchedule
  monthDays: DoseLogDay[]
  month: { year: number; month: number }
  onMonthChange: (next: { year: number; month: number }) => void
  onDayClick: (dateStr: string, entry: DoseLogDay | null) => void
  selectMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  earliestMonth: { year: number; month: number }
}

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function DayStatusIcon({ status }: { status: DayStatus | null }) {
  if (status === "complete") {
    return (
      <span
        style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid #22c55e" }}
        className="flex items-center justify-center text-xs font-bold"
      >
        <span style={{ color: "#22c55e" }}>✓</span>
      </span>
    )
  }
  if (status === "treatment-complete") {
    return <span style={{ color: "#22c55e", fontSize: 16, fontWeight: 700 }}>✓</span>
  }
  if (status === "treatment-partial") {
    return <span style={{ width: 16, height: 3, background: "#22c55e", borderRadius: 2, display: "inline-block" }} />
  }
  if (status === "treatment-missed") {
    return <span style={{ color: "#dc2626", fontSize: 16, fontWeight: 700 }}>✕</span>
  }
  return null
}

export default function HistoryCalendar({
  schedule,
  monthDays,
  month,
  onMonthChange,
  onDayClick,
  selectMode,
  selectedIds,
  onToggleSelect,
  earliestMonth,
}: HistoryCalendarProps) {
  const { year, month: m } = month
  const firstOfMonth = new Date(year, m - 1, 1)
  const leadingBlanks = firstOfMonth.getDay()
  const daysInMonth = new Date(year, m, 0).getDate()
  const todayStr = new Date().toISOString().slice(0, 10)

  const byDate = new Map<string, DoseLogDay>()
  for (const d of monthDays) byDate.set(d.completedAt.slice(0, 10), d)

  const atEarliest = year === earliestMonth.year && m === earliestMonth.month
  const atCurrentMonth = (() => {
    const now = new Date()
    return year === now.getFullYear() && m === now.getMonth() + 1
  })()

  function goPrevMonth() {
    if (atEarliest) return
    onMonthChange(m === 1 ? { year: year - 1, month: 12 } : { year, month: m - 1 })
  }
  function goNextMonth() {
    if (atCurrentMonth) return
    onMonthChange(m === 12 ? { year: year + 1, month: 1 } : { year, month: m + 1 })
  }

  return (
    <div className="px-4 pt-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <button onClick={goPrevMonth} disabled={atEarliest} className="disabled:opacity-30" aria-label="Previous month">‹</button>
        <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          {MONTH_NAMES[m - 1]} {year}
        </p>
        <button onClick={goNextMonth} disabled={atCurrentMonth} className="disabled:opacity-30" aria-label="Next month">›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {WEEKDAY_LABELS.map(w => (
          <div key={w} style={{ textAlign: "center", fontSize: 12, opacity: 0.6 }}>{w}</div>
        ))}

        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`blank-${i}`} />)}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const dayNum = i + 1
          const dateStr = `${year}-${pad2(m)}-${pad2(dayNum)}`
          const isFuture = dateStr > todayStr
          const isToday = dateStr === todayStr
          const entry = byDate.get(dateStr) ?? null
          const status = entry ? classifyDoseLogDay(entry, schedule) : null
          const selected = entry ? selectedIds.has(entry.id) : false

          return (
            <button
              key={dateStr}
              type="button"
              disabled={isFuture}
              onClick={() => {
                if (selectMode && entry) onToggleSelect(entry.id)
                else onDayClick(dateStr, entry)
              }}
              className="flex flex-col items-center gap-1"
              style={{
                padding: "8px 0",
                borderRadius: 8,
                opacity: isFuture ? 0.35 : 1,
                background: isToday
                  ? "var(--accent-soft, #fef3c7)"
                  : selected
                  ? "var(--color-primary-border)"
                  : "var(--color-bg-secondary)",
                border: isToday ? "1px solid #f59e0b" : selected ? "1.5px solid var(--color-primary-mid)" : "none",
              }}
            >
              <span style={{ fontSize: 12, opacity: 0.8, fontWeight: isToday ? 700 : 400 }}>{dayNum}</span>
              {isToday ? (
                <span style={{ fontSize: 10, opacity: 0.6 }}>today</span>
              ) : (
                !isFuture && <DayStatusIcon status={status} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (No consumer exists yet.)

- [ ] **Step 3: Commit**

```bash
git add components/HistoryCalendar.tsx
git commit -m "feat: add HistoryCalendar month grid with day-status icons"
```

---

### Task 7: Rewire `app/history/page.tsx`

**Files:**
- Modify: `app/history/page.tsx`

**Interfaces:**
- Consumes: `HistoryCalendar` from `@/components/HistoryCalendar` (Task 6); `DayEditor` from `@/components/DayEditor` (Task 4); `fetchDoseLogDaysInRange` from `@/lib/supabase` (Task 3); `fetchOnboardingDate` — see Step 2 below for how the earliest month is determined.
- Produces: nothing consumed by later tasks — this is the last functional integration task before cleanup.

- [ ] **Step 1: Replace imports**

Replace the existing import block:

```ts
import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import {
  getSession,
  fetchSchedule,
  fetchAllDoseLogDays,
  deleteDoseLogDays,
  deleteAllDoseLogDays,
} from "@/lib/supabase"
import DoseHistoryLog from "@/components/DoseHistoryLog"
```

with:

```ts
import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import {
  getSession,
  fetchSchedule,
  fetchDoseLogDaysInRange,
  deleteDoseLogDays,
  deleteAllDoseLogDays,
} from "@/lib/supabase"
import HistoryCalendar from "@/components/HistoryCalendar"
import DayEditor from "@/components/DayEditor"
```

- [ ] **Step 2: Replace state and load logic**

Replace the component's state block and `load()` effect:

```ts
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [days, setDays] = useState<DoseLogDay[]>([])
  const [loading, setLoading] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmTarget, setConfirmTarget] = useState<"selection" | "all" | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    async function load() {
      let session
      try {
        session = await getSession()
      } catch {
        router.replace("/login")
        return
      }
      if (!session) {
        router.replace("/login")
        return
      }
      try {
        const [s, allDays] = await Promise.all([fetchSchedule(), fetchAllDoseLogDays()])
        if (!s) {
          router.replace("/setup")
          return
        }
        setSchedule(s)
        setDays(allDays)
      } catch {
        router.replace("/daily")
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

with:

```ts
  const now = new Date()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [monthDays, setMonthDays] = useState<DoseLogDay[]>([])
  const [earliestMonth, setEarliestMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [loading, setLoading] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmTarget, setConfirmTarget] = useState<"selection" | "all" | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editingEntry, setEditingEntry] = useState<DoseLogDay | null>(null)
  const [editingDateStr, setEditingDateStr] = useState<string | null>(null)

  async function loadMonth(target: { year: number; month: number }) {
    const start = `${target.year}-${String(target.month).padStart(2, "0")}-01`
    const lastDay = new Date(target.year, target.month, 0).getDate()
    const end = `${target.year}-${String(target.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    const days = await fetchDoseLogDaysInRange(start, end).catch(() => [])
    setMonthDays(days)
  }

  useEffect(() => {
    async function load() {
      let session
      try {
        session = await getSession()
      } catch {
        router.replace("/login")
        return
      }
      if (!session) {
        router.replace("/login")
        return
      }
      try {
        const [s, firstMonthDays] = await Promise.all([
          fetchSchedule(),
          fetchDoseLogDaysInRange("2000-01-01", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`),
        ])
        if (!s) {
          router.replace("/setup")
          return
        }
        setSchedule(s)
        if (firstMonthDays.length > 0) {
          const earliest = firstMonthDays[firstMonthDays.length - 1]
          const d = new Date(earliest.completedAt)
          setEarliestMonth({ year: d.getFullYear(), month: d.getMonth() + 1 })
        }
        await loadMonth(month)
      } catch {
        router.replace("/daily")
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

`fetchDoseLogDaysInRange` returns newest-first (per its `order("completed_at", { ascending: false })`), so the oldest logged day is the last element of a range spanning everything up to today — used once at load to determine `earliestMonth`, bounding the calendar's back-navigation exactly like the design spec requires ("nothing to render before account creation").

- [ ] **Step 3: Add a month-change handler and day-click handler**

Add near the other handlers:

```ts
  async function handleMonthChange(next: { year: number; month: number }) {
    setMonth(next)
    await loadMonth(next)
  }

  function handleDayClick(dateStr: string, entry: DoseLogDay | null) {
    if (!entry) return
    setEditingEntry(entry)
    setEditingDateStr(dateStr)
  }
```

- [ ] **Step 4: Adapt delete-confirmation copy to not depend on a full day count**

Replace `handleConfirmDelete`'s selection branch is unchanged; update the confirmation dialog copy (it currently reads `days.length`, which no longer represents "all logged days" once fetching is month-scoped):

```tsx
<p className="text-base font-semibold mb-5" style={{ color: "var(--color-text-primary)" }}>
  {confirmTarget === "all"
    ? "Delete all logged history? This can't be undone."
    : `Delete ${selectedIds.size} selected day${selectedIds.size !== 1 ? "s" : ""}? This can't be undone.`}
</p>
```

And in `handleConfirmDelete`, replace `setDays([])` (the "all" branch) with `setMonthDays([])` and the "selection" branch's `setDays(prev => prev.filter(...))` with `setMonthDays(prev => prev.filter(d => !selectedIds.has(d.id)))`.

Also update the "Clear all" button's `disabled={days.length === 0}` to `disabled={monthDays.length === 0}` (a reasonable proxy — if the visible month has nothing, there's likely nothing to clear; exact cross-month emptiness isn't tracked and isn't worth a dedicated query for a disabled-state hint).

- [ ] **Step 5: Remove the "Edit" header link, replace `DoseHistoryLog` with `HistoryCalendar`, render `DayEditor`**

Replace the header's `{!selectMode && (<Link href="/history/edit">Edit</Link>)}` block — delete it entirely (editing now happens by tapping a calendar day).

Replace:

```tsx
<DoseHistoryLog
  schedule={schedule}
  days={days}
  selectMode={selectMode}
  selectedIds={selectedIds}
  onToggleSelect={toggleSelect}
/>
```

with:

```tsx
<HistoryCalendar
  schedule={schedule}
  monthDays={monthDays}
  month={month}
  onMonthChange={handleMonthChange}
  onDayClick={handleDayClick}
  selectMode={selectMode}
  selectedIds={selectedIds}
  onToggleSelect={toggleSelect}
  earliestMonth={earliestMonth}
/>
{editingEntry && editingDateStr && editingDateStr !== new Date().toISOString().slice(0, 10) && (
  <DayEditor
    entry={editingEntry}
    fallbackSchedule={schedule}
    onClose={() => { setEditingEntry(null); setEditingDateStr(null) }}
    onSaved={updated => {
      setMonthDays(prev => prev.map(d => (d.id === updated.id ? updated : d)))
      setEditingEntry(null)
      setEditingDateStr(null)
    }}
  />
)}
```

The `editingDateStr !== today` guard matches the design spec's stated assumption that today's cell should never open this modal; `HistoryCalendar`'s `onDayClick` is only reachable for non-future days with a real entry, and today's cell in Task 6 renders the "today" label instead of a status icon, but does not on its own prevent a click — this guard is the actual enforcement point. (A cleaner alternative — routing today's click to `/daily` via `next/navigation`'s `useRouter` instead of silently no-op'ing — is reasonable follow-up polish, not required by the spec.)

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual smoke test**

Run: `npm run dev`, sign in, open `/history`. Confirm the calendar renders the current month with status icons matching real logged days; navigate to the previous month and back; confirm navigating before the earliest logged month is disabled; tap a past day, confirm `DayEditor` opens; tap "Select", confirm tapping day cells toggles selection instead of opening the editor, and Delete/Clear all still work.

- [ ] **Step 8: Commit**

```bash
git add app/history/page.tsx
git commit -m "feat: replace History's flat list with the month calendar"
```

---

### Task 8: Cleanup — remove superseded surfaces

**Files:**
- Delete: `app/history/edit/page.tsx`
- Delete: `components/RecentDaysEditor.tsx`
- Delete: `components/DoseHistoryLog.tsx`
- Modify: `lib/supabase.ts` (remove `fetchRecentCompletedDays` and `fetchAllDoseLogDays`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing — this is the final cleanup task.

- [ ] **Step 1: Confirm no remaining references**

Run:
```bash
grep -rn "history/edit\|RecentDaysEditor\|DoseHistoryLog\|fetchRecentCompletedDays\|fetchAllDoseLogDays" app/ components/ lib/
```
Expected: no matches (Tasks 5 and 7 already removed every inbound reference; this step is a final confirmation before deleting).

- [ ] **Step 2: Delete the files**

```bash
git rm app/history/edit/page.tsx components/RecentDaysEditor.tsx components/DoseHistoryLog.tsx
```

(This also removes the now-empty `app/history/edit/` directory.)

- [ ] **Step 3: Remove the two dead functions from `lib/supabase.ts`**

Delete `fetchRecentCompletedDays` (previously lines 360-386) and `fetchAllDoseLogDays` (previously lines 388-413) in their entirety.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all `lib/schedule.test.ts` suites, unaffected by this cleanup.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase.ts
git commit -m "chore: remove /history/edit and superseded data-access functions"
```
