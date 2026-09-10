# Recompute Anchor Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a Critical bug (C1) found during the Trailing Edit Redesign's final whole-branch review — `recomputeFoodProgressFromHistory` always seeds a food's replay at Week 1 Day 1, silently rewinding any food seeded ahead of that (New Food Cycle's position stepper, or a Settings correction) on the next Trailing Edit save. Fix: persist a per-food anchor (position + date declared) on `treatment_food_progress`, written only by genuine "declare this food's position" events, and seed the replay from each food's own anchor instead of a hardcoded Week 1 Day 1.

**Architecture:** Two new columns on `treatment_food_progress` (`anchor_week`, `anchor_day`, `anchor_date`), mirrored on the `FoodProgress` type. Every read/write path that already uses an object-spread pattern (`{...fp, ...}`) preserves the anchor automatically; the three places that construct or deliberately re-declare a `FoodProgress` (`seedFoodProgress`, Settings' `saveFoodPosition`, and `recomputeFoodProgressFromHistory`'s own seed step) are the only ones that need explicit changes.

**Tech Stack:** Next.js (App Router), Supabase (Postgres + `@supabase/supabase-js`), TypeScript, Vitest for pure-function unit tests.

## Global Constraints

- The anchor is written **only** by `seedFoodProgress` (New Food Cycle's position stepper, onboarding) and Settings' `saveFoodPosition` (a manual per-food correction) — never by `DayEditor`'s Trailing Edit save, the backfill loop, or `handleCompleteDay`. This mirrors the already-established rule for `cycle_start_date`.
- `recomputeFoodProgressFromHistory` only replays `dose_log` entries dated `>= ` a food's own `anchorDate` — entries before it must never advance that food's position, even if they're within the broader `[cycle_start_date, today]` editable range.
- A food missing a `currentProgress` entry falls back to `{week: 1, day: 1}` with `anchorDate` = the earliest date in the passed-in `doseLogDays` (or today, if that's empty) — confirmed intentional, silent, no logging requirement.
- The informational UI note for a pre-anchor day is non-blocking: the checkbox stays toggleable and still persists to `dose_log` exactly as today. No new confirmation dialogs, no prevention logic.
- No change to Reaction Ramp's own logic, `cycle_start_date`'s semantics, or anything else in the already-approved Trailing Edit Redesign.
- TypeScript strict, no `any`.
- Test command: `npm test` (runs `vitest run`). Type-check: `npx tsc --noEmit -p .`. Build: `npm run build`.
- No code comments unless a WHY is genuinely non-obvious.
- **This ticket is not done until the production family's manual anchor correction (Task 6) is applied and verified — see Global Constraints in the design spec.**

## File Structure

- `supabase/migrations/20260910_treatment_food_progress_anchor.sql` — new. Adds `anchor_week`, `anchor_day`, `anchor_date` to `treatment_food_progress`.
- `lib/types.ts` — modify. `FoodProgress` gains `anchorWeek`, `anchorDay`, `anchorDate`.
- `lib/supabase.ts` — modify. `fetchFoodProgress` selects/maps the 3 new columns; `saveFoodProgress` writes them (generic passthrough — whatever's in the map); `seedFoodProgress` sets them on every entry it constructs.
- `lib/schedule.ts` — modify. `recomputeFoodProgressFromHistory` rewritten to seed from each food's anchor instead of a hardcoded Week 1 Day 1, and to only replay entries dated on/after that anchor.
- `lib/schedule.test.ts` — modify. `makeFoodProgress` gains anchor defaults; `recomputeFoodProgressFromHistory`'s test suite rewritten for the new anchor-based contract (the old tests implicitly assumed Week 1 Day 1 for every food, which is exactly the bug being fixed — they're being replaced, not patched).
- `app/settings/page.tsx` — modify. `saveFoodPosition` sets the corrected food's anchor to the new position + today, instead of relying on the object-spread's default preserve-the-old-anchor behavior.
- `components/DayEditor.tsx` — modify. Treatment rows get a new, non-blocking informational note when the edited day predates that food's `anchor_date`.
- `BRIEF.md` — modify (Task 7).

---

### Task 1: Migration — add anchor columns

**Files:**
- Create: `supabase/migrations/20260910_treatment_food_progress_anchor.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `treatment_food_progress` with 3 new nullable-safe columns. Unlike the `floor_week`/`floor_day` drop migration, this one is **additive with defaults** — old, still-deployed code that doesn't know about these columns is unaffected (its upserts simply don't touch them), so this migration does **not** need to wait for the new code to deploy. Apply it as soon as it's written; no sequencing hazard either direction.

- [ ] **Step 1: Write the migration**

```sql
-- Part of the Recompute Anchor Fix (Trailing Edit Redesign follow-up, C1).
-- recomputeFoodProgressFromHistory needs to know each food's true starting
-- position to replay its dose_log history correctly — it can't assume every
-- food starts at Week 1 Day 1, since the position stepper and Settings'
-- per-food corrector can both declare a different starting point. These
-- columns are that declaration: written only by seedFoodProgress and
-- saveFoodPosition, never by routine advancement or Trailing Edit.
--
-- Additive with defaults — safe to apply regardless of deploy timing,
-- unlike the floor_week/floor_day DROP COLUMN migration this follows.

ALTER TABLE treatment_food_progress
  ADD COLUMN IF NOT EXISTS anchor_week integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS anchor_day integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS anchor_date date NOT NULL DEFAULT CURRENT_DATE;
```

- [ ] **Step 2: Apply the migration to production via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with the SQL above. Confirm via `mcp__claude_ai_Supabase__list_tables` (verbose) that `treatment_food_progress` now lists `anchor_week`, `anchor_day`, `anchor_date`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260910_treatment_food_progress_anchor.sql
git commit -m "chore(db): add treatment_food_progress anchor_week/anchor_day/anchor_date"
```

---

### Task 2: Type + `lib/supabase.ts` plumbing

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/supabase.ts` (`fetchFoodProgress`, `saveFoodProgress`, `seedFoodProgress`)

**Interfaces:**
- Consumes: Task 1's migration (columns must exist in production before this reads/writes them — apply Task 1 first).
- Produces: `FoodProgress` with the 3 new fields; every read of `treatment_food_progress` returns them; every write persists whatever the caller's map contains for them (no default-filling in `saveFoodProgress` itself — callers are responsible, per the object-spread-preserves pattern this whole fix relies on). Task 3, 4, 5 depend on this.

- [ ] **Step 1: Update `FoodProgress`**

In `lib/types.ts`, change:

```ts
export interface FoodProgress {
  foodName: string
  week: number
  day: number
  completedDays: number
  lastCompletedAt: string | null
}
```

to:

```ts
export interface FoodProgress {
  foodName: string
  week: number
  day: number
  completedDays: number
  lastCompletedAt: string | null
  anchorWeek: number
  anchorDay: number
  anchorDate: string
}
```

- [ ] **Step 2: Update `fetchFoodProgress`**

In `lib/supabase.ts`, change:

```ts
export async function fetchFoodProgress(): Promise<Map<string, FoodProgress>> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("treatment_food_progress")
    .select("food_name, week, day, completed_days, last_completed_at")
    .eq("family_id", familyId)
  if (error) throw error
  const map = new Map<string, FoodProgress>()
  for (const row of data ?? []) {
    map.set(row.food_name as string, {
      foodName: row.food_name as string,
      week: row.week as number,
      day: row.day as number,
      completedDays: row.completed_days as number,
      lastCompletedAt: row.last_completed_at as string | null,
    })
  }
  return map
}
```

to:

```ts
export async function fetchFoodProgress(): Promise<Map<string, FoodProgress>> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("treatment_food_progress")
    .select("food_name, week, day, completed_days, last_completed_at, anchor_week, anchor_day, anchor_date")
    .eq("family_id", familyId)
  if (error) throw error
  const map = new Map<string, FoodProgress>()
  for (const row of data ?? []) {
    map.set(row.food_name as string, {
      foodName: row.food_name as string,
      week: row.week as number,
      day: row.day as number,
      completedDays: row.completed_days as number,
      lastCompletedAt: row.last_completed_at as string | null,
      anchorWeek: row.anchor_week as number,
      anchorDay: row.anchor_day as number,
      anchorDate: row.anchor_date as string,
    })
  }
  return map
}
```

- [ ] **Step 3: Update `saveFoodProgress`**

Change:

```ts
export async function saveFoodProgress(
  progress: Map<string, FoodProgress>
): Promise<void> {
  const familyId = await getFamilyId()
  const now = new Date().toISOString()
  const rows = [...progress.values()].map(fp => ({
    family_id: familyId,
    food_name: fp.foodName,
    week: fp.week,
    day: fp.day,
    completed_days: fp.completedDays,
    last_completed_at: fp.lastCompletedAt,
    updated_at: now,
  }))
  const { error } = await getClient()
    .from("treatment_food_progress")
    .upsert(rows, { onConflict: "family_id,food_name" })
  if (error) throw error
}
```

to:

```ts
export async function saveFoodProgress(
  progress: Map<string, FoodProgress>
): Promise<void> {
  const familyId = await getFamilyId()
  const now = new Date().toISOString()
  const rows = [...progress.values()].map(fp => ({
    family_id: familyId,
    food_name: fp.foodName,
    week: fp.week,
    day: fp.day,
    completed_days: fp.completedDays,
    last_completed_at: fp.lastCompletedAt,
    anchor_week: fp.anchorWeek,
    anchor_day: fp.anchorDay,
    anchor_date: fp.anchorDate,
    updated_at: now,
  }))
  const { error } = await getClient()
    .from("treatment_food_progress")
    .upsert(rows, { onConflict: "family_id,food_name" })
  if (error) throw error
}
```

This is a generic passthrough — it writes whatever `anchorWeek`/`anchorDay`/`anchorDate` each `FoodProgress` in the map already carries. It does not decide when the anchor should change; the callers do (Steps 4 below, Task 4).

- [ ] **Step 4: Update `seedFoodProgress`**

Change:

```ts
export async function seedFoodProgress(
  entries: { foodName: string; week: number; day: number }[]
): Promise<Map<string, FoodProgress>> {
  const progress = new Map<string, FoodProgress>()
  for (const entry of entries) {
    progress.set(entry.foodName, {
      foodName: entry.foodName,
      week: entry.week,
      day: entry.day,
      completedDays: entry.day - 1,
      lastCompletedAt: null,
    })
  }
  await saveFoodProgress(progress)
  return progress
}
```

to:

```ts
export async function seedFoodProgress(
  entries: { foodName: string; week: number; day: number }[]
): Promise<Map<string, FoodProgress>> {
  const today = todayDateString()
  const progress = new Map<string, FoodProgress>()
  for (const entry of entries) {
    progress.set(entry.foodName, {
      foodName: entry.foodName,
      week: entry.week,
      day: entry.day,
      completedDays: entry.day - 1,
      lastCompletedAt: null,
      anchorWeek: entry.week,
      anchorDay: entry.day,
      anchorDate: today,
    })
  }
  await saveFoodProgress(progress)
  return progress
}
```

`todayDateString` is already imported in `lib/supabase.ts` (existing line: `import { getCalendarPosition, todayDateString, addDays, formatDateOnly } from "./schedule"`) — no import change needed for this step.

- [ ] **Step 5: Fix `app/onboarding/page.tsx`'s throwaway preview map**

Found during execution — a real gap this plan's original file list missed. `app/onboarding/page.tsx` builds a local, never-persisted `Map<string, FoodProgress>` purely to feed `getGlobalPosition` for a buffer-days preview on the confirmation step — `getGlobalPosition` only reads `.week`/`.day`, never anchor fields, so this is a pure type-satisfaction fix with zero behavioral risk. Change:

```ts
      positionEntries.map(e => [e.foodName, { foodName: e.foodName, week: e.week, day: e.day, completedDays: e.day - 1, lastCompletedAt: null }])
```

to:

```ts
      positionEntries.map(e => [e.foodName, { foodName: e.foodName, week: e.week, day: e.day, completedDays: e.day - 1, lastCompletedAt: null, anchorWeek: e.week, anchorDay: e.day, anchorDate: todayDateString() }])
```

mirroring `seedFoodProgress`'s convention for these same entries elsewhere in this file. Add `todayDateString` to this file's `@/lib/schedule` import if not already present.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: errors in every other file that constructs a `FoodProgress` without the 3 new required fields. Expect errors in `app/settings/page.tsx` (Task 4) and `lib/schedule.ts`/`lib/schedule.test.ts` (Task 3 — `recomputeFoodProgressFromHistory` itself constructs a bare `FoodProgress` on its zero-history-init path, so it errors until that function is rewritten) — these are fixed in later steps/tasks, not here. Confirm no *unexpected* errors outside those files (in particular, `app/onboarding/page.tsx` should now be clean, after Step 5).

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/supabase.ts
git commit -m "feat(food-progress): add anchor fields to type, fetch, save, and seed"
```

---

### Task 3: `recomputeFoodProgressFromHistory` — seed from anchor, not Week 1 Day 1 (TDD)

**Files:**
- Modify: `lib/schedule.ts` (`recomputeFoodProgressFromHistory`)
- Modify: `lib/schedule.test.ts` (`makeFoodProgress` defaults; the entire `recomputeFoodProgressFromHistory` test suite, rewritten)

**Interfaces:**
- Consumes: `FoodProgress` (Task 2, now with anchor fields), `formatDateOnly`/`todayDateString` (pre-existing, same file), `advanceFoodProgress` (pre-existing, unchanged).
- Produces: `recomputeFoodProgressFromHistory`'s signature is unchanged (`(schedule, doseLogDays, currentProgress, excludeFoodNames) => Map<string, FoodProgress>`), but its seeding behavior changes. Task 5 (`DayEditor`) depends on the returned `FoodProgress` objects carrying correct `anchorWeek`/`anchorDay`/`anchorDate` (for the new UI note to read).

- [ ] **Step 1: Update `makeFoodProgress`'s defaults**

In `lib/schedule.test.ts`, change:

```ts
function makeFoodProgress(overrides: Partial<FoodProgress> = {}): FoodProgress {
  return {
    foodName: "Cashew",
    week: 1,
    day: 3,
    completedDays: 2,
    lastCompletedAt: null,
    ...overrides,
  }
}
```

to:

```ts
function makeFoodProgress(overrides: Partial<FoodProgress> = {}): FoodProgress {
  return {
    foodName: "Cashew",
    week: 1,
    day: 3,
    completedDays: 2,
    lastCompletedAt: null,
    anchorWeek: 1,
    anchorDay: 1,
    anchorDate: "2026-01-01",
    ...overrides,
  }
}
```

- [ ] **Step 2: Run the full suite, fix any other test broken by the type change**

Run: `npm test`
Expected: `recomputeFoodProgressFromHistory`'s existing 6 tests fail (they're being replaced in Step 3 below — expected, not a regression). All other tests should still pass, since every other consumer either spreads from `makeFoodProgress()`'s output (picks up the new defaults automatically) or doesn't construct `FoodProgress` literals at all. If any *other* test fails, read it and add matching `anchorWeek`/`anchorDay`/`anchorDate` values to its explicit expected-object literal (following whatever anchor values that test's input used) before proceeding — do not proceed with unexplained failures outside the 6 tests named above.

- [ ] **Step 3: Replace `recomputeFoodProgressFromHistory`'s test suite**

Delete the existing `describe("recomputeFoodProgressFromHistory", ...)` block entirely (added by the Trailing Edit Redesign's Task 2 — it implicitly assumed every food starts at Week 1 Day 1, which is exactly the bug this task fixes, so its test cases no longer describe correct behavior). Replace with:

```ts
describe("recomputeFoodProgressFromHistory", () => {
  it("replays a food checked every day from its anchor, rolling over at week 7", () => {
    const currentProgress = new Map([
      ["Walnut", makeFoodProgress({ foodName: "Walnut", week: 1, day: 1, completedDays: 0, anchorWeek: 1, anchorDay: 1, anchorDate: "2026-09-01" })],
    ])
    const days = Array.from({ length: 8 }, (_, i) =>
      makeDoseLogDay({
        id: `d${i}`,
        completedAt: `2026-09-0${i + 1}T19:00:00.000Z`,
        checkedFoods: { "evening-Walnut": true },
      })
    )
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, currentProgress, new Set())
    expect(result.get("Walnut")).toEqual({
      foodName: "Walnut", week: 2, day: 2, completedDays: 1,
      lastCompletedAt: "2026-09-08T19:00:00.000Z",
      anchorWeek: 1, anchorDay: 1, anchorDate: "2026-09-01",
    })
  })

  it("a food never checked stays exactly at its anchor, not Week 1 Day 1", () => {
    const currentProgress = new Map([
      ["Peanut", makeFoodProgress({ foodName: "Peanut", week: 2, day: 3, completedDays: 2, anchorWeek: 2, anchorDay: 3, anchorDate: "2026-09-01" })],
    ])
    const days = [makeDoseLogDay({ completedAt: "2026-09-02T19:00:00.000Z", checkedFoods: {} })]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, currentProgress, new Set())
    expect(result.get("Peanut")).toEqual({
      foodName: "Peanut", week: 2, day: 3, completedDays: 2, lastCompletedAt: null,
      anchorWeek: 2, anchorDay: 3, anchorDate: "2026-09-01",
    })
  })

  it("reproduces the actual production regression: a food anchored ahead of Week 1 Day 1 is never rewound", () => {
    // Peanut/Walnut's real scenario: seeded at Week 1 Day 3, never checked since.
    // Note: only anchorWeek/anchorDay seed the replay — week/day/completedDays
    // on the input are NOT read by this function (the replay reconstructs them
    // from scratch), so they're left at makeFoodProgress's defaults here rather
    // than set to a value that would be misleading to a reader.
    const currentProgress = new Map([
      ["Peanut", makeFoodProgress({ foodName: "Peanut", anchorWeek: 1, anchorDay: 3, anchorDate: "2026-09-02" })],
      ["Walnut", makeFoodProgress({ foodName: "Walnut", anchorWeek: 1, anchorDay: 3, anchorDate: "2026-09-02" })],
    ])
    const days = [
      makeDoseLogDay({ id: "d1", completedAt: "2026-09-03T19:00:00.000Z", checkedFoods: { "evening-Walnut": true } }),
      makeDoseLogDay({ id: "d2", completedAt: "2026-09-04T19:00:00.000Z", checkedFoods: {} }),
    ]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, currentProgress, new Set())
    expect(result.get("Peanut")?.week).toBe(1)
    expect(result.get("Peanut")?.day).toBe(3)
    expect(result.get("Walnut")?.week).toBe(1)
    expect(result.get("Walnut")?.day).toBe(4)
  })

  it("skips unchecked/absent days for that food while still advancing a different food checked the same days", () => {
    const currentProgress = new Map([
      ["Walnut", makeFoodProgress({ foodName: "Walnut", week: 1, day: 1, completedDays: 0, anchorWeek: 1, anchorDay: 1, anchorDate: "2026-09-01" })],
      ["Peanut", makeFoodProgress({ foodName: "Peanut", week: 1, day: 1, completedDays: 0, anchorWeek: 1, anchorDay: 1, anchorDate: "2026-09-01" })],
    ])
    const days = [
      makeDoseLogDay({ id: "d1", completedAt: "2026-09-01T19:00:00.000Z", checkedFoods: { "evening-Walnut": true } }),
      makeDoseLogDay({ id: "d2", completedAt: "2026-09-02T19:00:00.000Z", checkedFoods: {} }),
      makeDoseLogDay({ id: "d3", completedAt: "2026-09-03T19:00:00.000Z", checkedFoods: { "evening-Walnut": true } }),
    ]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, currentProgress, new Set())
    expect(result.get("Walnut")).toEqual({
      foodName: "Walnut", week: 1, day: 3, completedDays: 2,
      lastCompletedAt: "2026-09-03T19:00:00.000Z",
      anchorWeek: 1, anchorDay: 1, anchorDate: "2026-09-01",
    })
    expect(result.get("Peanut")).toEqual({
      foodName: "Peanut", week: 1, day: 1, completedDays: 0, lastCompletedAt: null,
      anchorWeek: 1, anchorDay: 1, anchorDate: "2026-09-01",
    })
  })

  it("is order-independent of the input array — sorts by completedAt before replaying", () => {
    const currentProgress = new Map([
      ["Peanut", makeFoodProgress({ foodName: "Peanut", week: 1, day: 1, completedDays: 0, anchorWeek: 1, anchorDay: 1, anchorDate: "2026-09-01" })],
    ])
    const days = [
      makeDoseLogDay({ id: "d2", completedAt: "2026-09-02T19:00:00.000Z", checkedFoods: { "evening-Peanut": true } }),
      makeDoseLogDay({ id: "d1", completedAt: "2026-09-01T19:00:00.000Z", checkedFoods: { "evening-Peanut": true } }),
    ]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, currentProgress, new Set())
    expect(result.get("Peanut")).toEqual({
      foodName: "Peanut", week: 1, day: 3, completedDays: 2,
      lastCompletedAt: "2026-09-02T19:00:00.000Z",
      anchorWeek: 1, anchorDay: 1, anchorDate: "2026-09-01",
    })
  })

  it("ignores dose_log entries dated before the food's anchor date", () => {
    const currentProgress = new Map([
      ["Peanut", makeFoodProgress({ foodName: "Peanut", week: 2, day: 1, completedDays: 0, anchorWeek: 2, anchorDay: 1, anchorDate: "2026-09-05" })],
    ])
    const days = [
      // Before the anchor — a leftover/phantom-window entry, must not count.
      makeDoseLogDay({ id: "d1", completedAt: "2026-09-01T19:00:00.000Z", checkedFoods: { "evening-Peanut": true } }),
      // On/after the anchor — must count.
      makeDoseLogDay({ id: "d2", completedAt: "2026-09-05T19:00:00.000Z", checkedFoods: { "evening-Peanut": true } }),
    ]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, currentProgress, new Set())
    expect(result.get("Peanut")).toEqual({
      foodName: "Peanut", week: 2, day: 2, completedDays: 1,
      lastCompletedAt: "2026-09-05T19:00:00.000Z",
      anchorWeek: 2, anchorDay: 1, anchorDate: "2026-09-05",
    })
  })

  it("excluded (ramp-controlled) foods pass through currentProgress unchanged, anchor included", () => {
    const currentProgress = new Map([
      ["Walnut", makeFoodProgress({ foodName: "Walnut", week: 3, day: 5, completedDays: 4, lastCompletedAt: "2026-08-20T00:00:00.000Z", anchorWeek: 1, anchorDay: 1, anchorDate: "2026-08-01" })],
    ])
    const days = [makeDoseLogDay({ completedAt: "2026-09-01T19:00:00.000Z", checkedFoods: { "evening-Walnut": true, "evening-Peanut": true } })]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, currentProgress, new Set(["Walnut"]))
    expect(result.get("Walnut")).toEqual(currentProgress.get("Walnut"))
  })

  it("a food with no currentProgress entry falls back to Week 1 Day 1, anchored at the earliest dose_log date", () => {
    const days = [makeDoseLogDay({ completedAt: "2026-09-03T19:00:00.000Z", checkedFoods: { "evening-Peanut": true } })]
    const result = recomputeFoodProgressFromHistory(replaySchedule, days, new Map(), new Set())
    expect(result.get("Peanut")).toEqual({
      foodName: "Peanut", week: 1, day: 2, completedDays: 1,
      lastCompletedAt: "2026-09-03T19:00:00.000Z",
      anchorWeek: 1, anchorDay: 1, anchorDate: "2026-09-03",
    })
  })
})
```

`replaySchedule` and `makeDoseLogDay` are the existing helpers from the Trailing Edit Redesign's Task 2 — reuse them, do not redefine.

- [ ] **Step 4: Run tests to verify the new suite fails**

Run: `npm test`
Expected: FAIL — the 8 new tests fail against the current (unmodified) `recomputeFoodProgressFromHistory`; all other tests pass.

- [ ] **Step 5: Implement the fix**

In `lib/schedule.ts`, change:

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

to:

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
    const existing = currentProgress.get(food.name)
    const anchorWeek = existing?.anchorWeek ?? 1
    const anchorDay = existing?.anchorDay ?? 1
    const anchorDate = existing?.anchorDate ?? (sorted.length > 0 ? formatDateOnly(new Date(sorted[0].completedAt)) : todayDateString())
    let fp: FoodProgress = {
      foodName: food.name,
      week: anchorWeek,
      day: anchorDay,
      completedDays: anchorDay - 1,
      lastCompletedAt: null,
      anchorWeek,
      anchorDay,
      anchorDate,
    }
    for (const entry of sorted) {
      const entryDate = formatDateOnly(new Date(entry.completedAt))
      if (entryDate < anchorDate) continue
      if (entry.checkedFoods[`evening-${food.name}`]) {
        fp = advanceFoodProgress(fp, entry.completedAt)
      }
    }
    result.set(food.name, fp)
  }
  return result
}
```

`formatDateOnly` and `todayDateString` are both already defined earlier in this same file (`lib/schedule.ts`) — no new import needed.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests, including the 8 rewritten ones.

- [ ] **Step 7: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: `lib/schedule.ts`/`lib/schedule.test.ts` clean. Errors may remain in `app/settings/page.tsx` (fixed in Task 4) and `components/DayEditor.tsx` if Task 5 hasn't landed yet — confirm no *other* unexpected errors.

- [ ] **Step 8: Commit**

```bash
git add lib/schedule.ts lib/schedule.test.ts
git commit -m "fix(schedule): seed recomputeFoodProgressFromHistory from each food's anchor, not Week 1 Day 1"
```

---

### Task 4: Settings' `saveFoodPosition` — declare a new anchor on correction

**Files:**
- Modify: `app/settings/page.tsx` (`saveFoodPosition`)

**Interfaces:**
- Consumes: `todayDateString` (pre-existing, `lib/schedule.ts` — check if already imported in this file; add if not).
- Produces: a Settings per-food correction now declares a fresh anchor at the corrected position, dated today — so the very next Trailing Edit save replays from the corrected position instead of silently reverting to whatever the food's old anchor was.

- [ ] **Step 1: Update `saveFoodPosition`**

Find:

```ts
  async function saveFoodPosition(foodName: string, newWeek: number, newDay: number) {
    const fp = foodProgress.get(foodName)
    if (!fp) return
    const oldGlobal = getGlobalPosition(foodProgress)
    const updatedFp: FoodProgress = { ...fp, week: newWeek, day: newDay, completedDays: newDay - 1 }
    const nextProgress = new Map(foodProgress)
    nextProgress.set(foodName, updatedFp)
    setFoodProgress(nextProgress)
```

Change to:

```ts
  async function saveFoodPosition(foodName: string, newWeek: number, newDay: number) {
    const fp = foodProgress.get(foodName)
    if (!fp) return
    const oldGlobal = getGlobalPosition(foodProgress)
    const updatedFp: FoodProgress = {
      ...fp,
      week: newWeek,
      day: newDay,
      completedDays: newDay - 1,
      anchorWeek: newWeek,
      anchorDay: newDay,
      anchorDate: todayDateString(),
    }
    const nextProgress = new Map(foodProgress)
    nextProgress.set(foodName, updatedFp)
    setFoodProgress(nextProgress)
```

Without this, the `{...fp, week: newWeek, day: newDay, completedDays: newDay - 1}` spread would silently *preserve* the food's old anchor — meaning the correction would show the new position immediately, but the very next Trailing Edit save would replay from the *old* anchor and could revert it. Explicitly setting the anchor here is what makes this correction "stick."

- [ ] **Step 2: Add the import**

The current `@/lib/schedule` import at the top of `app/settings/page.tsx` is `import { getGlobalPosition } from "@/lib/schedule"` (a prior fix in this same redesign already removed `cycleStartDateForPosition` from it). Change to:

```ts
import { getGlobalPosition, todayDateString } from "@/lib/schedule"
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: `app/settings/page.tsx` clean now. Confirm no other errors remain anywhere (Task 3 should have already cleared `lib/schedule.ts`/`.test.ts`; Task 5 clears `components/DayEditor.tsx` if not already done).

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx
git commit -m "fix(settings): declare a fresh anchor when correcting a food's position"
```

---

### Task 5: `DayEditor.tsx` — informational note on a pre-anchor day

**Files:**
- Modify: `components/FoodItem.tsx` (new optional prop)
- Modify: `components/DayEditor.tsx`

**Interfaces:**
- Consumes: `FoodProgress.anchorDate` (Task 2), `formatDateOnly`/`todayDateString` (already imported in this file per the Trailing Edit Redesign's Task 7).
- Produces: a non-blocking inline note on a treatment row when the day being edited predates that food's anchor — purely informational, the checkbox stays exactly as interactive as it already is.

- [ ] **Step 1: Add `infoNote` to `FoodItem`**

In `components/FoodItem.tsx`, add to the props interface (alongside the existing `lockedHint?: string`):

```ts
  infoNote?: string
```

and to the destructured props list (alongside `lockedHint`):

```ts
  infoNote,
```

Render it below the existing `lockedHint` block:

```tsx
          {lockedHint && (
            <p style={{ fontSize: 11, color: "var(--color-primary-mid)", marginTop: 2 }}>
              {lockedHint}
            </p>
          )}
          {infoNote && !lockedHint && (
            <p style={{ fontSize: 11, color: "var(--color-text-muted)", fontStyle: "italic", marginTop: 2 }}>
              {infoNote}
            </p>
          )}
```

`!lockedHint` in the second condition means the two are mutually exclusive in display — if a row is locked (e.g. outside its Reaction Ramp date range), that message takes priority over the informational anchor note, since a locked row's checkbox isn't interactive anyway and showing two stacked messages would be noise.

- [ ] **Step 2: Add the note-computing function to `DayEditor.tsx`**

Add alongside the existing `treatmentLockedHint` function:

```ts
  function preAnchorNote(foodName: string): string | undefined {
    if (!editing) return undefined
    if (!isTreatmentRowEditable(foodName)) return undefined
    const fp = foodProgress?.get(foodName)
    if (!fp) return undefined
    const entryDate = formatDateOnly(new Date(entry.completedAt))
    if (entryDate < fp.anchorDate) return "Before tracking started for this food"
    return undefined
  }
```

- [ ] **Step 3: Wire it into `renderRow`**

Find:

```ts
        lockedHint={row.session === "evening" ? treatmentLockedHint(row.name) : undefined}
```

Add directly after it:

```ts
        infoNote={row.session === "evening" ? preAnchorNote(row.name) : undefined}
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both fully clean — this should be the last file with any pending errors from Task 2's type change.

- [ ] **Step 5: Manual QA**

- Open a day before a food's anchor (but on/after `cycle_start_date`) in Trailing Edit: confirm the checkbox is still toggleable and shows "Before tracking started for this food" beneath the dose line.
- Toggle it and Save: confirm it persists to `dose_log` (reopen the day, it's still checked/unchecked as set) but does not move that food's tracked position (confirm via `treatment_food_progress` unchanged for that food, or via the app's displayed position not shifting).
- Open a day on/after the food's anchor: confirm no note appears and the checkbox behaves exactly as before this change.
- Confirm a ramp-locked row still shows only its lock reason, never both messages stacked.

- [ ] **Step 6: Commit**

```bash
git add components/FoodItem.tsx components/DayEditor.tsx
git commit -m "feat(dayeditor): show an informational note on a pre-anchor treatment row"
```

---

### Task 6: Production family manual anchor correction — **blocking, do not skip, must run BEFORE deploy**

**Files:** none (data correction, not a code change).

**Critical ordering constraint, found during Task 3's review:** Task 1's migration already applied to production with the schema's defaults (`anchor_week=1, anchor_day=1, anchor_date=<the day the migration ran>`) for every existing `treatment_food_progress` row, including Peanut/Walnut's. That's fine while it's dormant — the still-deployed old code doesn't read these columns. But the moment the new code (Tasks 2-5) deploys and the family opens Trailing Edit, `recomputeFoodProgressFromHistory` will read those wrong defaults and produce something **worse than the original bug**: it rewinds to Week 1 Day 1 (the original bug) *and* newly excludes every `dose_log` entry dated before the migration ran (since `anchor_date` defaults to that day) — a combination the pre-fix code never produced. **This task must be completed and verified before Tasks 2-5's code is deployed to production — not "sometime before the ticket is marked done."** If code review/merge timing makes that ordering awkward, do this task first, immediately, even before finishing the rest of this plan's review.

This is not a subagent-executable step — it requires direct, verified judgment against the real family's actual history, per the design spec's blocking checklist item. Perform this directly (not via a dispatched implementer):

- [ ] **Step 1: Query the current state**

Against the production Supabase project, read `treatment_food_progress` for family `00000000-0000-0000-0000-000000000001` ("Joshy") and cross-reference against `dose_log` history to determine Peanut and Walnut's actual correct starting anchor (position + date) — this is the same investigative process used throughout this week's dogfooding rounds (direct SQL query, not guessing).

- [ ] **Step 2: Apply the correction**

Write `anchor_week`/`anchor_day`/`anchor_date` for both rows via a direct, explicit `UPDATE`, matching the verified values from Step 1.

- [ ] **Step 3: Verify**

Re-query both rows to confirm the update applied. Open the app (or query directly) to confirm a Trailing Edit save no longer rewinds either food.

- [ ] **Step 4: Record completion**

Note in `BRIEF.md` (Task 7 below folds this in) that this step is done, with the verified anchor values used, so it's auditable later.

---

### Task 7: Full regression pass and BRIEF.md update

**Files:**
- Modify: `BRIEF.md`

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Full type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both clean.

- [ ] **Step 3: Update `BRIEF.md`**

Record this fix under the "Trailing Edit Redesign + Re-parse Redemotion" entry (or as its own dated addendum) — what C1 was, the anchor design, and the status of Task 6 (the blocking production correction). Update `## Current Status` per the project's standard rule. **Do not describe this ticket as fully complete unless Task 6 is confirmed done** — if Task 6 hasn't run yet, say so explicitly as the blocking remaining step, and explicitly flag that **this code must not be deployed to production until Task 6 has run** (see Task 6's ordering note) — deploying first would leave the production family worse off than before this fix.

- [ ] **Step 4: Commit**

```bash
git add BRIEF.md
git commit -m "docs: record Recompute Anchor Fix (C1) completion"
```
