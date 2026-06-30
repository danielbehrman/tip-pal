# Phase 3.5 F3 — Per-Food Week/Day Data Model Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single global week/day counter with independent per-food counters, so each treatment food advances on its own schedule when checked on Complete Day.

**Architecture:** New Supabase table `treatment_food_progress(family_id, food_name, week, day, completed_days, last_completed_at)` holds one row per treatment food per family. On first load after migration, rows are seeded from the current global week/day. The global header position = minimum (furthest behind) across all rows. Complete Day advances only checked foods. Buffer calc updated to use the slowest food's position. Zero changes to dose_log, cycle_start_date, or skip logic.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + RLS), TypeScript strict

## Global Constraints

- No new npm dependencies
- TypeScript strict mode — no `any`, no suppressed errors
- No comments unless WHY is non-obvious
- All `fetch()` calls to `/api/*` must prefix with `process.env.NEXT_PUBLIC_API_BASE_URL ?? ''` (Capacitor — no new fetch calls here, but don't break existing ones)
- App name: "Tip Pal" — never "TIP Pal"
- Commit after each task
- Migration must be applied to production Supabase before code is deployed — the code will call this table on first load and will error if the table doesn't exist

---

## Key Data Definitions

**`FoodProgress` (new type):**
```ts
interface FoodProgress {
  foodName: string
  week: number          // current week being dosed (1-indexed)
  day: number           // current day within week (1-indexed). day = completedDays + 1
  completedDays: number // doses completed in current week (0–6). When = 7 on next Complete Day: advance week, reset to 0
  lastCompletedAt: string | null
}
```

**Advancement rule:** On Complete Day, for each checked evening treatment food:
- `newCompletedDays = completedDays + 1`
- If `newCompletedDays >= 7`: `week += 1`, `day = 1`, `completedDays = 0`
- Else: `day = newCompletedDays + 1`, `completedDays = newCompletedDays`

**Global position rule:** `getGlobalPosition(progress)` = the food with the minimum `(week - 1) * 7 + (day - 1)` position index. Displayed in the header. Used for `saveDoseLog` when completing a day.

**Buffer rule:** Uses the slowest food's position. See `calculateBufferFromProgress` in Task 1.

**Seeding rule:** If the table has zero rows for this family but the schedule has treatment foods: insert one row per food with `week=globalWeek, day=globalDay, completedDays=globalDay-1` (where `globalWeek/globalDay` come from `DoseState` which is still derived from `cycleStartDate + skipCount`).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260629_treatment_food_progress.sql` | Create | Table + RLS + index |
| `lib/types.ts` | Modify | Add `FoodProgress` interface |
| `lib/schedule.ts` | Modify | Add `getGlobalPosition`, `foodsAreInSync`, `getTreatmentFoodEntry`, `calculateBufferFromProgress` |
| `lib/supabase.ts` | Modify | Add `fetchFoodProgress`, `saveFoodProgress`, `seedFoodProgress` |
| `app/daily/page.tsx` | Modify | Fetch+seed food progress on load; update `handleCompleteDay`; override doseState week/day from global position |
| `components/DailyView.tsx` | Modify | Accept+pass `foodProgress` prop; switch to `calculateBufferFromProgress` |
| `components/EveningSection.tsx` | Modify | Accept `foodProgress`; render per-food dose + week badges |

---

## Task 1: DB Migration + Types + Schedule Helpers

**Files:**
- Create: `supabase/migrations/20260629_treatment_food_progress.sql`
- Modify: `lib/types.ts`
- Modify: `lib/schedule.ts`

**Interfaces:**
- Produces: `FoodProgress` type (imported by Tasks 2 and 3)
- Produces: `getGlobalPosition(progress: Map<string, FoodProgress>): { week: number; day: number }`
- Produces: `foodsAreInSync(progress: Map<string, FoodProgress>): boolean`
- Produces: `getTreatmentFoodEntry(food: TreatmentFood, week: number): { weekEntry: TreatmentWeek; isContinuing: boolean }`
- Produces: `calculateBufferFromProgress(appointmentDateStr: string | null, totalTreatmentWeeks: number, slowestWeek: number, slowestCompletedDays: number): BufferResult`

- [ ] **Step 1: Create the migration SQL**

Create `supabase/migrations/20260629_treatment_food_progress.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.treatment_food_progress (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id         uuid        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  food_name         text        NOT NULL,
  week              integer     NOT NULL DEFAULT 1,
  day               integer     NOT NULL DEFAULT 1,
  completed_days    integer     NOT NULL DEFAULT 0,
  last_completed_at timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE(family_id, food_name)
);

ALTER TABLE public.treatment_food_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family_can_access_own_food_progress"
  ON public.treatment_food_progress
  FOR ALL
  USING (
    family_id IN (
      SELECT family_id FROM public.profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    family_id IN (
      SELECT family_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_treatment_food_progress_family_id
  ON public.treatment_food_progress(family_id);
```

**Do NOT run `supabase db push`** — it conflicts with the existing duplicate timestamp prefix. Apply directly after commit via:
```bash
supabase db query --linked < supabase/migrations/20260629_treatment_food_progress.sql
```
(This must be done before the code is deployed. The implementer notes this in the report but does not run the production command.)

- [ ] **Step 2: Add `FoodProgress` to `lib/types.ts`**

Append to the end of `lib/types.ts`:

```ts
export interface FoodProgress {
  foodName: string
  week: number
  day: number
  completedDays: number
  lastCompletedAt: string | null
}
```

- [ ] **Step 3: Add helpers to `lib/schedule.ts`**

Add the following four functions to the end of `lib/schedule.ts`. They use existing imports (`TreatmentFood`, `TreatmentWeek`, `ParsedSchedule` are already imported at the top).

First, add `FoodProgress` to the import from `./types`:

```ts
import { ParsedSchedule, TreatmentFood, TreatmentWeek, FoodProgress } from "./types"
```

Then append the four functions:

```ts
export function getTreatmentFoodEntry(
  food: TreatmentFood,
  week: number
): { weekEntry: TreatmentWeek; isContinuing: boolean } {
  const exactEntry = food.weeks.find(w => w.week === week)
  if (exactEntry) return { weekEntry: exactEntry, isContinuing: false }
  const sortedWeeks = [...food.weeks].sort((a, b) => a.week - b.week)
  const lastEntry = sortedWeeks[sortedWeeks.length - 1]
  return { weekEntry: lastEntry, isContinuing: true }
}

export function getGlobalPosition(
  progress: Map<string, FoodProgress>
): { week: number; day: number } {
  if (progress.size === 0) return { week: 1, day: 1 }
  let minIndex = Infinity
  let result = { week: 1, day: 1 }
  for (const fp of progress.values()) {
    const idx = (fp.week - 1) * 7 + (fp.day - 1)
    if (idx < minIndex) {
      minIndex = idx
      result = { week: fp.week, day: fp.day }
    }
  }
  return result
}

export function foodsAreInSync(progress: Map<string, FoodProgress>): boolean {
  if (progress.size <= 1) return true
  const values = [...progress.values()]
  const first = values[0]
  return values.every(fp => fp.week === first.week && fp.day === first.day)
}

export function calculateBufferFromProgress(
  appointmentDateStr: string | null,
  totalTreatmentWeeks: number,
  slowestWeek: number,
  slowestCompletedDays: number
): BufferResult {
  if (!appointmentDateStr || totalTreatmentWeeks === 0) return { kind: "hidden" }

  const apptDate = parseDateOnly(appointmentDateStr)
  const todayMidnight = parseDateOnly(todayDateString())
  if (apptDate <= todayMidnight) return { kind: "past" }

  // remainingDays = calendar days from today until the slowest food reaches its final Day 7
  // Formula derived from: positionIndex(totalWeeks, 7) - positionIndex(slowestWeek, slowestDay)
  // where slowestDay = slowestCompletedDays + 1
  const remainingDays =
    (totalTreatmentWeeks - slowestWeek) * 7 + (6 - slowestCompletedDays)
  const finalDay7Date = parseDateOnly(addDays(todayDateString(), remainingDays))
  const bufferDays =
    Math.round((apptDate.getTime() - finalDay7Date.getTime()) / MS_PER_DAY) - 1

  if (bufferDays < 0) return { kind: "behind", count: Math.abs(bufferDays) }
  return { kind: "days", count: bufferDays }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. (If you see "Property 'FoodProgress' not found" — verify the import line in schedule.ts was updated.)

```bash
npm run build
```

Expected: build succeeds. (The migration file is not compiled — only the .ts files matter here.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260629_treatment_food_progress.sql lib/types.ts lib/schedule.ts
git commit -m "feat(f3): add treatment_food_progress migration + FoodProgress type + schedule helpers"
```

---

## Task 2: Supabase Data Layer

**Files:**
- Modify: `lib/supabase.ts`

**Interfaces:**
- Consumes: `FoodProgress` from `lib/types.ts`, `TreatmentFood` from `lib/types.ts`
- Produces:
  - `fetchFoodProgress(): Promise<Map<string, FoodProgress>>`
  - `saveFoodProgress(progress: Map<string, FoodProgress>): Promise<void>`
  - `seedFoodProgress(treatmentFoods: TreatmentFood[], week: number, day: number): Promise<Map<string, FoodProgress>>`

**Context:** The existing `lib/supabase.ts` file is ~500 lines. All three new functions use the existing `getFamilyId()` helper (line 29) and `getClient()` (line 12). Add `FoodProgress` and `TreatmentFood` to the existing import at the top of the file.

- [ ] **Step 1: Update the import at the top of `lib/supabase.ts`**

The current import line reads:
```ts
import { ParsedSchedule, DoseState, DoseLogDay, DayRecord, FoodGroup } from "./types"
```

Change it to:
```ts
import { ParsedSchedule, DoseState, DoseLogDay, DayRecord, FoodGroup, FoodProgress, TreatmentFood } from "./types"
```

- [ ] **Step 2: Append the three new functions to the end of `lib/supabase.ts`**

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

export async function seedFoodProgress(
  treatmentFoods: TreatmentFood[],
  week: number,
  day: number
): Promise<Map<string, FoodProgress>> {
  const progress = new Map<string, FoodProgress>()
  for (const food of treatmentFoods) {
    progress.set(food.name, {
      foodName: food.name,
      week,
      day,
      completedDays: day - 1,
      lastCompletedAt: null,
    })
  }
  await saveFoodProgress(progress)
  return progress
}
```

**Note on `seedFoodProgress`:** `completedDays = day - 1` because if the user is currently on Day 3 (for example), they have completed Days 1 and 2 in the current week, so `completedDays = 2 = day - 1`.

- [ ] **Step 3: Verify TypeScript compiles and build passes**

```bash
npx tsc --noEmit
```

Expected: no errors.

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase.ts
git commit -m "feat(f3): add fetchFoodProgress, saveFoodProgress, seedFoodProgress"
```

---

## Task 3: Wire Food Progress into Daily Page + EveningSection

**Files:**
- Modify: `app/daily/page.tsx`
- Modify: `components/DailyView.tsx`
- Modify: `components/EveningSection.tsx`

**Interfaces:**
- Consumes: `fetchFoodProgress`, `saveFoodProgress`, `seedFoodProgress` from `lib/supabase.ts`
- Consumes: `getGlobalPosition`, `foodsAreInSync`, `getTreatmentFoodEntry`, `calculateBufferFromProgress` from `lib/schedule.ts`
- Consumes: `FoodProgress` from `lib/types.ts`

**Context — existing flow to understand:**
- `app/daily/page.tsx` fetches data in `useEffect`, passes props to `<DailyView />`.
- `DailyView.tsx` receives `schedule`, `doseState`, `appointmentDate` etc. and calls `calculateBuffer` for the buffer display.
- `DailyView.tsx` renders `<EveningSection schedule={schedule} currentWeek={currentWeek} ...>`.
- `EveningSection.tsx` calls `getTreatmentFoodsForWeek(schedule, currentWeek)` and renders one `<FoodItem>` per treatment food.
- `handleCompleteDay` in `daily/page.tsx` calls `saveDoseLog(currentWeek, currentDay, ...)` then updates `completedPositions` and `dayRecords`.

**What changes:**
1. `daily/page.tsx`: fetch food progress, seed if empty, compute global position, override `doseState.currentWeek/currentDay` with global position, update `handleCompleteDay` to advance per-food progress.
2. `DailyView.tsx`: accept `foodProgress` prop, pass to `EveningSection`, switch buffer calc to `calculateBufferFromProgress`.
3. `EveningSection.tsx`: accept `foodProgress` prop, iterate `schedule.treatmentFoods` directly (not `getTreatmentFoodsForWeek`), look up each food's own week from progress, show week badge when foods diverge.

- [ ] **Step 1: Update `app/daily/page.tsx` imports**

The existing import block currently includes (among other things):
```ts
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  saveCheckedState,
  saveDoseLog,
  saveSkipDay,
  fetchCompletedPositions,
  fetchDayRecords,
  fetchDateHasDayRecord,
  fetchAppointmentDate,
  saveAppointmentDate,
  fetchFamilyName,
  fetchFoodGroups,
  fetchVisitNumber,
  saveTimezone,
  getSession,
} from "@/lib/supabase"
import { todayDateString, addDays, getTreatmentFoodsForWeek } from "@/lib/schedule"
```

Change the supabase import to add the three new functions:
```ts
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  saveCheckedState,
  saveDoseLog,
  saveSkipDay,
  fetchCompletedPositions,
  fetchDayRecords,
  fetchDateHasDayRecord,
  fetchAppointmentDate,
  saveAppointmentDate,
  fetchFamilyName,
  fetchFoodGroups,
  fetchVisitNumber,
  saveTimezone,
  getSession,
  fetchFoodProgress,
  saveFoodProgress,
  seedFoodProgress,
} from "@/lib/supabase"
```

Change the schedule import to add the new helpers (and remove `getTreatmentFoodsForWeek` since it's no longer used directly in this file):
```ts
import { todayDateString, addDays, getTreatmentFoodsForWeek, getGlobalPosition } from "@/lib/schedule"
```

(Keep `getTreatmentFoodsForWeek` — it's still used in the `previousDayIncomplete` check lower in the file.)

Add `FoodProgress` to the types import:
```ts
import { ParsedSchedule, DoseState, DayRecord, FoodGroup, FoodProgress } from "@/lib/types"
```

- [ ] **Step 2: Add `foodProgress` state to `app/daily/page.tsx`**

After the existing `const [visitNumber, setVisitNumber] = useState<string | null>(null)` line, add:

```ts
const [foodProgress, setFoodProgress] = useState<Map<string, FoodProgress>>(new Map())
```

- [ ] **Step 3: Update the load sequence in `app/daily/page.tsx`**

The existing `Promise.all` block (around line 70) fetches 7 items in parallel. Add `fetchFoodProgress` to the same `Promise.all`:

Current:
```ts
const [ds, apptDate, name, positions, records, groups, vNum] = await Promise.all([
  fetchDoseState(),
  fetchAppointmentDate().catch(() => null),
  fetchFamilyName().catch(() => null),
  fetchCompletedPositions().catch(() => new Set<string>()),
  fetchDayRecords().catch(() => new Map<string, DayRecord>()),
  fetchFoodGroups().catch(() => []),
  fetchVisitNumber().catch(() => null),
])
```

Change to:
```ts
const [ds, apptDate, name, positions, records, groups, vNum, rawProgress] = await Promise.all([
  fetchDoseState(),
  fetchAppointmentDate().catch(() => null),
  fetchFamilyName().catch(() => null),
  fetchCompletedPositions().catch(() => new Set<string>()),
  fetchDayRecords().catch(() => new Map<string, DayRecord>()),
  fetchFoodGroups().catch(() => []),
  fetchVisitNumber().catch(() => null),
  fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
])
```

Then, right after the `if (!name) { ... }` redirect check and the `initialState` construction, add the seed + global position logic. Find this block:

```ts
setSchedule(s)
setDoseState(initialState)
setTreatmentAnchor({ week: initialState.currentWeek, day: initialState.currentDay })
```

Replace with:

```ts
// Seed food progress on first load if the table is empty for this family
let progress = rawProgress
if (progress.size === 0 && s.treatmentFoods.length > 0) {
  try {
    progress = await seedFoodProgress(
      s.treatmentFoods,
      initialState.currentWeek,
      initialState.currentDay
    )
  } catch {
    // Seed failed — continue with empty progress; app still functional
  }
}

// Override global week/day from food progress (per-food counters are authoritative)
const globalPos = progress.size > 0
  ? getGlobalPosition(progress)
  : { week: initialState.currentWeek, day: initialState.currentDay }

const stateWithGlobalPos: DoseState = {
  ...initialState,
  currentWeek: globalPos.week,
  currentDay: globalPos.day,
}

setSchedule(s)
setDoseState(stateWithGlobalPos)
setFoodProgress(progress)
setTreatmentAnchor({ week: globalPos.week, day: globalPos.day })
```

- [ ] **Step 4: Update `handleCompleteDay` in `app/daily/page.tsx`**

Find the existing `handleCompleteDay` function:

```ts
async function handleCompleteDay() {
  const current = doseStateRef.current
  if (!current || !hydrated) return

  const { currentWeek, currentDay, checkedFoods } = current
  const completedAt = new Date().toISOString()

  try {
    await saveDoseLog(currentWeek, currentDay, checkedFoods, completedAt, schedule!)
  } catch {
    // Log failed — local state still reflects the checked foods either way
  }

  setCompletedPositions(prev => {
    const next = new Set(prev)
    next.add(`${currentWeek}-${currentDay}`)
    return next
  })

  setDayRecords(prev => {
    const next = new Map(prev)
    next.set(`${currentWeek}-${currentDay}`, { date: completedAt, skipped: false })
    return next
  })
}
```

Replace with:

```ts
async function handleCompleteDay() {
  const current = doseStateRef.current
  if (!current || !hydrated) return

  const { checkedFoods } = current
  const completedAt = new Date().toISOString()

  // Advance per-food progress for every checked evening treatment food
  const updatedProgress = new Map(foodProgress)
  const currentSchedule = schedule!
  for (const food of currentSchedule.treatmentFoods) {
    const key = `evening-${food.name}`
    if (!checkedFoods[key]) continue
    const fp = updatedProgress.get(food.name)
    if (!fp) continue
    const newCompletedDays = fp.completedDays + 1
    if (newCompletedDays >= 7) {
      updatedProgress.set(food.name, { ...fp, week: fp.week + 1, day: 1, completedDays: 0, lastCompletedAt: completedAt })
    } else {
      updatedProgress.set(food.name, { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: completedAt })
    }
  }

  // Log uses the global position BEFORE advancement (the position just completed)
  const globalBefore = getGlobalPosition(foodProgress)

  try {
    await saveFoodProgress(updatedProgress)
  } catch {
    // Save failed — continue; local state still reflects progress
  }

  try {
    await saveDoseLog(globalBefore.week, globalBefore.day, checkedFoods, completedAt, currentSchedule)
  } catch {
    // Log failed — local state still reflects the checked foods either way
  }

  const newGlobal = getGlobalPosition(updatedProgress)

  setFoodProgress(updatedProgress)
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

**Note on `foodProgress` in `handleCompleteDay`:** `foodProgress` is React state — it is a closure variable. Add a `foodProgressRef` so `handleCompleteDay` always reads current progress (same pattern as `doseStateRef`). Add right after the existing `doseStateRef`:

```ts
const foodProgressRef = useRef<Map<string, FoodProgress>>(new Map())
```

Then wherever `setFoodProgress(...)` is called (in the load effect and in `handleCompleteDay`), also update `foodProgressRef.current`:

In the load effect, after `setFoodProgress(progress)`:
```ts
foodProgressRef.current = progress
```

In `handleCompleteDay`, change the first line of the function body:
```ts
const foodProgress = foodProgressRef.current
```

And after `setFoodProgress(updatedProgress)`:
```ts
foodProgressRef.current = updatedProgress
```

- [ ] **Step 5: Pass `foodProgress` through to `DailyView` in `app/daily/page.tsx`**

Find the return statement near the bottom of `DailyPage`:

```tsx
return (
  <DailyView
    schedule={schedule}
    doseState={doseState}
    onStateChange={handleStateChange}
    onCompleteDay={handleCompleteDay}
    onSkipDay={handleSkipDay}
    appointmentDate={appointmentDate}
    onAppointmentChange={handleAppointmentChange}
    familyName={familyName}
    completedPositions={completedPositions}
    dayRecords={dayRecords}
    treatmentAnchor={treatmentAnchor}
    previousDayIncomplete={previousDayIncomplete}
    foodGroups={foodGroups}
    visitNumber={visitNumber}
    isAppointmentDay={isAppointmentDay}
  />
)
```

Add `foodProgress={foodProgress}`:
```tsx
return (
  <DailyView
    schedule={schedule}
    doseState={doseState}
    onStateChange={handleStateChange}
    onCompleteDay={handleCompleteDay}
    onSkipDay={handleSkipDay}
    appointmentDate={appointmentDate}
    onAppointmentChange={handleAppointmentChange}
    familyName={familyName}
    completedPositions={completedPositions}
    dayRecords={dayRecords}
    treatmentAnchor={treatmentAnchor}
    previousDayIncomplete={previousDayIncomplete}
    foodGroups={foodGroups}
    visitNumber={visitNumber}
    isAppointmentDay={isAppointmentDay}
    foodProgress={foodProgress}
  />
)
```

- [ ] **Step 6: Update `components/DailyView.tsx`**

**6a. Update imports.** The existing import from `@/lib/schedule` currently includes `getTreatmentFoodsForWeek` and `getTotalTreatmentWeeks` and `calculateBuffer`. Change to:

```ts
import { getTreatmentFoodsForWeek, getTotalTreatmentWeeks, calculateBufferFromProgress, foodsAreInSync } from "@/lib/schedule"
```

Add `FoodProgress` to the types import:
```ts
import { ParsedSchedule, DoseState, DayRecord, FoodGroup, FoodProgress } from "@/lib/types"
```

**6b. Add `foodProgress` to `DailyViewProps`.** Find the `interface DailyViewProps` block and add the new prop:

```ts
interface DailyViewProps {
  schedule: ParsedSchedule
  doseState: DoseState
  onStateChange: (updater: (prev: DoseState) => DoseState) => void
  onCompleteDay: () => void
  onSkipDay: () => void
  appointmentDate: string | null
  onAppointmentChange: (value: string) => void
  familyName: string | null
  completedPositions: Set<string>
  dayRecords: Map<string, DayRecord>
  treatmentAnchor: { week: number; day: number }
  previousDayIncomplete: boolean
  foodGroups: FoodGroup[]
  visitNumber: string | null
  isAppointmentDay: boolean
  foodProgress: Map<string, FoodProgress>
}
```

**6c. Add `foodProgress` to the destructured props** in the `export default function DailyView({ ... })` signature.

**6d. Update the buffer calculation.** Find the existing call to `calculateBuffer`:

```ts
const bufferResult = calculateBuffer(
  appointmentDate,
  getTotalTreatmentWeeks(schedule),
  doseState.cycleStartDate,
  doseState.skipCount
)
```

The existing call is based on `cycleStartDate + skipCount`. Replace it with the new food-progress-based calculation. The "slowest food" is identified by `getGlobalPosition`, but we need its `completedDays` value, not just `week`/`day`. Extract it:

```ts
const totalTreatmentWeeks = getTotalTreatmentWeeks(schedule)

// Find the slowest food's completedDays for buffer projection
let slowestCompletedDays = 0
if (foodProgress.size > 0) {
  let minIdx = Infinity
  for (const fp of foodProgress.values()) {
    const idx = (fp.week - 1) * 7 + (fp.day - 1)
    if (idx < minIdx) {
      minIdx = idx
      slowestCompletedDays = fp.completedDays
    }
  }
}

const bufferResult = calculateBufferFromProgress(
  appointmentDate,
  totalTreatmentWeeks,
  doseState.currentWeek,
  slowestCompletedDays
)
```

(`doseState.currentWeek` is now set to the global (min) week from food progress, as established in Task 3 Step 3.)

**6e. Pass `foodProgress` to `EveningSection`.** Find the `<EveningSection ... />` render call. Add `foodProgress={foodProgress}`:

```tsx
<EveningSection
  schedule={schedule}
  currentWeek={currentWeek}
  checkedFoods={checkedFoods}
  onCheck={handleCheck}
  onSkipDay={onSkipDay}
  isFutureDay={isFutureDay}
  isCurrentTreatmentDay={isCurrentTreatmentDay}
  isSkipped={isSkipped}
  foodProgress={foodProgress}
/>
```

- [ ] **Step 7: Update `components/EveningSection.tsx`**

Replace the entire file with:

```tsx
"use client"

import { useState } from "react"
import { ParsedSchedule, FoodProgress } from "@/lib/types"
import FoodItem from "./FoodItem"
import { getTreatmentFoodEntry, foodsAreInSync } from "@/lib/schedule"

interface EveningSectionProps {
  schedule: ParsedSchedule
  currentWeek: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  onSkipDay: () => void
  isFutureDay: boolean
  isCurrentTreatmentDay: boolean
  isSkipped: boolean
  foodProgress: Map<string, FoodProgress>
}

export default function EveningSection({
  schedule,
  currentWeek,
  checkedFoods,
  onCheck,
  onSkipDay,
  isFutureDay,
  isCurrentTreatmentDay,
  isSkipped,
  foodProgress,
}: EveningSectionProps) {
  const [confirming, setConfirming] = useState(false)

  const inSync = foodsAreInSync(foodProgress)
  const treatmentFoods = schedule.treatmentFoods

  const allChecked = treatmentFoods.length > 0 && treatmentFoods.every(
    food => !!checkedFoods[`evening-${food.name}`]
  )
  const canSkip = isCurrentTreatmentDay && !isFutureDay && !allChecked && treatmentFoods.length > 0 && !isSkipped

  return (
    <section className="mb-6">
      <h2 className="text-xl font-bold mb-1">Evening</h2>
      <p className="text-xs text-gray-500 mb-2">
        4 hrs after morning · 15 min between foods · 1 hr rest after
      </p>
      {isFutureDay ? (
        <div className="mt-2 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl">
          <p className="text-sm text-amber-900 font-medium">
            You haven&apos;t reached this treatment day yet
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-gray-100">
            {treatmentFoods.map(food => {
              const fp = foodProgress.get(food.name)
              const foodWeek = fp?.week ?? currentWeek
              const { weekEntry, isContinuing } = getTreatmentFoodEntry(food, foodWeek)
              const weekBadge = !inSync && fp ? `Wk ${fp.week}` : undefined
              return (
                <FoodItem
                  key={`evening-${food.name}`}
                  name={food.name}
                  dose={weekEntry.dose}
                  unit={weekEntry.unit}
                  prepNote={null}
                  capped={false}
                  isWeekly={false}
                  isContinuing={isContinuing}
                  checked={!!checkedFoods[`evening-${food.name}`]}
                  onChange={val => onCheck(`evening-${food.name}`, val)}
                  weekBadge={weekBadge}
                />
              )
            })}
          </div>

          {canSkip && (
            confirming ? (
              <div className="mt-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
                <p className="text-sm font-medium mb-3">
                  Skip this day? Tomorrow will repeat the same week and day. This can&apos;t be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    className="flex-1 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
                    onClick={() => { setConfirming(false); onSkipDay() }}
                  >
                    Yes — skip
                  </button>
                  <button
                    className="flex-1 py-2 bg-gray-200 text-gray-800 text-sm font-semibold rounded-lg"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="mt-3 text-sm underline text-gray-500"
                onClick={() => setConfirming(true)}
              >
                Skip Day
              </button>
            )
          )}
        </>
      )}
    </section>
  )
}
```

**Note:** `FoodItem` now receives a `weekBadge?: string` prop. You need to check whether `FoodItem` already accepts this prop. Read `components/FoodItem.tsx` before proceeding.

- [ ] **Step 7b: Update `components/FoodItem.tsx` if needed**

Read `components/FoodItem.tsx`. If it does NOT already have a `weekBadge` prop:

Add `weekBadge?: string` to its props interface, and render it inline when truthy. Position it next to the food name or as a trailing badge. Use the same inline style as `components/ui/Badge.tsx`'s week variant (bg `#f0eaff`, color `#7a4db8`, font-size `9px`):

```tsx
{weekBadge && (
  <span
    className="text-[9px] font-medium px-1.5 py-0.5 rounded-[4px] ml-1"
    style={{ background: "#f0eaff", color: "#7a4db8" }}
  >
    {weekBadge}
  </span>
)}
```

If `FoodItem` already has a `weekBadge` prop, no changes needed.

- [ ] **Step 8: Verify TypeScript compiles and build passes**

```bash
npx tsc --noEmit
```

Expected: no errors.

```bash
npm run build
```

Expected: build succeeds. Check for any "Property does not exist" errors — they indicate a prop was added to a component but not to its interface, or a missing import.

- [ ] **Step 9: Commit**

```bash
git add app/daily/page.tsx components/DailyView.tsx components/EveningSection.tsx components/FoodItem.tsx
git commit -m "feat(f3): wire per-food progress into daily view — Complete Day advances checked foods independently"
```

---

## Post-Implementation: Apply Migration to Production

**Before deploying this code to Vercel, apply the migration to production Supabase:**

```bash
supabase db query --linked < supabase/migrations/20260629_treatment_food_progress.sql
```

**Verify the table exists:**
```bash
supabase db query --linked --sql "SELECT table_name FROM information_schema.tables WHERE table_name = 'treatment_food_progress';"
```

Expected: one row returned with `table_name = treatment_food_progress`.

**Then deploy** (using `/deploy prod` or `vercel --prod`). On first load, each user's treatment foods will be seeded into the table automatically.

---

## Self-Review

**Spec coverage:**
- [x] Each treatment food row in Supabase has its own `week` and `day` → Task 1 migration + Task 2 `fetchFoodProgress`/`saveFoodProgress`
- [x] On load, global header week/day = minimum across all active treatment foods → Task 3 Steps 3, 6d
- [x] Complete Day advances only checked treatment foods; skipped foods stay on their current day → Task 3 Step 4
- [x] Per-food week badges appear when at least one food is on a different week/day → Task 3 Step 7 (`weekBadge` prop, `inSync` check)
- [x] Per-food week badges hidden when all in sync → `!inSync` condition in Step 7
- [x] Buffer days recalculated against the furthest-behind food → Task 1 `calculateBufferFromProgress`, Task 3 Step 6d
- [x] Existing data migrated: seeded from current global week/day on first load → Task 3 Step 3 (`seedFoodProgress`)
- [x] Migration must be applied before code deploy → Post-Implementation section
- [x] No change to Complete Day gate rule (all evening foods must be checked) → `allChecked` check unchanged in EveningSection

**Known gaps this plan does NOT address (out of F3 scope):**
- Skip Day (individual food skip) — the BRIEF describes individual food skipping as a future UX pattern but the current Skip Day button skips the whole evening. Not changed in F3.
- History view still shows the global week/day position from `dose_log` — unchanged.
- Settings "Current position" still writes `cycle_start_date`/`skip_count` — unchanged. These are overridden on load by food progress.

**Type consistency:**
- `FoodProgress.foodName` used as the map key in all three supabase functions and in EveningSection
- `getGlobalPosition` returns `{ week: number; day: number }` — matches `treatmentAnchor` type
- `calculateBufferFromProgress(appointmentDateStr, totalTreatmentWeeks, slowestWeek, slowestCompletedDays)` — slowestWeek comes from `doseState.currentWeek` (which is set to global min week), slowestCompletedDays from the min-index food's `completedDays` field
