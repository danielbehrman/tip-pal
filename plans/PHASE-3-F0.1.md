# Phase 3 F0.1 — Calendar-Anchored Day Dating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace completion-gated day advancement with calendar-anchored advancement — Day 1 is the day the protocol started, position auto-advances daily by default with a non-blocking warning if the prior day was incomplete, and an explicit Skip Day action is the only thing that freezes position.

**Architecture:** Position becomes a pure function of two new `dose_state` fields — `cycle_start_date` (date) and `skip_count` (integer) — computed live wherever needed, never advanced by a write-on-load or write-on-timer path. `current_week`/`current_day` columns remain in the schema for human-debug visibility only; the application never reads them again. Skip Day reuses the existing `dose_log` shape (`session:'day', is_skipped:true`) for its audit trail — no new table.

**Tech Stack:** Next.js (App Router), Supabase (Postgres, no migrations CLI in this repo — schema changes applied via SQL run manually in the Supabase SQL editor, consistent with prior phases), TypeScript. No test runner is configured in this repo (no Jest/Vitest) — per project ground rules (no scope beyond the ticket, no unrequested tooling), this plan verifies pure date/position functions with a small standalone Node script (`node`, no compiler), not a new framework.

## Global Constraints

- Navigation (`handleStateChange`, Day ±/Week ± UI handlers) must never write `cycle_start_date`, `skip_count`, `current_week`, or `current_day` — only onboarding, Settings, Skip Day, and the one-time migration may write them. (Locked architecture rule, see `docs/superpowers/specs/2026-06-20-calendar-anchored-day-dating-design.md`.)
- `cycle_start_date` stored/compared as a `YYYY-MM-DD` date string, never a timestamp — avoids local/UTC drift, consistent with existing `appointmentDateStr` handling.
- No personal names in code. New UI copy uses "Tip Pal" casing per CLAUDE.md (existing UI strings are out of scope for this ticket).
- App name in any new user-facing copy: "Tip Pal".
- `calculateBuffer()` keeps its existing `BufferResult` return shape (`hidden`/`past`/`days`/`behind`) — only its internal computation changes.

---

## Design Note: Day ±/Week ± Navigation and Repeated Positions

Skip Day causes a position to be visited by two different calendar dates (the skipped day, then its repeat). Position-based Day ±/Week ± navigation (unchanged from F0 — it steps `week`/`day` numbers, not calendar dates) therefore cannot disambiguate "which visit" of a repeated position to show by position alone.

**Resolution:** `fetchDayRecords()` (Task 4) returns one record per `week-day` key, keeping the **most recent** `completed_at` when a position has multiple dose_log rows — consistent with the existing dedup convention already used by `fetchCompletedDayDates`. This means if a skipped day is later superseded by a completion at the repeated position, Day-by-day browsing shows the completion, not the earlier skip. The skip is never lost — it remains visible in the full chronological Dose History (F7), which lists every row by date regardless of position. This keeps Daily View browsing simple (still position-based, no rewrite of navigation to be date-based) while preserving the full audit trail elsewhere.

---

### Task 1: Database Migration — `cycle_start_date` and `skip_count`

**Files:**
- Create: `supabase/migrations/20260620_calendar_anchored_dating.sql`

**Interfaces:**
- Produces: `dose_state.cycle_start_date` (date, NOT NULL after backfill), `dose_state.skip_count` (integer, NOT NULL DEFAULT 0)

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260620_calendar_anchored_dating.sql
-- Phase 3 F0.1: Calendar-Anchored Day Dating

ALTER TABLE dose_state
  ADD COLUMN IF NOT EXISTS cycle_start_date date,
  ADD COLUMN IF NOT EXISTS skip_count integer NOT NULL DEFAULT 0;

-- One-time backfill for any existing rows (production: single family, already
-- mid-protocol). Backdates cycle_start_date from the currently stored
-- current_week/current_day so today maps to the account's real position.
UPDATE dose_state
SET cycle_start_date = (
  CURRENT_DATE - (((current_week - 1) * 7 + (current_day - 1)))
)
WHERE cycle_start_date IS NULL;

ALTER TABLE dose_state
  ALTER COLUMN cycle_start_date SET NOT NULL;
```

- [ ] **Step 2: Run it against production via the Supabase SQL editor**

Open the Supabase dashboard SQL editor for this project and run the script above. Confirm no errors.

- [ ] **Step 3: Verify the backfill**

```bash
set -a && source .env.local && set +a
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/dose_state?select=family_id,current_week,current_day,cycle_start_date,skip_count" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | python3 -m json.tool
```

Expected: the existing family's row now has `cycle_start_date` set and `skip_count: 0`. Manually sanity-check: `cycle_start_date` plus `(current_week-1)*7+(current_day-1)` days should equal today's date.

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/migrations/20260620_calendar_anchored_dating.sql
git commit -m "feat: add cycle_start_date and skip_count to dose_state"
```

**Production note (recorded after actually running this against the live project):** the backfill UPDATE above using `CURRENT_DATE` is timezone-ambiguous — Postgres's `CURRENT_DATE` evaluates in UTC, not the family's local day. Running it as written produced `cycle_start_date = 2026-06-07`, computed against UTC's date at execution time. Cross-checked against the production family's actual stored timezone (`profiles.reminder_timezone = 'America/New_York'`, evaluated at run time) — this happened to be correct (UTC's date matched NY's date at the moment this ran), but it was luck, not by construction. **For any future one-time backfill against a real family's row, compute the family's local date explicitly from their `reminder_timezone` first, and use that literal date in the `UPDATE`, rather than trusting `CURRENT_DATE`.** This doesn't affect the live application going forward — `lib/schedule.ts`'s `todayDateString()` always uses the browser's local `Date()`, so there's no UTC-mismatch risk once a family is using the app normally; the risk is specific to server-side one-time SQL migrations standing in for "today" without a browser present.

---

### Task 2: Core Date/Position Formulas in `lib/schedule.ts`

**Files:**
- Modify: `lib/schedule.ts`
- Create: `scripts/verify-position-formula.js` (throwaway manual verification, no framework)

**Interfaces:**
- Produces: `MS_PER_DAY`, `parseDateOnly(s: string): Date`, `formatDateOnly(d: Date): string`, `todayDateString(): string`, `addDays(dateStr: string, n: number): string`, `positionIndexOf(week: number, day: number): number`, `positionFromIndex(index: number): { week: number; day: number }`, `getCalendarPosition(cycleStartDate: string, skipCount: number): { week: number; day: number }`, `cycleStartDateForPosition(week: number, day: number): string`, `projectedDateForPosition(cycleStartDate: string, skipCount: number, week: number, day: number): string`

- [ ] **Step 1: Write the verification script (acts as the failing test)**

```js
// scripts/verify-position-formula.js
// Manual regression check for the calendar-position formula (no test framework in this repo).
// Run: node scripts/verify-position-formula.js

const MS_PER_DAY = 1000 * 60 * 60 * 24

function parseDateOnly(s) {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}
function formatDateOnly(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
function addDays(dateStr, n) {
  const d = parseDateOnly(dateStr)
  d.setDate(d.getDate() + n)
  return formatDateOnly(d)
}
function positionIndexOf(week, day) {
  return (week - 1) * 7 + (day - 1)
}
function positionFromIndex(index) {
  return { week: Math.floor(index / 7) + 1, day: (index % 7) + 1 }
}
function getCalendarPosition(cycleStartDate, skipCount, asOfDateStr) {
  const start = parseDateOnly(cycleStartDate)
  const asOf = parseDateOnly(asOfDateStr)
  const dayIndex = Math.round((asOf.getTime() - start.getTime()) / MS_PER_DAY)
  const positionIndex = Math.max(0, dayIndex - skipCount)
  return positionFromIndex(positionIndex)
}

let failures = 0
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures++
    console.error(`FAIL ${label}: expected ${e}, got ${a}`)
  } else {
    console.log(`PASS ${label}`)
  }
}

// cycle_start_date = 2026-01-01 (Day 1). No skips.
assertEqual(getCalendarPosition("2026-01-01", 0, "2026-01-01"), { week: 1, day: 1 }, "day 1, no skip")
assertEqual(getCalendarPosition("2026-01-01", 0, "2026-01-08"), { week: 2, day: 1 }, "day 8 rolls to week 2 day 1")
assertEqual(getCalendarPosition("2026-01-01", 0, "2026-01-07"), { week: 1, day: 7 }, "day 7 stays week 1")

// Spec example: cycle starts such that 2026-06-13 (Sat) = Week 3, Day 2 (positionIndex 15).
// cycle_start_date = 2026-06-13 - 15 days = 2026-05-29.
const start = "2026-05-29"
assertEqual(getCalendarPosition(start, 0, "2026-06-13"), { week: 3, day: 2 }, "Saturday pre-skip = W3D2")
// Skip happens on Saturday (2026-06-13) -> skip_count becomes 1 from Sunday onward.
assertEqual(getCalendarPosition(start, 1, "2026-06-14"), { week: 3, day: 2 }, "Sunday repeats W3D2 after skip")
assertEqual(getCalendarPosition(start, 1, "2026-06-15"), { week: 3, day: 3 }, "Monday advances to W3D3")

if (failures > 0) {
  console.error(`${failures} failure(s)`)
  process.exit(1)
}
console.log("All formula checks passed")
```

- [ ] **Step 2: Run it to confirm the formula is correct before wiring it into the app**

Run: `node scripts/verify-position-formula.js`
Expected: all `PASS` lines, exits 0. If anything fails, fix the formula in the script first — this is the spec for Step 3.

- [ ] **Step 3: Add the real functions to `lib/schedule.ts`**

Add near the top of the file, after the existing `import` line:

```ts
export const MS_PER_DAY = 1000 * 60 * 60 * 24

export function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export function formatDateOnly(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function todayDateString(): string {
  return formatDateOnly(new Date())
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDateOnly(dateStr)
  d.setDate(d.getDate() + n)
  return formatDateOnly(d)
}

export function positionIndexOf(week: number, day: number): number {
  return (week - 1) * 7 + (day - 1)
}

export function positionFromIndex(index: number): { week: number; day: number } {
  return { week: Math.floor(index / 7) + 1, day: (index % 7) + 1 }
}

/** Today's calendar-derived position. Never persisted by this function — callers decide whether to write it. */
export function getCalendarPosition(
  cycleStartDate: string,
  skipCount: number
): { week: number; day: number } {
  const start = parseDateOnly(cycleStartDate)
  const today = parseDateOnly(todayDateString())
  const dayIndex = Math.round((today.getTime() - start.getTime()) / MS_PER_DAY)
  const positionIndex = Math.max(0, dayIndex - skipCount)
  return positionFromIndex(positionIndex)
}

/** Inverse of getCalendarPosition — used by onboarding/Settings to re-anchor cycle_start_date from a chosen week/day, as of today. */
export function cycleStartDateForPosition(week: number, day: number): string {
  return addDays(todayDateString(), -positionIndexOf(week, day))
}

/** Forward projection — used by buffer calc to find the calendar date a future position (e.g. final week's Day 7) will fall on, assuming no further skips beyond skipCount. */
export function projectedDateForPosition(
  cycleStartDate: string,
  skipCount: number,
  week: number,
  day: number
): string {
  return addDays(cycleStartDate, positionIndexOf(week, day) + skipCount)
}
```

- [ ] **Step 4: Remove the dead `getTreatmentPosition` function**

Delete lines 41-48 of `lib/schedule.ts` (the unused `getTreatmentPosition(loggedPositions: Set<string>)` function) — it's dead code from the original, abandoned F0 plan, and its name is now easily confused with the new `getCalendarPosition`.

- [ ] **Step 5: Run the verification script again against the real exported functions**

Update `scripts/verify-position-formula.js` to import from the compiled output isn't practical pre-build — instead, run TypeScript directly via Node's strip-types support:

Run: `node --experimental-strip-types -e "
const s = require('./lib/schedule.ts');
console.log(s.getCalendarPosition('2026-05-29', 0));
"`

If `--experimental-strip-types` isn't available in the installed Node version, skip this step and rely on Step 2's standalone script (already verifies the algorithm) plus Task 9's `npm run build` typecheck to catch any transcription errors between the script and `lib/schedule.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/schedule.ts scripts/verify-position-formula.js
git commit -m "feat: add calendar-anchored position formulas to lib/schedule.ts"
```

---

### Task 3: Redesign `calculateBuffer`

**Files:**
- Modify: `lib/schedule.ts:14-33` (existing `calculateBuffer`)

**Interfaces:**
- Consumes: `parseDateOnly`, `projectedDateForPosition`, `MS_PER_DAY` from Task 2
- Produces: `calculateBuffer(appointmentDateStr: string | null, totalTreatmentWeeks: number, cycleStartDate: string | null, skipCount: number): BufferResult` (signature changed — two new required params)

- [ ] **Step 1: Replace the function body**

Replace the existing `calculateBuffer` (lines 14-33) with:

```ts
export function calculateBuffer(
  appointmentDateStr: string | null,
  totalTreatmentWeeks: number,
  cycleStartDate: string | null,
  skipCount: number
): BufferResult {
  if (!appointmentDateStr || totalTreatmentWeeks === 0 || !cycleStartDate) return { kind: "hidden" }

  const apptDate = parseDateOnly(appointmentDateStr)
  const todayMidnight = parseDateOnly(todayDateString())
  if (apptDate <= todayMidnight) return { kind: "past" }

  const finalDay7Date = parseDateOnly(
    projectedDateForPosition(cycleStartDate, skipCount, totalTreatmentWeeks, 7)
  )
  const bufferDays = Math.round((apptDate.getTime() - finalDay7Date.getTime()) / MS_PER_DAY) - 1

  if (bufferDays < 0) return { kind: "behind", count: Math.abs(bufferDays) }
  return { kind: "days", count: bufferDays }
}
```

- [ ] **Step 2: Verify by hand against the spec example**

If `cycle_start_date = 2026-05-29`, `skip_count = 0`, `totalTreatmentWeeks = 10`, then `finalDay7Date = projectedDateForPosition(...) = addDays("2026-05-29", positionIndexOf(10,7)) = addDays("2026-05-29", 69) = 2026-08-06`. If `appointmentDateStr = "2026-08-20"`, `bufferDays = (Aug 20 - Aug 6) - 1 = 13`. Confirm this by running:

```bash
node -e "
const start = new Date(2026, 4, 29); // May 29
const end = new Date(start); end.setDate(end.getDate() + 69);
console.log(end.toDateString()); // expect Thu Aug 06 2026
"
```

- [ ] **Step 3: Commit**

```bash
git add lib/schedule.ts
git commit -m "feat: redesign calculateBuffer to project from cycle_start_date instead of overcounting total weeks"
```

---

### Task 4: `lib/types.ts` and `lib/supabase.ts` Changes

**Files:**
- Modify: `lib/types.ts:45-52` (`DoseState` interface)
- Modify: `lib/supabase.ts:63-80` (`fetchDoseState`)
- Modify: `lib/supabase.ts:432-450` (`saveDoseState`)
- Modify: `lib/supabase.ts:218-263` (`fetchCompletedPositions`, `fetchCompletedDayDates`)
- Delete: `lib/supabase.ts:159-173` (`fetchLastDay7Completion` — dead code)
- Delete: `lib/supabase.ts:233-245` (`fetchLoggedPositions` — dead code, superseded)
- Create: `saveSkipDay`, `fetchDateHasDayRecord` in `lib/supabase.ts`

**Interfaces:**
- Consumes: `getCalendarPosition` from Task 2
- Produces: `DoseState.cycleStartDate: string`, `DoseState.skipCount: number`; `fetchDoseState(): Promise<DoseState | null>` (now returns *live computed* `currentWeek`/`currentDay`, derived from `cycleStartDate`/`skipCount`, not the raw DB columns); `saveSkipDay(week: number, day: number): Promise<void>`; `fetchDateHasDayRecord(dateStr: string): Promise<boolean>`; `fetchDayRecords(): Promise<Map<string, DayRecord>>` where `DayRecord = { date: string; skipped: boolean }`

- [ ] **Step 1: Update `DoseState` in `lib/types.ts`**

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
}

export interface DayRecord {
  date: string
  skipped: boolean
}
```

- [ ] **Step 2: Update `fetchDoseState` to select the new columns and compute live position**

Replace `lib/supabase.ts:63-80`:

```ts
export async function fetchDoseState(): Promise<DoseState | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_state")
    .select("checked_foods, completed_days, morning_skipped, evening_skipped, cycle_start_date, skip_count")
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
  }
}
```

Add the import at the top of `lib/supabase.ts`:

```ts
import { getCalendarPosition } from "./schedule"
```

- [ ] **Step 3: Update `saveDoseState` to write the new fields (keep `current_week`/`current_day` as a write-only debug cache)**

Replace `lib/supabase.ts:432-450`:

```ts
export async function saveDoseState(state: DoseState): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_state")
    .upsert(
      {
        family_id: familyId,
        current_week: state.currentWeek,
        current_day: state.currentDay,
        checked_foods: state.checkedFoods,
        completed_days: state.completedDays ?? {},
        morning_skipped: state.morningSkipped ?? false,
        evening_skipped: state.eveningSkipped ?? false,
        cycle_start_date: state.cycleStartDate,
        skip_count: state.skipCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "family_id" }
    )
  if (error) throw error
}
```

(Callers of `saveDoseState` are updated in Tasks 5-7 to always pass `cycleStartDate`/`skipCount`.)

- [ ] **Step 4: Delete dead functions**

Delete `fetchLastDay7Completion` (`lib/supabase.ts:159-173`) and `fetchLoggedPositions` (`lib/supabase.ts:233-245`) entirely.

- [ ] **Step 5: Broaden `fetchCompletedPositions` to include skipped (resolved) positions**

Replace `lib/supabase.ts:218-231`:

```ts
export async function fetchCompletedPositions(): Promise<Set<string>> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("week, day")
    .eq("family_id", familyId)
    .eq("session", "day")
  if (error) throw error
  const set = new Set<string>()
  for (const row of data ?? []) {
    set.add(`${row.week as number}-${row.day as number}`)
  }
  return set
}
```

(Dropped the `is_skipped=false` filter — a skipped day is just as "resolved" as a completed one for the purpose of unlocking Day + browsing, since both mean the day is no longer the live, in-progress day.)

- [ ] **Step 6: Replace `fetchCompletedDayDates` with `fetchDayRecords`**

Replace `lib/supabase.ts:247-263` (the old `fetchCompletedDayDates`) with:

```ts
export async function fetchDayRecords(): Promise<Map<string, DayRecord>> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("week, day, completed_at, is_skipped")
    .eq("family_id", familyId)
    .eq("session", "day")
    .order("completed_at", { ascending: true })
  if (error) throw error
  const map = new Map<string, DayRecord>()
  for (const row of data ?? []) {
    // ascending order: last row per position wins (most recent) — see Design Note above
    map.set(`${row.week as number}-${row.day as number}`, {
      date: row.completed_at as string,
      skipped: row.is_skipped as boolean,
    })
  }
  return map
}
```

Add `DayRecord` to the type import at the top of `lib/supabase.ts`:

```ts
import { ParsedSchedule, DoseState, DoseLogDay, DayRecord } from "./types"
```

- [ ] **Step 7: Add `saveSkipDay`**

Add near `saveDoseLog`:

```ts
export async function saveSkipDay(week: number, day: number): Promise<void> {
  const familyId = await getFamilyId()
  const { error: logError } = await getClient()
    .from("dose_log")
    .insert({
      family_id: familyId,
      week,
      day,
      session: "day",
      checked_foods: {},
      completed_at: new Date().toISOString(),
      is_skipped: true,
    })
  if (logError) throw logError

  const { error: incrementError } = await getClient().rpc("increment_skip_count", {
    p_family_id: familyId,
  })
  if (incrementError) throw incrementError
}
```

This calls a Postgres function for an atomic increment (avoids a read-then-write race on `skip_count`). Add the function in a second migration file:

```sql
-- supabase/migrations/20260620_increment_skip_count_fn.sql
CREATE OR REPLACE FUNCTION increment_skip_count(p_family_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE dose_state SET skip_count = skip_count + 1, updated_at = now()
  WHERE family_id = p_family_id;
$$;
```

- [ ] **Step 8: Add `fetchDateHasDayRecord`**

```ts
export async function fetchDateHasDayRecord(dateStr: string): Promise<boolean> {
  const familyId = await getFamilyId()
  const { count, error } = await getClient()
    .from("dose_log")
    .select("*", { count: "exact", head: true })
    .eq("family_id", familyId)
    .eq("session", "day")
    .gte("completed_at", `${dateStr}T00:00:00`)
    .lt("completed_at", `${dateStr}T23:59:59.999`)
  if (error) throw error
  return (count ?? 0) > 0
}
```

- [ ] **Step 9: Run the migration for the increment function**

Run the `increment_skip_count` SQL (Step 7) in the Supabase SQL editor, same way as Task 1.

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in files not yet updated by this plan (Tasks 5-8) — confirms Task 4's own changes are internally consistent. Re-run after each later task to confirm errors shrink to zero.

- [ ] **Step 11: Commit**

```bash
git add lib/types.ts lib/supabase.ts supabase/migrations/20260620_increment_skip_count_fn.sql
git commit -m "feat: derive dose_state position from cycle_start_date/skip_count, add Skip Day persistence"
```

---

### Task 5: Onboarding — Set `cycle_start_date` on Setup

**Files:**
- Modify: `app/onboarding/page.tsx:62-74` (`saveAndRedirect`)

**Interfaces:**
- Consumes: `cycleStartDateForPosition` from Task 2, updated `saveDoseState` from Task 4

- [ ] **Step 1: Update `saveAndRedirect`**

Replace `app/onboarding/page.tsx:62-74`:

```ts
async function saveAndRedirect(withCatchup: boolean) {
  setSaving(true)
  try {
    await saveFamilyConfig(familyName.trim(), appointmentDate || null)
    const positionChanged = week !== originalWeek || day !== originalDay
    if (positionChanged || !existingDoseState) {
      await saveDoseState({
        currentWeek: week,
        currentDay: day,
        checkedFoods: {},
        completedDays: existingDoseState?.completedDays ?? {},
        cycleStartDate: cycleStartDateForPosition(week, day),
        skipCount: 0,
      })
    }
    if (withCatchup) {
      await saveBulkCatchUpLog(week, day)
    }
    router.replace("/daily")
  } catch {
    setSaving(false)
  }
}
```

Add the import:

```ts
import { cycleStartDateForPosition } from "@/lib/schedule"
```

This covers both fresh starts (`week=1, day=1` → `cycleStartDateForPosition(1,1)` = today) and mid-protocol starts (e.g. `week=3, day=2` → today minus 15 days) with the same call, matching the design's onboarding rule — no new UI field needed.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `app/onboarding/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/onboarding/page.tsx
git commit -m "feat: set cycle_start_date during onboarding"
```

---

### Task 6: Settings — Re-anchor on Manual Position Override

**Files:**
- Modify: `app/settings/page.tsx:146-166` (`saveAll`)

**Interfaces:**
- Consumes: `cycleStartDateForPosition` from Task 2

- [ ] **Step 1: Update `saveAll`**

Replace the `positionChanged` block in `app/settings/page.tsx:155-165`:

```ts
const positionChanged = week !== originalWeek || day !== originalDay
if (positionChanged || !existingDoseState) {
  await saveDoseState({
    currentWeek: week,
    currentDay: day,
    checkedFoods: {},
    completedDays: existingDoseState?.completedDays ?? {},
    cycleStartDate: cycleStartDateForPosition(week, day),
    skipCount: 0,
  })
  setOriginalWeek(week)
  setOriginalDay(day)
}
```

Add the import:

```ts
import { cycleStartDateForPosition } from "@/lib/schedule"
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `app/settings/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat: re-anchor cycle_start_date on manual Settings position override"
```

---

### Task 7: `app/daily/page.tsx` — Live Position, Simplified Completion, Warning Detection

**Files:**
- Modify: `app/daily/page.tsx` (imports, `load()`, `handleCompleteDay`, new state for the warning banner)

**Interfaces:**
- Consumes: `getCalendarPosition`, `todayDateString`, `addDays` from Task 2; `fetchDayRecords`, `fetchDateHasDayRecord`, `saveSkipDay` from Task 4
- Produces: new props passed to `DailyView`: `dayRecords: Map<string, DayRecord>`, `previousDayIncomplete: boolean`, `onSkipDay: () => void`

- [ ] **Step 1: Update imports**

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
  saveTimezone,
  getSession,
} from "@/lib/supabase"
import { todayDateString, addDays } from "@/lib/schedule"
```

Remove `countCompletedDaysInWeek` from the import list — no longer used (week-increment is deleted in Step 3).

- [ ] **Step 2: Replace `completedDayDates` state with `dayRecords`, add `previousDayIncomplete`**

Replace lines 31 and the `load()` function body (lines 36-87):

```ts
const [dayRecords, setDayRecords] = useState<Map<string, DayRecord>>(new Map())
const [previousDayIncomplete, setPreviousDayIncomplete] = useState(false)
// treatmentAnchor holds the current treatment day position, computed live from
// cycle_start_date + skip_count. Set from doseState on load — never advanced
// locally except by re-fetching doseState after a write that re-anchors it
// (Settings, Skip Day does NOT re-anchor — see handleSkipDay).
const [treatmentAnchor, setTreatmentAnchor] = useState<{ week: number; day: number } | null>(null)

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

    saveTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone).catch(() => {})

    try {
      const s = await fetchSchedule()
      if (!s) {
        router.replace("/setup")
        return
      }
      const [ds, apptDate, name, positions, records] = await Promise.all([
        fetchDoseState(),
        fetchAppointmentDate().catch(() => null),
        fetchFamilyName().catch(() => null),
        fetchCompletedPositions().catch(() => new Set<string>()),
        fetchDayRecords().catch(() => new Map<string, DayRecord>()),
      ])
      if (!name) {
        router.replace("/onboarding")
        return
      }
      const initialState = ds ?? {
        currentWeek: 1,
        currentDay: 1,
        checkedFoods: {},
        cycleStartDate: todayDateString(),
        skipCount: 0,
      }
      setSchedule(s)
      setDoseState(initialState)
      setTreatmentAnchor({ week: initialState.currentWeek, day: initialState.currentDay })
      setAppointmentDate(apptDate)
      setFamilyName(name)
      setCompletedPositions(positions)
      setDayRecords(records)

      const yesterday = addDays(todayDateString(), -1)
      if (initialState.cycleStartDate < todayDateString()) {
        const hasRecord = await fetchDateHasDayRecord(yesterday).catch(() => true)
        setPreviousDayIncomplete(!hasRecord)
      }

      setHydrated(true)
    } catch {
      router.replace("/setup")
    }
  }
  load()
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

Add the `DayRecord` type import:

```ts
import { ParsedSchedule, DoseState, DayRecord } from "@/lib/types"
```

- [ ] **Step 3: Simplify `handleCompleteDay` — remove week-increment, remove position write**

Replace `handleCompleteDay` (lines 113-158):

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

Position no longer advances here — the day stays "today" until calendar time naturally moves it forward on the next load. `treatmentAnchor` is untouched by this function.

- [ ] **Step 4: Add `handleSkipDay`**

Add after `handleCompleteDay`:

```ts
async function handleSkipDay() {
  const current = doseStateRef.current
  if (!current || !hydrated || !treatmentAnchor) return
  const { week, day } = treatmentAnchor
  const skippedAt = new Date().toISOString()

  try {
    await saveSkipDay(week, day)
  } catch {
    return
  }

  setDayRecords(prev => {
    const next = new Map(prev)
    next.set(`${week}-${day}`, { date: skippedAt, skipped: true })
    return next
  })
  setCompletedPositions(prev => {
    const next = new Set(prev)
    next.add(`${week}-${day}`)
    return next
  })
}
```

- [ ] **Step 5: Pass new props to `DailyView`**

Replace the `DailyView` render block (lines 178-189):

```tsx
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
/>
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors remaining only in `components/DailyView.tsx` and `components/EveningSection.tsx` (updated in Task 8) — confirms `app/daily/page.tsx` itself is internally consistent.

- [ ] **Step 7: Commit**

```bash
git add app/daily/page.tsx
git commit -m "feat: derive daily-view position live, simplify completion, add Skip Day handler"
```

---

### Task 8: `components/DailyView.tsx` and `components/EveningSection.tsx` — UI Surface

**Files:**
- Modify: `components/DailyView.tsx`
- Modify: `components/EveningSection.tsx`

**Interfaces:**
- Consumes: `dayRecords: Map<string, DayRecord>`, `previousDayIncomplete: boolean`, `onSkipDay: () => void` props from Task 7

- [ ] **Step 1: Update `DailyViewProps` and the buffer/date-label logic**

Replace `components/DailyView.tsx:9-56`:

```tsx
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
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

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
}: DailyViewProps) {
  const { currentWeek, currentDay, checkedFoods } = doseState

  const bufferResult = calculateBuffer(
    appointmentDate,
    getTotalTreatmentWeeks(schedule),
    doseState.cycleStartDate,
    doseState.skipCount
  )
  const eveningItems = getTreatmentFoodsForWeek(schedule, currentWeek)

  const viewSeq = (currentWeek - 1) * 7 + currentDay
  const anchorSeq = (treatmentAnchor.week - 1) * 7 + treatmentAnchor.day
  const isFutureDay = viewSeq > anchorSeq
  const isCurrentTreatmentDay = viewSeq === anchorSeq
  const isPastDay = viewSeq < anchorSeq

  const posKey = `${currentWeek}-${currentDay}`
  const record = dayRecords.get(posKey)
  const projectedDate = new Date()
  projectedDate.setDate(projectedDate.getDate() + (viewSeq - anchorSeq))
  const isSkipped = isPastDay && record?.skipped === true
  const dateLabel = isPastDay && record
    ? formatDateLabel(new Date(record.date))
    : formatDateLabel(projectedDate)
  const showPreviousDayWarning = isCurrentTreatmentDay && previousDayIncomplete

  function handleCheck(key: string, val: boolean) {
    onStateChange(prev => ({ ...prev, checkedFoods: { ...prev.checkedFoods, [key]: val } }))

    if (val && key.startsWith("evening-") && isCurrentTreatmentDay && eveningItems.length > 0) {
      const updatedChecked = { ...checkedFoods, [key]: val }
      const allEveningChecked = eveningItems.every(
        ({ food }) => !!updatedChecked[`evening-${food.name}`]
      )
      if (allEveningChecked) {
        onCompleteDay()
      }
    }
  }

  function handleWeekChange(delta: number) {
    onStateChange(prev => {
      const nextWeek = prev.currentWeek + delta
      if (nextWeek < 1) return prev
      const completedDays = {
        ...(prev.completedDays ?? {}),
        [`${prev.currentWeek}-${prev.currentDay}`]: prev.checkedFoods,
      }
      const restored = completedDays[`${nextWeek}-${prev.currentDay}`] ?? {}
      return { ...prev, currentWeek: nextWeek, checkedFoods: restored, completedDays }
    })
  }

  function handleDayChange(delta: number) {
    onStateChange(prev => {
      const nextDay = prev.currentDay + delta
      if (nextDay < 1 || nextDay > 7) return prev
      const completedDays = {
        ...(prev.completedDays ?? {}),
        [`${prev.currentWeek}-${prev.currentDay}`]: prev.checkedFoods,
      }
      const restored = completedDays[`${prev.currentWeek}-${nextDay}`] ?? {}
      return { ...prev, currentDay: nextDay, checkedFoods: restored, completedDays }
    })
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 min-h-screen flex flex-col">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            {familyName && (
              <p className="text-sm text-gray-500 mb-0.5">{familyName}&apos;s Tip Pal</p>
            )}
            <h1 className="text-2xl font-bold">
              {isSkipped ? "Skipped" : `Week ${currentWeek}, Day ${currentDay}`} · {dateLabel}
            </h1>
          </div>
        </div>

        {showPreviousDayWarning && (
          <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl">
            <p className="text-sm text-amber-900 font-medium">
              Yesterday wasn&apos;t completed — you can still check off today&apos;s foods.
            </p>
          </div>
        )}

        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-10">Week</span>
            <button
              onClick={() => handleWeekChange(-1)}
              className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30"
              disabled={currentWeek <= 1}
            >
              −
            </button>
            <span className="text-lg font-semibold w-6 text-center">{currentWeek}</span>
            <button
              onClick={() => handleWeekChange(1)}
              className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold"
            >
              +
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-8">Day</span>
            <button
              onClick={() => handleDayChange(-1)}
              className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30"
              disabled={currentDay <= 1}
            >
              −
            </button>
            <span className="text-lg font-semibold w-6 text-center">{currentDay}</span>
            <button
              onClick={() => handleDayChange(1)}
              className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl font-bold disabled:opacity-30"
              disabled={currentDay >= 7 || !completedPositions.has(`${currentWeek}-${currentDay}`)}
            >
              +
            </button>
          </div>
        </div>
      </div>

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
            {bufferResult.count} buffer day{bufferResult.count !== 1 ? "s" : ""} after completing protocol
          </p>
        )}
        {bufferResult.kind === "behind" && (
          <p className="mt-2 text-sm text-amber-700 font-medium">
            {bufferResult.count} day{bufferResult.count !== 1 ? "s" : ""} short — appointment falls within the protocol period
          </p>
        )}
        {bufferResult.kind === "past" && (
          <p className="mt-2 text-sm text-amber-700 font-medium">
            Appointment date has passed — please update
          </p>
        )}
      </div>

      <MorningSection
        schedule={schedule}
        currentDay={currentDay}
        checkedFoods={checkedFoods}
        onCheck={handleCheck}
        isFutureDay={isFutureDay}
      />

      <EveningSection
        schedule={schedule}
        currentWeek={currentWeek}
        checkedFoods={checkedFoods}
        onCheck={handleCheck}
        onSkipDay={onSkipDay}
        isFutureDay={isFutureDay}
        isCurrentTreatmentDay={isCurrentTreatmentDay}
      />

      <div className="mt-auto pt-4">
        <div className="flex justify-center gap-6 pb-4">
          <Link href="/history" className="text-sm text-gray-400 underline">
            Dose history
          </Link>
          <Link href="/settings" className="text-sm text-gray-400 underline">
            Settings
          </Link>
        </div>
      </div>
    </div>
  )
}
```

Update the top of `components/DailyView.tsx` (imports and `formatDateLabel`'s preceding type import):

```ts
import { ParsedSchedule, DoseState, DayRecord } from "@/lib/types"
```

(`DayRecord` added alongside the existing `ParsedSchedule, DoseState` import on line 3.)

- [ ] **Step 2: Add the Skip Day button to `EveningSection`**

Replace `components/EveningSection.tsx` in full:

```tsx
"use client"

import { useState } from "react"
import { ParsedSchedule } from "@/lib/types"
import FoodItem from "./FoodItem"
import { getTreatmentFoodsForWeek } from "@/lib/schedule"

interface EveningSectionProps {
  schedule: ParsedSchedule
  currentWeek: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  onSkipDay: () => void
  isFutureDay: boolean
  isCurrentTreatmentDay: boolean
}

export default function EveningSection({
  schedule,
  currentWeek,
  checkedFoods,
  onCheck,
  onSkipDay,
  isFutureDay,
  isCurrentTreatmentDay,
}: EveningSectionProps) {
  const treatmentItems = getTreatmentFoodsForWeek(schedule, currentWeek)
  const [confirming, setConfirming] = useState(false)

  const allChecked = treatmentItems.length > 0 && treatmentItems.every(
    ({ food }) => !!checkedFoods[`evening-${food.name}`]
  )
  const canSkip = isCurrentTreatmentDay && !isFutureDay && !allChecked && treatmentItems.length > 0

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
            {treatmentItems.map(({ food, weekEntry, isContinuing }) => (
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
                onChange={(val) => onCheck(`evening-${food.name}`, val)}
              />
            ))}
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

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors across the whole project — this is the last task touching application code, so this confirms every change across Tasks 2-8 is internally consistent.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`, log in as the existing test account, and confirm:
- Header shows "Week X, Day Y · <today's date>" with no console errors
- Buffer day text still renders (or "hidden"/"past" states as appropriate)
- Checking all evening treatment foods still logs completion (verify via `/history`) without changing the header's week/day
- Settings page still loads and pre-fills week/day correctly from the live computed position

- [ ] **Step 5: Commit**

```bash
git add components/DailyView.tsx components/EveningSection.tsx
git commit -m "feat: add Skip Day UI, Skipped header label, and previous-day warning banner"
```

---

### Task 9: One-Time Production Migration Verification

**Files:** None (verification only — Task 1 already ran the schema migration and backfill)

**Interfaces:** None

- [ ] **Step 1: Confirm the live account now advances correctly under the new model**

```bash
set -a && source .env.local && set +a
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/dose_state?select=family_id,cycle_start_date,skip_count" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | python3 -m json.tool
```

Expected: one row, `cycle_start_date` set, `skip_count: 0`.

- [ ] **Step 2: Cross-check against the formula by hand**

Using the `cycle_start_date` from Step 1 and today's date, compute `positionIndexOf` manually and confirm it matches what `/daily` displays after Task 8 is deployed (e.g. via `npm run dev` and logging in).

- [ ] **Step 3: No commit needed** — this task is verification only.

---

## Self-Review

**Spec coverage:**
- Day 1 = protocol start date, consecutive dating → Task 2 (`getCalendarPosition`), Task 4 (`fetchDoseState` computes live), Task 5/6 (`cycleStartDateForPosition` on setup/override). Covered.
- Auto-advance by default, even if incomplete → Task 7 (`handleCompleteDay` no longer writes position; position is purely calendar-derived). Covered.
- Non-blocking warning on the new day → Task 7 (`previousDayIncomplete`), Task 8 (warning banner, foods remain enabled — `isFutureDay`/`isCurrentTreatmentDay` logic untouched by the warning). Covered.
- Skip Day freezes position, repeats tomorrow → Task 4 (`saveSkipDay` increments `skip_count`), Task 2 formula (verified against the spec example in the verification script). Covered.
- Skipped header label → Task 8 (`isSkipped` check against `dayRecords`). Covered.
- Mid-protocol undated history → Task 5 (`cycleStartDateForPosition` makes positions before cycle start mathematically undefined — Day − navigation's existing `disabled={currentDay <= 1}` / `currentWeek <= 1` bounds already stop at Week 1 Day 1, and nothing in this plan adds the ability to browse below the entered starting position, so there's nothing further to build for this criterion). Covered — documented, not a separate code change.
- Week-increment and buffer redesign → Task 3 (buffer), Task 7 (week-increment counter deleted, week is now always derived). Covered.
- `is_skipped` legacy rows don't break anything → confirmed during Architect investigation (only 1 production row, `session:'morning'`, never touches `session:'day'` queries this plan modifies). No task needed — verified, not built.

**Placeholder scan:** No TBD/TODO markers; every step has complete, concrete code.

**Type consistency:** `DayRecord` (`{ date: string; skipped: boolean }`) defined once in Task 4 Step 1, used identically in Task 4 Step 6 (`fetchDayRecords`), Task 7 (state + import), Task 8 (`DailyView` props + `EveningSection` does not need it directly). `getCalendarPosition`, `cycleStartDateForPosition`, `projectedDateForPosition`, `todayDateString`, `addDays` signatures match between Task 2's definitions and every call site in Tasks 3-7.

---

## Execution Handoff

Plan complete and saved to `plans/PHASE-3-F0.1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
