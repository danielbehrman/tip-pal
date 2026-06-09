# Phase 3 — F0: Daily View UX Fixes

## Ticket
**Goal:** Fix core usability issues discovered during dogfooding — missing date context, manual completion requirement, and ability to log out-of-order days.

**Acceptance Criteria:**
1. Completed days display `completed_at` date from dose_log: "Week 1, Day 4 · Thu Jun 6"
2. Current incomplete day displays today's live calendar date in the same format
3. When last evening treatment food is checked → day auto-completes, no user action
4. `completed_at` written to dose_log at moment of auto-complete
5. App advances to next day automatically on auto-complete
6. Complete Day button removed entirely
7. Skip Session button and skip logging removed entirely
8. Checking foods on any day ahead of current treatment day → blocked
9. Blocked state: inline error "You haven't reached this treatment day yet"
10. Day +/− navigation (browsing) still allowed — only food interaction blocked on future days

**Constraints:**
- Evening treatment foods only gate auto-complete (morning is informational)
- No new DB schema fields — dates derived from `completed_at` for past days, live date for current
- is_skipped rows must not be broken — treat them as logged for treatment day position

---

## Architecture

### Treatment Day Position
The "current treatment day" is derived from `loggedPositions` (all dose_log rows, including is_skipped). Walk forward from Week 1, Day 1 until the first unlogged position. This is independent of manual navigation so the position is always accurate even if the user navigated ahead with Week +/−.

```
function getTreatmentPosition(loggedPositions: Set<string>): { week, day }
  walk: 1-1, 1-2, ..., 1-7, 2-1, ...
  return first position not in loggedPositions
```

### Future Day Check
```
viewSeq = (currentWeek - 1) * 7 + currentDay
treatSeq = (treatmentPos.week - 1) * 7 + treatmentPos.day
isFutureDay = viewSeq > treatSeq
isCurrentTreatmentDay = !completedPositions.has(`${currentWeek}-${currentDay}`) && !isFutureDay
```

### Auto-Complete Trigger
In `DailyView.handleCheck`:
- Only when `val === true` (checking, not unchecking)
- Only when key starts with `evening-`
- Only when `isCurrentTreatmentDay`
- Check if all evening treatment foods are now checked using updated state
- If yes: call `onCompleteDay()`

### Date Header
- Completed day: format `completedDayDates.get("week-day")` using `toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })`
- Current day: format `new Date()` the same way

---

## Files Changed

### `lib/supabase.ts`
Add:
- `fetchCompletedDayDates()` → `Map<string, string>` — week-day key → completedAt for `session='day'`, `is_skipped=false` rows
- `fetchLoggedPositions()` → `Set<string>` — all (week,day) pairs in dose_log, any session, any is_skipped (for treatment day position calc)

### `components/FoodItem.tsx`
- Add `disabled?: boolean` prop — opacity-50, cursor-not-allowed, disables input

### `components/MorningSection.tsx`
- Remove `skipped`, `onSkip` props
- Add `isFutureDay: boolean` — disables checkboxes silently

### `components/EveningSection.tsx`
- Remove `skipped`, `onSkip`, `[confirming]` state
- Add `isFutureDay: boolean` — shows error banner, hides food list when true

### `components/DailyView.tsx`
- Remove `onSkipMorning`, `onSkipEvening` props
- Add `completedDayDates: Map<string, string>` prop
- Add `loggedPositions: Set<string>` prop
- Compute `treatmentPos`, `isFutureDay`, `isCurrentTreatmentDay`
- Compute date label for header ("Week X, Day Y · Day Mon D")
- `handleCheck`: trigger `onCompleteDay()` when auto-complete conditions met
- Remove Complete Day button, confirm dialog, `confirmingComplete`, `completionAttempted`
- Remove `eveningSkipped` from Week + and Day + disabled conditions
- Pass `isFutureDay` to MorningSection and EveningSection

### `app/daily/page.tsx`
- Remove `saveSkipLog` import
- Remove `handleSkipMorning`, `handleSkipEvening`
- Add `completedDayDates` state (`Map<string, string>`)
- Add `loggedPositions` state (`Set<string>`)
- Fetch both in `load()` alongside existing fetches
- In `handleCompleteDay`: optimistically update `completedDayDates` and `loggedPositions`
- Remove skip props from DailyView, add new props

---

## Risk: is_skipped rows in production
`fetchLoggedPositions` includes all dose_log rows (no is_skipped filter). If production has is_skipped rows for a given (week, day) without a corresponding session='day' row, those positions will still count as "logged" for treatment day position. This is the correct per-spec behavior.
