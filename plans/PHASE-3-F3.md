# Phase 3 F3 — Recommended Foods + Medications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse, review/edit, and display recommended foods and medications from the plan of care, with a per-food weekly tally counter (tap to increment/decrement) against each recommended food's target frequency.

**Architecture:** Two new optional `ParsedSchedule` arrays (`recommendedFoods`, `medications`) populated by an extended Claude parser prompt. A new `dose_state.recommended_food_counts` JSONB column (week number → food name → count) tracks weekly tallies, following the exact pattern already used by `completed_days` on that same table — week-reset is free because a new week is just an absent map key. A new `/recommended` page displays both categories; recommended foods get the counter, medications are purely informational.

**Tech Stack:** Next.js (App Router), Supabase (Postgres), TypeScript, Anthropic Claude API. No test runner in this repo — verification is `npx tsc --noEmit` plus manual walkthroughs, consistent with prior phases.

## Global Constraints

- `ParsedSchedule.recommendedFoods`/`medications` are **optional** fields — existing stored schedules predate this and must load without crashing.
- Every *new* parse always populates both as arrays (empty if none found) — never omitted.
- The counter is a per-protocol-week tally (not calendar week), reusing the existing `getCalendarPosition` derivation from F0.1 — no new date-boundary logic.
- The counter write path (`saveRecommendedFoodCounts`) must never write `cycle_start_date`/`skip_count`/`current_week`/`current_day`/`floor_week`/`floor_day` — preserves the locked navigation-never-writes-position architecture.
- `frequencyPerWeek` is a string (e.g. `"3-5"`), displayed verbatim — never parsed numerically.
- Medications get no counter — informational only.
- App name in any new UI copy: "Tip Pal" (not "TIP Pal") per project CLAUDE.md.

---

### Task 1: Database Migration — `recommended_food_counts`

**Files:**
- Create: `supabase/migrations/20260623_recommended_food_counts.sql`

**Interfaces:**
- Produces: `dose_state.recommended_food_counts` (jsonb, NOT NULL DEFAULT `'{}'::jsonb`)

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260623_recommended_food_counts.sql
-- Phase 3 F3: weekly tally counter for recommended foods.

ALTER TABLE dose_state
  ADD COLUMN IF NOT EXISTS recommended_food_counts jsonb NOT NULL DEFAULT '{}'::jsonb;
```

- [ ] **Step 2: Run it against production via the Supabase CLI** (show the controller/Project Owner the exact SQL first, per established practice this session — do not run without that confirmation)

```bash
supabase db query --file supabase/migrations/20260623_recommended_food_counts.sql --linked --yes
```

- [ ] **Step 3: Verify**

```bash
set -a && source .env.local && set +a
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/dose_state?select=family_id,recommended_food_counts" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | python3 -m json.tool
```

Expected: the existing family's row shows `recommended_food_counts: {}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260623_recommended_food_counts.sql
git commit -m "feat: add recommended_food_counts to dose_state"
```

---

### Task 2: Types — `RecommendedFood`, `Medication`, Schema Additions

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Produces: `RecommendedFood`, `Medication` interfaces; `ParsedSchedule.recommendedFoods?`, `ParsedSchedule.medications?`; `DoseState.recommendedFoodCounts?: Record<string, Record<string, number>>`

- [ ] **Step 1: Add the new interfaces and extend existing ones**

In `lib/types.ts`, add after `TreatmentFood`:

```ts
export interface RecommendedFood {
  name: string
  dose: number
  unit: string
  frequencyPerWeek: string
}

export interface Medication {
  name: string
  dose: string
  unit: string
  frequency: string
}
```

Replace the `ParsedSchedule` interface:

```ts
export interface ParsedSchedule {
  maintenanceFoods: MaintenanceFood[]
  weeklyFoods: WeeklyFood[]
  treatmentFoods: TreatmentFood[]
  recommendedFoods?: RecommendedFood[]
  medications?: Medication[]
}
```

Add `recommendedFoodCounts?: Record<string, Record<string, number>>` to `DoseState`:

```ts
export interface DoseState {
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `lib/types.ts` itself (other files referencing `ParsedSchedule`/`DoseState` are unaffected since these are additive optional fields).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add RecommendedFood/Medication types and schema fields"
```

---

### Task 3: Parser — Extend Claude Prompt for Recommended Foods + Medications

**Files:**
- Modify: `app/api/parse-schedule/route.ts`

**Interfaces:**
- Consumes: `RecommendedFood`, `Medication` from Task 2
- Produces: parser now requires `recommendedFoods`/`medications` arrays in every successful response

- [ ] **Step 1: Update the system prompt's schema block**

Replace the JSON schema block in `SYSTEM_PROMPT` (currently lines 34-49):

```ts
const SYSTEM_PROMPT = `You are a medical dosing schedule parser. Parse the provided text and return ONLY valid JSON with no explanation, no markdown, no code fences.

Return an object matching this exact schema:

{
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

Parsing rules:
- maintenanceFoods: foods given every morning. Set capped=true if the notes indicate a maximum or capped dose.
- weeklyFoods: foods given once per week (Sunday or Day 7 only). These appear in the morning section once a week.
- treatmentFoods: foods with a weekly dose escalation schedule. Each entry has a weeks array covering each week's dose.
- Set isFinal=true on a TreatmentWeek if the notes say "continue at final dose", "maintain at", "continue", or similar terminal language for that dose level. Only the last week entry should have isFinal=true.
- recommendedFoods: foods recommended at a target frequency that is NOT daily (e.g. "3-5x/week", "2-3 times weekly"). Set frequencyPerWeek to that range exactly as stated (e.g. "3-5"). These are distinct from maintenanceFoods (daily) and weeklyFoods (once per week, Day 7 only).
- medications: daily medications (e.g. Zyrtec, Flovent, antihistamines) — not food, not scenario kit / emergency medications. Set frequency to how often it's given (e.g. "once daily", "twice daily").
- If the text has no recommended foods or no medications, return an empty array for that field — never omit the field.
- Seeds (sesame seed, flax seed, etc.) must have prepNote set to "Crush before serving". This is a medical requirement.
- Any food with a specific preparation instruction must have that instruction in prepNote.
- If there is no prep note, set prepNote to null.
- dose must always be a number for maintenanceFoods, weeklyFoods, treatmentFoods, and recommendedFoods (not a string). medications dose is a string (e.g. "10mg", "1 tablet").
- All fields are required. Do not omit any field.`
```

- [ ] **Step 2: Update `isValidSchedule`**

Replace `isValidSchedule` (currently lines 62-70):

```ts
function isValidSchedule(obj: unknown): obj is ParsedSchedule {
  if (!obj || typeof obj !== "object") return false
  const s = obj as Record<string, unknown>
  return (
    Array.isArray(s.maintenanceFoods) &&
    Array.isArray(s.weeklyFoods) &&
    Array.isArray(s.treatmentFoods) &&
    Array.isArray(s.recommendedFoods) &&
    Array.isArray(s.medications)
  )
}
```

- [ ] **Step 3: Manual test against a real plan-of-care excerpt**

Run the dev server (`npm run dev`), go to Settings → Re-parse schedule (or `/setup`), paste a plan of care excerpt that includes at least one recommended food (e.g. "Blueberries, 3-5 times per week") and one medication (e.g. "Zyrtec 10mg daily"), submit, and confirm the API response includes non-empty `recommendedFoods`/`medications` arrays matching the input. Report the actual returned JSON in your report.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 5: Commit**

```bash
git add app/api/parse-schedule/route.ts
git commit -m "feat: parse recommendedFoods and medications from plan of care"
```

---

### Task 4: `lib/supabase.ts` — Read/Write `recommendedFoodCounts`

**Files:**
- Modify: `lib/supabase.ts` (`fetchDoseState`, `saveDoseState`)
- Create: `saveRecommendedFoodCounts` in `lib/supabase.ts`

**Interfaces:**
- Produces: `fetchDoseState()` returns `recommendedFoodCounts`; `saveRecommendedFoodCounts(counts: Record<string, Record<string, number>>): Promise<void>`

- [ ] **Step 1: Update `fetchDoseState`**

Replace `lib/supabase.ts:64-88`:

```ts
export async function fetchDoseState(): Promise<DoseState | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_state")
    .select("checked_foods, completed_days, morning_skipped, evening_skipped, cycle_start_date, skip_count, floor_week, floor_day, recommended_food_counts")
    .eq("family_id", familyId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const cycleStartDate = data.cycle_start_date as string
  const skipCount = (data.skip_count as number) ?? 0
  const { week, day } = getCalendarPosition(cycleStartDate, skipCount)
  return {
    currentWeek: week,
    currentDay: day,
    checkedFoods: data.checked_foods as Record<string, boolean>,
    completedDays: (data.completed_days ?? {}) as Record<string, Record<string, boolean>>,
    morningSkipped: data.morning_skipped ?? false,
    eveningSkipped: data.evening_skipped ?? false,
    cycleStartDate,
    skipCount,
    floorWeek: (data.floor_week as number) ?? 1,
    floorDay: (data.floor_day as number) ?? 1,
    recommendedFoodCounts: (data.recommended_food_counts ?? {}) as Record<string, Record<string, number>>,
  }
}
```

- [ ] **Step 2: Update `saveDoseState`**

In the upsert payload inside `saveDoseState` (`lib/supabase.ts:434-...`), add one field:

```ts
recommended_food_counts: state.recommendedFoodCounts ?? {},
```

(Insert it alongside the existing `floor_week`/`floor_day` lines in the upsert object.)

- [ ] **Step 3: Add `saveRecommendedFoodCounts`**

Add near `saveCheckedState`:

```ts
export async function saveRecommendedFoodCounts(
  counts: Record<string, Record<string, number>>
): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_state")
    .update({
      recommended_food_counts: counts,
      updated_at: new Date().toISOString(),
    })
    .eq("family_id", familyId)
  if (error) throw error
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in files not yet updated (Task 5-7's targets) if any reference the now-required `recommendedFoodCounts`/new fields — but since the field is optional, expect no new errors at all from this task.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase.ts
git commit -m "feat: read/write recommended_food_counts in lib/supabase.ts"
```

---

### Task 5: Review Screen — Recommended Foods + Medications Sections

**Files:**
- Modify: `components/ScheduleReview.tsx`

**Interfaces:**
- Consumes: `RecommendedFood`, `Medication` from Task 2

- [ ] **Step 1: Add update handlers and two new sections**

In `components/ScheduleReview.tsx`, add two new updater functions alongside the existing ones (after `updateTreatmentFoodName`):

```ts
function updateRecommended(index: number, updated: RecommendedFood) {
  const foods = [...(schedule.recommendedFoods ?? [])]
  foods[index] = updated
  onScheduleChange({ ...schedule, recommendedFoods: foods })
}

function updateMedication(index: number, updated: Medication) {
  const meds = [...(schedule.medications ?? [])]
  meds[index] = updated
  onScheduleChange({ ...schedule, medications: meds })
}
```

Update the import line to include the new types:

```ts
import { ParsedSchedule, MaintenanceFood, WeeklyFood, TreatmentFood, TreatmentWeek, RecommendedFood, Medication } from "@/lib/types"
```

Add two new sections after the existing "Evening (treatment)" section, before the "Confirm & Save" button:

```tsx
{(schedule.recommendedFoods ?? []).length > 0 && (
  <section>
    <h2 className="text-lg font-bold mb-2">Recommended Foods</h2>
    {(schedule.recommendedFoods ?? []).map((food, i) => (
      <div key={i} className="flex flex-col gap-2 py-3 border-b border-gray-100 last:border-0">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex flex-col flex-1 min-w-32">
            <label className="text-xs text-gray-500 mb-0.5">Name</label>
            <input
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              value={food.name}
              onChange={(e) => updateRecommended(i, { ...food, name: e.target.value })}
            />
          </div>
          <div className="flex flex-col w-20">
            <label className="text-xs text-gray-500 mb-0.5">Dose</label>
            <input
              type="number"
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              value={food.dose}
              onChange={(e) => updateRecommended(i, { ...food, dose: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="flex flex-col w-20">
            <label className="text-xs text-gray-500 mb-0.5">Unit</label>
            <input
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              value={food.unit}
              onChange={(e) => updateRecommended(i, { ...food, unit: e.target.value })}
            />
          </div>
          <div className="flex flex-col w-24">
            <label className="text-xs text-gray-500 mb-0.5">Freq/week</label>
            <input
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              value={food.frequencyPerWeek}
              placeholder="3-5"
              onChange={(e) => updateRecommended(i, { ...food, frequencyPerWeek: e.target.value })}
            />
          </div>
        </div>
      </div>
    ))}
  </section>
)}

{(schedule.medications ?? []).length > 0 && (
  <section>
    <h2 className="text-lg font-bold mb-2">Medications</h2>
    {(schedule.medications ?? []).map((med, i) => (
      <div key={i} className="flex flex-col gap-2 py-3 border-b border-gray-100 last:border-0">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex flex-col flex-1 min-w-32">
            <label className="text-xs text-gray-500 mb-0.5">Name</label>
            <input
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              value={med.name}
              onChange={(e) => updateMedication(i, { ...med, name: e.target.value })}
            />
          </div>
          <div className="flex flex-col w-24">
            <label className="text-xs text-gray-500 mb-0.5">Dose</label>
            <input
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              value={med.dose}
              onChange={(e) => updateMedication(i, { ...med, dose: e.target.value })}
            />
          </div>
          <div className="flex flex-col w-20">
            <label className="text-xs text-gray-500 mb-0.5">Unit</label>
            <input
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              value={med.unit}
              onChange={(e) => updateMedication(i, { ...med, unit: e.target.value })}
            />
          </div>
          <div className="flex flex-col w-28">
            <label className="text-xs text-gray-500 mb-0.5">Frequency</label>
            <input
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              value={med.frequency}
              placeholder="once daily"
              onChange={(e) => updateMedication(i, { ...med, frequency: e.target.value })}
            />
          </div>
        </div>
      </div>
    ))}
  </section>
)}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add components/ScheduleReview.tsx
git commit -m "feat: add recommended foods and medications sections to review screen"
```

---

### Task 6: New `/recommended` Page and Display Component

**Files:**
- Create: `app/recommended/page.tsx`
- Create: `components/RecommendedFoodsView.tsx`

**Interfaces:**
- Consumes: `fetchSchedule`, `fetchDoseState`, `saveRecommendedFoodCounts`, `getSession` from `lib/supabase.ts`; `RecommendedFood`, `Medication` from `lib/types.ts`

- [ ] **Step 1: Create `components/RecommendedFoodsView.tsx`**

```tsx
"use client"

import { RecommendedFood, Medication } from "@/lib/types"

interface RecommendedFoodsViewProps {
  recommendedFoods: RecommendedFood[]
  medications: Medication[]
  counts: Record<string, number>
  onIncrement: (foodName: string) => void
  onDecrement: (foodName: string) => void
}

export default function RecommendedFoodsView({
  recommendedFoods,
  medications,
  counts,
  onIncrement,
  onDecrement,
}: RecommendedFoodsViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-lg font-bold mb-1">Recommended Foods</h2>
        <p className="text-xs text-gray-500 mb-2">Not daily — tap when given to track this week&apos;s progress</p>
        {recommendedFoods.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-3">No recommended foods in the current plan of care.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {recommendedFoods.map((food) => {
              const count = counts[food.name] ?? 0
              return (
                <div key={food.name} className="flex items-center justify-between py-3 gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-medium truncate">{food.name}</div>
                    <div className="text-sm text-gray-700">{food.dose} {food.unit}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onDecrement(food.name)}
                      disabled={count === 0}
                      className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg text-lg font-bold disabled:opacity-30"
                    >
                      −
                    </button>
                    <button
                      onClick={() => onIncrement(food.name)}
                      className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold min-w-[88px]"
                    >
                      {count} / {food.frequencyPerWeek} this week
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold mb-2">Medications</h2>
        {medications.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-3">No medications in the current plan of care.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {medications.map((med) => (
              <div key={med.name} className="py-3">
                <div className="text-base font-medium">{med.name}</div>
                <div className="text-sm text-gray-700">{med.dose} {med.unit} — {med.frequency}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/recommended/page.tsx`**

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ParsedSchedule } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveRecommendedFoodCounts,
  getSession,
} from "@/lib/supabase"
import RecommendedFoodsView from "@/components/RecommendedFoodsView"

export default function RecommendedPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [currentWeek, setCurrentWeek] = useState<number | null>(null)
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
  const [hydrated, setHydrated] = useState(false)

  const countsRef = useRef<Record<string, Record<string, number>>>({})
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
        const s = await fetchSchedule()
        if (!s) {
          router.replace("/setup")
          return
        }
        const ds = await fetchDoseState()
        if (!ds) {
          router.replace("/setup")
          return
        }
        setSchedule(s)
        setCurrentWeek(ds.currentWeek)
        const initialCounts = ds.recommendedFoodCounts ?? {}
        setCounts(initialCounts)
        countsRef.current = initialCounts
        setHydrated(true)
      } catch {
        router.replace("/setup")
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function adjustCount(foodName: string, delta: number) {
    if (!hydrated || currentWeek === null) return
    const weekKey = String(currentWeek)
    setCounts(prev => {
      const weekCounts = { ...(prev[weekKey] ?? {}) }
      const next = Math.max(0, (weekCounts[foodName] ?? 0) + delta)
      weekCounts[foodName] = next
      const updated = { ...prev, [weekKey]: weekCounts }
      countsRef.current = updated
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
      saveDebounceRef.current = setTimeout(() => {
        saveRecommendedFoodCounts(countsRef.current).catch(() => {})
      }, 150)
      return updated
    })
  }

  if (!schedule || currentWeek === null) return null

  const weekKey = String(currentWeek)
  const weekCounts = counts[weekKey] ?? {}

  return (
    <main className="max-w-lg mx-auto px-4 py-6 min-h-screen flex flex-col">
      <div className="mb-6">
        <Link href="/daily" className="text-sm text-gray-400 underline">← Daily view</Link>
        <h1 className="text-2xl font-bold mt-3">Recommended Foods &amp; Medications</h1>
      </div>

      <RecommendedFoodsView
        recommendedFoods={schedule.recommendedFoods ?? []}
        medications={schedule.medications ?? []}
        counts={weekCounts}
        onIncrement={(name) => adjustCount(name, 1)}
        onDecrement={(name) => adjustCount(name, -1)}
      />
    </main>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/recommended/page.tsx components/RecommendedFoodsView.tsx
git commit -m "feat: add /recommended page with weekly tally counter"
```

---

### Task 7: Link from Daily View

**Files:**
- Modify: `components/DailyView.tsx`

- [ ] **Step 1: Add the nav link**

In `components/DailyView.tsx`, in the bottom-nav `<div className="flex justify-center gap-6 pb-4">` block (currently lines 232-238), add a third link:

```tsx
<div className="flex justify-center gap-6 pb-4">
  <Link href="/recommended" className="text-sm text-gray-400 underline">
    Recommended
  </Link>
  <Link href="/history" className="text-sm text-gray-400 underline">
    Dose history
  </Link>
  <Link href="/settings" className="text-sm text-gray-400 underline">
    Settings
  </Link>
</div>
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: zero errors, successful static export of the new `/recommended` route alongside existing routes.

- [ ] **Step 3: Commit**

```bash
git add components/DailyView.tsx
git commit -m "feat: link Recommended Foods page from daily view"
```

---

## Self-Review

**Spec coverage:**
- Parser outputs all 5 categories → Task 3. Covered.
- Recommended foods on a separate info screen, not daily view → Task 6. Covered.
- Medications on the same screen → Task 6. Covered.
- Review screen shows all categories before confirm, inline editing → Task 5. Covered.
- Weekly frequency counter, tap to increment, target range display → Task 6 (`RecommendedFoodsView`). Covered.
- Counter resets on protocol week, not calendar week → Task 6 (`weekKey = String(currentWeek)`, `currentWeek` from the existing calendar-anchored `fetchDoseState`). Covered.
- Counter supports decrement/undo → Task 6 (`adjustCount` with `delta`, `−` button disabled at 0). Covered.
- Old stored schedules without these fields don't crash → Task 2 (optional fields) + Task 6 (`?? []` fallbacks throughout). Covered.
- Navigation/counter writes never touch position fields → Task 4 (`saveRecommendedFoodCounts` only touches `recommended_food_counts`). Covered.

**Placeholder scan:** No TBD/TODO; every step has complete code.

**Type consistency:** `RecommendedFood`/`Medication` (Task 2) used identically in the parser route (Task 3), `ScheduleReview.tsx` (Task 5), and `RecommendedFoodsView.tsx`/`app/recommended/page.tsx` (Task 6). `recommendedFoodCounts: Record<string, Record<string, number>>` shape consistent across `lib/types.ts`, `lib/supabase.ts`, and the new page.

---

## Execution Handoff

Plan complete and saved to `plans/PHASE-3-F3.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
