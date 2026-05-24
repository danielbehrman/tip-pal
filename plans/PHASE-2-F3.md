# Implementation Plan — Phase 2 / F3: Appointment Date Entry and Buffer Day Display

**Status:** Ready for Dev  
**Date:** 2026-05-24  
**Depends on:** F1 (Supabase foundation), F2 (Auth)  
**F4 dependency note:** F4 is not yet built. No `dose_log` rows exist. Buffer display must be hidden — not errored — when no Day-7 anchor row is found. This is handled by treating `anchorDate = null` as a hard hide condition.

---

## 1. SQL Migration

Run this migration in the Supabase SQL editor (or via a migration file). The `families` table already exists with RLS enabled.

```sql
-- Add the appointment date column
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS next_appointment_date date;

-- RLS: existing SELECT policy already covers anon/authenticated reads on families.
-- An UPDATE policy for authenticated users is required. Check whether one exists:
--
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'families';
--
-- If no UPDATE policy exists, add:
CREATE POLICY "Authenticated users can update their own family"
  ON families
  FOR UPDATE
  USING (
    id = (
      SELECT family_id FROM profiles
      WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    id = (
      SELECT family_id FROM profiles
      WHERE id = auth.uid()
    )
  );
```

**RLS audit note:** The SELECT policy on `families` was set up in F1. F3 needs UPDATE. The USING + WITH CHECK above scope the update to only the row whose `id` matches the authenticated user's `family_id` — a parent cannot update another family's record. Dev must verify no UPDATE policy already exists before running; duplicate policies are an error in Postgres.

---

## 2. `lib/supabase.ts` Additions

Add three exported async functions. Place them after `saveDoseState`.

### 2a. `fetchAppointmentDate`

```typescript
export async function fetchAppointmentDate(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("next_appointment_date")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return data.next_appointment_date as string | null
}
```

Returns the raw ISO date string (`"YYYY-MM-DD"`) stored in Postgres, or `null` if unset. The date column type is `date`, which Supabase returns as a plain string — no timestamp parsing needed.

### 2b. `saveAppointmentDate`

```typescript
export async function saveAppointmentDate(date: string | null): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ next_appointment_date: date })
    .eq("id", familyId)
  if (error) throw error
}
```

Accepts a `"YYYY-MM-DD"` string or `null` (to clear the date). Uses `update` not `upsert` — the `families` row already exists (created at F1 provisioning time). Does not touch any other column.

### 2c. `fetchLastDay7Completion`

```typescript
export async function fetchLastDay7Completion(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("completed_at")
    .eq("family_id", familyId)
    .eq("day", 7)
    .eq("is_skipped", false)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return data.completed_at as string
}
```

Returns the ISO timestamp string of the most recent Day-7 non-skipped completion, or `null` if no such row exists. Uses `.maybeSingle()` — zero rows is a valid state, not an error. While F4 is unbuilt, this will always return `null`; the buffer display will remain hidden.

---

## 3. `lib/schedule.ts` Addition — Buffer Calculation

Add a pure exported function at the bottom of `lib/schedule.ts`. No new file needed — this is schedule-domain logic.

```typescript
/**
 * Calculate buffer days between the day after a Day-7 completion and the day
 * before an appointment.
 *
 * @param appointmentDateStr  ISO date string "YYYY-MM-DD" (from Supabase date column)
 * @param anchorTimestamp     ISO timestamp string (completed_at of last Day-7 log row),
 *                            or null if no Day-7 has been completed yet
 * @returns
 *   { kind: "hidden" }                  — no appointment date, or no anchor date
 *   { kind: "past" }                    — appointment date is today or in the past
 *   { kind: "days"; count: number }     — buffer day count (may be 0 or negative pre-check)
 */
export type BufferResult =
  | { kind: "hidden" }
  | { kind: "past" }
  | { kind: "days"; count: number }

export function calculateBuffer(
  appointmentDateStr: string | null,
  anchorTimestamp: string | null
): BufferResult {
  // Hide if either input is absent
  if (!appointmentDateStr || !anchorTimestamp) {
    return { kind: "hidden" }
  }

  // Parse appointment as a local-midnight date to avoid timezone shifts
  // "YYYY-MM-DD" split avoids Date.parse UTC interpretation
  const [apptYear, apptMonth, apptDay] = appointmentDateStr.split("-").map(Number)
  const apptDate = new Date(apptYear, apptMonth - 1, apptDay) // local midnight

  // Today at local midnight
  const today = new Date()
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  // Appointment in the past (or today — today is the day of the appointment, not a buffer day)
  if (apptDate <= todayMidnight) {
    return { kind: "past" }
  }

  // Anchor: the completed_at timestamp of the last Day-7 log row
  // Parse as UTC timestamp (ISO string from Supabase), then normalize to local midnight
  const anchorRaw = new Date(anchorTimestamp)
  const anchorMidnight = new Date(
    anchorRaw.getFullYear(),
    anchorRaw.getMonth(),
    anchorRaw.getDate()
  )

  // Buffer window: day after anchor → day before appointment
  // Start = anchor + 1 day
  const bufferStart = new Date(anchorMidnight)
  bufferStart.setDate(bufferStart.getDate() + 1)

  // End (exclusive) = appointment day itself
  // Days = (apptDate - bufferStart) / msPerDay
  const MS_PER_DAY = 1000 * 60 * 60 * 24
  const count = Math.round((apptDate.getTime() - bufferStart.getTime()) / MS_PER_DAY)

  // count < 0 means appointment is before the anchor+1 — data integrity issue, treat as past
  if (count < 0) {
    return { kind: "past" }
  }

  return { kind: "days", count }
}
```

**Why `Math.round` not `Math.floor`:** DST transitions can cause a day boundary to be off by one hour, making a full calendar day come out as 0.958 days. `Math.round` corrects this without introducing an off-by-one in the normal case. The anchor-to-appointment range spans multiple days in all real uses; rounding 1ms of DST drift is safe.

**Timezone model:** The app has no timezone configuration; it runs in the user's local browser timezone. Appointment date is a plain date (no time), so it is parsed as local midnight. The `completed_at` anchor is a UTC ISO timestamp from Supabase — it is converted to local midnight before computing the delta. This matches the parent's local-day experience.

---

## 4. `app/daily/page.tsx` Changes

### 4a. New state variables

```typescript
const [appointmentDate, setAppointmentDate] = useState<string | null>(null)
const [anchorTimestamp, setAnchorTimestamp] = useState<string | null>(null)
```

### 4b. Import additions

```typescript
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  fetchAppointmentDate,
  saveAppointmentDate,
  fetchLastDay7Completion,
  getSession,
} from "@/lib/supabase"
```

### 4c. `load()` effect — fetch on mount

Inside the existing `load()` async function, after `setDoseState(...)`, add:

```typescript
const [apptDate, anchorTs] = await Promise.all([
  fetchAppointmentDate(),
  fetchLastDay7Completion(),
])
setAppointmentDate(apptDate)
setAnchorTimestamp(anchorTs)
```

Both calls can run in parallel since they are independent. Wrap in the existing `try/catch` — on error, both state values remain `null`, which safely hides the buffer display.

### 4d. Debounced save handler

Add this handler in the component body, after `handleStateChange`:

```typescript
const appointmentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

function handleAppointmentChange(value: string) {
  const normalized = value.trim() === "" ? null : value
  setAppointmentDate(normalized)
  if (appointmentDebounceRef.current) {
    clearTimeout(appointmentDebounceRef.current)
  }
  appointmentDebounceRef.current = setTimeout(async () => {
    try {
      await saveAppointmentDate(normalized)
    } catch {
      // Save failed silently — value is still in local state.
      // Server state wins on next refresh (consistent with existing pattern).
    }
  }, 300)
}
```

Add `useRef` to the existing React import.

### 4e. Pass new props to DailyView

```tsx
return (
  <DailyView
    schedule={schedule}
    doseState={doseState}
    onStateChange={handleStateChange}
    appointmentDate={appointmentDate}
    anchorTimestamp={anchorTimestamp}
    onAppointmentChange={handleAppointmentChange}
  />
)
```

---

## 5. `components/DailyView.tsx` Changes

### 5a. New imports

```typescript
import { calculateBuffer } from "@/lib/schedule"
```

### 5b. Extended props interface

```typescript
interface DailyViewProps {
  schedule: ParsedSchedule
  doseState: DoseState
  onStateChange: (state: DoseState) => void
  appointmentDate: string | null
  anchorTimestamp: string | null
  onAppointmentChange: (value: string) => void
}
```

### 5c. Buffer calculation (inside component body, before JSX)

```typescript
const bufferResult = calculateBuffer(appointmentDate, anchorTimestamp)
```

This is a pure function call — no effect, no async, no state. Recalculates on every render; input values only change on load or user edit.

### 5d. JSX placement

Insert the appointment/buffer block between the Week/Day controls (`</div>` closing the `flex gap-6` row) and the `<MorningSection>` call. Exact insertion point in the current JSX: after line 108 (the `</div>` that closes the week/day controls block) and before `<MorningSection`.

```tsx
{/* Appointment date + buffer display */}
<div className="mb-4">
  <label className="block text-sm text-gray-500 mb-1" htmlFor="next-appointment">
    Next appointment
  </label>
  <input
    id="next-appointment"
    type="date"
    className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full"
    value={appointmentDate ?? ""}
    onChange={(e) => onAppointmentChange(e.target.value)}
  />

  {bufferResult.kind === "days" && (
    <p className="mt-2 text-sm text-gray-600">
      {bufferResult.count} buffer day{bufferResult.count !== 1 ? "s" : ""} before appointment
    </p>
  )}

  {bufferResult.kind === "past" && (
    <p className="mt-2 text-sm text-amber-700 font-medium">
      Appointment date has passed — please update
    </p>
  )}

  {/* bufferResult.kind === "hidden" → renders nothing */}
</div>
```

No wrapper conditional around the `<input>` — the input is always shown so parents can enter a date at any time. Only the buffer line is conditional.

---

## 6. Edge Cases

| Scenario | Behavior |
|---|---|
| No appointment date set | `calculateBuffer` returns `{ kind: "hidden" }`. Buffer line not rendered. Input is empty. |
| Appointment date in past or today | `calculateBuffer` returns `{ kind: "past" }`. Amber warning shown. Input remains editable. |
| No Day-7 anchor row (F4 not built yet) | `anchorTimestamp` is `null`. `calculateBuffer` returns `{ kind: "hidden" }`. Buffer line hidden regardless of appointment date. |
| Supabase save fails on appointment change | Debounced handler swallows the error. Local state retains the user's typed value. On next hard refresh, server state (last successful save) is loaded — consistent with the pattern used for `saveDoseState`. |
| Both parents edit appointment simultaneously | Last write wins. No optimistic lock. `families` has one row per family; `update` on the same row is a last-writer-wins conflict. Acceptable for MVP — appointment date changes are infrequent and the value is identical for both parents. |
| Appointment date cleared (input emptied) | `value.trim() === ""` normalizes to `null`. `saveAppointmentDate(null)` writes `NULL` to Postgres. On reload, `fetchAppointmentDate` returns `null`. Buffer hidden. |
| `completed_at` timestamp in a DST-transition hour | `Math.round` in `calculateBuffer` absorbs a ±1 hour DST shift without flipping the day count. |
| `count === 0` (appointment is tomorrow) | Returns `{ kind: "days", count: 0 }`. Displays "0 buffer days before appointment." This is correct — zero buffer days means the appointment is the next calendar day. Not treated as "past." |
| Appointment date same day as anchor | `bufferStart` = anchor + 1 day. If that equals the appointment date, `count = 0`. Displays "0 buffer days." Correct. |

---

## 7. Ordering Constraints

1. **SQL migration runs before any code is deployed.** `saveAppointmentDate` calls `update` on a column that must exist. Run the migration and confirm `next_appointment_date` column is present in Supabase before pushing code.

2. **RLS UPDATE policy confirmed before testing.** If the UPDATE policy is missing, `saveAppointmentDate` will silently return a Supabase RLS error (403). Dev must check `pg_policies` and apply the policy in step 1 if absent.

3. **`calculateBuffer` is a pure function — no Supabase dependency.** It can be unit-tested independently before any Supabase wiring.

4. **`fetchLastDay7Completion` will always return `null` until F4 is built.** This is correct and expected. Buffer display is hidden. No special pre-F4 behavior needed.

5. **No changes to `ParsedSchedule`, `DoseState`, or any existing function signatures.** All additions are additive.

6. **Debounce ref cleanup:** The `useRef`-based debounce does not need an explicit `useEffect` cleanup because the 300ms timer resolves before any realistic unmount scenario (navigation away). No cleanup effect required.

---

## File Change Summary

| File | Change type | Description |
|---|---|---|
| Supabase SQL | New migration | Add `next_appointment_date date` column; add UPDATE RLS policy |
| `lib/supabase.ts` | Additions | `fetchAppointmentDate`, `saveAppointmentDate`, `fetchLastDay7Completion` |
| `lib/schedule.ts` | Addition | `calculateBuffer` pure function + `BufferResult` type |
| `app/daily/page.tsx` | Additions | Two new state vars, two new fetches in `load()`, debounced save handler, three new props to DailyView, `useRef` import |
| `components/DailyView.tsx` | Additions | Three new props, `calculateBuffer` call, appointment input + buffer display JSX block |

No new files. No changes to existing function signatures. No changes to routing.
