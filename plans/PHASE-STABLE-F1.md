# Treatment Food Tracking Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the all-or-nothing Complete Day gate with a confirm-on-save dialog, add lazy auto-rollover for missed days, fix the false "yesterday incomplete" banner, let Trailing Edit affect per-food advancement, and replace Settings' single global Week/Day stepper with per-food steppers — all rooted in one fact: treatment foods are tracked independently (`treatment_food_progress`), and every piece of code must respect that.

**Architecture:** No new tables, no schema migration. `dose_log` stays one-row-per-calendar-day (`session: 'day'`), written only by two paths: (1) live user action (Complete Day confirm, or a Trailing Edit correction via `UPDATE`, never `INSERT`), and (2) lazy auto-rollover finalizing the single most recent missed day, using the existing `fetchDateHasDayRecord` guard so it can never duplicate a row. Position for treatment foods is always derived live via `getGlobalPosition()` (minimum across `treatment_food_progress`) — never stored as an independent "current position" a user sets directly. `dose_state.currentWeek/currentDay/cycleStartDate/floorWeek/floorDay` exist only to drive nav-floor and calendar-fallback display; they get recomputed from `getGlobalPosition()` after any per-food change, never edited directly by the user.

**Tech Stack:** Next.js App Router, React (client components, `useState`/`useEffect`), Supabase (Postgres, `@supabase/supabase-js` client calls in `lib/supabase.ts`), TypeScript. No test framework exists in this repo — verification is `npx tsc --noEmit`, `npm run build`, and manual QA against the acceptance criteria in the design doc. Match this repo's established plan convention (full-file-section replacement steps, typecheck + build verification, then commit) rather than introducing a new testing framework.

## Global Constraints

- App name "Tip Pal" — never "TIP Pal". No personal names in code or copy.
- `dose_log` has no unique constraint beyond its primary key `id` (confirmed against the live Supabase schema) — `(week, day)` legitimately repeats across reset epochs, so every write path must reason about this explicitly (guard-before-insert, or update-by-`id` never by `(week, day)` lookup with a blind insert fallback).
- History must be factual, never fabricated — a day with no `dose_log` row shows as empty/absent, never backfilled, never normalized to look complete.
- `resetFoodProgress`/`seedFoodProgress` remain, reserved for initial onboarding/setup seeding only — no other code path may call them after this plan.
- `npx tsc --noEmit` must report zero errors after every task. `npm run build` must succeed at the checkpoint tasks that call for it (5, 8, 9) — full builds are slower, so intermediate tasks rely on `tsc` alone, which Next.js's own build type-checking makes an accurate proxy.
- Exact confirm-dialog and banner copy is locked in the design doc (`docs/superpowers/specs/2026-07-16-treatment-food-tracking-fixes-final-design.md`) — do not rephrase.
- Global header's "furthest-behind food" display (`getGlobalPosition`, min-across-foods) must be unaffected by every change in this plan — it is read, never redefined.

---

## File Map

| File | Change |
|---|---|
| `lib/supabase.ts` | Remove `saveSkipDay`, `saveBulkCatchUpLog`. `saveDoseLog` gains an `isSkipped` param. Add `fetchLastLoggedDate()`. Drop the `!is_skipped` filter from `fetchRecentCompletedDays` and `fetchAllDoseLogDays`. |
| `components/EveningSection.tsx` | Remove the `allTreatmentChecked` gate and the Skip evening button/confirm block. Wire the new confirm-dialog flow. |
| `components/CompleteDayConfirm.tsx` (new) | Confirm dialog: names unchecked foods, or the "no treatment foods given" copy. |
| `components/DailyView.tsx` | Remove the 100%-checked auto-fire in `handleCheck`. Remove `onSkipDay` prop. Two-variant banner copy (single-day / multi-day gap). |
| `app/daily/page.tsx` | Remove `handleSkipDay` and the `saveSkipDay` import. `handleCompleteDay` computes `isSkipped`. Banner root-cause fix (floor comparison) + auto-rollover rewrite of the reconciliation block. |
| `app/history/edit/page.tsx` | Fetch `dose_state` + `treatment_food_progress`. Wire per-food advancement when a previously-unchecked treatment food is checked. Updated copy. |
| `components/RecentDaysEditor.tsx` | Copy-only change (no prop/behavior change needed). |
| `components/DoseHistoryLog.tsx` | Fix evening-skip status derivation to read `checked_foods` content instead of the now-dead `eveningSkipped` flag. |
| `app/settings/page.tsx` | Remove the single global stepper, the Catchup modal, and all `showCatchup`/`withCatchup` state. Add per-food steppers + read-only auto-derived "Program day" summary. |
| `app/onboarding/page.tsx` | Remove its separate Catchup modal and `showCatchup`/`withCatchup` state (Task 1 removed `saveBulkCatchUpLog` — "no longer used anywhere"). Its own single week/day picker (step 3) is unchanged — seeding every food to the same starting position is correct for brand-new schedules. |

## Data Model Reference

```ts
// lib/types.ts — unchanged, reference only
interface FoodProgress {
  foodName: string
  week: number
  day: number
  completedDays: number
  lastCompletedAt: string | null
}

interface DoseState {
  currentWeek: number
  currentDay: number
  checkedFoods: Record<string, boolean>
  morningSkipped?: boolean
  eveningSkipped?: boolean
  completedDays?: Record<string, Record<string, boolean>>
  cycleStartDate: string
  skipCount: number
  floorWeek: number
  floorDay: number
  recommendedFoodCounts?: Record<string, Record<string, number>>
}

interface DoseLogDay {
  id: string
  week: number
  day: number
  completedAt: string
  checkedFoods: Record<string, boolean>
  scheduleSnapshot: ParsedSchedule | null
  morningSkipped: boolean
  eveningSkipped: boolean
}
```

`getGlobalPosition(progress: Map<string, FoodProgress>): { week: number; day: number }` (`lib/schedule.ts:106-120`) — minimum position across all foods. Never modify this function.

**Per-food advancement math** (used identically in three places in this plan — Complete Day, auto-rollover, Trailing Edit):
```ts
const newCompletedDays = fp.completedDays + 1
const updatedFp = newCompletedDays >= 7
  ? { ...fp, week: fp.week + 1, day: 1, completedDays: 0, lastCompletedAt: nowIso }
  : { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: nowIso }
```

**Dose-state merge rule:** `saveDoseState(state: DoseState)` (`lib/supabase.ts:522-544`) is a full-row upsert — it overwrites every column. Any task that calls it to update position fields (`currentWeek`/`currentDay`/`cycleStartDate`/`floorWeek`/`floorDay`) MUST spread the existing fetched `DoseState` first and only override those specific fields, or it will silently wipe today's live `checkedFoods`/`completedDays`/skip flags. This is called out explicitly in every task that touches it.

---

### Task 1: Data layer — dose_log writes, skip removal, history fetch fixes

**Files:**
- Modify: `lib/supabase.ts`

**Interfaces:**
- Produces: `saveDoseLog(week: number, day: number, checkedFoods: Record<string, boolean>, completedAt: string, scheduleSnapshot: object, isSkipped: boolean): Promise<void>` (signature change — 6th param added)
- Produces: `fetchLastLoggedDate(): Promise<string | null>` — returns the calendar date portion (`YYYY-MM-DD`) of the most recent `session: 'day'` row's `completed_at`, or `null` if none exists
- Removes: `saveSkipDay`, `saveBulkCatchUpLog` (no longer exported — later tasks remove their only call sites)

- [ ] **Step 1: Add `isSkipped` param to `saveDoseLog`**

Replace `lib/supabase.ts:259-280`:

```ts
export async function saveDoseLog(
  week: number,
  day: number,
  checkedFoods: Record<string, boolean>,
  completedAt: string,
  scheduleSnapshot: object,
  isSkipped: boolean
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
    })
  if (error) throw error
}
```

- [ ] **Step 2: Remove `saveSkipDay`**

Delete `lib/supabase.ts:282-301` (the entire `saveSkipDay` function) — its only caller is removed in Task 2.

- [ ] **Step 3: Remove `saveBulkCatchUpLog`**

Delete `lib/supabase.ts:196-217` (the entire `saveBulkCatchUpLog` function) — its only caller is removed in Task 8.

- [ ] **Step 4: Drop the skip filter from `fetchRecentCompletedDays` and `fetchAllDoseLogDays`**

In `fetchRecentCompletedDays` (`lib/supabase.ts:367-393`), change:

```ts
const completedDayRows = data.filter(r => r.session === "day" && !r.is_skipped)
const topThree = completedDayRows.slice(0, 3)
```

to:

```ts
const dayRows = data.filter(r => r.session === "day")
const topThree = dayRows.slice(0, 3)
```

In `fetchAllDoseLogDays` (`lib/supabase.ts:395-420`), change:

```ts
const completedDayRows = data.filter(r => r.session === "day" && !r.is_skipped)
return completedDayRows.map(dayRow => ({
```

to:

```ts
const dayRows = data.filter(r => r.session === "day")
return dayRows.map(dayRow => ({
```

(Both functions already sort by `completed_at` — a skipped day now appears in position, correctly labeled, instead of being silently hidden. This is required for spec section 4: "display exactly what happened.")

- [ ] **Step 5: Add `fetchLastLoggedDate`**

Add after `fetchDateHasDayRecord` (`lib/supabase.ts:354-365`):

```ts
export async function fetchLastLoggedDate(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("completed_at")
    .eq("family_id", familyId)
    .eq("session", "day")
    .order("completed_at", { ascending: false })
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) return null
  return (data[0].completed_at as string).slice(0, 10)
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: errors only in files not yet updated to match the new `saveDoseLog` signature and the removed functions (`app/daily/page.tsx`, `app/settings/page.tsx`) — these are fixed in Tasks 4, 5, 8. If any error is in a file outside that list, stop and investigate before continuing.

- [ ] **Step 7: Commit**

```bash
git add lib/supabase.ts
git commit -m "refactor(data): add isSkipped to saveDoseLog, fetchLastLoggedDate, remove saveSkipDay/saveBulkCatchUpLog, unhide skipped days from history fetches"
```

---

### Task 2: Remove Skip Evening / Complete Day gate

**Files:**
- Modify: `components/EveningSection.tsx`
- Modify: `components/DailyView.tsx`
- Modify: `app/daily/page.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: `EveningSectionProps` drops `onSkipDay`; `DailyViewProps` drops `onSkipDay`

- [ ] **Step 1: Remove the gate, Skip evening button, and `confirmingSkip` state from `EveningSection.tsx`**

Replace the full file (`components/EveningSection.tsx`) with:

```tsx
"use client"

import { ParsedSchedule, FoodProgress, Medication } from "@/lib/types"
import { getMedicationSessions, getTreatmentFoodEntry, foodsAreInSync } from "@/lib/schedule"
import FoodItem from "./FoodItem"
import SectionHeader from "./ui/SectionHeader"
import CTAButton from "./ui/CTAButton"

interface EveningSectionProps {
  schedule: ParsedSchedule
  currentWeek: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  onSkipMorning: () => void
  onCompleteDayTap: () => void
  isFutureDay: boolean
  isCurrentTreatmentDay: boolean
  isSkipped: boolean
  foodProgress: Map<string, FoodProgress>
}

function getEveningMedications(medications: Medication[] | undefined): Medication[] {
  if (!medications?.length) return []
  return medications.filter(med => getMedicationSessions(med.frequency).includes("evening"))
}

export default function EveningSection({
  schedule,
  currentWeek,
  checkedFoods,
  onCheck,
  onSkipMorning,
  onCompleteDayTap,
  isFutureDay,
  isCurrentTreatmentDay,
  isSkipped,
  foodProgress,
}: EveningSectionProps) {
  const inSync = foodsAreInSync(foodProgress)
  const treatmentFoods = schedule.treatmentFoods
  const eveningMeds = getEveningMedications(schedule.medications)

  // Count: treatment foods + medications
  const itemCount = treatmentFoods.length + eveningMeds.length

  const showActions = isCurrentTreatmentDay && !isFutureDay && !isSkipped

  return (
    <section className="mb-6">
      <SectionHeader session="evening" label="Evening" count={itemCount} />

      {isFutureDay ? (
        <div
          className="px-4 py-3 rounded-xl"
          style={{ background: "#fff8e1", border: "0.5px solid #ffe082" }}
        >
          <p className="text-sm font-medium" style={{ color: "#795548" }}>
            You haven&apos;t reached this treatment day yet
          </p>
        </div>
      ) : (
        <>
          {/* Treatment foods */}
          {treatmentFoods.map(food => {
            const fp = foodProgress.get(food.name)
            const foodWeek = fp?.week ?? currentWeek
            const { weekEntry, isContinuing } = getTreatmentFoodEntry(food, foodWeek)
            const weekBadge = !inSync && fp ? `Wk ${fp.week} · Day ${fp.day}` : undefined
            const key = `evening-${food.name}`
            return (
              <FoodItem
                key={key}
                name={food.name}
                dose={weekEntry.dose}
                unit={weekEntry.unit}
                prepNote={null}
                capped={false}
                session="evening"
                isContinuing={isContinuing}
                checked={!!checkedFoods[key]}
                onChange={val => onCheck(key, val)}
                weekBadge={weekBadge}
              />
            )
          })}

          {/* Evening medications */}
          {eveningMeds.map(med => {
            const key = `evening-med-${med.name}`
            return (
              <FoodItem
                key={key}
                name={med.name}
                dose={med.dose}
                unit={med.unit}
                prepNote={null}
                capped={false}
                session="med"
                checked={!!checkedFoods[key]}
                onChange={val => onCheck(key, val)}
              />
            )
          })}

          {/* Complete Day — always enabled; confirm dialog handles partial/zero checks */}
          {showActions && (
            <div className="mt-4">
              <CTAButton onClick={onCompleteDayTap}>
                Complete Day
              </CTAButton>
            </div>
          )}

          {/* Skip morning — informational log only */}
          {showActions && (
            <div className="mt-3 flex flex-col items-center gap-1">
              <button
                className="text-sm underline"
                style={{ color: "var(--color-text-muted)" }}
                onClick={onSkipMorning}
              >
                Skip morning
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
```

Note: `onCompleteDay` is renamed to `onCompleteDayTap` here because Task 3 inserts a confirm-decision step between the tap and the actual save — `onCompleteDayTap` is "user tapped the button," which may or may not lead to `onCompleteDay` (the actual save) being called.

- [ ] **Step 2: Remove `onSkipDay` from `DailyView.tsx`, remove the auto-fire, pass through `onCompleteDayTap`**

In `components/DailyView.tsx`, remove `onSkipDay` from `DailyViewProps` (line 15) and from the destructured props (line 56).

Replace `handleCheck` (`components/DailyView.tsx:141-150`):

```ts
function handleCheck(key: string, val: boolean) {
  onStateChange(prev => ({ ...prev, checkedFoods: { ...prev.checkedFoods, [key]: val } }))
}
```

Replace the `EveningSection` usage (`components/DailyView.tsx:361-373`):

```tsx
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
/>
```

(`onCompleteDay` prop on `DailyView` itself is unchanged for now — Task 3 changes what it means at the `app/daily/page.tsx` call site.)

- [ ] **Step 3: Remove `handleSkipDay` and the `saveSkipDay` import from `app/daily/page.tsx`**

Remove `saveSkipDay` from the import block (`app/daily/page.tsx:12`).

Delete `handleSkipDay` (`app/daily/page.tsx:279-301`).

Remove `onSkipDay={handleSkipDay}` from the `<DailyView>` usage (`app/daily/page.tsx:323`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors (Task 1's `saveDoseLog` signature change doesn't affect this file yet — that's Task 4).

- [ ] **Step 5: Commit**

```bash
git add components/EveningSection.tsx components/DailyView.tsx app/daily/page.tsx
git commit -m "refactor(daily): remove Complete Day gate and Skip Evening entirely"
```

---

### Task 3: Confirm-on-save dialog

**Files:**
- Create: `components/CompleteDayConfirm.tsx`
- Modify: `components/EveningSection.tsx`

**Interfaces:**
- Produces: `CompleteDayConfirmProps = { unchecked: string[]; onConfirm: () => void; onCancel: () => void }` — `unchecked` is the list of treatment food names not checked (empty array means none were checked at all, not "all were checked" — the caller only renders this component when at least one food is unchecked)
- Consumes (in `EveningSection.tsx`): `useState` for dialog visibility, `treatmentFoods` (already in scope)

- [ ] **Step 1: Create `components/CompleteDayConfirm.tsx`**

`noneChecked` is an explicit prop, not re-derived inside the component, because the component only receives the unchecked list — it has no way to know on its own whether that list represents "some unchecked" or "all unchecked" without also knowing the total treatment food count. The caller (Step 2) already has both numbers, so it decides.

```tsx
"use client"

interface CompleteDayConfirmProps {
  unchecked: string[]
  noneChecked: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function CompleteDayConfirm({ unchecked, noneChecked, onConfirm, onCancel }: CompleteDayConfirmProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div
        className="bg-white w-full rounded-t-2xl px-6 pt-6"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
      >
        {noneChecked ? (
          <p className="text-base font-semibold mb-5" style={{ color: "var(--color-text-primary)" }}>
            No treatment foods were given today — confirm skip?
          </p>
        ) : (
          <div className="mb-5">
            {unchecked.map(name => (
              <p key={name} className="text-base font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>
                {name} wasn&apos;t checked — skip it today?
              </p>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <button
            className="flex-1 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--color-primary-mid)", color: "#fff" }}
            onClick={onConfirm}
          >
            Confirm
          </button>
          <button
            className="flex-1 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--color-primary-border)", color: "var(--color-text-primary)" }}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the dialog into `EveningSection.tsx`**

In `components/EveningSection.tsx`, add `useState` back to the imports and `CompleteDayConfirm`:

```ts
import { useState } from "react"
```

```ts
import CompleteDayConfirm from "./CompleteDayConfirm"
```

Inside the component body, before `return`, add:

```ts
const [showConfirm, setShowConfirm] = useState(false)

const uncheckedTreatmentFoods = treatmentFoods.filter(
  food => !checkedFoods[`evening-${food.name}`]
).map(food => food.name)

function handleCompleteDayTap() {
  if (uncheckedTreatmentFoods.length === 0) {
    onCompleteDayTap()
    return
  }
  setShowConfirm(true)
}

function handleConfirm() {
  setShowConfirm(false)
  onCompleteDayTap()
}
```

Replace the Complete Day button block:

```tsx
{showActions && (
  <div className="mt-4">
    <CTAButton onClick={handleCompleteDayTap}>
      Complete Day
    </CTAButton>
  </div>
)}
```

Add the dialog just before the closing `</section>`:

```tsx
{showConfirm && (
  <CompleteDayConfirm
    unchecked={uncheckedTreatmentFoods}
    noneChecked={uncheckedTreatmentFoods.length === treatmentFoods.length}
    onConfirm={handleConfirm}
    onCancel={() => setShowConfirm(false)}
  />
)}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero new errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add components/CompleteDayConfirm.tsx components/EveningSection.tsx
git commit -m "feat(daily): add Complete Day confirm-on-save dialog for partial/zero checked treatment foods"
```

---

### Task 4: `handleCompleteDay` computes `isSkipped`

**Files:**
- Modify: `app/daily/page.tsx`

**Interfaces:**
- Consumes: `saveDoseLog` (Task 1's new signature)

- [ ] **Step 1: Update the `saveDoseLog` call in `handleCompleteDay`**

In `app/daily/page.tsx`, `handleCompleteDay` (lines 214-277), replace:

```ts
    try {
      await saveDoseLog(globalBefore.week, globalBefore.day, checkedFoods, completedAt, currentSchedule)
    } catch {
```

with:

```ts
    const isSkipped =
      currentSchedule.treatmentFoods.length > 0 &&
      !currentSchedule.treatmentFoods.some(food => !!checkedFoods[`evening-${food.name}`])

    try {
      await saveDoseLog(globalBefore.week, globalBefore.day, checkedFoods, completedAt, currentSchedule, isSkipped)
    } catch {
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/daily/page.tsx
git commit -m "fix(daily): handleCompleteDay records is_skipped based on actual checked treatment foods"
```

---

### Task 5: Banner root-cause fix + auto-rollover

**Files:**
- Modify: `app/daily/page.tsx`
- Modify: `components/DailyView.tsx`

**Interfaces:**
- Consumes: `fetchLastLoggedDate` (Task 1), `getGlobalPosition` (`lib/schedule.ts`)
- Produces: `DailyViewProps` gains `bannerInfo: { kind: "single"; date: string; foods: string[] } | { kind: "multi"; count: number; startDate: string; endDate: string } | null` (replaces the boolean `previousDayIncomplete`)

This task replaces the reconciliation block at `app/daily/page.tsx:140-178` entirely. Today it only reconciles when **all** foods were checked, and only ever compares against a single hardcoded "yesterday." The new version always finalizes the single most recent missed day (per-food, using whatever was checked), and separately detects whether there's an older, permanently-unlogged gap before that.

- [ ] **Step 1: Add `bannerInfo` type and computation to `app/daily/page.tsx`**

Add the import:

```ts
fetchLastLoggedDate,
```

to the existing `lib/supabase` import block (near `fetchDateHasDayRecord`).

Add near the top of the file, after the other type imports:

```ts
type BannerInfo =
  | { kind: "single"; date: string; foods: string[] }
  | { kind: "multi"; count: number; startDate: string; endDate: string }
  | null
```

Replace the `previousDayIncomplete` state declaration:

```ts
const [previousDayIncomplete, setPreviousDayIncomplete] = useState(false)
```

with:

```ts
const [bannerInfo, setBannerInfo] = useState<BannerInfo>(null)
```

- [ ] **Step 2: Replace lines 92-178 with one unified block**

This replaces everything from `const initialState = ds ?? {` through the end of the old reconciliation block (`app/daily/page.tsx:92-178`) — including the `setSchedule`/`setDoseState`/etc. calls that used to sit in the middle of that range. Reconciliation now runs to completion (mutating local variables only) **before** any `set*` call fires, so the very first render already reflects any auto-rollover advancement — no more "flash of stale position, then jump."

```ts
        const initialState = ds ?? {
          currentWeek: 1,
          currentDay: 1,
          checkedFoods: {},
          cycleStartDate: todayDateString(),
          skipCount: 0,
          floorWeek: 1,
          floorDay: 1,
        }

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
        let globalPos = progress.size > 0
          ? getGlobalPosition(progress)
          : { week: initialState.currentWeek, day: initialState.currentDay }

        const stateWithGlobalPos: DoseState = {
          ...initialState,
          currentWeek: globalPos.week,
          currentDay: globalPos.day,
        }

        let finalDayRecords = records
        let finalCompletedPositions = positions
        let banner: BannerInfo = null

        // Lazy auto-rollover: finalize only the single most recent missed day.
        // Skips entirely if there's no genuine prior tracked day — yesterday's
        // position falling at or before the floor set at the last reset/onboarding.
        const yesterday = addDays(todayDateString(), -1)
        const yesterdaySeq = (initialState.currentWeek - 1) * 7 + initialState.currentDay - 1
        const floorSeq = (initialState.floorWeek - 1) * 7 + initialState.floorDay
        if (initialState.cycleStartDate < todayDateString() && yesterdaySeq > floorSeq) {
          const hasRecord = await fetchDateHasDayRecord(yesterday).catch(() => true)
          if (!hasRecord) {
            const yWeek = Math.floor((yesterdaySeq - 1) / 7) + 1
            const yDay = ((yesterdaySeq - 1) % 7) + 1
            const yPosKey = `${yWeek}-${yDay}`
            const yCheckedFoods = initialState.completedDays?.[yPosKey] ?? {}
            const yEveningItems = getTreatmentFoodsForWeek(s, yWeek)
            const yUncheckedNames = yEveningItems
              .filter(({ food }) => !yCheckedFoods[`evening-${food.name}`])
              .map(({ food }) => food.name)
            const yIsSkipped = yEveningItems.length > 0 && yUncheckedNames.length === yEveningItems.length

            // Advance per-food progress for whatever was checked, same math as handleCompleteDay
            const reconciledAt = new Date().toISOString()
            const advancedProgress = new Map(progress)
            for (const { food } of yEveningItems) {
              if (!yCheckedFoods[`evening-${food.name}`]) continue
              const fp = advancedProgress.get(food.name)
              if (!fp) continue
              const newCompletedDays = fp.completedDays + 1
              advancedProgress.set(
                food.name,
                newCompletedDays >= 7
                  ? { ...fp, week: fp.week + 1, day: 1, completedDays: 0, lastCompletedAt: reconciledAt }
                  : { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: reconciledAt }
              )
            }

            try {
              await saveFoodProgress(advancedProgress)
              await saveDoseLog(yWeek, yDay, yCheckedFoods, reconciledAt, s, yIsSkipped)
              progress = advancedProgress
              globalPos = getGlobalPosition(advancedProgress)
              stateWithGlobalPos.currentWeek = globalPos.week
              stateWithGlobalPos.currentDay = globalPos.day

              const nextDayRecords = new Map(finalDayRecords)
              nextDayRecords.set(yPosKey, { date: reconciledAt, skipped: yIsSkipped })
              finalDayRecords = nextDayRecords

              const nextCompletedPositions = new Set(finalCompletedPositions)
              nextCompletedPositions.add(yPosKey)
              finalCompletedPositions = nextCompletedPositions

              if (yUncheckedNames.length > 0) {
                const lastLogged = await fetchLastLoggedDate().catch(() => null)
                const gapStart = lastLogged ? addDays(lastLogged, 1) : null
                const gapEnd = addDays(yesterday, -1)
                if (gapStart && gapStart <= gapEnd) {
                  const gapDays = Math.round(
                    (new Date(gapEnd + "T00:00:00").getTime() - new Date(gapStart + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24)
                  ) + 1
                  banner = { kind: "multi", count: gapDays, startDate: gapStart, endDate: gapEnd }
                } else {
                  banner = { kind: "single", date: yesterday, foods: yUncheckedNames }
                }
              }
            } catch {
              banner = { kind: "single", date: yesterday, foods: yUncheckedNames }
            }
          }
        }

        setSchedule(s)
        setDoseState(stateWithGlobalPos)
        setFoodProgress(progress)
        foodProgressRef.current = progress
        setTreatmentAnchor({ week: stateWithGlobalPos.currentWeek, day: stateWithGlobalPos.currentDay })
        setAppointmentDate(apptDate)
        setFamilyName(name)
        setCompletedPositions(finalCompletedPositions)
        setDayRecords(finalDayRecords)
        setFoodGroups(groups)
        setVisitNumber(vNum)
        setChildPhotoUrl(photoUrl)
        setBannerInfo(banner)
```

- [ ] **Step 3: Pass `bannerInfo` to `DailyView` instead of `previousDayIncomplete`**

In the `<DailyView>` JSX (`app/daily/page.tsx:317-336`), replace:

```tsx
      previousDayIncomplete={previousDayIncomplete}
```

with:

```tsx
      bannerInfo={bannerInfo}
```

- [ ] **Step 4: Render two-variant banner copy in `DailyView.tsx`**

In `components/DailyView.tsx`, replace `previousDayIncomplete: boolean` in `DailyViewProps` (line 22) with:

```ts
bannerInfo:
  | { kind: "single"; date: string; foods: string[] }
  | { kind: "multi"; count: number; startDate: string; endDate: string }
  | null
```

Replace the destructured prop name (line 63) from `previousDayIncomplete` to `bannerInfo`.

Replace the banner block (`components/DailyView.tsx:319-328`):

```tsx
{bannerInfo && isCurrentTreatmentDay && (
  <div
    className="mb-4 px-4 py-3 rounded-xl"
    style={{ background: "#fff8e1", border: "0.5px solid #ffe082" }}
  >
    <p className="text-sm font-medium" style={{ color: "#795548" }}>
      {bannerInfo.kind === "single"
        ? `${formatDateLabel(new Date(bannerInfo.date + "T00:00:00"))} wasn't logged — ${bannerInfo.foods.join(", ")} weren't given. Go back and fix it if that's wrong.`
        : `${bannerInfo.count} days weren't logged (${formatDateLabel(new Date(bannerInfo.startDate + "T00:00:00"))}–${formatDateLabel(new Date(bannerInfo.endDate + "T00:00:00"))}). Only your current position is tracked going forward — go back to each day to log what actually happened.`}
    </p>
  </div>
)}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 6: Manual verification**

Run: `npm run build 2>&1 | tail -8`
Expected: `✓ Compiled successfully`.

Manually trace through the acceptance criteria from the design doc's testing section for auto-rollover and the banner (single-day and multi-day cases) — this cannot be automated without a test framework, so read through the replaced block once more against: "no tap, next load → single most recent day finalizes"; "2+ day gap → only the most recent finalizes, earlier days stay empty permanently"; "does not fire on same-day-as-reset load" (the `yesterdaySeq > floorSeq` guard).

- [ ] **Step 7: Commit**

```bash
git add app/daily/page.tsx components/DailyView.tsx
git commit -m "fix(daily): auto-rollover finalizes only the single most recent missed day; two-variant gap banner replaces false yesterday-incomplete warning"
```

---

### Task 6: Trailing Edit advancement

**Files:**
- Modify: `app/history/edit/page.tsx`
- Modify: `components/RecentDaysEditor.tsx` (copy only)

**Interfaces:**
- Consumes: `fetchFoodProgress`, `saveFoodProgress`, `fetchDoseState`, `saveDoseState` (all existing in `lib/supabase.ts`), `getGlobalPosition`, `cycleStartDateForPosition` (`lib/schedule.ts`)

- [ ] **Step 1: Replace `app/history/edit/page.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ParsedSchedule, DoseLogDay, DoseState, FoodProgress } from "@/lib/types"
import {
  getSession,
  fetchSchedule,
  fetchRecentCompletedDays,
  updateDoseLogCheckedFoods,
  fetchFoodProgress,
  saveFoodProgress,
  fetchDoseState,
  saveDoseState,
} from "@/lib/supabase"
import { getGlobalPosition, cycleStartDateForPosition } from "@/lib/schedule"
import RecentDaysEditor from "@/components/RecentDaysEditor"

export default function HistoryEditPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [days, setDays] = useState<DoseLogDay[]>([])
  const [foodProgress, setFoodProgress] = useState<Map<string, FoodProgress>>(new Map())
  const [loading, setLoading] = useState(true)

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
        const [s, recentDays, progress] = await Promise.all([
          fetchSchedule(),
          fetchRecentCompletedDays(),
          fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
        ])
        if (!s) {
          router.replace("/setup")
          return
        }
        setSchedule(s)
        setDays(recentDays)
        setFoodProgress(progress)
      } catch {
        router.replace("/daily")
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleToggle(
    id: string,
    key: string,
    val: boolean,
    current: Record<string, boolean>
  ) {
    const updated = { ...current, [key]: val }
    setDays(prev =>
      prev.map(d => (d.id === id ? { ...d, checkedFoods: updated } : d))
    )
    updateDoseLogCheckedFoods(id, updated).catch(() => {})

    // Only a treatment food going from unchecked -> checked advances position.
    const wasChecked = !!current[key]
    if (!val || wasChecked || !key.startsWith("evening-")) return

    const foodName = key.slice("evening-".length)
    const fp = foodProgress.get(foodName)
    if (!fp) return

    const oldGlobal = getGlobalPosition(foodProgress)
    const nowIso = new Date().toISOString()
    const newCompletedDays = fp.completedDays + 1
    const updatedFp: FoodProgress =
      newCompletedDays >= 7
        ? { ...fp, week: fp.week + 1, day: 1, completedDays: 0, lastCompletedAt: nowIso }
        : { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: nowIso }

    const nextProgress = new Map(foodProgress)
    nextProgress.set(foodName, updatedFp)
    setFoodProgress(nextProgress)

    try {
      await saveFoodProgress(nextProgress)
      const newGlobal = getGlobalPosition(nextProgress)
      if (newGlobal.week !== oldGlobal.week || newGlobal.day !== oldGlobal.day) {
        const existing: DoseState | null = await fetchDoseState().catch(() => null)
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
    } catch {
      // Save failed — local state still reflects the correction; next load re-fetches truth
    }
  }

  if (loading || !schedule) return null

  return (
    <main className="max-w-lg mx-auto px-4 py-6 min-h-screen">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/history" className="text-gray-500 text-sm underline">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold">Edit Recent Days</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Showing the 3 most recently logged days. Checking a previously-unchecked treatment food advances that food&apos;s position — gaps outside these 3 days can&apos;t be corrected here.
      </p>
      <RecentDaysEditor schedule={schedule} days={days} onToggle={handleToggle} />
    </main>
  )
}
```

Note on the merge rule: `saveDoseState({ ...existing, ... })` spreads the freshly-fetched `DoseState` so `checkedFoods`/`completedDays`/`morningSkipped`/`eveningSkipped` are preserved exactly — today's live checkboxes are never touched by a Trailing Edit correction. The `saveDoseState` call is skipped entirely when the edited food wasn't the furthest-behind one (global position unchanged), avoiding an unnecessary write.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/history/edit/page.tsx
git commit -m "feat(history): Trailing Edit now advances a food's position when a previously-unchecked treatment food is corrected"
```

---

### Task 7: Fix History display's evening-skip derivation

**Files:**
- Modify: `components/DoseHistoryLog.tsx`

**Interfaces:**
- No prop signature change — internal derivation only

- [ ] **Step 1: Replace `getDayStatus` and `getEveningText` to derive from `checked_foods` instead of the dead `eveningSkipped` flag**

`entry.eveningSkipped` is now always `false` in practice — nothing in the app writes a `session: 'evening'` skip row. "Skipped" for the evening session must instead mean "zero treatment foods were given," derived the same way `getEveningText` already computes its display text.

Replace `getDayStatus` (`components/DoseHistoryLog.tsx:21-26`):

```ts
function getDayStatus(entry: DoseLogDay, schedule: ParsedSchedule): DayStatus {
  const s = entry.scheduleSnapshot ?? schedule
  const eveningFoods = getTreatmentFoodsForWeek(s, entry.week).map(({ food }) => `evening-${food.name}`)
  const eveningSkipped = eveningFoods.length > 0 && !eveningFoods.some(key => entry.checkedFoods[key])
  if (entry.morningSkipped && eveningSkipped) return "both-skipped"
  if (entry.morningSkipped) return "am-skipped"
  if (eveningSkipped) return "pm-skipped"
  return "complete"
}
```

Replace `getEveningText` (`components/DoseHistoryLog.tsx:55-65` — keep body, just drop the now-meaningless `eveningSkipped` short-circuit at the top since "None logged" already covers the zero-checked case identically):

```ts
function getEveningText(entry: DoseLogDay, schedule: ParsedSchedule): string {
  const s = entry.scheduleSnapshot ?? schedule
  const foods = getTreatmentFoodsForWeek(s, entry.week).map(({ food }) => ({
    key: `evening-${food.name}`,
    name: food.name,
  }))
  const given = foods.filter(f => entry.checkedFoods[f.key]).map(f => f.name)
  return given.length > 0 ? given.join(", ") : "None logged"
}
```

Update the one call site of `getDayStatus` inside `DayRow` (find the line `const status = getDayStatus(entry)` and change to `const status = getDayStatus(entry, schedule)` — `schedule` is already a prop of `DayRow`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add components/DoseHistoryLog.tsx
git commit -m "fix(history): derive evening-skipped status from checked_foods, not the unused eveningSkipped flag"
```

---

### Task 8: Settings per-food adjuster

**Files:**
- Modify: `app/settings/page.tsx`
- Modify: `app/onboarding/page.tsx` (remove its separate Catchup modal — same reason, different file, see Step 7)

**Interfaces:**
- Consumes: `fetchFoodProgress`, `saveFoodProgress` (existing), `getGlobalPosition`, `cycleStartDateForPosition` (`lib/schedule.ts`)
- Removes: `resetFoodProgress` import (no longer called from this file — it remains exported from `lib/supabase.ts` for onboarding/setup only), `saveBulkCatchUpLog` import (removed in Task 1) from both `app/settings/page.tsx` and `app/onboarding/page.tsx`, `cycleStartDateForPosition` usage for the old single-position save path (replaced)

- [ ] **Step 1: Update imports**

In `app/settings/page.tsx`, remove from the import block (lines 6-29):
- `saveBulkCatchUpLog`
- `resetFoodProgress`

Add:
- `fetchFoodProgress`
- `saveFoodProgress`

- [ ] **Step 2: Replace the week/day/catchup state with per-food state**

Remove these state declarations (lines 60-64, 70):

```ts
const [week, setWeek] = useState(1)
const [day, setDay] = useState(1)
const [originalWeek, setOriginalWeek] = useState(1)
const [originalDay, setOriginalDay] = useState(1)
const [existingDoseState, setExistingDoseState] = useState<DoseState | null>(null)
```

```ts
const [showCatchup, setShowCatchup] = useState(false)
```

Add:

```ts
const [foodProgress, setFoodProgress] = useState<Map<string, FoodProgress>>(new Map())
const [existingDoseState, setExistingDoseState] = useState<DoseState | null>(null)
```

Add `FoodProgress` to the type import from `@/lib/types` (line 31).

- [ ] **Step 3: Fetch food progress on load**

In the `load()` function's `Promise.all` (lines 93-101), add `fetchFoodProgress().catch(() => new Map<string, FoodProgress>())` and destructure it as `progress`:

```ts
const [name, ds, notifSettings, groups, sched, photoUrl, vNum, progress] = await Promise.all([
  fetchFamilyName().catch(() => null),
  fetchDoseState().catch(() => null),
  fetchNotificationSettings().catch(() => null),
  fetchFoodGroups().catch(() => []),
  fetchSchedule().catch(() => null),
  fetchChildPhotoUrl().catch(() => null),
  fetchVisitNumber().catch(() => null),
  fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
])
```

Replace the block that used to set `week`/`day`/`originalWeek`/`originalDay` (lines 109-115):

```ts
if (ds) {
  setExistingDoseState(ds)
}
setFoodProgress(progress)
```

- [ ] **Step 4: Replace `handleSave`/`saveAll` with per-food save**

Remove `handleSave` (lines 237-246) entirely.

Replace `saveAll` (lines 199-235) with a per-food save function:

```ts
async function saveFoodPosition(foodName: string, newWeek: number, newDay: number) {
  const fp = foodProgress.get(foodName)
  if (!fp) return
  const oldGlobal = getGlobalPosition(foodProgress)
  const updatedFp: FoodProgress = { ...fp, week: newWeek, day: newDay, completedDays: newDay - 1 }
  const nextProgress = new Map(foodProgress)
  nextProgress.set(foodName, updatedFp)
  setFoodProgress(nextProgress)

  setSaving(true)
  setSaveError(null)
  try {
    await saveFoodProgress(nextProgress)
    const newGlobal = getGlobalPosition(nextProgress)
    if ((newGlobal.week !== oldGlobal.week || newGlobal.day !== oldGlobal.day) && existingDoseState) {
      await saveDoseState({
        ...existingDoseState,
        currentWeek: newGlobal.week,
        currentDay: newGlobal.day,
        checkedFoods: {},
        cycleStartDate: cycleStartDateForPosition(newGlobal.week, newGlobal.day),
        floorWeek: newGlobal.week,
        floorDay: newGlobal.day,
      })
    }
    setSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaved(false), 2500)
  } catch (err) {
    setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
  } finally {
    setSaving(false)
  }
}

async function saveOtherFields() {
  setSaving(true)
  setSaveError(null)
  try {
    await saveChildName(childName.trim())
    if (appointmentDateLoaded.current) {
      await saveAppointmentDate(appointmentDate || null)
    }
    await saveVisitNumber(visitNumber.trim() || null)
    await saveNotificationSettings(morningReminder, eveningReminder, timezone)
    setSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaved(false), 2500)
  } catch (err) {
    setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
  } finally {
    setSaving(false)
  }
}
```

Note: `checkedFoods: {}` is intentionally cleared on a position-changing save (matches the prior behavior's reasoning — the derived "current day" may have changed, so today's in-progress checkboxes no longer correspond to a known day). `completedDays` is preserved via the `...existingDoseState` spread. `saveOtherFields` replaces `saveAll(false)`'s non-position responsibilities (child name, appointment date, visit number, notifications) — the Save button (Step 6) now calls this instead of `handleSave`.

- [ ] **Step 5: Replace the Program section JSX — remove global stepper, add per-food steppers + auto summary**

Replace the Week stepper + Day stepper block (`app/settings/page.tsx:354-404`, i.e. everything from the `{/* Week stepper */}` comment through the closing `</div>` of the Day stepper) with:

```tsx
{/* Auto-derived program day */}
{foodProgress.size > 0 && (() => {
  const globalPos = getGlobalPosition(foodProgress)
  let drivingFood: string | null = null
  let minIdx = Infinity
  for (const fp of foodProgress.values()) {
    const idx = (fp.week - 1) * 7 + (fp.day - 1)
    if (idx < minIdx) {
      minIdx = idx
      drivingFood = fp.foodName
    }
  }
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>Program day (auto)</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
          Based on {drivingFood} — your furthest-behind food
        </p>
      </div>
      <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
        Week {globalPos.week}, Day {globalPos.day}
      </span>
    </div>
  )
})()}
<RowDivider />
{/* Per-food steppers — two independent steppers per food (Week, Day), same clamp
    rules as the original single global stepper: Week min 1 no max, Day clamped 1-7
    with no cross-rollover. Deliberately not combined/rollover — matches "same
    visual style as current stepper" from the design doc exactly. */}
{[...foodProgress.values()].map(fp => {
  const globalPos = getGlobalPosition(foodProgress)
  const isFurthestBehind = fp.week === globalPos.week && fp.day === globalPos.day
  return (
    <div key={fp.foodName}>
      <div className="px-4 py-2">
        <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
          {fp.foodName}
          {isFurthestBehind && (
            <span
              className="ml-2 text-xs px-2 py-0.5 rounded-full"
              style={{ background: "var(--color-bg-secondary)", color: "var(--color-text-muted)" }}
            >
              furthest behind
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Week</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => saveFoodPosition(fp.foodName, Math.max(1, fp.week - 1), fp.day)}
            disabled={fp.week <= 1}
            className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
            style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
          >
            −
          </button>
          <span className="text-base font-semibold w-6 text-center" style={{ color: "var(--color-text-primary)" }}>
            {fp.week}
          </span>
          <button
            onClick={() => saveFoodPosition(fp.foodName, fp.week + 1, fp.day)}
            className="flex items-center justify-center text-lg font-bold"
            style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
          >
            +
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Day</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => saveFoodPosition(fp.foodName, fp.week, Math.max(1, fp.day - 1))}
            disabled={fp.day <= 1}
            className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
            style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
          >
            −
          </button>
          <span className="text-base font-semibold w-6 text-center" style={{ color: "var(--color-text-primary)" }}>
            {fp.day}
          </span>
          <button
            onClick={() => saveFoodPosition(fp.foodName, fp.week, Math.min(7, fp.day + 1))}
            disabled={fp.day >= 7}
            className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
            style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
          >
            +
          </button>
        </div>
      </div>
      <RowDivider />
    </div>
  )
})}
```

Add `getGlobalPosition, cycleStartDateForPosition` to the `@/lib/schedule` import.

- [ ] **Step 6: Wire the Save button to `saveOtherFields`, remove the Catchup modal**

Replace the Save button's `onClick` (`app/settings/page.tsx:559`):

```tsx
onClick={saveOtherFields}
```

Delete the entire "Catchup bottom-sheet modal" block (`app/settings/page.tsx:571-601`).

- [ ] **Step 7: Remove the Catchup modal from `app/onboarding/page.tsx` too**

Task 1 removed `saveBulkCatchUpLog` from `lib/supabase.ts` — the design doc says "Remove `saveBulkCatchUpLog` entirely — no longer used anywhere in the app," and `app/onboarding/page.tsx` has its own, separate call site (onboarding's own bulk catch-up prompt after step 3's initial week/day picker). This file is otherwise untouched by this plan — onboarding's single week/day picker in step 3 is correct as-is and must not change: it seeds every treatment food to the *same* starting position via `seedFoodProgress`, which is the one legitimate case for a shared position (a brand-new schedule, before any food has had a chance to drift). Only the catch-up-log prompt itself is being removed here, for the same reason as Settings: history must never be fabricated.

Remove `saveBulkCatchUpLog` from the import block (`app/onboarding/page.tsx:14`).

Remove the `showCatchup` state declaration (`app/onboarding/page.tsx:66`: `const [showCatchup, setShowCatchup] = useState(false)`).

Replace `handleConfirm` (`app/onboarding/page.tsx:123-131`):

```ts
function handleConfirm() {
  saveAndRedirect()
}
```

Replace `saveAndRedirect` (`app/onboarding/page.tsx:133-161`) — drops the `withCatchup` param and the `saveBulkCatchUpLog` call:

```ts
async function saveAndRedirect() {
  setSaving(true)
  setSaveError(null)
  try {
    await saveFamilyConfig(childName.trim(), appointmentDate || null)
    await saveVisitNumber(VISIT_SEQUENCE[visitIdx])
    const positionChanged = week !== originalWeek || day !== originalDay
    if (positionChanged || !existingDoseState) {
      await saveDoseState({
        currentWeek: week,
        currentDay: day,
        checkedFoods: {},
        completedDays: existingDoseState?.completedDays ?? {},
        cycleStartDate: cycleStartDateForPosition(week, day),
        skipCount: 0,
        floorWeek: week,
        floorDay: day,
      })
    }
    router.replace("/daily")
  } catch (err) {
    setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
    setSaving(false)
  } finally {
    setSaving(false)
  }
}
```

Delete the entire "Catchup modal — fixed bottom sheet" block (`app/onboarding/page.tsx:536-563`, from the `{/* Catchup modal — fixed bottom sheet */}` comment through its closing `)}`).

Update the "Start dosing" button's `disabled`/`onClick` — it already calls `handleConfirm` and is `disabled={saving}`, both unchanged; no edit needed there since `handleConfirm` now always calls `saveAndRedirect()` directly.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors. If `week`/`day`/`originalWeek`/`originalDay`/`handleSave`/`showCatchup` are referenced anywhere else in `app/settings/page.tsx` (unlikely but verify with `grep -n "\\bweek\\b\\|\\bday\\b\\|handleSave\\|showCatchup" app/settings/page.tsx`), remove those references too. Do the same check for `app/onboarding/page.tsx` (`grep -n "showCatchup\|withCatchup\|saveBulkCatchUpLog" app/onboarding/page.tsx` should return nothing).

- [ ] **Step 9: Full build**

Run: `npm run build 2>&1 | tail -8`
Expected: `✓ Compiled successfully`.

- [ ] **Step 10: Commit**

```bash
git add app/settings/page.tsx app/onboarding/page.tsx
git commit -m "feat(settings): replace single global Week/Day stepper with per-food steppers and auto-derived Program day summary; remove bulk catch-up log from Settings and onboarding"
```

---

### Task 9: Full verification and BRIEF.md closure

**Files:**
- Modify: `BRIEF.md`

- [ ] **Step 1: Full typecheck and build**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: zero errors.

Run: `npm run build 2>&1 | tail -10`
Expected: `✓ Compiled successfully`, all routes generated including `/daily`, `/settings`, `/history`, `/history/edit`.

- [ ] **Step 2: Manual QA pass against the design doc's testing section**

Work through every bullet in `docs/superpowers/specs/2026-07-16-treatment-food-tracking-fixes-final-design.md`'s Testing section against the live app (dev server or deployed preview) — this is a UI-gated feature bundle, so this step precedes Dan's sign-off, not a substitute for it. Do not mark this step done without actually exercising each scenario.

- [ ] **Step 3: Update BRIEF.md Carry Forward rows**

In the three rows added for this bundle (the false-banner row, the Settings-adjuster row, and the Complete-Day-gate row), change the status cell from "Plan pending" to "Implemented 2026-07-16, pending QA + Dan UI sign-off (confirm dialog copy/layout, banner copy, Settings per-food screen — all three require sign-off per standard gate)."

- [ ] **Step 4: Commit**

```bash
git add BRIEF.md
git commit -m "docs: mark treatment food tracking fixes bundle implemented, pending QA and Dan UI sign-off"
```
