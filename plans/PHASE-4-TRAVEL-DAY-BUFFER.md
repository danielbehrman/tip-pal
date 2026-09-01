# Travel Day Buffer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a family flag that they travel to their clinic appointments (fly the day before, so no dosing happens that day) and have the buffer calculation automatically account for one additional non-dosing day. Pure math and display only — no logging, no `dose_log` writes for the travel day.

**Architecture:** A single `flies_to_appointments` boolean on `families`, read/written through one `fetch`/`save` pair in `lib/supabase.ts` (same shape as the existing `fetchAppointmentDate`/`saveAppointmentDate`). `calculateBufferFromProgress()` in `lib/schedule.ts` takes the flag as a new required parameter and subtracts one more day when true — pure, no I/O, fully unit-testable. The three UI call sites (onboarding, new-cycle, daily view) each source the flag differently because `appointmentDate` itself already flows differently at each of those three sites in the existing code — the flag follows suit rather than forcing a new shared pattern.

**Tech Stack:** Next.js (App Router), Supabase (Postgres + `@supabase/supabase-js`), TypeScript, Vitest for pure-function unit tests.

## Global Constraints

- No `dose_log` write for the travel day — pure buffer math and display only.
- No skip-day logging or tracking of any kind for this flag.
- Travel day is always exactly the day immediately before the appointment — never a configurable offset.
- No backfill prompt or banner for existing families — the column defaults to `false`, matching current buffer behavior exactly; families opt in via Settings whenever they choose.
- UI control is a two-button Yes/No segmented pair, never a checkbox — a checkbox's unchecked-by-default state can't express "unanswered" the way this feature requires in onboarding.
- The explanatory note ("If you fly or travel the day before, we'll automatically account for one extra skip day in your buffer calculation.") must appear next to the control everywhere it's shown — baked into the shared component so it can't be dropped in one place and kept in another.
- TypeScript strict, no `any`.
- Test command: `npm test` (runs `vitest run`).
- No code comments unless a WHY is genuinely non-obvious — matches this codebase's existing style.
- Every client component/page file starts with `"use client"`.
- Colors via the existing `var(--color-*)` tokens from `globals.css` — do not introduce new tokens or hardcoded hex values except where the codebase already uses a literal hex for a specific pattern (e.g. `#dc2626` for error/destructive text, already used throughout `app/onboarding/page.tsx` and `app/settings/page.tsx`).
- No new food cycle, no parser involvement — this setting is entered manually and independent of schedule parsing.

## Refinements made while grounding the approved design spec in actual code

The design spec (`docs/superpowers/specs/2026-09-01-travel-day-buffer-design.md`) was approved at the architecture level, including the corrected per-call-site data flow added after a review gap. Turning it into buildable tasks surfaced two more implementation-level details, both consistent with the approved design's intent:

1. **A pre-existing copy bug in `components/DailyView.tsx` must be fixed as part of this feature, not left inconsistent.** The buffer info bottom-sheet already contains the sentence *"the day before (for travel) [is] not counted as buffer days"* (`BUFFER_INFO_COPY`, currently unconditional text) — written ahead of this feature actually existing. Today that sentence is simply false for every family, since no travel-day exclusion exists yet. Task 7 makes this copy conditional on the new flag so it's only shown to families who've actually opted in, instead of shipping this feature while leaving materially incorrect medical-adjacent copy live for everyone else.
2. **Onboarding does not prefetch the flag's saved value, unlike `appointmentDate`.** `appointmentDate` is meaningfully prefetched in onboarding's initial load because a `null`/empty value cleanly means "not yet entered." `flies_to_appointments` has no such empty state — the column is `NOT NULL DEFAULT false`, so a freshly-created family row (which is all onboarding ever sees, since the page redirects away once a family name exists) would read back as `false` indistinguishably from a real "No" answer. Prefetching and prefilling from that value would silently pre-select "No" and violate the explicit "no default" requirement. Task 5 therefore always starts the onboarding control at `null` (unanswered) rather than adding a fetch call that couldn't be interpreted safely.

## File Structure

- `supabase/migrations/20260901_travel_day_buffer.sql` — new. Adds `flies_to_appointments` to `families`.
- `lib/supabase.ts` — modify. Adds `fetchFliesToAppointments`, `saveFliesToAppointments`.
- `lib/schedule.ts` — modify. `calculateBufferFromProgress` gains a required `fliesToAppointments: boolean` parameter.
- `lib/schedule.test.ts` — modify. New tests for `calculateBufferFromProgress` covering the flag.
- `components/TravelDayToggle.tsx` — new. Shared Yes/No control + note text, used by onboarding and Settings.
- `app/onboarding/page.tsx` — modify. Adds the required Yes/No question to Step 2, a Step 4 summary row, and persists on save.
- `app/new-cycle/page.tsx` — modify. Fetches the flag independently on load; passes it into the buffer calculation.
- `app/daily/page.tsx` — modify. Fetches the flag alongside the rest of the family's data; passes it down to `DailyView`.
- `components/DailyView.tsx` — modify. Accepts the flag as a prop, passes it into the buffer calculation, makes the info-sheet copy conditional on it.
- `app/settings/page.tsx` — modify. Fetches the flag on mount; adds the Yes/No control (with note) after the appointment date row; saves on submit.

---

### Task 1: Migration — `flies_to_appointments`

**Files:**
- Create: `supabase/migrations/20260901_travel_day_buffer.sql`

**Interfaces:**
- Produces: `families.flies_to_appointments` (boolean, `NOT NULL DEFAULT false`) — every later task depends on this column existing.

- [ ] **Step 1: Write the migration**

```sql
-- Phase 4: Travel Day Buffer. A family that flies to appointments loses one
-- additional non-dosing day before the appointment; the buffer calculation
-- accounts for it when this flag is set. Defaults to false so every existing
-- family's buffer math is unchanged until they explicitly opt in via Settings.
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS flies_to_appointments BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tool to apply it directly to the linked project (id `hrzpiezzviwgxgnpqqvz`, name "Tip Pal"): call the migration-apply tool with the file's contents as the query and `travel_day_buffer` as the migration name. Confirm success by listing the project's tables/columns and verifying `families.flies_to_appointments` is present, boolean, `NOT NULL`, default `false`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260901_travel_day_buffer.sql
git commit -m "feat: add flies_to_appointments column to families"
```

---

### Task 2: Data access layer (`lib/supabase.ts`)

**Files:**
- Modify: `lib/supabase.ts` (insert after `saveAppointmentDate`, currently lines 207–214, before `saveSkipLog`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `fetchFliesToAppointments(): Promise<boolean>`
  - `saveFliesToAppointments(value: boolean): Promise<void>`

  Tasks 5, 6, 7, and 8 all call into this file.

- [ ] **Step 1: Add the two functions**

Insert directly after the existing `saveAppointmentDate` function (ends at line 214):

```ts
export async function fetchFliesToAppointments(): Promise<boolean> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("flies_to_appointments")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return data.flies_to_appointments as boolean
}

export async function saveFliesToAppointments(value: boolean): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ flies_to_appointments: value })
    .eq("id", familyId)
  if (error) throw error
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (additive-only, nothing consumes these yet).

- [ ] **Step 3: Commit**

```bash
git add lib/supabase.ts
git commit -m "feat: add fetchFliesToAppointments/saveFliesToAppointments"
```

---

### Task 3: Buffer calculation logic (TDD)

**Files:**
- Modify: `lib/schedule.ts` (function at lines 150–173)
- Modify: `lib/schedule.test.ts` (append new `describe` block; extend the top import)
- Modify: `app/onboarding/page.tsx` (line 162 only — compile-fix, see Step 5)
- Modify: `app/new-cycle/page.tsx` (line 168 only — compile-fix, see Step 5)
- Modify: `components/DailyView.tsx` (lines 104–109 only — compile-fix, see Step 5)

**Interfaces:**
- Consumes: `todayDateString`, `addDays` from `./schedule` (pre-existing, exported).
- Produces: `calculateBufferFromProgress(appointmentDateStr, totalTreatmentWeeks, slowestWeek, slowestCompletedDays, fliesToAppointments: boolean): BufferResult` — signature change, new 5th required parameter. Tasks 5, 6, and 7 each pass their own real value for this parameter, replacing the temporary literal `false` this task inserts at each call site so the project keeps compiling in between tasks.

- [ ] **Step 1: Write the failing tests**

Update the top of `lib/schedule.test.ts` — extend the existing import from `./schedule` (currently ending `...advanceProgressForDay, resolveRampAfterAdvance`) to add `calculateBufferFromProgress, todayDateString, addDays`:

```ts
import { applyCrossCategoryCredit, treatmentRampDone, treatmentRampActive, advanceRampStepState, getRampOverrides, advanceProgressForDay, resolveRampAfterAdvance, calculateBufferFromProgress, todayDateString, addDays } from "./schedule"
```

Append to the end of the file (after the last existing `describe` block):

```ts
describe("calculateBufferFromProgress — fliesToAppointments", () => {
  it("subtracts one additional day from a positive buffer when the flag is true", () => {
    // totalTreatmentWeeks === slowestWeek and slowestCompletedDays === 6 means
    // the slowest food is already on day 7 of the final week — remainingDays is 0,
    // so finalDay7Date is today, isolating the flag's effect on the result.
    const appointmentDateStr = addDays(todayDateString(), 11)
    const withoutFlag = calculateBufferFromProgress(appointmentDateStr, 4, 4, 6, false)
    const withFlag = calculateBufferFromProgress(appointmentDateStr, 4, 4, 6, true)
    expect(withoutFlag).toEqual({ kind: "days", count: 10 })
    expect(withFlag).toEqual({ kind: "days", count: 9 })
  })

  it("makes an already-behind family show one day more behind when the flag is true", () => {
    // remainingDays = (4-4)*7 + (6-3) = 3, so finalDay7Date is 3 days from today.
    const appointmentDateStr = addDays(todayDateString(), 2)
    const withoutFlag = calculateBufferFromProgress(appointmentDateStr, 4, 4, 3, false)
    const withFlag = calculateBufferFromProgress(appointmentDateStr, 4, 4, 3, true)
    expect(withoutFlag).toEqual({ kind: "behind", count: 2 })
    expect(withFlag).toEqual({ kind: "behind", count: 3 })
  })

  it("does not affect the hidden case (no appointment date)", () => {
    expect(calculateBufferFromProgress(null, 4, 4, 6, true)).toEqual({ kind: "hidden" })
  })

  it("does not affect the past case (appointment date already elapsed)", () => {
    const pastDate = addDays(todayDateString(), -5)
    expect(calculateBufferFromProgress(pastDate, 4, 4, 6, true)).toEqual({ kind: "past" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `calculateBufferFromProgress` is called with 5 arguments but only accepts 4 (TypeScript/test failure), or a `count` mismatch once the signature is loosened without the subtraction logic.

- [ ] **Step 3: Update the function signature and logic**

Replace the existing function in `lib/schedule.ts` (lines 150–173):

```ts
export function calculateBufferFromProgress(
  appointmentDateStr: string | null,
  totalTreatmentWeeks: number,
  slowestWeek: number,
  slowestCompletedDays: number,
  fliesToAppointments: boolean
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
    Math.round((apptDate.getTime() - finalDay7Date.getTime()) / MS_PER_DAY) - 1 - (fliesToAppointments ? 1 : 0)

  if (bufferDays < 0) return { kind: "behind", count: Math.abs(bufferDays) }
  return { kind: "days", count: bufferDays }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `lib/schedule.test.ts`, including the new `calculateBufferFromProgress` suite. `npm test` (`vitest run`) transpiles without type-checking, so it won't yet catch that the three app-level call sites now pass one too few arguments — that's a TypeScript error, not a runtime one, and only surfaces via `tsc`. Step 5 fixes it before it can bite in Step 7.

- [ ] **Step 5: Fix the three existing call sites so the project compiles**

Each gets a temporary literal `false` as the 5th argument — later tasks replace this with the real fetched/state value:

In `app/onboarding/page.tsx`, line 162, change:
```ts
    ? calculateBufferFromProgress(appointmentDate || null, maxWeek, slowestPosition.week, slowestPosition.day - 1)
```
to:
```ts
    ? calculateBufferFromProgress(appointmentDate || null, maxWeek, slowestPosition.week, slowestPosition.day - 1, false)
```
(Task 5 replaces this `false` with the real `fliesToAppointments` state value.)

In `app/new-cycle/page.tsx`, line 168, change:
```ts
    ? calculateBufferFromProgress(appointmentDate || null, getMaxWeek(parsedSchedule), 1, 0)
```
to:
```ts
    ? calculateBufferFromProgress(appointmentDate || null, getMaxWeek(parsedSchedule), 1, 0, false)
```
(Task 6 replaces this `false` with the real `fliesToAppointments` state value.)

In `components/DailyView.tsx`, lines 104–109, change:
```ts
  const bufferResult = calculateBufferFromProgress(
    appointmentDate,
    totalTreatmentWeeks,
    doseState.currentWeek,
    slowestCompletedDays
  )
```
to:
```ts
  const bufferResult = calculateBufferFromProgress(
    appointmentDate,
    totalTreatmentWeeks,
    doseState.currentWeek,
    slowestCompletedDays,
    false
  )
```
(Task 7 replaces this `false` with the real `fliesToAppointments` prop value.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `lib/schedule.test.ts`, including the new `calculateBufferFromProgress` suite and every pre-existing suite.

- [ ] **Step 7: Verify the whole project compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/schedule.ts lib/schedule.test.ts app/onboarding/page.tsx app/new-cycle/page.tsx components/DailyView.tsx
git commit -m "feat: account for an optional travel day in buffer calculation"
```

---

### Task 4: `TravelDayToggle` component

**Files:**
- Create: `components/TravelDayToggle.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: default export `TravelDayToggle({ value, onChange, error }: { value: boolean | null; onChange: (value: boolean) => void; error?: boolean })`. Used by Task 5 (onboarding) and Task 8 (Settings).

- [ ] **Step 1: Write the component**

```tsx
"use client"

interface TravelDayToggleProps {
  value: boolean | null
  onChange: (value: boolean) => void
  error?: boolean
}

export default function TravelDayToggle({ value, onChange, error = false }: TravelDayToggleProps) {
  return (
    <div>
      <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text-primary)" }}>
        Do you travel to your appointments?
      </p>
      <p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
        If you fly or travel the day before, we&apos;ll automatically account for one extra skip day in your buffer calculation.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          className="flex-1 py-2 rounded-lg text-sm font-medium"
          style={{
            background: value === true ? "var(--color-primary-mid)" : "var(--color-bg-secondary)",
            color: value === true ? "#fff" : "var(--color-text-primary)",
            border: error ? "1.5px solid #dc2626" : "none",
          }}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className="flex-1 py-2 rounded-lg text-sm font-medium"
          style={{
            background: value === false ? "var(--color-primary-mid)" : "var(--color-bg-secondary)",
            color: value === false ? "#fff" : "var(--color-text-primary)",
            border: error ? "1.5px solid #dc2626" : "none",
          }}
        >
          No
        </button>
      </div>
      {error && (
        <p className="text-sm mt-1" style={{ color: "#dc2626" }}>
          Please answer this question.
        </p>
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
git add components/TravelDayToggle.tsx
git commit -m "feat: add TravelDayToggle component"
```

---

### Task 5: Onboarding integration

**Files:**
- Modify: `app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `TravelDayToggle` from `@/components/TravelDayToggle` (Task 4); `saveFliesToAppointments` from `@/lib/supabase` (Task 2); `calculateBufferFromProgress` (Task 3, already patched to accept a 5th argument at line 162).
- Produces: nothing consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Add imports**

Add `saveFliesToAppointments` to the existing `@/lib/supabase` import list (currently lines 5–17, alongside `saveFamilyConfig`):

```ts
import {
  getSession,
  fetchSchedule,
  fetchFamilyName,
  fetchDoseState,
  fetchAppointmentDate,
  saveFamilyConfig,
  saveFliesToAppointments,
  saveDoseState,
  saveVisitNumber,
  uploadChildPhoto,
  saveChildPhotoUrl,
  seedFoodProgress,
} from "@/lib/supabase"
```

Add a new import line for the component:

```ts
import TravelDayToggle from "@/components/TravelDayToggle"
```

- [ ] **Step 2: Add state**

Add alongside the existing `appointmentDate` state (line 56):

```ts
  const [fliesToAppointments, setFliesToAppointments] = useState<boolean | null>(null)
  const [travelError, setTravelError] = useState(false)
```

Per the design's resolved refinement, this intentionally starts at `null` on every onboarding visit and is never prefetched — see "Refinements" above.

- [ ] **Step 3: Add the Step 2 validation handler**

Add directly after the existing `handleStep1Continue` function (lines 112–115):

```ts
  function handleStep2Continue() {
    if (fliesToAppointments === null) { setTravelError(true); return }
    setStep(3)
  }
```

- [ ] **Step 4: Wire the handler and control into Step 2's JSX**

In the Step 2 block (lines 348–375), change the Continue button's `onClick` from `() => setStep(3)` to `handleStep2Continue`, and insert the toggle between the existing "Tap to pick a date…" paragraph and the Continue button:

```tsx
      {/* Step 2: Appointment date */}
      {step === 2 && (
        <div className="px-4 pt-8 pb-24 flex flex-col gap-6">
          <div
            className="bg-white rounded-xl px-4 py-3 flex items-center justify-between"
            style={{ border: "0.5px solid var(--color-primary-border)" }}
          >
            <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Appointment date</span>
            <input
              type="date"
              value={appointmentDate}
              onChange={e => setAppointmentDate(e.target.value)}
              className="text-sm bg-transparent outline-none border-none text-right"
              style={{ color: "var(--color-text-secondary)" }}
            />
          </div>
          <p className="text-sm text-center" style={{ color: "var(--color-text-muted)" }}>
            Tap to pick a date from the calendar.
          </p>
          <TravelDayToggle
            value={fliesToAppointments}
            onChange={v => { setFliesToAppointments(v); setTravelError(false) }}
            error={travelError}
          />
          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "var(--color-primary-mid)" }}
            onClick={handleStep2Continue}
          >
            Continue
          </button>
        </div>
      )}
```

- [ ] **Step 5: Pass the real value into the buffer calculation**

Replace the Task-3-inserted literal at line 162:

```ts
  const bufferResult = schedule
    ? calculateBufferFromProgress(appointmentDate || null, maxWeek, slowestPosition.week, slowestPosition.day - 1, false)
    : { kind: "hidden" as const }
```

with:

```ts
  const bufferResult = schedule
    ? calculateBufferFromProgress(appointmentDate || null, maxWeek, slowestPosition.week, slowestPosition.day - 1, fliesToAppointments ?? false)
    : { kind: "hidden" as const }
```

(`?? false` is a defensive fallback only — by the time Step 4 renders this value, Step 2's validation has already guaranteed it's non-null.)

- [ ] **Step 6: Add the Step 4 summary row**

In the Step 4 summary array (lines 439–457), add a new row directly after "Next appointment":

```ts
            {[
              { label: "Child", value: childName },
              {
                label: "Next appointment",
                value: appointmentDate
                  ? new Date(appointmentDate + "T00:00:00").toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "—",
              },
              { label: "Travel day", value: fliesToAppointments ? "Yes" : "No" },
              {
                label: "Starting position",
                value: positionsInSync
                  ? `${visitLabel(currentVisitRaw)} · Week ${positionEntries[0]?.week ?? 1} · Day ${positionEntries[0]?.day ?? 1}`
                  : `${visitLabel(currentVisitRaw)} · Varies by food`,
              },
              { label: "Buffer days", value: bufferText },
            ].map((row, i, arr) => (
```

- [ ] **Step 7: Persist on save**

In `saveAndRedirect` (lines 125–150), add the save call directly after `saveFamilyConfig`:

```ts
      await saveFamilyConfig(childName.trim(), appointmentDate || null)
      await saveFliesToAppointments(fliesToAppointments ?? false)
```

- [ ] **Step 8: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Manual smoke test**

Run: `npm run dev`. Walk through onboarding as a fresh account (or a test account with no `families` row): confirm Step 2 shows both the appointment date and the new Yes/No question with neither button pre-selected; tapping Continue without answering shows "Please answer this question." and does not advance; answering Yes or No advances to Step 3; Step 4's summary shows the chosen answer under "Travel day"; completing onboarding and then checking Settings shows the same saved answer.

- [ ] **Step 10: Commit**

```bash
git add app/onboarding/page.tsx
git commit -m "feat: add required travel-day question to onboarding"
```

---

### Task 6: `new-cycle` integration

**Files:**
- Modify: `app/new-cycle/page.tsx`

**Interfaces:**
- Consumes: `fetchFliesToAppointments` from `@/lib/supabase` (Task 2); `calculateBufferFromProgress` (Task 3, already patched to accept a 5th argument at line 168).
- Produces: nothing consumed by later tasks — this is a leaf integration task.

- [ ] **Step 1: Add the import**

Add `fetchFliesToAppointments` to the existing `@/lib/supabase` import list (lines 6–13):

```ts
import {
  fetchSchedule,
  fetchChildPhotoUrl,
  fetchFliesToAppointments,
  archiveAndStartNewCycle,
  getSession,
  seedFoodProgress,
  clearFoodProgress,
} from "@/lib/supabase"
```

- [ ] **Step 2: Add state**

Add alongside the existing `appointmentDate` state (line 62):

```ts
  const [fliesToAppointments, setFliesToAppointments] = useState(false)
```

- [ ] **Step 3: Fetch it independently in `init()`**

Update the `init()` function's `Promise.all` (lines 70–83):

```ts
  useEffect(() => {
    async function init() {
      const session = await getSession()
      if (!session) { router.replace("/login"); return }
      const [s, photo, flies] = await Promise.all([
        fetchSchedule().catch(() => null),
        fetchChildPhotoUrl().catch(() => null),
        fetchFliesToAppointments().catch(() => false),
      ])
      setCurrentSchedule(s)
      setChildPhotoUrl(photo)
      setFliesToAppointments(flies)
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

This is fetched independently — not derived from the parsed-schedule payload — because whether a family flies to appointments is a standing preference, not a fact that changes per cycle the way the appointment date does.

- [ ] **Step 4: Pass the real value into the buffer calculation**

Replace the Task-3-inserted literal at line 168:

```ts
  const bufferResult = parsedSchedule
    ? calculateBufferFromProgress(appointmentDate || null, getMaxWeek(parsedSchedule), 1, 0, false)
```

with:

```ts
  const bufferResult = parsedSchedule
    ? calculateBufferFromProgress(appointmentDate || null, getMaxWeek(parsedSchedule), 1, 0, fliesToAppointments)
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`, sign in as a test account that has already answered "Yes" to the travel question in Settings (or set it via Settings first), then start a New Food Cycle. Confirm the buffer preview shown during the new-cycle flow reflects the extra travel day (compare against the same flow with the setting toggled to No).

- [ ] **Step 7: Commit**

```bash
git add app/new-cycle/page.tsx
git commit -m "feat: account for travel day in new-cycle buffer preview"
```

---

### Task 7: Daily view integration

**Files:**
- Modify: `app/daily/page.tsx`
- Modify: `components/DailyView.tsx`

**Interfaces:**
- Consumes: `fetchFliesToAppointments` from `@/lib/supabase` (Task 2); `calculateBufferFromProgress` (Task 3, already patched to accept a 5th argument in `DailyView.tsx`).
- Produces: `DailyViewProps.fliesToAppointments: boolean` — this task both adds and immediately consumes this prop; nothing downstream depends on it.

- [ ] **Step 1: `app/daily/page.tsx` — add the import**

Add `fetchFliesToAppointments` to the existing `@/lib/supabase` import list (lines 6–31, alongside `fetchAppointmentDate`):

```ts
  fetchAppointmentDate,
  fetchFliesToAppointments,
```

- [ ] **Step 2: Add state**

Add alongside the existing `appointmentDate` state (line 45):

```ts
  const [fliesToAppointments, setFliesToAppointments] = useState(false)
```

- [ ] **Step 3: Add it to the mount-time `Promise.all`**

Update the destructure and `Promise.all` (lines 89–100):

```ts
        const [ds, apptDate, name, positions, records, groups, vNum, rawProgress, photoUrl, rawRamp, flies] = await Promise.all([
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
          fetchFliesToAppointments().catch(() => false),
        ])
```

- [ ] **Step 4: Set the state**

Add directly after the existing `setAppointmentDate(apptDate)` line (line 257):

```ts
        setAppointmentDate(apptDate)
        setFliesToAppointments(flies)
```

- [ ] **Step 5: Pass it down to `DailyView`**

Add the prop to the `<DailyView>` JSX (after `appointmentDate={appointmentDate}`, line 429):

```tsx
      appointmentDate={appointmentDate}
      fliesToAppointments={fliesToAppointments}
```

- [ ] **Step 6: `components/DailyView.tsx` — extend the props interface**

Add to `DailyViewProps` (after `appointmentDate: string | null`, line 16):

```ts
  fliesToAppointments: boolean
```

Add to the destructured props (after `appointmentDate,`, line 70):

```ts
  fliesToAppointments,
```

- [ ] **Step 7: Pass the real value into the buffer calculation**

Replace the Task-3-inserted literal at lines 104–109:

```ts
  const bufferResult = calculateBufferFromProgress(
    appointmentDate,
    totalTreatmentWeeks,
    doseState.currentWeek,
    slowestCompletedDays,
    false
  )
```

with:

```ts
  const bufferResult = calculateBufferFromProgress(
    appointmentDate,
    totalTreatmentWeeks,
    doseState.currentWeek,
    slowestCompletedDays,
    fliesToAppointments
  )
```

- [ ] **Step 8: Make the info-sheet copy conditional**

Replace the existing `BUFFER_INFO_COPY` constant (lines 58–62):

```ts
const BUFFER_INFO_COPY =
  "Buffer days are the days between completing your final week of dosing and your next clinic appointment. " +
  "Your program requires at least 7 days on the final week's dose before your visit. " +
  "Buffer days show how much cushion you have — so you know you're on track. " +
  "Note: The day of your appointment and the day before (for travel) are not counted as buffer days."
```

with a function that takes the flag:

```ts
function getBufferInfoCopy(fliesToAppointments: boolean): string {
  const base =
    "Buffer days are the days between completing your final week of dosing and your next clinic appointment. " +
    "Your program requires at least 7 days on the final week's dose before your visit. " +
    "Buffer days show how much cushion you have — so you know you're on track. " +
    "Note: The day of your appointment"
  return fliesToAppointments
    ? base + " and the day before (for travel) are not counted as buffer days."
    : base + " is not counted as a buffer day."
}
```

Update the render site (line 429) from `{BUFFER_INFO_COPY}` to:

```tsx
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-primary)" }}>
              {getBufferInfoCopy(fliesToAppointments)}
            </p>
```

- [ ] **Step 9: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Run the full test suite**

Run: `npm test`
Expected: PASS — all `lib/schedule.test.ts` suites, unaffected by this task's UI-only changes.

- [ ] **Step 11: Manual smoke test**

Run: `npm run dev`, sign in as the test account. With the travel setting off in Settings, open the daily view's buffer info sheet and confirm the copy says only the appointment day is excluded. Toggle the setting on in Settings, reload the daily view, and confirm: the buffer number itself is one lower (or one more "behind"), and the info sheet copy now mentions the travel day too.

- [ ] **Step 12: Commit**

```bash
git add app/daily/page.tsx components/DailyView.tsx
git commit -m "feat: wire travel day into daily view buffer calculation and info copy"
```

---

### Task 8: Settings integration

**Files:**
- Modify: `app/settings/page.tsx`

**Interfaces:**
- Consumes: `TravelDayToggle` from `@/components/TravelDayToggle` (Task 4); `fetchFliesToAppointments`, `saveFliesToAppointments` from `@/lib/supabase` (Task 2).
- Produces: nothing consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Add imports**

Add `fetchFliesToAppointments, saveFliesToAppointments` to the existing `@/lib/supabase` import list (alongside `fetchAppointmentDate, ..., saveAppointmentDate`), and add the component import:

```ts
import TravelDayToggle from "@/components/TravelDayToggle"
```

- [ ] **Step 2: Add state**

Add alongside the existing `appointmentDate` state and its loaded-guard ref (lines 62, 76):

```ts
  const [fliesToAppointments, setFliesToAppointments] = useState(false)
  const fliesToAppointmentsLoaded = useRef(false)
```

- [ ] **Step 3: Fetch it on load**

Update the existing appointment-date fetch block (lines 106–110), which already runs outside the main `Promise.all` with its own try/catch and guard ref:

```ts
        try {
          const apptDate = await fetchAppointmentDate()
          setAppointmentDate(apptDate ?? "")
          appointmentDateLoaded.current = true
        } catch {}
        try {
          const flies = await fetchFliesToAppointments()
          setFliesToAppointments(flies)
          fliesToAppointmentsLoaded.current = true
        } catch {}
```

- [ ] **Step 4: Add the UI row**

Insert directly after the appointment date row and its `RowDivider` (lines 372–382), before the "Program day (auto)" block:

```tsx
            {/* Appointment date */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Next appointment</span>
              <input
                type="date"
                value={appointmentDate}
                onChange={e => setAppointmentDate(e.target.value)}
                className="text-sm bg-transparent text-right outline-none border-none"
                style={{ color: "var(--color-text-secondary)" }}
              />
            </div>
            <RowDivider />
            {/* Travel day */}
            <div className="px-4 py-3">
              <TravelDayToggle
                value={fliesToAppointments}
                onChange={v => setFliesToAppointments(v)}
              />
            </div>
            <RowDivider />
```

- [ ] **Step 5: Save on submit**

In `saveOtherFields` (lines 255–274), add the save call guarded the same way as `appointmentDate`'s:

```ts
  async function saveOtherFields() {
    if (!childName.trim()) { setNameError(true); return }
    setSaving(true)
    setSaveError(null)
    try {
      await saveChildName(childName.trim())
      if (appointmentDateLoaded.current) {
        await saveAppointmentDate(appointmentDate || null)
      }
      if (fliesToAppointmentsLoaded.current) {
        await saveFliesToAppointments(fliesToAppointments)
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

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual smoke test**

Run: `npm run dev`, sign in, open `/settings`. Confirm: the "Do you travel to your appointments?" question with its note text appears directly below "Next appointment" and above "Program day (auto)", pre-selected to the currently saved value (never unselected, since the column is non-nullable). Toggle it, tap Save, reload the page, and confirm the toggled value persists. Confirm the note text is visible in the same view as the buttons, not truncated or hidden.

- [ ] **Step 8: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat: add travel day setting to Settings"
```
