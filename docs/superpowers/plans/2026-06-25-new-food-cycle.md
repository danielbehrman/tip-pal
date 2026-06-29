# F4 — New Food Cycle Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a family returns from a clinic visit with a new plan of care, archive the current schedule, replace it with the new one, and reset the dosing position to Week 1 / Day 1.

**Architecture:** On appointment day (today === `families.next_appointment_date`), the daily view replaces the dose sections with a "Start new food cycle" card. Tapping it goes to `/new-cycle` — a 3-step page (paste → parse → review with diff badges → confirm). Confirming archives the old schedule to a `previous_cycles` JSONB column on `families`, replaces the active schedule, resets `dose_state`, and updates the appointment date and visit number from the parsed plan. All food categories are fully replaced (not merged) — the new plan of care is exhaustive.

**Tech Stack:** Next.js App Router, Supabase (Postgres + anon key client), Tailwind CSS 4

## Global Constraints

- App name "Tip Pal" — never "TIP Pal" in any user-facing copy
- No personal names in the codebase
- Tailwind only — no inline styles
- Styling conventions: `max-w-lg mx-auto px-4`, `rounded-xl` for cards, `bg-slate-900 text-white` for primary buttons, `bg-gray-100` for secondary, `text-sm text-gray-500` for labels
- No test runner — `npm run build` is the only automated check. After every implementation step that touches TypeScript, run `npm run build` from `/Users/dan/Shipyard/tippal` and confirm zero errors before committing
- `process.env.NEXT_PUBLIC_API_BASE_URL ?? ""` prefix on all fetch calls to `/api/*` (required for Capacitor native builds)
- All Supabase reads/writes use the anon-key client from `@/lib/supabase` — no service role on the client
- Do NOT delete any existing exported functions from `lib/supabase.ts` — other pages depend on them
- `"use client"` at top of any file that uses hooks or browser APIs

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260625_new_cycle.sql` | Create | DB: `previous_cycles` column + `visit_number` column on `families` |
| `lib/types.ts` | Modify | Add `visitNumber?` and `appointmentDate?` to `ParsedSchedule` |
| `app/api/parse-schedule/route.ts` | Modify | Add `visitNumber` and `appointmentDate` to system prompt schema |
| `lib/supabase.ts` | Modify | Add `fetchVisitNumber`, `saveVisitNumber`, `archiveAndStartNewCycle` |
| `components/DailyView.tsx` | Modify | `visitNumber` prop, visit label, appointment-day card |
| `app/daily/page.tsx` | Modify | Fetch visit number, compute `isAppointmentDay`, pass new props |
| `app/new-cycle/page.tsx` | Create | Full new-cycle flow: paste → parse → review → confirm |
| `components/NewCycleReview.tsx` | Create | Read-only schedule display with NEW/CHANGED diff badges |
| `app/settings/page.tsx` | Modify | Add "New food cycle" link |

---

## Task 1: DB migration + type extension + Supabase layer

**Files:**
- Create: `supabase/migrations/20260625_new_cycle.sql`
- Modify: `lib/types.ts`
- Modify: `app/api/parse-schedule/route.ts`
- Modify: `lib/supabase.ts`

**Interfaces:**
- Produces:
  - `ParsedSchedule.visitNumber?: string` — e.g. `"8"`, `"Tolerance 1"`
  - `ParsedSchedule.appointmentDate?: string` — `"YYYY-MM-DD"` or absent
  - `fetchVisitNumber(): Promise<string | null>` in `lib/supabase.ts`
  - `saveVisitNumber(visitNumber: string | null): Promise<void>` in `lib/supabase.ts`
  - `archiveAndStartNewCycle(currentSchedule: ParsedSchedule | null, newSchedule: ParsedSchedule, visitNumber: string | null, newAppointmentDate: string | null): Promise<void>` in `lib/supabase.ts`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260625_new_cycle.sql`:

```sql
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS previous_cycles JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS visit_number TEXT;
```

This migration must be applied manually in the Supabase dashboard SQL editor before the production deploy in Task 5. Write the file now; do not apply it yet.

- [ ] **Step 2: Extend `ParsedSchedule` in `lib/types.ts`**

Add two optional fields to `ParsedSchedule` (after `medications?`):

```ts
export interface ParsedSchedule {
  maintenanceFoods: MaintenanceFood[]
  weeklyFoods: WeeklyFood[]
  treatmentFoods: TreatmentFood[]
  recommendedFoods?: RecommendedFood[]
  medications?: Medication[]
  visitNumber?: string
  appointmentDate?: string
}
```

These are optional so existing stored schedules (which don't have these fields) continue to work without null-checks throughout the app.

- [ ] **Step 3: Add `visitNumber` and `appointmentDate` to the parse-schedule system prompt**

Open `app/api/parse-schedule/route.ts`. The `SYSTEM_PROMPT` const defines a JSON schema. Add `visitNumber` and `appointmentDate` as the first two fields in the schema and add parsing rules for them. The updated schema block (replace the existing `{` … `}` schema section):

```
{
  "visitNumber": "string — the visit number as stated in the document (e.g. '8', '9', 'Tolerance Visit 1'). If not found, omit this field.",
  "appointmentDate": "YYYY-MM-DD — the next appointment or follow-up date. If not found, omit this field.",
  "maintenanceFoods": [
    { "name": "string", "dose": number, "unit": "string", "capped": boolean, "prepNote": "string or null" }
  ],
  "weeklyFoods": [
    { "name": "string", "dose": number, "unit": "string", "prepNote": "string or null" }
  ],
  "treatmentFoods": [
    {
      "name": "string",
      "weeks": [
        { "week": number, "dose": number, "unit": "string", "isFinal": boolean }
      ]
    }
  ],
  "recommendedFoods": [
    { "name": "string", "dose": number, "unit": "string", "frequencyPerWeek": "string" }
  ],
  "medications": [
    { "name": "string", "dose": "string", "unit": "string", "frequency": "string" }
  ]
}
```

Also add these two lines to the parsing rules (after the last bullet in the current list):
```
- visitNumber: extract the visit identifier exactly as written (e.g. "Visit 8" → "8", "Tolerance Visit 1" → "Tolerance Visit 1"). Omit if not present.
- appointmentDate: extract the next appointment date and format it as YYYY-MM-DD. Omit if not present or unclear.
```

The `isValidSchedule` function does not need to change — `visitNumber` and `appointmentDate` are optional extras.

- [ ] **Step 4: Add three functions to `lib/supabase.ts`**

Add these three functions at the end of `lib/supabase.ts`. They use the already-imported `getClient`, `getFamilyId`, `ParsedSchedule`, and `todayDateString` (import `todayDateString` from `"./schedule"` — it is already imported as `getCalendarPosition` from the same file; add `todayDateString` to that same import line).

```ts
export async function fetchVisitNumber(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("visit_number")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return (data.visit_number as string | null) ?? null
}

export async function saveVisitNumber(visitNumber: string | null): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ visit_number: visitNumber })
    .eq("id", familyId)
  if (error) throw error
}

export async function archiveAndStartNewCycle(
  currentSchedule: ParsedSchedule | null,
  newSchedule: ParsedSchedule,
  visitNumber: string | null,
  newAppointmentDate: string | null
): Promise<void> {
  const familyId = await getFamilyId()

  // 1. Read current previous_cycles array
  const { data: familyData, error: familyReadError } = await getClient()
    .from("families")
    .select("previous_cycles")
    .eq("id", familyId)
    .single()
  if (familyReadError) throw familyReadError

  const existingCycles = (familyData.previous_cycles ?? []) as object[]
  const archivedEntry = currentSchedule
    ? { schedule: currentSchedule, archivedAt: new Date().toISOString() }
    : null
  const newCycles = archivedEntry ? [...existingCycles, archivedEntry] : existingCycles

  // 2. Update families: archive, visit number, appointment date
  const { error: familyUpdateError } = await getClient()
    .from("families")
    .update({
      previous_cycles: newCycles,
      visit_number: visitNumber,
      next_appointment_date: newAppointmentDate,
    })
    .eq("id", familyId)
  if (familyUpdateError) throw familyUpdateError

  // 3. Replace schedule
  const { error: scheduleError } = await getClient()
    .from("schedules")
    .upsert(
      { family_id: familyId, parsed_data: newSchedule, updated_at: new Date().toISOString() },
      { onConflict: "family_id" }
    )
  if (scheduleError) throw scheduleError

  // 4. Reset dose_state
  const today = todayDateString()
  const { error: doseError } = await getClient()
    .from("dose_state")
    .upsert(
      {
        family_id: familyId,
        current_week: 1,
        current_day: 1,
        checked_foods: {},
        completed_days: {},
        morning_skipped: false,
        evening_skipped: false,
        cycle_start_date: today,
        skip_count: 0,
        floor_week: 1,
        floor_day: 1,
        recommended_food_counts: {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "family_id" }
    )
  if (doseError) throw doseError
}
```

Also update the existing import of `schedule` at line 3 to include `todayDateString`:

Current line 3:
```ts
import { getCalendarPosition } from "./schedule"
```

Replace with:
```ts
import { getCalendarPosition, todayDateString } from "./schedule"
```

- [ ] **Step 5: Build check**

```bash
cd /Users/dan/Shipyard/tippal && npm run build
```

Expected: zero TypeScript errors, all pages compile. Fix any errors before committing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260625_new_cycle.sql lib/types.ts app/api/parse-schedule/route.ts lib/supabase.ts
git commit -m "feat: F4 Task 1 — DB migration, ParsedSchedule extension, archiveAndStartNewCycle"
```

---

## Task 2: Visit number display + appointment-day card in DailyView

**Files:**
- Modify: `components/DailyView.tsx`
- Modify: `app/daily/page.tsx`

**Interfaces:**
- Consumes (from Task 1): `fetchVisitNumber(): Promise<string | null>`
- `DailyViewProps` gains two new props:
  - `visitNumber: string | null`
  - `isAppointmentDay: boolean`

- [ ] **Step 1: Add `visitNumber` and `isAppointmentDay` to `DailyViewProps`**

In `components/DailyView.tsx`, add to the `DailyViewProps` interface (after `foodGroups: FoodGroup[]`):

```ts
visitNumber: string | null
isAppointmentDay: boolean
```

Add to the destructured props in the function signature:

```ts
export default function DailyView({
  schedule,
  doseState,
  onStateChange,
  onCompleteDay,
  onSkipDay,
  appointmentDate,
  onAppointmentChange,
  familyName,
  completedPositions,
  dayRecords,
  treatmentAnchor,
  previousDayIncomplete,
  foodGroups,
  visitNumber,
  isAppointmentDay,
}: DailyViewProps) {
```

- [ ] **Step 2: Update the appointment label to show visit number**

In `components/DailyView.tsx`, find the appointment label (currently `"Next appointment"`). Replace:

```tsx
<label className="block text-sm text-gray-500 mb-1" htmlFor="next-appointment">
  Next appointment
</label>
```

With:

```tsx
<label className="block text-sm text-gray-500 mb-1" htmlFor="next-appointment">
  {visitNumber ? `Next appointment, Visit ${visitNumber}` : "Next appointment"}
</label>
```

- [ ] **Step 3: Add `Link` import to DailyView (if not already present)**

`components/DailyView.tsx` already imports `Link from "next/link"` — confirm this exists at the top of the file. It is present in the current codebase.

- [ ] **Step 4: Replace dose sections with appointment-day card**

In `components/DailyView.tsx`, find the `<MorningSection ... />` JSX. The current structure is:

```tsx
<MorningSection
  schedule={schedule}
  currentDay={currentDay}
  checkedFoods={checkedFoods}
  onCheck={handleCheck}
  isFutureDay={isFutureDay}
  foodGroups={foodGroups}
/>

<EveningSection
  schedule={schedule}
  currentWeek={currentWeek}
  checkedFoods={checkedFoods}
  onCheck={handleCheck}
  onSkipDay={onSkipDay}
  isFutureDay={isFutureDay}
  isCurrentTreatmentDay={isCurrentTreatmentDay}
  isSkipped={isSkipped}
/>
```

Replace this block with:

```tsx
{isAppointmentDay && isCurrentTreatmentDay ? (
  <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-6 mb-4 flex flex-col gap-3">
    <div>
      <p className="text-base font-semibold text-blue-900">
        {visitNumber ? `Today is Visit ${visitNumber}.` : "Today is your appointment."}
      </p>
      <p className="text-sm text-blue-800 mt-1">
        When you&apos;re ready, start your new food cycle to load your updated schedule.
      </p>
    </div>
    <Link
      href="/new-cycle"
      className="inline-block text-center w-full py-3 bg-slate-900 text-white text-sm font-semibold rounded-xl"
    >
      Start new food cycle
    </Link>
  </div>
) : (
  <>
    <MorningSection
      schedule={schedule}
      currentDay={currentDay}
      checkedFoods={checkedFoods}
      onCheck={handleCheck}
      isFutureDay={isFutureDay}
      foodGroups={foodGroups}
    />

    <EveningSection
      schedule={schedule}
      currentWeek={currentWeek}
      checkedFoods={checkedFoods}
      onCheck={handleCheck}
      onSkipDay={onSkipDay}
      isFutureDay={isFutureDay}
      isCurrentTreatmentDay={isCurrentTreatmentDay}
      isSkipped={isSkipped}
    />
  </>
)}
```

- [ ] **Step 5: Update `app/daily/page.tsx` to fetch and pass `visitNumber` and `isAppointmentDay`**

In `app/daily/page.tsx`:

**Add `fetchVisitNumber` to imports** (the import line from `@/lib/supabase`):
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
```

**Add `visitNumber` state** (after `const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([])`):
```ts
const [visitNumber, setVisitNumber] = useState<string | null>(null)
```

**Add `fetchVisitNumber()` to the parallel fetch** (the `Promise.all` call currently fetches 6 things):
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

**Set state** (after `setFoodGroups(groups)`):
```ts
setVisitNumber(vNum)
```

**Compute `isAppointmentDay`** — add this derived value just before the `return` at the bottom of the component (after `if (!schedule || !doseState || !treatmentAnchor) return null`):

```ts
const isAppointmentDay = !!appointmentDate && appointmentDate === todayDateString()
```

(`todayDateString` is already imported from `@/lib/schedule` in this file.)

**Pass new props to DailyView**:
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

- [ ] **Step 6: Build check**

```bash
cd /Users/dan/Shipyard/tippal && npm run build
```

Expected: zero errors. Fix any before committing.

- [ ] **Step 7: Commit**

```bash
git add components/DailyView.tsx app/daily/page.tsx
git commit -m "feat: F4 Task 2 — visit number label + appointment-day new cycle card"
```

---

## Task 3: New Cycle page — paste + parse step

**Files:**
- Create: `app/new-cycle/page.tsx`

**Interfaces:**
- Consumes (from Task 1): `fetchSchedule(): Promise<ParsedSchedule | null>`, `ParsedSchedule` (with `visitNumber?`, `appointmentDate?`)
- Consumes: existing `PasteInput` component at `components/PasteInput.tsx`
- Produces: `app/new-cycle/page.tsx` with states `view: "paste"|"loading"|"review"|"confirming"|"error"`, `currentSchedule: ParsedSchedule | null`, `parsedSchedule: ParsedSchedule | null` — consumed by Task 4 (review + confirm wiring)

The `NewCycleReview` component (Task 4) will be imported here. In this task, wire the import and render a placeholder so the page builds — the actual component comes in Task 4.

- [ ] **Step 1: Create `app/new-cycle/page.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import PasteInput from "@/components/PasteInput"
import NewCycleReview from "@/components/NewCycleReview"
import { ParsedSchedule } from "@/lib/types"
import { fetchSchedule, archiveAndStartNewCycle, getSession } from "@/lib/supabase"

type View = "paste" | "loading" | "review" | "confirming" | "error"

export default function NewCyclePage() {
  const router = useRouter()
  const [view, setView] = useState<View>("paste")
  const [rawText, setRawText] = useState("")
  const [currentSchedule, setCurrentSchedule] = useState<ParsedSchedule | null>(null)
  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    async function init() {
      const session = await getSession()
      if (!session) {
        router.replace("/login")
        return
      }
      const s = await fetchSchedule().catch(() => null)
      setCurrentSchedule(s)
    }
    init()
  }, [router])

  async function handleSubmit() {
    setView("loading")
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""
      const res = await fetch(`${apiBase}/api/parse-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error ?? "Unknown error")
        setView("error")
        return
      }
      setParsedSchedule(data.schedule)
      setView("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setView("error")
    }
  }

  async function handleConfirm() {
    if (!parsedSchedule) return
    setView("confirming")
    try {
      await archiveAndStartNewCycle(
        currentSchedule,
        parsedSchedule,
        parsedSchedule.visitNumber ?? null,
        parsedSchedule.appointmentDate ?? null
      )
      router.push("/daily")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save new cycle")
      setView("error")
    }
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8 min-h-screen">
      <h1 className="text-2xl font-bold mb-2">New Food Cycle</h1>
      <p className="text-sm text-gray-500 mb-6">
        Paste your updated plan of care. Your current schedule will be archived and replaced.
      </p>

      {view === "paste" && (
        <PasteInput
          value={rawText}
          onChange={setRawText}
          onSubmit={handleSubmit}
        />
      )}

      {view === "loading" && (
        <p className="text-gray-600 text-lg">Parsing new schedule…</p>
      )}

      {view === "review" && parsedSchedule && (
        <NewCycleReview
          currentSchedule={currentSchedule}
          newSchedule={parsedSchedule}
          onBack={() => setView("paste")}
          onConfirm={handleConfirm}
          confirming={false}
        />
      )}

      {view === "confirming" && (
        <p className="text-gray-600 text-lg">Saving new food cycle…</p>
      )}

      {view === "error" && (
        <div className="flex flex-col gap-4">
          <p className="text-red-700 font-medium">Error: {error}</p>
          <button
            className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl"
            onClick={() => { setView("paste"); setError("") }}
          >
            Try Again
          </button>
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Create stub `components/NewCycleReview.tsx` so the build passes**

```tsx
"use client"

import { ParsedSchedule } from "@/lib/types"

interface NewCycleReviewProps {
  currentSchedule: ParsedSchedule | null
  newSchedule: ParsedSchedule
  onBack: () => void
  onConfirm: () => void
  confirming: boolean
}

export default function NewCycleReview({
  onBack,
  onConfirm,
  confirming,
}: NewCycleReviewProps) {
  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="text-sm text-slate-600 underline text-left">
        ← Edit pasted text
      </button>
      <p className="text-gray-500 text-sm">Review coming in Task 4.</p>
      <button
        onClick={onConfirm}
        disabled={confirming}
        className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl disabled:opacity-50"
      >
        {confirming ? "Saving…" : "Confirm & Start New Cycle"}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Build check**

```bash
cd /Users/dan/Shipyard/tippal && npm run build
```

Expected: `/new-cycle` appears in the route list, zero TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add app/new-cycle/page.tsx components/NewCycleReview.tsx
git commit -m "feat: F4 Task 3 — new-cycle page with paste+parse flow and stub review"
```

---

## Task 4: NewCycleReview component — diff display + confirm

**Files:**
- Modify: `components/NewCycleReview.tsx` (replace stub with full implementation)

**Interfaces:**
- Consumes (from Task 1): `ParsedSchedule` with `visitNumber?` and `appointmentDate?`
- Consumes (from Task 3): props `{ currentSchedule, newSchedule, onBack, onConfirm, confirming }`

Diff rules:
- **maintenanceFoods**: per food by name — `"new"` if name not in current, `"changed"` if dose or unit differs, else no badge
- **weeklyFoods**: same logic as maintenanceFoods
- **treatmentFoods**: `"new"` if name not in current, `"updated"` if name exists (treatment weeks always fully replace)
- **recommendedFoods**: `"new"` if name not in current, else no badge
- **medications**: `"new"` if name not in current, else no badge

Badge styles:
- `"new"` — `<span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">NEW</span>`
- `"changed"` — `<span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">CHANGED</span>` plus `<span className="text-xs text-gray-400">(was {prevDose} {prevUnit})</span>`
- `"updated"` — `<span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">UPDATED</span>`

- [ ] **Step 1: Replace `components/NewCycleReview.tsx` with full implementation**

```tsx
"use client"

import { ParsedSchedule, MaintenanceFood, WeeklyFood } from "@/lib/types"

interface NewCycleReviewProps {
  currentSchedule: ParsedSchedule | null
  newSchedule: ParsedSchedule
  onBack: () => void
  onConfirm: () => void
  confirming: boolean
}

type DiffTag = "new" | "changed" | "updated" | null

interface ChangedMeta { prevDose: number; prevUnit: string }

function getMFTag(
  food: MaintenanceFood | WeeklyFood,
  current: (MaintenanceFood | WeeklyFood)[] | undefined
): { tag: DiffTag; meta?: ChangedMeta } {
  if (!current) return { tag: "new" }
  const existing = current.find(f => f.name === food.name)
  if (!existing) return { tag: "new" }
  if (existing.dose !== food.dose || existing.unit !== food.unit) {
    return { tag: "changed", meta: { prevDose: existing.dose, prevUnit: existing.unit } }
  }
  return { tag: null }
}

function Badge({ tag, meta }: { tag: DiffTag; meta?: ChangedMeta }) {
  if (!tag) return null
  if (tag === "new") return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">NEW</span>
  if (tag === "updated") return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">UPDATED</span>
  return (
    <span className="flex items-center gap-1">
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">CHANGED</span>
      {meta && <span className="text-xs text-gray-400">(was {meta.prevDose} {meta.prevUnit})</span>}
    </span>
  )
}

export default function NewCycleReview({
  currentSchedule,
  newSchedule,
  onBack,
  onConfirm,
  confirming,
}: NewCycleReviewProps) {
  const cur = currentSchedule

  return (
    <div className="flex flex-col gap-6">
      <button onClick={onBack} className="text-sm text-slate-600 underline text-left">
        ← Edit pasted text
      </button>

      {newSchedule.visitNumber && (
        <p className="text-sm text-gray-500">Visit {newSchedule.visitNumber}</p>
      )}

      {newSchedule.maintenanceFoods.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Morning (daily)</h2>
          {newSchedule.maintenanceFoods.map((food, i) => {
            const { tag, meta } = getMFTag(food, cur?.maintenanceFoods)
            return (
              <div key={i} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {food.name}{food.capped ? " · CAPPED" : ""}
                  </span>
                  <span className="text-xs text-gray-500">
                    {food.dose} {food.unit}{food.prepNote ? ` · ${food.prepNote}` : ""}
                  </span>
                </div>
                <Badge tag={tag} meta={meta} />
              </div>
            )
          })}
        </section>
      )}

      {newSchedule.weeklyFoods.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Morning (weekly — Day 7 only)</h2>
          {newSchedule.weeklyFoods.map((food, i) => {
            const { tag, meta } = getMFTag(food, cur?.weeklyFoods)
            return (
              <div key={i} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{food.name}</span>
                  <span className="text-xs text-gray-500">
                    {food.dose} {food.unit}{food.prepNote ? ` · ${food.prepNote}` : ""}
                  </span>
                </div>
                <Badge tag={tag} meta={meta} />
              </div>
            )
          })}
        </section>
      )}

      {newSchedule.treatmentFoods.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Evening (treatment)</h2>
          {newSchedule.treatmentFoods.map((food, fi) => {
            const existsInCurrent = cur?.treatmentFoods.some(f => f.name === food.name)
            const tag: DiffTag = existsInCurrent ? "updated" : "new"
            return (
              <div key={fi} className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{food.name}</span>
                  <Badge tag={tag} />
                </div>
                <div className="ml-2 border-l-2 border-gray-200 pl-3">
                  {food.weeks.map((week, wi) => (
                    <div key={wi} className="text-xs text-gray-500 py-1 border-b border-gray-100 last:border-0">
                      Week {week.week}: {week.dose} {week.unit}{week.isFinal ? " · final dose" : ""}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {(newSchedule.recommendedFoods ?? []).length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Recommended foods</h2>
          {(newSchedule.recommendedFoods ?? []).map((food, i) => {
            const existsInCurrent = cur?.recommendedFoods?.some(f => f.name === food.name)
            const tag: DiffTag = existsInCurrent ? null : "new"
            return (
              <div key={i} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{food.name}</span>
                  <span className="text-xs text-gray-500">
                    {food.dose} {food.unit} · {food.frequencyPerWeek}×/week
                  </span>
                </div>
                <Badge tag={tag} />
              </div>
            )
          })}
        </section>
      )}

      {(newSchedule.medications ?? []).length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Daily medications</h2>
          {(newSchedule.medications ?? []).map((med, i) => {
            const existsInCurrent = cur?.medications?.some(m => m.name === med.name)
            const tag: DiffTag = existsInCurrent ? null : "new"
            return (
              <div key={i} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{med.name}</span>
                  <span className="text-xs text-gray-500">
                    {med.dose} {med.unit} · {med.frequency}
                  </span>
                </div>
                <Badge tag={tag} />
              </div>
            )
          })}
        </section>
      )}

      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
        <p className="text-sm text-amber-900">
          Confirming will archive your current schedule and reset your position to Week 1, Day 1.
          Your dosing history is preserved in Supabase.
        </p>
      </div>

      <button
        onClick={onConfirm}
        disabled={confirming}
        className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl disabled:opacity-50"
      >
        {confirming ? "Saving…" : "Confirm & Start New Cycle"}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Build check**

```bash
cd /Users/dan/Shipyard/tippal && npm run build
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add components/NewCycleReview.tsx
git commit -m "feat: F4 Task 4 — NewCycleReview with NEW/CHANGED/UPDATED diff badges"
```

---

## Task 5: Settings entry point + production deploy

**Files:**
- Modify: `app/settings/page.tsx`
- Apply: `supabase/migrations/20260625_new_cycle.sql` (via Supabase dashboard)

**Interfaces:**
- Consumes: existing Settings page structure — add one `<Link>` after "Re-parse schedule"

- [ ] **Step 1: Add "New food cycle" link to Settings**

In `app/settings/page.tsx`, find the "Re-parse schedule" link block:

```tsx
<div className="border-t border-gray-100 pt-5">
  <Link href="/setup" className="text-sm text-gray-500 underline">
    Re-parse schedule
  </Link>
</div>
```

Replace with:

```tsx
<div className="border-t border-gray-100 pt-5 flex flex-col gap-3">
  <Link href="/new-cycle" className="text-sm text-gray-500 underline">
    New food cycle
  </Link>
  <Link href="/setup" className="text-sm text-gray-500 underline">
    Re-parse schedule
  </Link>
</div>
```

- [ ] **Step 2: Final build check**

```bash
cd /Users/dan/Shipyard/tippal && npm run build
```

Expected: `/new-cycle` in route list, zero errors across all 15+ pages.

- [ ] **Step 3: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat: F4 Task 5 — New food cycle link in Settings"
```

- [ ] **Step 4: Apply Supabase migration**

Before deploying, apply the migration in the Supabase dashboard:

1. Go to Supabase dashboard → SQL editor
2. Run the contents of `supabase/migrations/20260625_new_cycle.sql`:
   ```sql
   ALTER TABLE families
     ADD COLUMN IF NOT EXISTS previous_cycles JSONB NOT NULL DEFAULT '[]'::jsonb,
     ADD COLUMN IF NOT EXISTS visit_number TEXT;
   ```
3. Confirm no error

- [ ] **Step 5: Deploy to production**

```bash
vercel --prod
```

- [ ] **Step 6: Smoke check**

```bash
curl -s -o /dev/null -w "%{http_code}" https://tippal.behrman.dev/daily
curl -s -o /dev/null -w "%{http_code}" https://tippal.behrman.dev/new-cycle
curl -s -o /dev/null -w "%{http_code}" https://tippal.behrman.dev/settings
```

All three must return 200.

- [ ] **Step 7: Final commit (report file)**

Write the task report to `/Users/dan/Shipyard/tippal/.superpowers/sdd/task-5-f4-report.md` with:
- Status (DONE / DONE_WITH_CONCERNS / BLOCKED)
- All commit SHAs
- Build result
- Migration applied: yes / pending
- Smoke check results
- Any concerns

```bash
git add .superpowers/sdd/task-5-f4-report.md 2>/dev/null || true
git commit -m "feat: F4 complete — New Food Cycle flow deployed"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ "New Food Cycle" option in Settings → Task 5
- ✅ Confirmation warning before overwrite → Task 4 (amber warning box)
- ✅ Re-parse flow → Task 3 (paste + parse identical to /setup)
- ✅ Review screen calls out new/changed → Task 4 (diff badges)
- ✅ On confirm: all foods replaced, week/day reset to 1/1, visit number set → Task 1 (`archiveAndStartNewCycle`)
- ✅ Visit number in UI near appointment date → Task 2
- ✅ Previous cycle archived in Supabase → Task 1 (`previous_cycles` JSONB)
- ✅ Auto-populates appointment date from parsed plan → Task 1 + Task 3
- ✅ Appointment-day card replaces dose sections → Task 2
- ✅ History navigation still works on appointment day → Task 2 (card only shows when `isCurrentTreatmentDay`)

**Confirmed spec deviations (owner-approved):**
- BRIEF said "maintenance foods never wiped — additive only." Owner overrode: all food categories replace entirely. The new plan of care is exhaustive.

**BRIEF constraint: all tasks note that `previous_cycles` is not surfaced in UI in Phase 3** — nothing in this plan builds a history UI. Archive only.
