# Photo Bug, Reparse Flow Gaps, Recommended Foods Logging, History Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Tasks 5 and 10 are checkpoint gates, not dispatchable coding tasks.** They require presenting a written mockup to Dan and waiting for his explicit approval in chat before Task 6/7 or Task 11 may begin. Do not dispatch them to a subagent — the orchestrating session must handle them directly.

**Goal:** Fix the reparse flow's missing avatar and missing back/exit; add a per-food week/day starting-position prompt to onboarding and every reparse; replace recommended foods' tap-on-pip logging with explicit +/− controls tied to the furthest-ahead treatment food's week; add day-selection delete to History alongside the existing, untouched Trailing Edit feature.

**Architecture:** Five independent items, five independent commit lines, five independent Reviewer passes — per Dan's explicit instruction not to merge them. No schema changes. No change to `dose_log`'s structure or to Trailing Edit (`/history/edit`). The only shared new surface is `components/FoodPositionStepper.tsx`, extracted from Settings' existing per-food stepper with zero behavior change, then reused by onboarding and reparse in a local-state (batch-commit) mode alongside Settings' existing live-write mode.

**Tech Stack:** Next.js App Router, React (client components), Supabase (`lib/supabase.ts`), TypeScript. No test framework exists in this repo — verification is `npx tsc --noEmit`, `npm run build`, and manual QA against the design doc's testing section, matching this repo's established convention.

## Global Constraints

- App name "Tip Pal" — never "TIP Pal". No personal names in code or copy.
- Trailing Edit (`app/history/edit/page.tsx`, the "Edit" link on `/history`) is **not touched by this plan** — confirmed with Dan. Item 5's new delete-selection UI is added alongside it, not in place of it.
- `treatment_food_progress` orphan/partial-write resolution (design doc, "Orphaned rows" / "Partial-write failure" sections): reparse clears `treatment_food_progress` for the family as soon as the cycle's core writes succeed (before the position prompt renders), then re-seeds it only on the position screen's own confirm action. This means an abandoned position screen leaves the table empty, not stale — which is exactly the condition `app/daily/page.tsx`'s existing lazy-reseed-on-empty fallback already handles. No new rollback/transaction machinery.
- `seedFoodProgress`'s signature changes in Task 4 from `(treatmentFoods: TreatmentFood[], week: number, day: number)` to `(entries: { foodName: string; week: number; day: number }[])`. Its only existing caller (`app/daily/page.tsx`) is updated in the same task.
- `npx tsc --noEmit` must report zero errors after every task. `npm run build` must succeed at Task 12 (final checkpoint).
- "Minimum reached" banner and any other copy not explicitly locked below is Dev's call on exact wording — meaning is locked, not phrasing, per the design doc.

---

## File Map

| File | Change |
|---|---|
| `app/new-cycle/page.tsx` | Task 1: small header avatar on every view-state. Task 2: unify back/exit into one control, disabled during `loading`/`confirming`. Task 7: new `"position"` view-state with per-food starting-position prompt. |
| `components/FoodPositionStepper.tsx` (new) | Task 3: shared per-food Week/Day stepper UI, extracted verbatim from Settings, parameterized for live-write (Settings) and local-state (onboarding/reparse) callers. |
| `app/settings/page.tsx` | Task 3: consumes `FoodPositionStepper` instead of inline JSX. No visual or behavior change. |
| `lib/supabase.ts` | Task 4: `seedFoodProgress` signature change to per-food entries; new `clearFoodProgress()`. Task 9: new `deleteDoseLogDays(ids)`, `deleteAllDoseLogDays()`. |
| `app/daily/page.tsx` | Task 4: update its one `seedFoodProgress` call site to the new signature. |
| `app/onboarding/page.tsx` | Task 6: replace the single global Week/Day stepper (step 3) with per-food `FoodPositionStepper`; `saveAndRedirect` seeds `treatment_food_progress` directly instead of relying on `daily/page.tsx`'s lazy uniform seed. |
| `lib/schedule.ts` | Task 8: new `getFurthestAheadPosition`, new `parseFrequencyLow`. |
| `app/foods/page.tsx` | Task 8: `currentWeek` sourced from `getFurthestAheadPosition` over `treatment_food_progress`, not `dose_state.currentWeek`. |
| `components/RecommendedFoodsView.tsx` | Task 8: `PipRow` becomes read-only; new +/− buttons; new "minimum reached" banner. |
| `app/history/page.tsx` | Task 11: select-mode toggle, "Clear all", single confirm dialog. `/history/edit` link unchanged. |
| `components/DoseHistoryLog.tsx` | Task 11: optional `selectMode`/`selectedIds`/`onToggleSelect` props, backward-compatible defaults. |
| `BRIEF.md` | Task 12: closure entry. |

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

interface RecommendedFood {
  name: string
  dose: number
  unit: string
  frequencyPerWeek: string  // free-form range, e.g. "3-5"
}
```

`getGlobalPosition(progress: Map<string, FoodProgress>): { week: number; day: number }` (`lib/schedule.ts:106-120`) — **minimum** index across foods (furthest-behind). Unmodified by this plan.

`positionIndexOf(week: number, day: number): number` (`lib/schedule.ts:27-29`) — `(week - 1) * 7 + (day - 1)`. Reused by Task 8's new furthest-ahead helper.

**Shared stepper entry type**, defined in `components/FoodPositionStepper.tsx` (Task 3), imported by every consumer:
```ts
export interface FoodPositionEntry {
  foodName: string
  week: number
  day: number
}
```

---

### Task 1: Reparse header avatar

**Files:**
- Modify: `app/new-cycle/page.tsx`

**Interfaces:**
- Consumes: nothing new — `childPhotoUrl` is already fetched and in state (`app/new-cycle/page.tsx:60,70,73`)

**Diagnosis:** `childPhotoUrl` is fetched correctly on load via `fetchChildPhotoUrl()`, same as every other screen. The bug is purely that the shared header renders no avatar element at all — only the `"success"` view's separate 120px ring+avatar (lines 416-426) shows a photo. The other 5 view-states (`confirm`, `paste`, `loading`, `review`, `confirming`, `error`) show nothing.

- [ ] **Step 1: Add a small avatar to the shared header**

In `app/new-cycle/page.tsx`, replace the header's title element:

```tsx
        <h1 className="text-xl font-semibold text-white">{headerTitle}</h1>
```

with:

```tsx
        <div className="flex items-center gap-2">
          <div
            className="rounded-full overflow-hidden flex items-center justify-center shrink-0"
            style={{ width: 28, height: 28, background: "var(--color-primary-light)", fontSize: 14 }}
          >
            {childPhotoUrl ? (
              <img src={childPhotoUrl} alt="Child" className="w-full h-full object-cover" />
            ) : (
              "🧒"
            )}
          </div>
          <h1 className="text-xl font-semibold text-white">{headerTitle}</h1>
        </div>
```

This is inside the always-rendered `<header>` block (not inside any `{view === ...}` conditional), so it appears identically on every view-state. The existing 120px avatar in the `"success"` view is untouched — this is a separate, smaller header element.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/new-cycle/page.tsx
git commit -m "fix(reparse): show child photo in header on every reparse screen, not just the success view"
```

---

### Task 2: Reparse back/exit on every screen

**Files:**
- Modify: `app/new-cycle/page.tsx`

**Interfaces:**
- Produces: `handleExit()`, `showExitControl: boolean`, `exitDisabled: boolean` (local to the component — replaces `showBack`)

- [ ] **Step 1: Replace `showBack` with unified exit logic**

Replace (`app/new-cycle/page.tsx`):

```tsx
  const showBack = view === "paste" || view === "review"
```

with:

```tsx
  const exitTarget: View | null =
    view === "paste" ? "confirm"
    : view === "review" ? "paste"
    : view === "error" ? "paste"
    : null

  const showExitControl = view !== "success"
  const exitDisabled = view === "loading" || view === "confirming"

  function handleExit() {
    if (exitDisabled) return
    if (view === "confirm") { router.back(); return }
    if (exitTarget) setView(exitTarget)
  }
```

- [ ] **Step 2: Replace the header's left and right slots**

Replace the header's back-button block:

```tsx
        {showBack ? (
          <button
            onClick={() => setView(view === "review" ? "paste" : "confirm")}
            className="text-white text-lg"
            aria-label="Back"
          >
            ‹
          </button>
        ) : (
          <div style={{ width: 24 }} />
        )}
```

with:

```tsx
        {showExitControl ? (
          <button
            onClick={handleExit}
            disabled={exitDisabled}
            className="text-white text-lg disabled:opacity-40"
            aria-label={view === "confirm" ? "Cancel" : "Back"}
          >
            ‹
          </button>
        ) : (
          <div style={{ width: 24 }} />
        )}
```

Replace the header's right-side slot (the `view === "confirm"` special-cased Cancel link):

```tsx
        {view === "confirm" ? (
          <button
            onClick={() => router.back()}
            className="text-sm"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            Cancel
          </button>
        ) : (
          <div style={{ width: 50 }} />
        )}
```

with:

```tsx
        <div style={{ width: 50 }} />
```

`confirm`'s exit now lives entirely in the unified left-side control (`handleExit` calls `router.back()` specifically for `view === "confirm"`), so the right slot is always just the spacer.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 4: Manual verification**

Run: `npm run build 2>&1 | tail -8`
Expected: `✓ Compiled successfully`.

Trace through each view-state: `confirm` exit → `router.back()`; `paste`/`review`/`error` exit → returns to the prior step with `rawText`/`parsedSchedule`/`appointmentDate` discarded (nothing was ever written to Supabase before `handleConfirm`, so there is no partial state to clean up); `loading`/`confirming` show the control visibly but disabled; `success` shows no exit control (unchanged — "Start dosing" is its exit).

- [ ] **Step 5: Commit**

```bash
git add app/new-cycle/page.tsx
git commit -m "fix(reparse): add working back/exit to every reparse screen, disabled during in-flight parse/save"
```

---

### Task 3: Extract shared `FoodPositionStepper`, refactor Settings to use it

**Files:**
- Create: `components/FoodPositionStepper.tsx`
- Modify: `app/settings/page.tsx`

**Interfaces:**
- Produces: `FoodPositionEntry = { foodName: string; week: number; day: number }`; `FoodPositionStepperProps = { entries: FoodPositionEntry[]; onChange: (foodName: string, week: number, day: number) => void; disabled?: boolean; badgeLabel?: string; isBadged?: (foodName: string) => boolean }`
- Consumes (Settings only): existing `saveFoodPosition`, `getGlobalPosition`

**Behavior parity requirement:** this task must produce byte-identical rendered output for Settings — it is a pure refactor, not a redesign, so it does not require Dan's sign-off (unlike Tasks 6/7/11, which add genuinely new screens). The Reviewer should diff Settings' rendered markup/behavior against `main` before this task, not just read the code.

- [ ] **Step 1: Create `components/FoodPositionStepper.tsx`**

```tsx
"use client"

export interface FoodPositionEntry {
  foodName: string
  week: number
  day: number
}

interface FoodPositionStepperProps {
  entries: FoodPositionEntry[]
  onChange: (foodName: string, week: number, day: number) => void
  disabled?: boolean
  badgeLabel?: string
  isBadged?: (foodName: string) => boolean
}

function RowDivider() {
  return <div style={{ height: "0.5px", background: "var(--color-primary-border)", marginLeft: 16 }} />
}

export default function FoodPositionStepper({
  entries,
  onChange,
  disabled = false,
  badgeLabel = "",
  isBadged,
}: FoodPositionStepperProps) {
  return (
    <>
      {entries.map(fp => (
        <div key={fp.foodName}>
          <div className="px-4 py-2">
            <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
              {fp.foodName}
              {isBadged?.(fp.foodName) && (
                <span
                  className="ml-2 text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "var(--color-bg-secondary)", color: "var(--color-text-muted)" }}
                >
                  {badgeLabel}
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Week</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => onChange(fp.foodName, Math.max(1, fp.week - 1), fp.day)}
                disabled={fp.week <= 1 || disabled}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                −
              </button>
              <span className="text-base font-semibold w-6 text-center" style={{ color: "var(--color-text-primary)" }}>
                {fp.week}
              </span>
              <button
                onClick={() => onChange(fp.foodName, fp.week + 1, fp.day)}
                disabled={disabled}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
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
                onClick={() => onChange(fp.foodName, fp.week, Math.max(1, fp.day - 1))}
                disabled={fp.day <= 1 || disabled}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                −
              </button>
              <span className="text-base font-semibold w-6 text-center" style={{ color: "var(--color-text-primary)" }}>
                {fp.day}
              </span>
              <button
                onClick={() => onChange(fp.foodName, fp.week, Math.min(7, fp.day + 1))}
                disabled={fp.day >= 7 || disabled}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                +
              </button>
            </div>
          </div>
          <RowDivider />
        </div>
      ))}
    </>
  )
}
```

`isBadged` is a predicate over food name (not a single `badgeFoodName` string) so that Settings' existing tie behavior is preserved exactly: if two foods are both at the furthest-behind position, both get the badge, same as today's inline `isFurthestBehind` check per row.

- [ ] **Step 2: Replace Settings' inline per-food stepper block with `FoodPositionStepper`**

In `app/settings/page.tsx`, replace the entire per-food steppers block (the `{/* Per-food steppers ... */}` comment through the closing `})}` of that `.map`):

```tsx
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
                        disabled={fp.week <= 1 || saving}
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
                        disabled={saving}
                        className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
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
                        disabled={fp.day <= 1 || saving}
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
                        disabled={fp.day >= 7 || saving}
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

with:

```tsx
            <FoodPositionStepper
              entries={[...foodProgress.values()]}
              onChange={saveFoodPosition}
              disabled={saving}
              badgeLabel="furthest behind"
              isBadged={foodName => {
                const fp = foodProgress.get(foodName)
                if (!fp) return false
                const globalPos = getGlobalPosition(foodProgress)
                return fp.week === globalPos.week && fp.day === globalPos.day
              }}
            />
```

- [ ] **Step 3: Add the import**

In `app/settings/page.tsx`, add near the other component imports:

```ts
import FoodPositionStepper from "@/components/FoodPositionStepper"
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 5: Manual verification**

Run: `npm run build 2>&1 | tail -8`
Expected: `✓ Compiled successfully`. Load `/settings` and confirm the Program section's per-food steppers render and behave identically to before this task (same layout, same "furthest behind" badge on the correct food(s), same live-save-on-tap behavior).

- [ ] **Step 6: Commit**

```bash
git add components/FoodPositionStepper.tsx app/settings/page.tsx
git commit -m "refactor(settings): extract per-food stepper into shared FoodPositionStepper component, no behavior change"
```

---

### Task 4: `lib/supabase.ts` — per-food `seedFoodProgress`, new `clearFoodProgress`

**Files:**
- Modify: `lib/supabase.ts`
- Modify: `app/daily/page.tsx`

**Interfaces:**
- Produces: `seedFoodProgress(entries: { foodName: string; week: number; day: number }[]): Promise<Map<string, FoodProgress>>` (signature change), `clearFoodProgress(): Promise<void>` (new)

- [ ] **Step 1: Change `seedFoodProgress`'s signature**

Replace (`lib/supabase.ts`):

```ts
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

with:

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

- [ ] **Step 2: Add `clearFoodProgress`**

Add directly after `seedFoodProgress`:

```ts
export async function clearFoodProgress(): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("treatment_food_progress")
    .delete()
    .eq("family_id", familyId)
  if (error) throw error
}
```

- [ ] **Step 3: Remove the now-unused `TreatmentFood` import**

In `lib/supabase.ts`, `TreatmentFood` was only used by the old `seedFoodProgress` signature. Change:

```ts
import { ParsedSchedule, DoseState, DoseLogDay, DayRecord, FoodGroup, FoodProgress, TreatmentFood } from "./types"
```

to:

```ts
import { ParsedSchedule, DoseState, DoseLogDay, DayRecord, FoodGroup, FoodProgress } from "./types"
```

- [ ] **Step 4: Update `app/daily/page.tsx`'s call site**

Replace (`app/daily/page.tsx`):

```ts
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
```

with:

```ts
        let progress = rawProgress
        if (progress.size === 0 && s.treatmentFoods.length > 0) {
          try {
            progress = await seedFoodProgress(
              s.treatmentFoods.map(f => ({
                foodName: f.name,
                week: initialState.currentWeek,
                day: initialState.currentDay,
              }))
            )
          } catch {
            // Seed failed — continue with empty progress; app still functional
          }
        }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase.ts app/daily/page.tsx
git commit -m "refactor(data): seedFoodProgress takes per-food entries instead of one uniform week/day; add clearFoodProgress"
```

---

### Task 5: [CHECKPOINT] Dan UI sign-off — per-food position prompt (onboarding + reparse)

**Not a dispatchable coding task.** Do not hand this to a subagent. The orchestrating session presents the following to Dan directly and waits for his explicit approval before Task 6 or Task 7 may start.

- [ ] **Step 1: Present the mockup/description to Dan**

Present, in chat:

- **Onboarding (step 3 replacement):** header copy changes from "Set the week and day you're currently dosing on." to "Set each treatment food's starting week and day." Below it, one `FoodPositionStepper` row per treatment food from the just-parsed schedule (same visual style as Settings' Program section — food name, then Week stepper row, then Day stepper row, divider, repeat), each defaulting to Week 1 / Day 1, independently adjustable, no live-save (batched, committed on "Continue" into step 4 same as today). Step 4's summary card "Current position" row becomes "Starting position," reading `Week 1 · Day 1` when every food is still at the shared default, or `Varies by food` if any food was overridden — this is the layout call flagged as "Dev's call" in the design doc, now being shown concretely for approval rather than left implicit.
- **Reparse (new step after cycle confirm):** after the existing "Confirm new cycle" write succeeds, a new screen titled the same as the flow's existing header pattern shows: "Set each treatment food's starting week and day for this cycle. Defaults to Week 1, Day 1." followed by the same `FoodPositionStepper` list (one row per food in the *new* schedule), and a "Confirm starting positions" button. This screen has a working back/exit (per Task 2's pattern) that skips straight to the existing "success" screen, accepting the Week 1/Day 1 defaults for every food rather than blocking the user.

- [ ] **Step 2: Wait for explicit approval**

Do not proceed to Task 6 or Task 7 until Dan responds with approval (verbatim "yes," "go," "approved," or equivalent — not silence, not an unrelated reply). If Dan requests changes, update this task's description and this plan's Tasks 6/7 accordingly before proceeding, and re-present.

---

### Task 6: Onboarding per-food position prompt

**Files:**
- Modify: `app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `FoodPositionStepper`, `FoodPositionEntry` (Task 3), `seedFoodProgress` (Task 4's new signature), `getGlobalPosition` (`lib/schedule.ts`)
- Requires: Task 5 sign-off received

**Precondition:** Task 5 approved.

- [ ] **Step 1: Replace week/day state with per-food entries**

In `app/onboarding/page.tsx`, replace:

```ts
  const [week, setWeek] = useState(1)
  const [day, setDay] = useState(1)
  const [originalWeek, setOriginalWeek] = useState<number | null>(null)
  const [originalDay, setOriginalDay] = useState<number | null>(null)
  const [existingDoseState, setExistingDoseState] = useState<DoseState | null>(null)
```

with:

```ts
  const [positionEntries, setPositionEntries] = useState<FoodPositionEntry[]>([])
  const [existingDoseState, setExistingDoseState] = useState<DoseState | null>(null)
```

- [ ] **Step 2: Add imports**

Add to the `@/lib/supabase` import block:

```ts
  seedFoodProgress,
```

Add to the `@/lib/schedule` import (currently `import { cycleStartDateForPosition, calculateBufferFromProgress } from "@/lib/schedule"`):

```ts
import { cycleStartDateForPosition, calculateBufferFromProgress, getGlobalPosition } from "@/lib/schedule"
```

Add a new import:

```ts
import FoodPositionStepper, { FoodPositionEntry } from "@/components/FoodPositionStepper"
```

- [ ] **Step 3: Initialize `positionEntries` when the schedule loads**

In the `load()` effect, replace:

```ts
        setSchedule(s)
        const [name, apptDate, ds] = await Promise.all([
          fetchFamilyName().catch(() => null),
          fetchAppointmentDate().catch(() => null),
          fetchDoseState().catch(() => null),
        ])
        if (name) { router.replace("/daily"); return }
        if (apptDate) setAppointmentDate(apptDate)
        if (ds) {
          setWeek(ds.currentWeek)
          setDay(ds.currentDay)
          setOriginalWeek(ds.currentWeek)
          setOriginalDay(ds.currentDay)
          setExistingDoseState(ds)
        }
```

with:

```ts
        setSchedule(s)
        setPositionEntries(s.treatmentFoods.map(f => ({ foodName: f.name, week: 1, day: 1 })))
        const [name, apptDate, ds] = await Promise.all([
          fetchFamilyName().catch(() => null),
          fetchAppointmentDate().catch(() => null),
          fetchDoseState().catch(() => null),
        ])
        if (name) { router.replace("/daily"); return }
        if (apptDate) setAppointmentDate(apptDate)
        if (ds) {
          setExistingDoseState(ds)
        }
```

Every food defaults to Week 1/Day 1 per the ticket's acceptance criterion — this replaces the old behavior of restoring `week`/`day` from a pre-existing `dose_state`, which no longer applies now that position is per-food.

- [ ] **Step 4: Add the change handler and rewrite `saveAndRedirect`**

Add a handler function (place it near `handlePhotoChange`):

```ts
  function handlePositionChange(foodName: string, week: number, day: number) {
    setPositionEntries(prev => prev.map(e => (e.foodName === foodName ? { ...e, week, day } : e)))
  }
```

Replace `saveAndRedirect`:

```ts
  async function saveAndRedirect() {
    setSaving(true)
    setSaveError(null)
    try {
      await saveFamilyConfig(childName.trim(), appointmentDate || null)
      await saveVisitNumber(VISIT_SEQUENCE[visitIdx])
      const seededProgress = await seedFoodProgress(positionEntries)
      const globalPos = getGlobalPosition(seededProgress)
      await saveDoseState({
        currentWeek: globalPos.week,
        currentDay: globalPos.day,
        checkedFoods: {},
        completedDays: existingDoseState?.completedDays ?? {},
        cycleStartDate: cycleStartDateForPosition(globalPos.week, globalPos.day),
        skipCount: 0,
        floorWeek: globalPos.week,
        floorDay: globalPos.day,
      })
      router.replace("/daily")
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed — please try again")
      setSaving(false)
    } finally {
      setSaving(false)
    }
  }
```

`seedFoodProgress` now runs at onboarding time (previously it only ran lazily on first `daily/page.tsx` load) — `dose_state`'s `currentWeek`/`currentDay`/`cycleStartDate`/`floorWeek`/`floorDay` are derived from the seeded result via `getGlobalPosition`, the same pattern Settings and reparse (Task 7) use, instead of being written directly from local stepper state.

- [ ] **Step 5: Update the buffer calculation**

Replace:

```ts
  const maxWeek = schedule ? getMaxWeek(schedule) : 99
  const bufferResult = schedule
    ? calculateBufferFromProgress(appointmentDate || null, maxWeek, week, day - 1)
    : { kind: "hidden" as const }
```

with:

```ts
  const maxWeek = schedule ? getMaxWeek(schedule) : 99
  const slowestPosition = (() => {
    if (positionEntries.length === 0) return { week: 1, day: 1 }
    const map = new Map(
      positionEntries.map(e => [e.foodName, { foodName: e.foodName, week: e.week, day: e.day, completedDays: e.day - 1, lastCompletedAt: null }])
    )
    return getGlobalPosition(map)
  })()
  const bufferResult = schedule
    ? calculateBufferFromProgress(appointmentDate || null, maxWeek, slowestPosition.week, slowestPosition.day - 1)
    : { kind: "hidden" as const }
```

- [ ] **Step 6: Update step 3's header copy**

Replace:

```tsx
        {step === 3 && (
          <div>
            <h1 className="text-xl font-semibold text-white">Your position</h1>
            <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.8)" }}>
              Set the week and day you&apos;re currently dosing on.
            </p>
          </div>
        )}
```

with:

```tsx
        {step === 3 && (
          <div>
            <h1 className="text-xl font-semibold text-white">Your position</h1>
            <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.8)" }}>
              Set each treatment food&apos;s starting week and day.
            </p>
          </div>
        )}
```

- [ ] **Step 7: Update step 4's header summary**

Add, just before the `return (` statement (so it's available to both the header and the summary card):

```ts
  const positionsInSync =
    positionEntries.length === 0 ||
    positionEntries.every(e => e.week === positionEntries[0].week && e.day === positionEntries[0].day)
```

Replace the step 4 header's position text:

```tsx
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
                Week {week}, Day {day}
              </p>
```

with:

```tsx
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
                {positionsInSync
                  ? `Week ${positionEntries[0]?.week ?? 1}, Day ${positionEntries[0]?.day ?? 1}`
                  : "Starting positions vary by food"}
              </p>
```

- [ ] **Step 8: Replace step 3's Week/Day stepper JSX**

Replace the entire Week stepper block through the entire Day stepper block (from the `{/* Week stepper */}` comment through the Day stepper's closing `</div>`, i.e. everything between the Visit stepper block and the step's final "Continue" button):

```tsx
          {/* Week stepper */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--color-text-secondary)" }}>
              Week
            </p>
            <div
              className="bg-white rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ border: "0.5px solid var(--color-primary-border)" }}
            >
              <button
                onClick={() => setWeek(w => Math.max(1, w - 1))}
                disabled={week <= 1}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                −
              </button>
              <span className="text-base font-medium" style={{ color: "var(--color-text-primary)" }}>Week {week}</span>
              <button
                onClick={() => setWeek(w => Math.min(maxWeek, w + 1))}
                disabled={week >= maxWeek}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                +
              </button>
            </div>
          </div>

          {/* Day stepper */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--color-text-secondary)" }}>
              Day
            </p>
            <div
              className="bg-white rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ border: "0.5px solid var(--color-primary-border)" }}
            >
              <button
                onClick={() => setDay(d => Math.max(1, d - 1))}
                disabled={day <= 1}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                −
              </button>
              <span className="text-base font-medium" style={{ color: "var(--color-text-primary)" }}>Day {day}</span>
              <button
                onClick={() => setDay(d => Math.min(7, d + 1))}
                disabled={day >= 7}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                +
              </button>
            </div>
          </div>
```

with:

```tsx
          {/* Per-food starting position */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--color-text-secondary)" }}>
              Treatment foods
            </p>
            <div
              className="bg-white rounded-xl overflow-hidden"
              style={{ border: "0.5px solid var(--color-primary-border)" }}
            >
              <FoodPositionStepper entries={positionEntries} onChange={handlePositionChange} />
            </div>
          </div>
```

- [ ] **Step 9: Update step 4's summary card row**

Replace:

```tsx
              {
                label: "Current position",
                value: `${visitLabel(currentVisitRaw)} · Week ${week} · Day ${day}`,
              },
```

with:

```tsx
              {
                label: "Starting position",
                value: positionsInSync
                  ? `${visitLabel(currentVisitRaw)} · Week ${positionEntries[0]?.week ?? 1} · Day ${positionEntries[0]?.day ?? 1}`
                  : `${visitLabel(currentVisitRaw)} · Varies by food`,
              },
```

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors. If `week`/`day`/`originalWeek`/`originalDay` are referenced anywhere else in the file (`grep -n "\\bweek\\b\\|\\bday\\b" app/onboarding/page.tsx` and check each hit is `positionEntries`/`FoodPositionEntry`-related, not the removed state), fix those references too.

- [ ] **Step 11: Manual verification**

Run: `npm run build 2>&1 | tail -8`
Expected: `✓ Compiled successfully`. Walk through onboarding with a schedule that has 2+ treatment foods: confirm step 3 shows one stepper pair per food, all defaulting to Week 1/Day 1; overriding one food's position and continuing shows "Varies by food" in step 4; confirming writes correct per-food rows to `treatment_food_progress` (verify via Supabase directly, not just the UI).

- [ ] **Step 12: Commit**

```bash
git add app/onboarding/page.tsx
git commit -m "feat(onboarding): replace single global Week/Day stepper with per-food starting-position prompt"
```

---

### Task 7: Reparse per-food position prompt

**Files:**
- Modify: `app/new-cycle/page.tsx`

**Interfaces:**
- Consumes: `FoodPositionStepper`, `FoodPositionEntry` (Task 3), `seedFoodProgress`, `clearFoodProgress` (Task 4)
- Requires: Task 5 sign-off received

**Precondition:** Task 5 approved, Task 2 complete (this task extends Task 2's exit-control logic).

- [ ] **Step 1: Add the new view state and position-entry state**

Replace:

```ts
type View = "confirm" | "paste" | "loading" | "review" | "confirming" | "success" | "error"
```

with:

```ts
type View = "confirm" | "paste" | "loading" | "review" | "confirming" | "position" | "success" | "error"
```

Add new state, near the other `useState` declarations:

```ts
  const [positionEntries, setPositionEntries] = useState<FoodPositionEntry[]>([])
  const [positionSaving, setPositionSaving] = useState(false)
  const [positionError, setPositionError] = useState<string | null>(null)
```

- [ ] **Step 2: Add imports**

Add:

```ts
import FoodPositionStepper, { FoodPositionEntry } from "@/components/FoodPositionStepper"
```

Add `seedFoodProgress, clearFoodProgress` to the existing `@/lib/supabase` import block.

- [ ] **Step 3: Rewrite `handleConfirm` to transition into the position step**

Replace:

```ts
  async function handleConfirm() {
    if (!parsedSchedule) return
    setView("confirming")
    try {
      await archiveAndStartNewCycle(
        currentSchedule,
        parsedSchedule,
        parsedSchedule.visitNumber ?? null,
        appointmentDate || null
      )
      setView("success")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save new cycle")
      setView("error")
    }
  }
```

with:

```ts
  async function handleConfirm() {
    if (!parsedSchedule) return
    setView("confirming")
    try {
      await archiveAndStartNewCycle(
        currentSchedule,
        parsedSchedule,
        parsedSchedule.visitNumber ?? null,
        appointmentDate || null
      )
      try {
        await clearFoodProgress()
      } catch {
        // Clear failed — seedFoodProgress's per-food upsert below will still overwrite
        // same-named carried-over foods; a food removed in the new schedule may remain
        // orphaned in this edge case. No retry surfaced here — low severity, see design doc.
      }
      if (parsedSchedule.treatmentFoods.length === 0) {
        setView("success")
      } else {
        setPositionEntries(parsedSchedule.treatmentFoods.map(f => ({ foodName: f.name, week: 1, day: 1 })))
        setView("position")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save new cycle")
      setView("error")
    }
  }

  function handlePositionChange(foodName: string, week: number, day: number) {
    setPositionEntries(prev => prev.map(e => (e.foodName === foodName ? { ...e, week, day } : e)))
  }

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

`treatment_food_progress` is cleared as soon as the cycle's core writes succeed — before the position screen even renders — so an abandoned position screen leaves the table empty (safe: `daily/page.tsx`'s existing lazy-reseed-on-empty fallback covers it), never stale with old-cycle rows (the original orphan risk).

- [ ] **Step 4: Extend Task 2's exit logic for the `"position"` view**

Replace:

```ts
  const exitTarget: View | null =
    view === "paste" ? "confirm"
    : view === "review" ? "paste"
    : view === "error" ? "paste"
    : null
```

with:

```ts
  const exitTarget: View | null =
    view === "paste" ? "confirm"
    : view === "review" ? "paste"
    : view === "error" ? "paste"
    : view === "position" ? "success"
    : null
```

Exiting `"position"` goes straight to `"success"`, accepting the Week 1/Day 1 defaults for every food (equivalent to what the lazy-reseed fallback would do anyway) rather than blocking the user on a screen that follows an already-committed cycle change.

- [ ] **Step 5: Update `headerTitle` for the new view**

Replace:

```ts
  const headerTitle =
    view === "review" || view === "confirming" ? "Review changes"
    : view === "success" ? "New food cycle"
    : "New food cycle"
```

with:

```ts
  const headerTitle =
    view === "review" || view === "confirming" ? "Review changes"
    : view === "position" ? "Starting positions"
    : view === "success" ? "New food cycle"
    : "New food cycle"
```

- [ ] **Step 6: Render the position step**

Add a new block, directly after the Step 3 (Review) block's closing `})()}` and before the `{/* Step 4: Success */}` comment:

```tsx
      {/* Step 3.5: Per-food starting position */}
      {view === "position" && (
        <div className="px-4 pt-6 pb-24 flex flex-col gap-4">
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            Set each treatment food&apos;s starting week and day for this cycle. Defaults to Week 1, Day 1.
          </p>
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "0.5px solid var(--color-primary-border)" }}>
            <FoodPositionStepper entries={positionEntries} onChange={handlePositionChange} disabled={positionSaving} />
          </div>
          {positionError && (
            <p className="text-sm" style={{ color: "#dc2626" }}>{positionError}</p>
          )}
          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--color-primary-mid)" }}
            onClick={handleConfirmPositions}
            disabled={positionSaving}
          >
            {positionSaving ? "Saving…" : "Confirm starting positions"}
          </button>
        </div>
      )}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 8: Manual verification**

Run: `npm run build 2>&1 | tail -8`
Expected: `✓ Compiled successfully`. Walk through a reparse with 2+ treatment foods in the new schedule: after "Confirm new cycle," the position screen appears with per-food steppers; adjusting and confirming writes the entered per-food values to `treatment_food_progress` (verify directly against Supabase); a food present in the old cycle but absent from the new schedule has no surviving row after this flow (verifies the orphan fix). Separately, test exiting the position screen via the header back control and confirm it lands on "success" with `treatment_food_progress` empty for the family, then load `/daily` and confirm the lazy-reseed fallback seeds every new-schedule food to Week 1/Day 1.

- [ ] **Step 9: Commit**

```bash
git add app/new-cycle/page.tsx
git commit -m "feat(reparse): add per-food starting-position prompt after cycle confirm, replacing the silent treatment_food_progress no-op"
```

---

### Task 8: Recommended foods +/− logging

**Files:**
- Modify: `lib/schedule.ts`
- Modify: `app/foods/page.tsx`
- Modify: `components/RecommendedFoodsView.tsx`

**Interfaces:**
- Produces: `getFurthestAheadPosition(progress: Map<string, FoodProgress>): { week: number; day: number }`, `parseFrequencyLow(freq: string): number` (both `lib/schedule.ts`)
- Consumes: existing `onGive`/`onUndo`/`saveRecommendedGiven` (unchanged), `fetchFoodProgress` (existing)

- [ ] **Step 1: Add `getFurthestAheadPosition` and `parseFrequencyLow` to `lib/schedule.ts`**

Add directly after `getGlobalPosition`:

```ts
export function getFurthestAheadPosition(
  progress: Map<string, FoodProgress>
): { week: number; day: number } {
  if (progress.size === 0) return { week: 1, day: 1 }
  let maxIndex = -Infinity
  let result = { week: 1, day: 1 }
  for (const fp of progress.values()) {
    const idx = (fp.week - 1) * 7 + (fp.day - 1)
    if (idx > maxIndex) {
      maxIndex = idx
      result = { week: fp.week, day: fp.day }
    }
  }
  return result
}

export function parseFrequencyLow(freq: string): number {
  const match = freq.match(/\d+/)
  return match ? parseInt(match[0], 10) : 0
}
```

- [ ] **Step 2: Switch `app/foods/page.tsx`'s week source**

Replace:

```tsx
import {
  fetchSchedule,
  fetchDoseState,
  saveRecommendedGiven,
  getSession,
} from "@/lib/supabase"
import RecommendedFoodsView from "@/components/RecommendedFoodsView"
```

with:

```tsx
import {
  fetchSchedule,
  fetchDoseState,
  fetchFoodProgress,
  saveRecommendedGiven,
  getSession,
} from "@/lib/supabase"
import { getFurthestAheadPosition } from "@/lib/schedule"
import { FoodProgress } from "@/lib/types"
import RecommendedFoodsView from "@/components/RecommendedFoodsView"
```

Replace:

```tsx
      try {
        const [s, ds] = await Promise.all([fetchSchedule(), fetchDoseState()])
        if (!s) {
          router.replace("/setup")
          return
        }
        const initialCounts = ds?.recommendedFoodCounts ?? {}
        setSchedule(s)
        setCurrentWeek(ds?.currentWeek ?? 1)
        setCounts(initialCounts)
        countsRef.current = initialCounts
        setHydrated(true)
      } catch {
        router.replace("/login")
      }
```

with:

```tsx
      try {
        const [s, ds, progress] = await Promise.all([
          fetchSchedule(),
          fetchDoseState(),
          fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
        ])
        if (!s) {
          router.replace("/setup")
          return
        }
        const initialCounts = ds?.recommendedFoodCounts ?? {}
        const week = progress.size > 0 ? getFurthestAheadPosition(progress).week : (ds?.currentWeek ?? 1)
        setSchedule(s)
        setCurrentWeek(week)
        setCounts(initialCounts)
        countsRef.current = initialCounts
        setHydrated(true)
      } catch {
        router.replace("/login")
      }
```

- [ ] **Step 3: Simplify `PipRow` to a read-only summary**

In `components/RecommendedFoodsView.tsx`, replace:

```tsx
function PipRow({
  count,
  interactive,
  onGive,
  onUndo,
}: {
  count: number
  interactive: boolean
  onGive: () => void
  onUndo: () => void
}) {
  return (
    <div className="flex gap-1.5 items-center">
      {Array.from({ length: PIP_COUNT }, (_, i) => {
        const pipNum = i + 1
        const filled = count >= pipNum
        const isLastFilled = count === pipNum
        const isNextEmpty = !filled && count === pipNum - 1
        const tappable = interactive && (isLastFilled || isNextEmpty)
        return (
          <button
            key={pipNum}
            onClick={() => {
              if (!interactive) return
              if (isLastFilled) onUndo()
              else if (isNextEmpty) onGive()
            }}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: filled ? "var(--color-primary-mid)" : "var(--color-primary-border)",
              border: "none",
              padding: 0,
              cursor: tappable ? "pointer" : "default",
              flexShrink: 0,
            }}
            aria-label={filled ? (isLastFilled && interactive ? "Undo serving" : undefined) : (isNextEmpty && interactive ? "Log serving" : undefined)}
          />
        )
      })}
    </div>
  )
}
```

with:

```tsx
function PipRow({ count }: { count: number }) {
  return (
    <div className="flex gap-1.5 items-center">
      {Array.from({ length: PIP_COUNT }, (_, i) => {
        const filled = count >= i + 1
        return (
          <div
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: filled ? "var(--color-primary-mid)" : "var(--color-primary-border)",
              flexShrink: 0,
            }}
          />
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Add the import for `parseFrequencyLow`**

Add:

```tsx
import { parseFrequencyLow } from "@/lib/schedule"
```

- [ ] **Step 5: Replace the "This week" tab's food card interaction**

Replace:

```tsx
              recommendedFoods.map(food => {
                const count = weekCounts[food.name] ?? 0
                return (
                  <div
                    key={food.name}
                    className="bg-white rounded-xl p-4"
                    style={{ border: "0.5px solid var(--color-primary-border)" }}
                  >
                    <p
                      className="font-semibold mb-0.5"
                      style={{ fontSize: 15, color: "var(--color-text-primary)" }}
                    >
                      {food.name}
                    </p>
                    <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
                      {food.dose} {food.unit}
                    </p>
                    <PipRow
                      count={count}
                      interactive={true}
                      onGive={() => onGive(food.name)}
                      onUndo={() => onUndo(food.name)}
                    />
                    <p className="text-xs mt-1.5" style={{ color: "var(--color-text-muted)" }}>
                      {food.frequencyPerWeek} per week
                    </p>
                  </div>
                )
              })
```

with:

```tsx
              recommendedFoods.map(food => {
                const count = weekCounts[food.name] ?? 0
                return (
                  <div
                    key={food.name}
                    className="bg-white rounded-xl p-4"
                    style={{ border: "0.5px solid var(--color-primary-border)" }}
                  >
                    <p
                      className="font-semibold mb-0.5"
                      style={{ fontSize: 15, color: "var(--color-text-primary)" }}
                    >
                      {food.name}
                    </p>
                    <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
                      {food.dose} {food.unit}
                    </p>
                    <div className="flex items-center justify-between">
                      <PipRow count={count} />
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => onUndo(food.name)}
                          disabled={count <= 0}
                          aria-label={`Undo serving for ${food.name}`}
                          className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                          style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
                        >
                          −
                        </button>
                        <span className="text-base font-semibold w-6 text-center" style={{ color: "var(--color-text-primary)" }}>
                          {count}
                        </span>
                        <button
                          onClick={() => onGive(food.name)}
                          aria-label={`Log serving for ${food.name}`}
                          className="flex items-center justify-center text-lg font-bold"
                          style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <p className="text-xs mt-1.5" style={{ color: "var(--color-text-muted)" }}>
                      {food.frequencyPerWeek} per week
                    </p>
                  </div>
                )
              })
```

- [ ] **Step 6: Update the History tab's read-only `PipRow` usage**

Replace:

```tsx
                                <PipRow
                                  count={count}
                                  interactive={false}
                                  onGive={() => {}}
                                  onUndo={() => {}}
                                />
```

with:

```tsx
                                <PipRow count={count} />
```

- [ ] **Step 7: Add the "minimum reached" banner**

In the `"week"` tab body, replace:

```tsx
        {activeTab === "week" && (
          <div className="px-4 pt-4 flex flex-col gap-3">
            {recommendedFoods.length === 0 ? (
```

with:

```tsx
        {activeTab === "week" && (
          <div className="px-4 pt-4 flex flex-col gap-3">
            {recommendedFoods.length > 0 &&
              recommendedFoods.every(food => (weekCounts[food.name] ?? 0) >= parseFrequencyLow(food.frequencyPerWeek)) && (
                <div className="rounded-xl px-4 py-3" style={{ background: "#dcfce7", border: "0.5px solid #86efac" }}>
                  <p className="text-sm font-medium" style={{ color: "#166534" }}>
                    Minimum reached for all recommended foods this week
                  </p>
                </div>
              )}
            {recommendedFoods.length === 0 ? (
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 9: Manual verification**

Run: `npm run build 2>&1 | tail -8`
Expected: `✓ Compiled successfully`. Load `/foods` with a schedule that has 2+ treatment foods at different weeks (out of sync) and confirm the displayed week matches the furthest-ahead food, not the furthest-behind (compare against `/daily`'s header, which should show a lower or equal week). Tap +/− on a recommended food and confirm the count updates and persists (reload the page). Push every recommended food's count to its `frequencyPerWeek` low end and confirm the banner appears; undo one below the threshold and confirm it disappears.

- [ ] **Step 10: Commit**

```bash
git add lib/schedule.ts app/foods/page.tsx components/RecommendedFoodsView.tsx
git commit -m "feat(foods): replace tap-on-pip logging with explicit +/- controls; weekly reset now keys off the furthest-ahead treatment food; add minimum-reached banner"
```

---

### Task 9: `lib/supabase.ts` — History delete functions

**Files:**
- Modify: `lib/supabase.ts`

**Interfaces:**
- Produces: `deleteDoseLogDays(ids: string[]): Promise<void>`, `deleteAllDoseLogDays(): Promise<void>`

**Scoping decision:** `deleteDoseLogDays` deletes by `dose_log.id` — the exact row each selected History entry represents (`DoseLogDay.id`, from `fetchAllDoseLogDays`). It does **not** attempt to also find and delete a same-date `session: "morning"` skip row, because those rows are cross-referenced elsewhere in this codebase by `(week, day)` match (`fetchAllDoseLogDays`'s `morningSkipped` derivation) — and `(week, day)` is explicitly documented as unsafe to match on for deletion, since it legitimately repeats across reset epochs (see the prior bundle's Global Constraints, `plans/PHASE-STABLE-F1.md`). A stray, undisplayed morning-skip row surviving a day's deletion is low severity — morning skip is already documented elsewhere as "informational only." `deleteAllDoseLogDays` has no such concern: it removes every row for the family regardless of session, unambiguously.

- [ ] **Step 1: Add both functions**

Add after `updateDoseLogCheckedFoods`:

```ts
export async function deleteDoseLogDays(ids: string[]): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_log")
    .delete()
    .eq("family_id", familyId)
    .in("id", ids)
  if (error) throw error
}

export async function deleteAllDoseLogDays(): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_log")
    .delete()
    .eq("family_id", familyId)
  if (error) throw error
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase.ts
git commit -m "feat(data): add deleteDoseLogDays and deleteAllDoseLogDays"
```

---

### Task 10: [CHECKPOINT] Dan UI sign-off — History delete-selection

**Not a dispatchable coding task.** Do not hand this to a subagent. The orchestrating session presents the following to Dan directly and waits for his explicit approval before Task 11 may start.

- [ ] **Step 1: Present the mockup/description to Dan**

Present, in chat:

- `/history`'s header keeps the existing "Edit" link exactly as-is (Trailing Edit, untouched) and gains a "Select" toggle next to it. Tapping "Select" replaces "Edit"/"Select" with a "Cancel" button and reveals a second header row: "Clear all" on the left, "Delete (n)" on the right (disabled/greyed until at least one day is checked).
- In select mode, each history day in the list gains an empty circle to the left of its date — tapping it fills the circle (checkmark) without triggering the day's existing expand/collapse behavior, which stays available via tapping the rest of the row.
- Tapping "Delete (n)" or "Clear all" shows one bottom-sheet confirmation (matching the visual style of the existing Complete Day confirm dialog from the prior bundle — white sheet, red "Delete" action, grey "Cancel"), reading "Delete N selected days? This can't be undone." or "Delete all N logged days? This can't be undone." Confirming performs the delete and exits select mode; cancelling dismisses the sheet with no change.

- [ ] **Step 2: Wait for explicit approval**

Do not proceed to Task 11 until Dan responds with approval. If Dan requests changes, update this task's description and Task 11 accordingly before proceeding, and re-present.

---

### Task 11: History delete-selection UI

**Files:**
- Modify: `app/history/page.tsx`
- Modify: `components/DoseHistoryLog.tsx`

**Interfaces:**
- Consumes: `deleteDoseLogDays`, `deleteAllDoseLogDays` (Task 9)
- Produces: `DoseHistoryLogProps` gains optional `selectMode?: boolean`, `selectedIds?: Set<string>`, `onToggleSelect?: (id: string) => void` (backward-compatible defaults — no other caller of this component exists, but the defaults keep it safe to call with no selection props at all)

**Requires:** Task 10 sign-off received.

- [ ] **Step 1: Add selection props to `DoseHistoryLog` and `DayRow`**

In `components/DoseHistoryLog.tsx`, replace the props interface:

```tsx
interface DoseHistoryLogProps {
  schedule: ParsedSchedule
  days: DoseLogDay[]
}
```

with:

```tsx
interface DoseHistoryLogProps {
  schedule: ParsedSchedule
  days: DoseLogDay[]
  selectMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}
```

Replace `DayRow`'s signature and its top row's JSX:

```tsx
function DayRow({
  entry,
  schedule,
}: {
  entry: DoseLogDay
  schedule: ParsedSchedule
}) {
  const [expanded, setExpanded] = useState(false)
  const status = getDayStatus(entry, schedule)
  const { label, dotColor } = STATUS_CONFIG[status]
  const morningText = getMorningText(entry, schedule)
  const eveningText = getEveningText(entry, schedule)

  return (
    <div style={{ borderBottom: "0.5px solid var(--color-primary-border)" }}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-white"
        onClick={() => setExpanded(e => !e)}
      >
        <p className="text-sm font-medium text-left" style={{ color: "var(--color-text-primary)" }}>
          {formatDate(entry.completedAt)} · Day {entry.day}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: dotColor,
            }}
          />
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {label}
          </span>
          <span style={{ color: "var(--color-text-muted)", fontSize: 10 }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </button>
```

with:

```tsx
function DayRow({
  entry,
  schedule,
  selectMode,
  selected,
  onToggleSelect,
}: {
  entry: DoseLogDay
  schedule: ParsedSchedule
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const status = getDayStatus(entry, schedule)
  const { label, dotColor } = STATUS_CONFIG[status]
  const morningText = getMorningText(entry, schedule)
  const eveningText = getEveningText(entry, schedule)

  return (
    <div style={{ borderBottom: "0.5px solid var(--color-primary-border)" }}>
      <div className="w-full flex items-center gap-3 px-4 py-3 bg-white">
        {selectMode && (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-label={selected ? "Deselect day" : "Select day"}
            className="shrink-0 flex items-center justify-center"
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              border: `1.5px solid ${selected ? "var(--color-primary-mid)" : "var(--color-primary-border)"}`,
              background: selected ? "var(--color-primary-mid)" : "transparent",
              padding: 0,
            }}
          >
            {selected && <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>✓</span>}
          </button>
        )}
        <button
          type="button"
          className="flex-1 flex items-center justify-between"
          onClick={() => setExpanded(e => !e)}
        >
          <p className="text-sm font-medium text-left" style={{ color: "var(--color-text-primary)" }}>
            {formatDate(entry.completedAt)} · Day {entry.day}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: dotColor,
              }}
            />
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              {label}
            </span>
            <span style={{ color: "var(--color-text-muted)", fontSize: 10 }}>
              {expanded ? "▲" : "▼"}
            </span>
          </div>
        </button>
      </div>
```

- [ ] **Step 2: Wire the new props through the top-level component**

Replace:

```tsx
export default function DoseHistoryLog({ schedule, days }: DoseHistoryLogProps) {
```

with:

```tsx
export default function DoseHistoryLog({
  schedule,
  days,
  selectMode = false,
  selectedIds = new Set(),
  onToggleSelect = () => {},
}: DoseHistoryLogProps) {
```

Replace the `DayRow` usage:

```tsx
            {weekDays.map(entry => (
              <DayRow key={entry.id} entry={entry} schedule={schedule} />
            ))}
```

with:

```tsx
            {weekDays.map(entry => (
              <DayRow
                key={entry.id}
                entry={entry}
                schedule={schedule}
                selectMode={selectMode}
                selected={selectedIds.has(entry.id)}
                onToggleSelect={() => onToggleSelect(entry.id)}
              />
            ))}
```

- [ ] **Step 3: Rewrite `app/history/page.tsx`**

Replace the entire file:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import {
  getSession,
  fetchSchedule,
  fetchAllDoseLogDays,
  deleteDoseLogDays,
  deleteAllDoseLogDays,
} from "@/lib/supabase"
import DoseHistoryLog from "@/components/DoseHistoryLog"

export default function HistoryPage() {
  const router = useRouter()
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

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  async function handleConfirmDelete() {
    if (!confirmTarget) return
    setDeleting(true)
    try {
      if (confirmTarget === "all") {
        await deleteAllDoseLogDays()
        setDays([])
      } else {
        const ids = [...selectedIds]
        await deleteDoseLogDays(ids)
        setDays(prev => prev.filter(d => !selectedIds.has(d.id)))
      }
      exitSelectMode()
    } catch {
      // Delete failed — leave selection intact so the user can retry
    } finally {
      setDeleting(false)
      setConfirmTarget(null)
    }
  }

  if (loading || !schedule) return null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      <header
        className="px-4 pb-4"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-white">History</h1>
          <div className="flex items-center gap-4">
            {!selectMode && (
              <Link
                href="/history/edit"
                className="text-sm font-medium"
                style={{ color: "rgba(255,255,255,0.85)" }}
              >
                Edit
              </Link>
            )}
            <button
              type="button"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className="text-sm font-medium"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              {selectMode ? "Cancel" : "Select"}
            </button>
          </div>
        </div>
        {selectMode && (
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={() => setConfirmTarget("all")}
              disabled={days.length === 0}
              className="text-sm font-medium disabled:opacity-40"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setConfirmTarget("selection")}
              disabled={selectedIds.size === 0}
              className="text-sm font-semibold disabled:opacity-40"
              style={{ color: "#fff" }}
            >
              Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </button>
          </div>
        )}
      </header>
      <DoseHistoryLog
        schedule={schedule}
        days={days}
        selectMode={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />
      {confirmTarget && (
        <div className="fixed inset-0 z-[60] flex items-end" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div
            className="bg-white w-full rounded-t-2xl px-6 pt-6"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
          >
            <p className="text-base font-semibold mb-5" style={{ color: "var(--color-text-primary)" }}>
              {confirmTarget === "all"
                ? `Delete all ${days.length} logged day${days.length !== 1 ? "s" : ""}? This can't be undone.`
                : `Delete ${selectedIds.size} selected day${selectedIds.size !== 1 ? "s" : ""}? This can't be undone.`}
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "#dc2626", color: "#fff" }}
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "var(--color-primary-border)", color: "var(--color-text-primary)" }}
                onClick={() => setConfirmTarget(null)}
                disabled={deleting}
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

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: zero errors.

- [ ] **Step 5: Manual verification**

Run: `npm run build 2>&1 | tail -8`
Expected: `✓ Compiled successfully`. On `/history`: confirm the "Edit" link still works and is unaffected (Trailing Edit's `/history/edit` still opens and functions identically to before this plan). Tap "Select," check 2 days, tap "Delete (2)," confirm the dialog copy, confirm — the 2 days disappear from the list, and directly against Supabase, exactly those 2 `dose_log` rows are gone while `treatment_food_progress` is byte-for-byte unchanged. Repeat with "Clear all."

- [ ] **Step 6: Commit**

```bash
git add app/history/page.tsx components/DoseHistoryLog.tsx
git commit -m "feat(history): add day-selection delete and Clear all, dose_log only, Trailing Edit untouched"
```

---

### Task 12: Full verification and BRIEF.md closure

**Files:**
- Modify: `BRIEF.md`

- [ ] **Step 1: Full typecheck and build**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: zero errors.

Run: `npm run build 2>&1 | tail -10`
Expected: `✓ Compiled successfully`, all routes generated including `/daily`, `/settings`, `/history`, `/history/edit`, `/foods`, `/onboarding`, `/new-cycle`.

- [ ] **Step 2: Manual QA pass against the design doc's QA section**

Work through every bullet in `docs/superpowers/specs/2026-07-20-photo-reparse-recfoods-history-design.md`'s final "QA" section against the live app — this precedes Dan's sign-off, not a substitute for it. In particular: verify `treatment_food_progress` directly in Supabase (not just the UI) after (a) a reparse where a food was removed between cycles — confirm no orphaned row survives, and (b) both History delete paths — confirm zero change to any row.

- [ ] **Step 3: Update BRIEF.md Current Status**

Replace the `## Current Status` block's `Last Updated`, `Blocker`, and `Next Action` fields to record: all 5 items implemented and typechecked/built clean, pending QA pass (Step 2) and Dan's UI sign-off on items 3 and 5 specifically (items 1, 2, 4 don't require sign-off per the ticket, but stay in Stable/maintenance mode per standing rule until Dan confirms via dogfooding).

- [ ] **Step 4: Commit**

```bash
git add BRIEF.md
git commit -m "docs: mark photo/reparse/recfoods/history bundle implemented, pending QA and Dan UI sign-off on items 3 and 5"
```
